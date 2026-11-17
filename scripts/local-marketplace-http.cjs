const http = require('node:http');
const { LocalHarnessError } = require('./local-marketplace-docker.cjs');

function createRestProxy(port = 55450) {
  return http.createServer((req, res) => {
    if (!req.url?.startsWith('/rest/v1/')) { res.writeHead(404); res.end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port, agent: false, path: req.url.slice('/rest/v1'.length), method: req.method, headers: req.headers, signal: AbortSignal.timeout(15000) }, incoming => {
      incoming.once('error', () => res.destroy());
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(res);
    });
    upstream.once('error', () => {
      if (res.headersSent) res.destroy();
      else { res.writeHead(503); res.end(); }
    });
    res.once('close', () => upstream.destroy());
    req.pipe(upstream);
  });
}

function getLoopback(port, path, { headers, signal }) {
  // A request-local agent bypasses Node's ambient proxy configuration. http.get does not follow redirects.
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, headers, signal, agent: false }, resolve).once('error', reject);
  });
}

async function restReady(port = 55451) {
  const response = await getLoopback(port, '/rest/v1/', { signal: AbortSignal.timeout(1000) });
  response.destroy();
  return response.statusCode >= 200 && response.statusCode < 300;
}

const ownerHeader = 'x-fb08-local-privacy-run';

async function readOwnedResponse(port, path, { run, cookie, status, type }) {
  const headers = cookie ? { cookie: `fb08_mp_buyer=${cookie}` } : {};
  const response = await getLoopback(port, path, { headers, signal: AbortSignal.timeout(15000) });
  if (response.headers[ownerHeader] !== run || response.statusCode !== status || !response.headers['content-type']?.startsWith(type)) {
    response.destroy();
    throw new LocalHarnessError('Unexpected response from the owned privacy server.');
  }
  let body = '';
  response.setEncoding('utf8');
  for await (const chunk of response) body += chunk;
  return body;
}

module.exports = { createRestProxy, restReady, ownerHeader, readOwnedResponse };
