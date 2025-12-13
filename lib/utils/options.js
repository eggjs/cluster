'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const utils = require('egg-utils');
const is = require('is-type-of');

module.exports = function(options) {
  const defaults = {
    framework: '',
    baseDir: process.cwd(),
    port: options.https ? 8443 : null,
    reusePort: false,
    workers: null,
    plugins: null,
    https: false,
    startMode: 'process',
    ports: [],
    env: null,
  };
  options = extend(defaults, options);
  if (!options.workers) {
    options.workers = os.cpus().length;
  }
  if (!options.env && process.env.EGG_SERVER_ENV) {
    options.env = process.env.EGG_SERVER_ENV;
  }

  const pkgPath = path.join(options.baseDir, 'package.json');
  assert(fs.existsSync(pkgPath), `${pkgPath} should exist`);

  options.framework = utils.getFrameworkPath({
    baseDir: options.baseDir,
    // compatible customEgg only when call startCluster directly without framework
    framework: options.framework || options.customEgg,
  });

  const egg = require(options.framework);
  assert(egg.Application, `should define Application in ${options.framework}`);
  assert(egg.Agent, `should define Agent in ${options.framework}`);

  // https
  if (options.https) {
    if (is.boolean(options.https)) {
      // TODO: compatible options.key, options.cert, will remove at next major
      /* istanbul ignore next */
      console.warn('[egg-cluster:deprecated] [master] Please use `https: { key, cert, ca }` instead of `https: true`');
      options.https = {
        key: options.key,
        cert: options.cert,
      };
    }
    assert(options.https.key && fs.existsSync(options.https.key), 'options.https.key should exists');
    assert(options.https.cert && fs.existsSync(options.https.cert), 'options.https.cert should exists');
    assert(!options.https.ca || fs.existsSync(options.https.ca), 'options.https.ca should exists');
  }

  options.port = parseInt(options.port, 10) || undefined;
  options.workers = parseInt(options.workers, 10);
  if (options.require) options.require = [].concat(options.require);

  // don't print deprecated message in production env.
  // it will print to stderr.
  if (process.env.NODE_ENV === 'production') {
    process.env.NO_DEPRECATION = '*';
  }

  const isDebug = process.execArgv.some(argv => argv.includes('--debug') || argv.includes('--inspect'));
  if (isDebug) options.isDebug = isDebug;

  return options;
};

function extend(target, src) {
  const keys = Object.keys(src);
  for (const key of keys) {
    if (src[key] != null) {
      target[key] = src[key];
    }
  }
  return target;
}
