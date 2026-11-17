/** Isolated local integration harness; never reads .env or linked Supabase configuration. */
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { randomBytes, createHmac } = require('node:crypto');
const http = require('node:http');
const label = 'fb08.marketplace-payments-local';
const dbName = 'marketplace_payments_local';
const dbContainer = 'fb08-marketplace-payments-local-db';
const restContainer = 'fb08-marketplace-payments-local-rest';
const network = 'fb08-marketplace-payments-local';
function docker(args, input) { return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
function inspect(name) { return JSON.parse(docker(['inspect', name]))[0]; }
function owned(name, image, port) {
  const info = inspect(name);
  if (info.Config.Labels?.[label] !== 'true' || info.Config.Image !== image || !info.State.Running) throw new Error('Owned local container guard failed.');
  if (port && !Object.values(info.HostConfig.PortBindings ?? {}).flat().every(p => p.HostIp === '127.0.0.1' && p.HostPort === String(port))) throw new Error('Loopback container guard failed.');
  return info;
}
function sql(input) { return docker(['exec', '-i', dbContainer, 'psql', '-X', '-U', 'postgres', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-Atq'], input); }
async function setup() {
  // docker create/run refuses existing names. No reset/drop/removal path exists.
  docker(['network', 'create', '--label', `${label}=true`, network]);
  docker(['run', '-d', '--name', dbContainer, '--label', `${label}=true`, '--network', network, '-p', '127.0.0.1:55449:5432', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', `POSTGRES_DB=${dbName}`, 'postgres:17-alpine']);
  for (let i = 0; i < 40; i++) {
    try { docker(['exec', dbContainer, 'pg_isready', '-U', 'postgres', '-d', dbName]); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  owned(dbContainer, 'postgres:17-alpine', 55449);
  if (sql("select count(*) from information_schema.tables where table_schema in ('public','storage');").trim() !== '0') throw new Error('Bootstrap requires an empty disposable database.');
  sql(readFileSync('scripts/local-marketplace-bootstrap.sql', 'utf8'));
  for (const name of [
    '20261116180858_fb08_marketplace.sql', '20261116182303_marketplace_literal_search.sql',
    '20261117004434_marketplace_payments.sql', '20261117004437_marketplace_payment_functions.sql',
    '20261117095439_marketplace_payment_reconciliation.sql', '20261117102524_marketplace_payment_presentation.sql',
  ]) sql(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  const jwtSecret = randomBytes(48).toString('base64url');
  // Secret exists only in this owned test container configuration, never output or command history.
  docker(['run', '-d', '--name', restContainer, '--label', `${label}=true`, '--network', network, '-p', '127.0.0.1:55450:3000', '-e', `PGRST_DB_URI=postgres://postgres@${dbContainer}:5432/${dbName}`, '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${jwtSecret}`, 'public.ecr.aws/supabase/postgrest:v14.18']);
  console.log('PASS: owned local database initialized; minimal Storage catalogs only.');
}
async function main() {
  if (process.argv.length !== 2 && !(process.argv.length === 3 && ['--setup', '--privacy'].includes(process.argv[2]))) throw new Error('Use no arguments to test, --privacy for build/render privacy checks, or --setup once for a new disposable stack.');
  if (process.argv[2] === '--setup') await setup();
  owned(dbContainer, 'postgres:17-alpine', 55449);
  const rest = owned(restContainer, 'public.ecr.aws/supabase/postgrest:v14.18', 55450);
  const env = rest.Config.Env;
  if (!env.includes(`PGRST_DB_URI=postgres://postgres@${dbContainer}:5432/${dbName}`)) throw new Error('Owned database target guard failed.');
  const secret = env.find(value => value.startsWith('PGRST_JWT_SECRET='))?.slice('PGRST_JWT_SECRET='.length);
  if (!secret) throw new Error('Local JWT configuration missing.');
  for (const file of ['marketplace.sql', 'marketplace-payments.sql', 'marketplace-seller-proof.sql', 'marketplace-connect.sql', 'marketplace-payment-reconciliation.sql', 'marketplace-payment-presentation.sql']) {
    sql(readFileSync(`supabase/tests/${file}`, 'utf8')); console.log(`PASS: rolled-back ${file}`);
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = `${header}.${body}.${createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')}`;
  const proxy = http.createServer((req, res) => {
    if (!req.url?.startsWith('/rest/v1/')) { res.writeHead(404); res.end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: 55450, path: req.url.slice('/rest/v1'.length), method: req.method, headers: req.headers }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
    upstream.on('error', () => { res.writeHead(503); res.end(); }); req.pipe(upstream);
  });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(55451, '127.0.0.1', resolve); });
  try {
    // Wait for PostgREST initialization; every request remains on the fixed loopback port.
    for (let i = 0; i < 40; i++) { try { if ((await fetch('http://127.0.0.1:55451/rest/v1/')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
    for (const file of ['test-marketplace-payments-db.ts', 'test-marketplace-events-db.ts', 'test-marketplace-payment-reads-db.ts', 'test-marketplace-account-locks.ts']) {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--import=tsx', `scripts/${file}`], { stdio: 'inherit', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MARKETPLACE_TEST_SUPABASE_URL: 'http://127.0.0.1:55451', MARKETPLACE_TEST_SERVICE_ROLE_KEY: token, MARKETPLACE_TEST_DB_CONTAINER: dbContainer, MARKETPLACE_TEST_DB_NAME: dbName } });
        child.on('error', reject); child.on('exit', resolve);
      });
      if (code !== 0) throw new Error('Local integration child failed.');
    }
    if (process.argv[2] === '--privacy') {
      const anonBody = Buffer.from(JSON.stringify({ role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const anonToken = `${header}.${anonBody}.${createHmac('sha256', secret).update(`${header}.${anonBody}`).digest('base64url')}`;
      await require('./verify-marketplace-payment-privacy.cjs')({ token, anonToken, sql });
    }
  } finally { await new Promise(resolve => proxy.close(resolve)); }
}
main().catch(() => { console.error('Local payment integration failed. Inspect the owned disposable stack privately; no credentials or raw database errors are printed.'); process.exitCode = 1; });
