'use strict';

// $ node app_worker.js options
const options = JSON.parse(process.argv[2]);
if (options.require) {
  // inject
  options.require.forEach(mod => {
    require(mod);
  });
}

let AppWorker;
if (options.startMode === 'worker_threads') {
  AppWorker = require('./utils/mode/impl/worker_threads/app').AppWorker;
} else {
  AppWorker = require('./utils/mode/impl/process/app').AppWorker;
}

const os = require('os');
const fs = require('fs');
const debug = require('util').debuglog('egg-cluster:app_worker');
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
const clusterConfig = app.config.cluster || /* istanbul ignore next */ {};
const listenConfig = clusterConfig.listen || /* istanbul ignore next */ {};
const httpsOptions = Object.assign({}, clusterConfig.https, options.https);
const port = options.port = options.port || listenConfig.port;
const debugPort = options.debugPort;
const protocol = (httpsOptions.key && httpsOptions.cert) ? 'https' : 'http';

// https://nodejs.org/api/net.html#serverlistenoptions-callback
// https://github.com/nodejs/node/blob/main/node.gypi#L310
// https://docs.python.org/3/library/sys.html#sys.platform
// This option is available only on some platforms, such as Linux 3.9+, DragonFlyBSD 3.6+, FreeBSD 12.0+, Solaris 11.4, and AIX 7.2.5+.
const supportedPlatforms = [ 'linux', 'freebsd', 'sunos', 'aix' ];
let reusePort = options.reusePort = options.reusePort || listenConfig.reusePort;
if (reusePort && !supportedPlatforms.includes(os.platform())) {
  reusePort = false;
  options.reusePort = false;
  debug('platform %s is not supported currently, set reusePort to false', os.platform());
}

AppWorker.send({
  to: 'master',
  action: 'realport',
  data: {
    port,
    protocol,
  },
});

app.ready(startServer);

function exitProcess() {
  // Use SIGTERM kill process, ensure trigger the gracefulExit
  AppWorker.kill();
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
  let debugPortServer;

  // https config
  if (httpsOptions.key && httpsOptions.cert) {
    httpsOptions.key = fs.readFileSync(httpsOptions.key);
    httpsOptions.cert = fs.readFileSync(httpsOptions.cert);
    httpsOptions.ca = httpsOptions.ca && fs.readFileSync(httpsOptions.ca);
    server = require('https').createServer(httpsOptions, app.callback());
    if (debugPort) {
      debugPortServer = require('http').createServer(app.callback());
    }
  } else {
    server = require('http').createServer(app.callback());
    if (debugPort) {
      debugPortServer = server;
    }
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
    AppWorker.on('message', (message, connection) => {
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
      if (reusePort) {
        // https://nodejs.org/api/net.html#serverlistenoptions-callback
        const listenOptions = { port, reusePort };
        if (listenConfig.hostname) {
          listenOptions.host = listenConfig.hostname;
        }
        debug('listen options %j', listenOptions);
        server.listen(listenOptions);
      } else {
        const args = [ port ];
        if (listenConfig.hostname) {
          args.push(listenConfig.hostname);
        }
        debug('listen options %s', args);
        server.listen(...args);
      }
    }
    if (debugPortServer) {
      debug('listen on debug port: %s', debugPort);
      debugPortServer.listen(debugPort);
    }
  }

  AppWorker.send({
    to: 'master',
    action: 'listening',
    data: server.address() || { port },
  });
}

AppWorker.gracefulExit({
  logger: consoleLogger,
  label: 'app_worker',
  beforeExit: () => app.close(),
});
