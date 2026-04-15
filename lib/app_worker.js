'use strict';

// $ node app_worker.js options
const options = JSON.parse(process.argv[2]);
if (options.require) {
  // inject
  options.require.forEach(mod => {
    require(mod);
  });
}

const fs = require('fs');
const debug = require('debug')('egg-cluster');
const gracefulExit = require('graceful-process');
const ConsoleLogger = require('egg-logger').EggConsoleLogger;
const consoleLogger = new ConsoleLogger({
  level: process.env.EGG_APP_WORKER_LOGGER_LEVEL,
});
const Application = require(options.framework).Application;
debug('new Application with options %j', options);
let app;
try {
  app = new Application(options);
} catch (err) {
  consoleLogger.error(err);
  throw err;
}

// IPC logging — register after `new Application` so that app constructors which throw synchronously
// (e.g. fixtures that trigger framework errors) do not pay the extra require/listener cost nor
// perturb the timing of events that were racing with master-side teardown before this change.
const { ipcLogger, formatIpcMessage, internalIpcLogEnabled } = require('./utils/ipc_logger');

// D. master -> app (recv): log every IPC message delivered to this worker via the cluster channel.
// Handle is present when master forwards a net.Socket (sticky-session mode).
// This listener is read-only; other `process.on('message')` listeners (framework, sticky handler,
// etc.) are unaffected.
process.on('message', (msg, handle) => {
  const body = typeof msg === 'string' ? { action: msg } : msg;
  ipcLogger.info(formatIpcMessage(`app#${process.pid}<-master`, body, handle));
});

// F. master -> app internal NODE_CLUSTER messages (newconn with fd, disconnect, suicide, ...).
// `internalMessage` is an undocumented but stable Node.js event.
// Opt-in via EGG_CLUSTER_IPC_LOG because `newconn` fires once per HTTP request.
if (internalIpcLogEnabled) {
  process.on('internalMessage', (msg, handle) => {
    if (!msg || msg.cmd !== 'NODE_CLUSTER') return;
    const label = msg.act ? `cluster:${msg.act}` : `cluster:ack#${msg.ack != null ? msg.ack : '?'}`;
    ipcLogger.info(formatIpcMessage(
      `app#${process.pid}<-master`,
      { action: label, data: msg },
      handle
    ));
  });
}

const clusterConfig = app.config.cluster || /* istanbul ignore next */ {};
const listenConfig = clusterConfig.listen || /* istanbul ignore next */ {};
const httpsOptions = Object.assign({}, clusterConfig.https, options.https);
const port = options.port = options.port || listenConfig.port;
const protocol = (httpsOptions.key && httpsOptions.cert) ? 'https' : 'http';

// C. app -> master (send): there is exactly one direct process.send() in the app worker — `realport`.
// All other master-side lifecycle info (app-start / app-exit) is derived from cluster events, not from
// explicit app-to-master sends.
const realportMessage = {
  to: 'master',
  action: 'realport',
  data: {
    port,
    protocol,
  },
};
ipcLogger.info(formatIpcMessage(`app#${process.pid}->master`, realportMessage));
process.send(realportMessage);

app.ready(startServer);

function exitProcess() {
  // Use SIGTERM kill process, ensure trigger the gracefulExit
  process.exitCode = 1;
  process.kill(process.pid);
}

// exit if worker start timeout
app.once('startTimeout', startTimeoutHandler);

function startTimeoutHandler() {
  consoleLogger.error('[app_worker] start timeout, exiting with code:1');
  exitProcess();
}

function startServer(err) {
  if (err) {
    consoleLogger.error(err);
    consoleLogger.error('[app_worker] start error, exiting with code:1');
    exitProcess();
    return;
  }

  app.removeListener('startTimeout', startTimeoutHandler);

  let server;

  // https config
  if (httpsOptions.key && httpsOptions.cert) {
    httpsOptions.key = fs.readFileSync(httpsOptions.key);
    httpsOptions.cert = fs.readFileSync(httpsOptions.cert);
    httpsOptions.ca = httpsOptions.ca && fs.readFileSync(httpsOptions.ca);
    server = require('https').createServer(httpsOptions, app.callback());
  } else {
    server = require('http').createServer(app.callback());
  }

  server.once('error', err => {
    consoleLogger.error('[app_worker] server got error: %s, code: %s', err.message, err.code);
    exitProcess();
  });

  // emit `server` event in app
  app.emit('server', server);

  if (options.sticky) {
    server.listen(options.stickyWorkerPort, '127.0.0.1');
    // Listen to messages sent from the master. Ignore everything else.
    process.on('message', (message, connection) => {
      if (message !== 'sticky-session:connection') {
        return;
      }

      // Emulate a connection event on the server by emitting the
      // event with the connection the master sent us.
      server.emit('connection', connection);
      connection.resume();
    });
  } else {
    if (listenConfig.path) {
      server.listen(listenConfig.path);
    } else {
      if (typeof port !== 'number') {
        consoleLogger.error('[app_worker] port should be number, but got %s(%s)', port, typeof port);
        exitProcess();
        return;
      }
      const args = [ port ];
      if (listenConfig.hostname) args.push(listenConfig.hostname);
      debug('listen options %s', args);
      server.listen(...args);
    }
  }
}

gracefulExit({
  logger: consoleLogger,
  label: 'app_worker',
  beforeExit: () => app.close(),
});
