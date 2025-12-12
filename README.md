# egg-cluster

[![NPM version][npm-image]][npm-url]
[![CI](https://github.com/eggjs/cluster/actions/workflows/nodejs.yml/badge.svg)](https://github.com/eggjs/cluster/actions/workflows/nodejs.yml)
[![Test coverage][codecov-image]][codecov-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/egg-cluster.svg?style=flat-square
[npm-url]: https://npmjs.org/package/egg-cluster
[codecov-image]: https://codecov.io/github/eggjs/egg-cluster/coverage.svg?branch=master
[codecov-url]: https://codecov.io/github/eggjs/egg-cluster?branch=master
[snyk-image]: https://snyk.io/test/npm/egg-cluster/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/egg-cluster
[download-image]: https://img.shields.io/npm/dm/egg-cluster.svg?style=flat-square
[download-url]: https://npmjs.org/package/egg-cluster

Cluster Manager for EggJS

---

## Install

```bash
npm i egg-cluster --save
```

## Usage

```js
const startCluster = require('egg-cluster').startCluster;
startCluster({
  baseDir: '/path/to/app',
  framework: '/path/to/framework',
});
```

You can specify a callback that will be invoked when application has started. However, master process will exit when catch an error.

```js
startCluster(options, () => {
  console.log('started');
});
```

## Options

| Param        | Type      | Description                              |
| ------------ | --------- | ---------------------------------------- |
| baseDir      | `String`  | directory of application                 |
| framework    | `String`  | specify framework that can be absolute path or npm package |
| plugins      | `Object`  | plugins for unittest                     |
| workers      | `Number`  | numbers of app workers                   |
| sticky       | `Boolean` | sticky mode server                       |
| port         | `Number`  | port                                     |
| debugPort    | `Number`  | the debug port only listen on http protocol |
| https        | `Object`  | start a https server, note: `key` / `cert` / `ca` should be full path to file |
| require      | `Array\|String` | will inject into worker/agent process |
| pidFile      | `String`  | will save master pid to this file |
| startMode    | `String`  | default is 'process', use 'worker_threads' to start the app & agent worker by worker_threads |
| ports        | `Array`   | startup port of each app worker, such as: [7001, 7002, 7003], only effects when the startMode is 'worker_threads' |
| env        | `String`   | custom env, default is process.env.EGG_SERVER_ENV |

## Env

EGG_APP_CLOSE_TIMEOUT: app worker boot timeout value

EGG_AGENT_CLOSE_TIMEOUT: agent worker boot timeout value

## License

[MIT](LICENSE)

## Contributors

[![Contributors](https://contrib.rocks/image?repo=eggjs/cluster)](https://github.com/eggjs/cluster/graphs/contributors)

Made with [contributors-img](https://contrib.rocks).
