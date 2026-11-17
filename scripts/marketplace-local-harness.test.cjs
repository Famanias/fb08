const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { test } = require('node:test');
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
