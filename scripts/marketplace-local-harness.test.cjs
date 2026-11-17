const assert = require('node:assert/strict');
const { execFile, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const http = require('node:http');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { db, inspectOwnedContainer, label, network } = require('./local-marketplace-docker.cjs');

const harness = resolve(__dirname, 'run-marketplace-payments-local.cjs');
const lockRunner = resolve(__dirname, 'test-marketplace-account-locks.ts');
const unreachableDocker = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  DOCKER_HOST: 'tcp://127.0.0.1:1',
  MARKETPLACE_TEST_DB_CONTAINER: 'fb08-marketplace-payments-local-db',
  MARKETPLACE_TEST_DB_NAME: 'marketplace_payments_local',
};

function run(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: unreachableDocker, timeout: 10000, ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, 'the unsafe invocation must fail');
  assert.ok(result.stdout === '', 'the unsafe invocation must produce zero stdout');
  return result.stderr;
}

test('privacy preflight rejects every production dotenv filename with a presence-only message', () => {
  const project = mkdtempSync(join(tmpdir(), 'fb08-privacy-preflight-'));
  try {
    for (const name of ['.env.production.local', '.env.local', '.env.production', '.env']) {
      const path = join(project, name);
      // Create this fictional marker and leave its contents unread.
      writeFileSync(path, 'FAKE_PRIVATE_SENTINEL=fb08-fictional-dotenv-value\n', { flag: 'wx' });
      const output = run([harness, '--privacy'], { cwd: project });
      assert.ok(output.trim() === 'Privacy check requires production dotenv files to be absent.', 'expected presence-only dotenv rejection');
      rmSync(path);
    }
  } finally { rmSync(project, { recursive: true }); }
});

test('privacy preflight rejects an occupied listener before Docker or a scan', async () => {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(55452, '127.0.0.1', resolve); });
  try {
    assert.match(run([harness, '--privacy']), /Privacy loopback port 55452 is already in use\./);
    assert.equal(listener.listening, true);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});

test('setup and direct lock runner both refuse Docker-over-TCP before any Docker operation', () => {
  const message = /Refusing Docker endpoint outside an approved local socket or named pipe\./;
  assert.match(run([harness, '--setup']), message);
  assert.match(run(['--import=tsx', lockRunner]), message);
});

test('container guard requires its label, network ID and one exact configured and published binding', () => {
  const container = {
    Name: '/fb08-marketplace-payments-local-db', Id: 'a'.repeat(64),
    Config: { Image: 'postgres:17-alpine', Labels: { [label]: 'true' }, Env: ['POSTGRES_DB=marketplace_payments_local'] },
    State: { Running: true },
    HostConfig: { NetworkMode: network, PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55449' }] } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55449' }] }, Networks: { [network]: { NetworkID: 'expected-local-network' } } },
  };
  const inspect = record => inspectOwnedContainer({ run: () => JSON.stringify([record]) }, db, 'expected-local-network');
  assert.equal(inspect(container).Id, container.Id);
  for (const mutate of [
    record => { record.HostConfig.PortBindings = {}; },
    record => { record.NetworkSettings.Ports = { '5432/tcp': [] }; },
    record => { record.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    record => { record.HostConfig.PortBindings['5433/tcp'] = record.HostConfig.PortBindings['5432/tcp']; },
    record => { record.Config.Labels = {}; },
    record => { record.Config.Env.push('POSTGRES_DB=unexpected_target'); },
    record => { record.NetworkSettings.Networks[network].NetworkID = 'wrong-network'; },
  ]) {
    const record = structuredClone(container);
    mutate(record);
    assert.throws(() => inspect(record), /Owned local Docker container guard failed\./);
  }
});

test('readiness, REST forwarding and authorized privacy reads bypass an ambient Node HTTP proxy', async () => {
  const proof = 'a'.repeat(43);
  const token = 'fictional-qa-service-token';
  const owner = 'fictional-run-id';
  const direct = { readiness: 0, cookie: 0, auth: 0 };
  let proxied = 0;
  const target = http.createServer((req, res) => {
    if (req.url === '/rest/v1/') { direct.readiness++; res.end(); return; }
    if (req.url === '/fixture' && req.headers.authorization === `Bearer ${token}`) { direct.auth++; res.end(); return; }
    if (req.url === '/order' && req.headers.cookie === `fb08_mp_buyer=${proof}`) {
      direct.cookie++;
      res.writeHead(200, { 'x-fb08-local-privacy-run': owner, 'content-type': 'text/html' });
      res.end('authorized fictional order');
      return;
    }
    res.writeHead(404).end();
  });
  const trap = http.createServer((_req, res) => { proxied++; res.writeHead(502).end(); });
  trap.on('connect', (_req, socket) => { proxied++; socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  try {
    for (const server of [target, trap]) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    }
    const trapUrl = `http://127.0.0.1:${trap.address().port}`;
    const probe = `
      const http = require('node:http');
      const { createRestProxy, restReady, readOwnedResponse } = require(process.argv[1]);
      const port = Number(process.argv[2]);
      const proxy = createRestProxy(port);
      proxy.listen(0, '127.0.0.1', async () => {
        try {
          const results = await Promise.allSettled([
            restReady(port),
            new Promise((resolve, reject) => {
              const options = {
                hostname: '127.0.0.1', port: proxy.address().port, path: '/rest/v1/fixture', agent: false,
                headers: { host: '127.0.0.1:' + port, authorization: 'Bearer ' + process.argv[3] },
                signal: AbortSignal.timeout(4000),
              };
              http.get(options, response => { response.resume(); resolve(response.statusCode === 200); }).on('error', reject);
            }),
            readOwnedResponse(port, '/order', { cookie: process.argv[4], run: process.argv[5], status: 200, type: 'text/html' })
              .then(body => body === 'authorized fictional order'),
          ]);
          console.log(JSON.stringify(results.map(result => result.status === 'fulfilled' && result.value)));
        } finally { proxy.close(); proxy.closeAllConnections(); }
      });
    `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      '-e', probe, resolve(__dirname, 'local-marketplace-http.cjs'), String(target.address().port), token, proof, owner,
    ], { timeout: 10000, env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      NODE_USE_ENV_PROXY: '1', HTTP_PROXY: trapUrl, HTTPS_PROXY: trapUrl, NO_PROXY: '',
    } });
    assert.equal(proxied, 0, 'loopback HTTP must never reach the configured proxy');
    assert.deepEqual(JSON.parse(stdout), [true, true, true], 'all requests must receive their direct origin responses');
    assert.deepEqual(direct, { readiness: 1, cookie: 1, auth: 1 });
  } finally {
    await Promise.all([target, trap].map(server => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    })));
  }
});
