/** Isolated local integration harness; never reads .env or linked Supabase configuration. */
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { randomBytes, createHmac } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { db, rest, dbName, network, label, LocalHarnessError, openLocalDocker, inspectOwnedContainer, inspectOwnedNetwork } = require('./local-marketplace-docker.cjs');
const { createRestProxy, restReady } = require('./local-marketplace-http.cjs');
const privacy = require('./verify-marketplace-payment-privacy.cjs');

function sqlFor(docker, containerId) {
  return input => docker.run(['exec', '-i', containerId, 'psql', '-X', '-U', 'postgres', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-Atq'], { input });
}

async function setup(docker) {
  for (const target of [db, rest]) docker.run(['image', 'inspect', target.image]);
  // docker create/run refuses existing names. No reset/drop/removal path exists.
  docker.run(['network', 'create', '--label', `${label}=true`, network]);
  const networkId = inspectOwnedNetwork(docker);
  docker.run(['run', '--pull', 'never', '-d', '--name', db.name, '--label', `${label}=true`, '--network', network, '-p', '127.0.0.1:55449:5432', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', db.config, db.image]);
  const ownedDb = inspectOwnedContainer(docker, db, networkId);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    // TCP waits for the final Postgres listener after its socket-only init server shuts down.
    try { docker.run(['exec', ownedDb.Id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', dbName]); ready = true; break; }
    catch { await delay(250); }
  }
  if (!ready) throw new LocalHarnessError('The owned local database did not become ready.');
  const sql = sqlFor(docker, ownedDb.Id);
  if (sql("select count(*) from information_schema.tables where table_schema in ('public','storage');").trim() !== '0') throw new Error('Bootstrap requires an empty disposable database.');
  sql(readFileSync('scripts/local-marketplace-bootstrap.sql', 'utf8'));
  for (const name of [
    '20261116180858_fb08_marketplace.sql', '20261116182303_marketplace_literal_search.sql',
    '20261117004434_marketplace_payments.sql', '20261117004437_marketplace_payment_functions.sql',
    '20261117095439_marketplace_payment_reconciliation.sql', '20261117102524_marketplace_payment_presentation.sql',
  ]) sql(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  const extraEnv = { PGRST_JWT_SECRET: randomBytes(48).toString('base64url') };
  docker.run(['run', '--pull', 'never', '-d', '--name', rest.name, '--label', `${label}=true`, '--network', network, '-p', '127.0.0.1:55450:3000', '-e', rest.config, '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', 'PGRST_JWT_SECRET', rest.image], { extraEnv });
  console.log('PASS: owned local database initialized; minimal Storage catalogs only.');
}
async function main() {
  if (process.argv.length !== 2 && !(process.argv.length === 3 && ['--setup', '--privacy'].includes(process.argv[2]))) throw new Error('Use no arguments to test, --privacy for build/render privacy checks, or --setup once for a new disposable stack.');
  if (process.argv[2] === '--privacy') await privacy.preflight();
  const docker = openLocalDocker();
  if (process.argv[2] === '--setup') await setup(docker);
  const networkId = inspectOwnedNetwork(docker);
  const ownedDb = inspectOwnedContainer(docker, db, networkId);
  const ownedRest = inspectOwnedContainer(docker, rest, networkId);
  const sql = sqlFor(docker, ownedDb.Id);
  const env = ownedRest.Config.Env;
  const secret = env.find(value => value.startsWith('PGRST_JWT_SECRET='))?.slice('PGRST_JWT_SECRET='.length);
  if (!secret) throw new Error('Local JWT configuration missing.');
  for (const file of ['marketplace.sql', 'marketplace-payments.sql', 'marketplace-seller-proof.sql', 'marketplace-connect.sql', 'marketplace-payment-reconciliation.sql', 'marketplace-payment-presentation.sql']) {
    sql(readFileSync(`supabase/tests/${file}`, 'utf8')); console.log(`PASS: rolled-back ${file}`);
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = `${header}.${body}.${createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
  const proxy = createRestProxy();
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(55451, '127.0.0.1', resolve); });
  try {
    // Wait for PostgREST initialization; every request remains on the fixed loopback port.
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        if (await restReady()) { ready = true; break; }
      } catch {}
      await delay(250);
    }
    if (!ready) throw new LocalHarnessError('The owned local PostgREST proxy did not become ready.');
    for (const file of ['test-marketplace-payments-db.ts', 'test-marketplace-events-db.ts', 'test-marketplace-payment-reads-db.ts', 'test-marketplace-account-locks.ts']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import=tsx', `scripts/${file}`], { stdio: 'inherit', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_USE_ENV_PROXY: '0', DOCKER_HOST: docker.endpoint, MARKETPLACE_TEST_SUPABASE_URL: 'http://127.0.0.1:55451', MARKETPLACE_TEST_SERVICE_ROLE_KEY: token, MARKETPLACE_TEST_DB_CONTAINER: db.name, MARKETPLACE_TEST_DB_NAME: dbName } });
        child.on('error', reject); child.on('exit', resolve);
      });
      if (code !== 0) throw new Error('Local integration child failed.');
    }
    if (process.argv[2] === '--privacy') {
      const anonBody = Buffer.from(JSON.stringify({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const anonToken = `${header}.${anonBody}.${createHmac('sha256', secret).update(`${header}.${anonBody}`).digest('base64url')}`;
      await privacy.verify({ token, anonToken, sql });
    }
  } finally {
    await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
  }
}
main().catch(error => {
  console.error(error instanceof LocalHarnessError ? error.message : 'Local payment integration failed. Inspect the owned disposable stack privately; no credentials or raw database errors are printed.');
  process.exitCode = 1;
});
