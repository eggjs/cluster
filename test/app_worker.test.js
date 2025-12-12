const assert = require('assert');
const { rm } = require('fs/promises');
const mm = require('egg-mock');
const request = require('supertest');
const urllib = require('urllib');
const address = require('address');
const utils = require('./utils');
const { sleep } = require('../lib/utils/timer');

describe('test/app_worker.test.js', () => {
  let app;
  afterEach(() => app && app.close());

  describe('app worker', () => {
    before(() => {
      app = utils.cluster('apps/app-server');
      return app.ready();
    });
    it('should emit `server`', () => {
      return app.httpRequest()
        .get('/')
        .expect('true');
    });
  });

  describe('app worker error', () => {
    it('should exit when app worker error during boot', () => {
      app = utils.cluster('apps/worker-die');

      return app
        // .debug()
        .expect('code', 1)
        .end();
    });

    it('should exit when emit error during app worker boot', () => {
      app = utils.cluster('apps/app-start-error', {
        opt: {
          env: Object.assign({}, process.env, {
            EGG_APP_WORKER_LOGGER_LEVEL: 'INFO',
          }),
        },
      });

      return app
        // .debug()
        .expect('code', 1)
        .expect('stdout', /\[app_worker] beforeExit success/)
        .end();
    });

    it('should FrameworkErrorformater work during app boot', () => {
      app = utils.cluster('apps/app-start-framework-error', {
        opt: {
          env: Object.assign({}, process.env, {
            EGG_APP_WORKER_LOGGER_LEVEL: 'INFO',
          }),
        },
      });

      return app
        // .debug()
        .expect('code', 1)
        .expect('stderr', /CustomError: mock error \[ https\:\/\/eggjs\.org\/zh-cn\/faq\/customPlugin_99 \]/)
        .end();
    });

    it('should FrameworkErrorformater work during app boot ready', () => {
      app = utils.cluster('apps/app-start-framework-ready-error', {
        opt: {
          env: Object.assign({}, process.env, {
            EGG_APP_WORKER_LOGGER_LEVEL: 'INFO',
          }),
        },
      });

      return app
        // .debug()
        .expect('code', 1)
        .expect('stderr', /CustomError: mock error \[ https\:\/\/eggjs\.org\/zh-cn\/faq\/customPlugin_99 \]/)
        .end();
    });

    it('should remove error listener after ready', async () => {
      app = utils.cluster('apps/app-error-listeners');
      await app.ready();
      await app.httpRequest()
        .get('/')
        .expect({
          beforeReady: 1,
          afterReady: 1,
        });
      await app.close();
    });

    it('should ignore listen to other port', done => {
      app = utils.cluster('apps/other-port');
      // app.debug();
      app.notExpect('stdout', /started at 7002/).end(done);
    });
  });

  describe('app worker error in env === "default"', () => {
    before(() => {
      mm.env('default');
      app = utils.cluster('apps/app-die');
      // app.debug();
      return app.ready();
    });
    after(mm.restore);

    it('should restart', async () => {
      await app.httpRequest()
        .get('/exit')
        .expect(200);

      // wait app worker restart
      await sleep(10000);

      app.expect('stdout', /app_worker#1:\d+ disconnect/);
      app.expect('stdout', /app_worker#2:\d+ started/);
    });
  });

  describe('app worker error when env === "local"', () => {
    before(() => {
      mm.env('local');
      app = utils.cluster('apps/app-die');
      // app.debug();
      return app.ready();
    });
    after(mm.restore);

    it('should restart', async () => {
      try {
        await app.httpRequest()
          .get('/exit');
      } catch (_) {
        // ignore
      }

      // wait app worker restart
      await sleep(10000);

      app.expect('stdout', /app_worker#1:\d+ disconnect/);
      app.expect('stderr', /don't fork new work/);
    });
  });

  describe('app worker kill when env === "local"', () => {
    before(() => {
      mm.env('local');
      app = utils.cluster('apps/app-kill');
      // app.debug();
      return app.ready();
    });
    after(mm.restore);

    it('should exit', async () => {
      try {
        await app.httpRequest()
          .get('/kill?signal=SIGKILL');
      } catch (_) {
        // ignore
      }

      // wait app worker restart
      await sleep(10000);

      app.expect('stdout', /app_worker#1:\d+ disconnect/);
      app.expect('stderr', /don't fork new work/);
    });
  });

  describe('app start timeout', () => {
    it('should exit', () => {
      app = utils.cluster('apps/app-start-timeout');
      return app
        // .debug()
        .expect('code', 1)
        .expect('stderr', /\[master\] app_worker#1:\d+ start fail, exiting with code:1/)
        .expect('stderr', /\[app_worker\] start timeout, exiting with code:1/)
        .expect('stderr', /nodejs.AppWorkerDiedError: \[master\]/)
        .expect('stderr', /app_worker#1:\d+ died/)
        .end();
    });
  });

  describe('listen config', () => {
    const sockFile = utils.getFilepath('apps/app-listen-path/my.sock');
    beforeEach(() => {
      mm.env('default');
    });
    afterEach(mm.restore);
    afterEach(() => rm(sockFile, { force: true, recursive: true }));

    it('should error then port is not specified', async () => {
      app = utils.cluster('apps/app-listen-without-port');
      // app.debug();
      await app.ready();

      app.expect('code', 1);
      app.expect('stderr', /port should be number, but got null/);
    });

    it('should use port in config', async () => {
      app = utils.cluster('apps/app-listen-port');
      // app.debug();
      await app.ready();

      app.expect('code', 0);
      app.expect('stdout', /egg started on http:\/\/127.0.0.1:17010/);

      await request('http://0.0.0.0:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://127.0.0.1:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://localhost:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://127.0.0.1:17010')
        .get('/port')
        .expect('17010')
        .expect(200);
    });

    it('should set reusePort=true in config', async () => {
      app = utils.cluster('apps/app-listen-reusePort');
      // app.debug();
      await app.ready();

      app.expect('code', 0);
      app.expect('stdout', /egg started on http:\/\/127.0.0.1:17010/);

      await request('http://0.0.0.0:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://127.0.0.1:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://localhost:17010')
        .get('/')
        .expect('done')
        .expect(200);

      await request('http://127.0.0.1:17010')
        .get('/port')
        .expect('17010')
        .expect(200);
    });

    it('should use hostname in config', async () => {
      const url = address.ip() + ':17010';

      app = utils.cluster('apps/app-listen-hostname');
      // app.debug();
      await app.ready();

      app.expect('code', 0);
      app.expect('stdout', new RegExp(`egg started on http://${url}`));

      await request(url)
        .get('/')
        .expect('done')
        .expect(200);

      try {
        const response = await urllib.request('http://127.0.0.1:17010', { dataType: 'text' });
        assert(response.status === 200);
        assert(response.data === 'done');
        throw new Error('should not run');
      } catch (err) {
        assert(/ECONNREFUSED/.test(err.message));
      }
    });

    it('should use path in config', async () => {
      app = utils.cluster('apps/app-listen-path');
      // app.debug();
      await app.ready();

      app.expect('code', 0);
      app.expect('stdout', new RegExp(`egg started on ${sockFile}`));

      const sock = encodeURIComponent(sockFile);
      await request(`http+unix://${sock}`)
        .get('/')
        .expect('done')
        .expect(200);
    });
  });

  it('should exit when EADDRINUSE', async () => {
    mm.env('default');

    app = utils.cluster('apps/app-server', { port: 17001 });
    // app.debug();
    await app.ready();

    let app2;
    try {
      app2 = utils.cluster('apps/app-server', { port: 17001 });
      app2.debug();
      await app2.ready();

      app2.expect('code', 1);
      app2.expect('stderr', /\[app_worker] server got error: bind EADDRINUSE null:17001, code: EADDRINUSE/);
      app2.expect('stdout', /don't fork/);
    } finally {
      await app2.close();
    }
  });

  describe('refork', () => {
    beforeEach(() => {
      mm.env('default');
    });

    it('should refork when app_worker exit', async () => {
      app = utils.cluster('apps/app-die');
      // app.debug();
      await app.ready();

      await app.httpRequest()
        .get('/exit')
        .expect(200);

      await sleep(10000);

      app.expect('stdout', /app_worker#1:\d+ started at \d+/);
      app.expect('stderr', /new worker:\d+ fork/);
      app.expect('stdout', /app_worker#1:\d+ disconnect/);
      app.expect('stdout', /app_worker#2:\d+ started at \d+/);

      await app.httpRequest()
        .get('/exit')
        .expect(200);

      await sleep(10000);

      app.expect('stdout', /app_worker#3:\d+ started at \d+/);
    });

    it('should not refork when starting', async () => {
      app = utils.cluster('apps/app-start-error');
      // app.debug();
      await app.ready();

      app.expect('stdout', /don't fork/);
      app.expect('stderr', /app_worker#1:\d+ start fail/);
      app.expect('code', 1);
    });
  });
});
