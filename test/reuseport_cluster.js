const cluster = require('node:cluster');
const http = require('node:http');
const os = require('node:os');
const process = require('node:process');

const numCPUs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

// pid: count
const totals = {};
function request(index) {
  http.get('http://localhost:17001/', {
    headers: {
      connection: 'close',
    },
  }, res => {
    const { statusCode } = res;
    console.log(index, res.statusCode, res.headers);
    let error;
    // Any 2xx status code signals a successful response but
    // here we're only checking for 200.
    if (statusCode !== 200) {
      error = new Error('Request Failed.\n' +
                        `Status Code: ${statusCode}`);
    }
    if (error) {
      console.error(error.message);
      // Consume response data to free up memory
      res.resume();
      return;
    }
    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', chunk => { rawData += chunk; });
    res.on('end', () => {
      try {
        console.log(rawData);
      } catch (e) {
        console.error(e.message);
      }
      const data = JSON.parse(rawData);
      totals[data.pid] = (totals[data.pid] || 0) + 1;
    });
  }).on('error', e => {
    console.error(`Got error: ${e.stack}`);
  });
}

if (cluster.isPrimary || cluster.isMaster) {
  console.log(`Primary ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died, code: ${code}, signal: ${signal}`);
  });

  setTimeout(() => {
    for (let i = 0; i < 1000; i++) {
      request(i);
    }
  }, 2000);
  setTimeout(() => {
    console.log(totals);
    process.exit(0);
  }, 5000);
} else {
  // Workers can share any TCP connection
  // In this case it is an HTTP server
  http.createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ pid: process.pid }));
  }).listen({
    port: 17001,
    reusePort: os.platform() === 'linux',
  });

  console.log(`Worker ${process.pid} started`);
}
