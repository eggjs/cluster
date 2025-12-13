'use strict';

const cluster = require('cluster');
const cfork = require('cfork');
const sendmessage = require('sendmessage');
const gracefulExit = require('graceful-process');

const { BaseAppWorker, BaseAppUtils } = require('../../base/app');
const terminate = require('../../../terminate');

class AppWorker extends BaseAppWorker {
  get id() {
    return this.instance.id;
  }

  get workerId() {
    return this.instance.process.pid;
  }

  get state() {
    return this.instance.state;
  }

  get exitedAfterDisconnect() {
    return this.instance.exitedAfterDisconnect;
  }

  get exitCode() {
    return this.instance.exitCode;
  }

  send(...args) {
    sendmessage(this.instance, ...args);
  }

  clean() {
    this.instance.removeAllListeners();
  }

  static on(event, callback) {
    process.on(event, callback);
  }

  static send(message) {
    if (message && message.action === 'listening' && message.reusePort) {
      // cluster won't get `listening` event when reusePort is true, use cluster `message` event instead
      // rewrite message.action to 'reuse-port-listening'
      message.action = 'reuse-port-listening';
      cluster.worker.send(message);
      return;
    }
    process.send(message);
  }

  static kill() {
    process.exitCode = 1;
    process.kill(process.pid);
  }

  static gracefulExit(options) {
    gracefulExit(options);
  }
}

class AppUtils extends BaseAppUtils {
  fork() {
    this.startTime = Date.now();
    this.startSuccessCount = 0;

    const args = [ JSON.stringify(this.options) ];
    this.log('[master] start appWorker with args %j (process)', args);
    cfork({
      exec: this.getAppWorkerFile(),
      args,
      silent: false,
      count: this.options.workers,
      // don't refork in local env
      refork: this.isProduction,
      windowsHide: process.platform === 'win32',
    });

    let debugPort = process.debugPort;
    cluster.on('fork', worker => {
      const appWorker = new AppWorker(worker);
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
      this.log('[master] app_worker#%s:%s start, state: %s, current workers: %j',
        appWorker.id, appWorker.workerId, appWorker.state, Object.keys(cluster.workers));

      // send debug message, due to `brk` scence, send here instead of app_worker.js
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
    });
    cluster.on('disconnect', worker => {
      const appWorker = new AppWorker(worker);
      this.logger.info('[master] app_worker#%s:%s disconnect, suicide: %s, state: %s, current workers: %j',
        appWorker.id, appWorker.workerId, appWorker.exitedAfterDisconnect, appWorker.state, Object.keys(cluster.workers));
    });
    cluster.on('exit', (worker, code, signal) => {
      const appWorker = new AppWorker(worker);
      this.messenger.send({
        action: 'app-exit',
        data: {
          workerId: appWorker.workerId,
          code,
          signal,
        },
        to: 'master',
        from: 'app',
      });
    });
    cluster.on('listening', (worker, address) => {
      const appWorker = new AppWorker(worker);
      this.logger.info('[master] app_worker#%s:%s listening on %j', appWorker.id, appWorker.workerId, address);
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
    // handle 'reuse-port-listening' message: { action: 'reuse-port-listening', data: { port: 3000 } }
    cluster.on('message', (worker, message) => {
      if (!message || message.action !== 'reuse-port-listening') {
        return;
      }
      const address = message.data;
      const appWorker = new AppWorker(worker);
      this.logger.info('[master] app_worker#%s:%s reuse-port listening on %j', appWorker.id, appWorker.workerId, address);
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

    return this;
  }

  async kill(timeout) {
    await Promise.all(Object.keys(cluster.workers).map(id => {
      const worker = cluster.workers[id];
      worker.disableRefork = true;
      return terminate(worker, timeout);
    }));
  }
}

module.exports = { AppWorker, AppUtils };
