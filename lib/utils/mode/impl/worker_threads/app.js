'use strict';

const workerThreads = require('worker_threads');
const { BaseAppWorker, BaseAppUtils } = require('../../base/app');

class AppWorker extends BaseAppWorker {
  #id = 0;

  constructor(instance, id) {
    super(instance);
    this.#id = id;
  }

  get id() {
    return this.#id;
  }

  get workerId() {
    return this.instance.threadId;
  }

  get state() {
    return 'worker_threads working';
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

      this.log(`[master] worker_threads listening at ${address.address}:${address.port} (%sms)`,
        Date.now() - this.startTime);
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
    worker.on('exit', code => {
      this.messenger.send({
        action: 'app-exit',
        data: {
          workerId: appWorker.workerId,
          code,
        },
        to: 'master',
        from: 'app',
      });
    });
  }

  fork() {
    this.startTime = Date.now();
    this.isAllWorkerStarted = false;
    this.startSuccessCount = 0;

    const argv = [ JSON.stringify(this.options) ];

    for (let i = 0; i < this.options.workers;) {
      this.#forkSingle(this.getAppWorkerFile(), { argv }, ++i);
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