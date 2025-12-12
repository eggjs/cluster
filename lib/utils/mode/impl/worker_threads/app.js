'use strict';

const { sleep } = require('../../../timer');
const workerThreads = require('worker_threads');
const { BaseAppWorker, BaseAppUtils } = require('../../base/app');

class AppWorker extends BaseAppWorker {
  #id = 0;
  #threadId = -1;
  #state = 'none';

  constructor(instance, id) {
    super(instance);
    this.#id = id;
    this.#threadId = instance.threadId;
  }

  get id() {
    return this.#id;
  }

  get workerId() {
    return this.#threadId;
  }

  get state() {
    return this.#state;
  }

  set state(val) {
    this.#state = val;
  }

  get exitedAfterDisconnect() {
    return true;
  }

  get exitCode() {
    return this.instance.exitCode;
  }

  send(...args) {
    this.instance.postMessage(...args);
  }

  clean() {
    this.instance.removeAllListeners();
  }

  static on(event, callback) {
    workerThreads.parentPort.on(event, callback);
  }

  static send(data) {
    workerThreads.parentPort.postMessage(data);
  }

  static kill() {
    process.exit(1);
  }

  static gracefulExit(options) {
    const { beforeExit } = options;
    process.on('exit', async code => {
      if (typeof beforeExit === 'function') {
        await beforeExit();
      }
      process.exit(code);
    });
  }
}

class AppUtils extends BaseAppUtils {
  #workers = [];

  #forkSingle(appPath, options, id) {
    // start app worker
    const worker = new workerThreads.Worker(appPath, options);
    this.#workers.push(worker);

    // wrap app worker
    const appWorker = new AppWorker(worker, id);
    this.emit('worker_forked', appWorker);
    appWorker.disableRefork = true;
    worker.on('message', msg => {
      if (typeof msg === 'string') {
        msg = {
          action: msg,
          data: msg,
        };
      }
      msg.from = 'app';
      this.messenger.send(msg);
    });
    this.log('[master] app_worker#%s (tid:%s) start', appWorker.id, appWorker.workerId);

    // send debug message, due to `brk` scence, send here instead of app_worker.js
    let debugPort = process.debugPort;
    if (this.options.isDebug) {
      debugPort++;
      this.messenger.send({
        to: 'parent',
        from: 'app',
        action: 'debug',
        data: {
          debugPort,
          pid: appWorker.workerId,
        },
      });
    }

    // handle worker listening
    worker.on('message', ({ action, data: address }) => {
      if (action !== 'listening') {
        return;
      }

      if (!address) {
        return;
      }

      appWorker.state = 'listening';
      this.messenger.send({
        action: 'app-start',
        data: {
          workerId: appWorker.workerId,
          address,
        },
        to: 'master',
        from: 'app',
      });

    });

    // handle worker exit
    worker.on('exit', async code => {
      appWorker.state = 'dead';
      this.messenger.send({
        action: 'app-exit',
        data: {
          workerId: appWorker.workerId,
          code,
        },
        to: 'master',
        from: 'app',
      });

      // refork app worker
      await sleep(1000);
      this.#forkSingle(appPath, options, id);
    });
  }

  fork() {
    this.startTime = Date.now();
    this.startSuccessCount = 0;

    if (this.options.reusePort) {
      for (let i = 0; i < this.options.workers; i++) {
        const argv = [ JSON.stringify(this.options) ];
        const appWorkerId = i + 1;
        this.#forkSingle(this.getAppWorkerFile(), { argv }, appWorkerId);
      }
    } else {
      const ports = this.options.ports;
      if (!ports.length) {
        ports.push(this.options.port);
      }
      this.options.workers = ports.length;
      let i = 0;
      do {
        const options = Object.assign({}, this.options, { port: ports[i] });
        const argv = [ JSON.stringify(options) ];
        this.#forkSingle(this.getAppWorkerFile(), { argv }, ++i);
      } while (i < ports.length);
    }

    return this;
  }

  async kill() {
    for (const worker of this.#workers) {
      this.log(`[master] kill app worker#${worker.id} (worker_threads) by worker.terminate()`);
      worker.removeAllListeners();
      worker.terminate();
    }
  }
}

module.exports = { AppWorker, AppUtils };
