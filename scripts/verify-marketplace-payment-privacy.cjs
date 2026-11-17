/** Production Next privacy checks over the harness's disposable loopback stack. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { lstatSync, readdirSync, readFileSync } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { join } = require('node:path');
const { LocalHarnessError } = require('./local-marketplace-docker.cjs');

const hostname = '127.0.0.1';
const port = 55452;
const origin = `http://${hostname}:${port}`;
const ownerHeader = 'x-fb08-local-privacy-run';

function assertNoDotenv() {
  // These are exactly the files @next/env can load in production mode.
  for (const name of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    if (lstatSync(name, { throwIfNoEntry: false })) throw new LocalHarnessError('Privacy check requires production dotenv files to be absent.');
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: hostname, port, exclusive: true }, resolve);
  });
}

async function preflight() {
  assertNoDotenv();
  const probe = net.createServer();
  try { await listen(probe); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new LocalHarnessError('Privacy loopback port 55452 is already in use.');
    throw error;
  }
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

function launch(mode, env, stdio) {
  const child = spawn(process.execPath, [__filename, mode], { env, stdio });
  const exited = new Promise(resolve => {
    child.once('exit', resolve);
    child.once('error', () => resolve(null));
  });
  return { child, exited };
}

async function bounded(work, ms, message) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new LocalHarnessError(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function stop({ child, exited }) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  try { await bounded(exited, 3000, 'Privacy child did not stop.'); }
  catch {
    child.kill('SIGKILL');
    await bounded(exited, 3000, 'Privacy child did not stop after termination.');
  }
}

function scanAssets(canaries) {
  let assets = 0;
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(js|json|html|map|css)$/.test(entry.name)) {
        assets++;
        checkPrivate(readFileSync(path, 'utf8'), canaries);
      }
    }
  }
  scan('.next/static');
  if (!assets) throw new LocalHarnessError('Privacy build produced no public assets to scan.');
  console.log(`PASS: ${assets} public build assets; private canaries absent.`);
}

function checkPrivate(content, canaries) {
  if (canaries.some(value => content.includes(value))) throw new LocalHarnessError('Private canary present in a public asset or rendered response.');
}

function expectText(body, values, message) {
  if (!values.every(value => body.includes(value))) throw new LocalHarnessError(message);
}

function fixtureFor(run, authSecret) {
  const tenant = `local-privacy-${run}`;
  const ordinaryId = randomUUID(), activeId = randomUUID(), soldId = randomUUID(), orderId = randomUUID(), sellerId = randomUUID();
  const ordinaryTitle = `Fictional ordinary privacy fixture ${run}`;
  const activeTitle = `Fictional active sandbox privacy fixture ${run}`;
  const soldTitle = `Fictional sold sandbox privacy fixture ${run}`;
  const sellerEmail = `private-seller-${run}@example.invalid`;
  const accountId = `acct_${run.replaceAll('-', '')}`;
  const sessionId = `cs_test_${randomBytes(16).toString('hex')}`, intentId = `pi_${randomBytes(16).toString('hex')}`;
  const buyer = randomBytes(32).toString('base64url');
  const buyerHash = createHmac('sha256', authSecret).update(JSON.stringify(['fb08-marketplace-payments-v1', 'buyer-session', buyer])).digest('hex');
  const ids = `('${ordinaryId}','${activeId}','${soldId}')`;
  // Only fixed literals and the generated identifiers/canaries above enter SQL.
  const seed = `begin;
    insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind,status) values
      ('${ordinaryId}','${ordinaryTitle}','Local only',100,'Other','Test','listings/${ordinaryId}.webp','ordinary','active'),
      ('${activeId}','${activeTitle}','Local only',1234.50,'Other','Test','listings/${activeId}.webp','sandbox','active'),
      ('${soldId}','${soldTitle}','Local only',1234.50,'Other','Test','listings/${soldId}.webp','sandbox','sold');
    insert into public.marketplace_listing_contacts(listing_id,seller_email) values
      ('${ordinaryId}','${sellerEmail}'),('${activeId}','${sellerEmail}'),('${soldId}','${sellerEmail}');
    insert into public.marketplace_payment_inventory(listing_id,tenant) values ('${activeId}','${tenant}'),('${soldId}','${tenant}');
    insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values ('${sellerId}','${tenant}','${sellerEmail}',clock_timestamp());
    insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
      values ('${tenant}','${sellerId}','${accountId}',true,'ready',clock_timestamp(),'${randomUUID()}');
    insert into public.marketplace_orders(id,tenant,listing_id,seller_id,account_id,buyer_access_hash,read_expires_at,
      submission_key,state,title,gross_minor,fee_minor,session_id,payment_intent_id,create_key,checkout_expires_at,prepared_at)
      values ('${orderId}','${tenant}','${soldId}','${sellerId}','${accountId}','${buyerHash}',clock_timestamp()+interval '7 days',
      '${randomUUID()}','paid','${soldTitle}',123450,12345,'${sessionId}','${intentId}','${randomUUID()}',extract(epoch from now())::bigint,clock_timestamp());
    commit;`;
  const cleanup = `begin;
    delete from public.marketplace_orders where id='${orderId}' and tenant='${tenant}';
    delete from public.marketplace_connected_accounts where seller_id='${sellerId}' and tenant='${tenant}';
    delete from public.marketplace_payment_sellers where id='${sellerId}' and tenant='${tenant}';
    delete from public.marketplace_payment_inventory where listing_id in ${ids} and tenant='${tenant}';
    delete from public.marketplace_listing_contacts where listing_id in ${ids} and seller_email='${sellerEmail}';
    delete from public.marketplace_listings where (id,title) in
      (('${ordinaryId}','${ordinaryTitle}'),('${activeId}','${activeTitle}'),('${soldId}','${soldTitle}'));
    select (select count(*) from public.marketplace_listings where id in ${ids})
      + (select count(*) from public.marketplace_payment_inventory where tenant='${tenant}')
      + (select count(*) from public.marketplace_payment_sellers where tenant='${tenant}')
      + (select count(*) from public.marketplace_connected_accounts where tenant='${tenant}')
      + (select count(*) from public.marketplace_orders where tenant='${tenant}')
      + (select count(*) from public.marketplace_listing_contacts where listing_id in ${ids});
    commit;`;
  return { tenant, ordinaryId, activeId, soldId, orderId, ordinaryTitle, activeTitle, soldTitle, buyer,
    canaries: [sellerEmail, accountId, sessionId, intentId, buyer, buyerHash], seed, cleanup };
}

async function verify({ token, anonToken, sql }) {
  const run = randomUUID();
  const authSecret = randomBytes(36).toString('base64url');
  const fixture = fixtureFor(run, authSecret);
  const privateEnv = {
    SUPABASE_SERVICE_ROLE_KEY: token, AUTH_SESSION_SECRET: authSecret,
    STRIPE_SECRET_KEY: `sk_test_${randomBytes(16).toString('hex')}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(16).toString('hex')}`,
    RESEND_API_KEY: `re_${randomBytes(16).toString('hex')}`,
    MARKETPLACE_SELLER_EMAIL_FROM: `fictional-sender-${run}@example.test`,
  };
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55451', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonToken,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_LocalMarketplacePrivacyFixture',
    MARKETPLACE_PAYMENTS_ENABLED: 'true', MARKETPLACE_PAYMENT_TENANT: fixture.tenant, MARKETPLACE_APP_ORIGIN: origin,
    MARKETPLACE_STRIPE_ACCOUNT_COUNTRY: 'US', ...privateEnv,
  };

  assertNoDotenv();
  const build = launch('--build', env, 'ignore');
  try {
    if (await bounded(build.exited, 240000, 'Privacy production build timed out.') !== 0) throw new LocalHarnessError('Privacy production build failed.');
  } finally { await stop(build); }
  scanAssets(Object.values(privateEnv));

  await preflight();
  const server = launch('--serve', { ...env, FB08_LOCAL_PRIVACY_RUN: run }, ['ignore', 'ignore', 'ignore', 'ipc']);
  let seedAttempted = false;
  try {
    const ready = new Promise(resolve => server.child.once('message', resolve));
    const state = await bounded(Promise.race([ready, server.exited]), 30000, 'Privacy server startup timed out.');
    if (state !== 'ready' || server.child.exitCode !== null) throw new LocalHarnessError('Owned privacy server failed to bind and start.');
    seedAttempted = true;
    sql(fixture.seed);

    let responses = 0;
    const canaries = [...Object.values(privateEnv), ...fixture.canaries];
    async function request(path, { cookie, status = 200, type = 'text/html' } = {}) {
      const options = { redirect: 'error', signal: AbortSignal.timeout(15000), headers: cookie ? { cookie: `fb08_mp_buyer=${cookie}` } : {} };
      const response = await fetch(origin + path, options);
      const body = await response.text();
      if (server.child.exitCode !== null || server.child.signalCode !== null || response.headers.get(ownerHeader) !== run
        || response.status !== status || !response.headers.get('content-type')?.startsWith(type)) {
        throw new LocalHarnessError('Unexpected response from the owned privacy server.');
      }
      checkPrivate(body, canaries);
      responses++;
      return body;
    }

    const { ordinaryId, activeId, soldId, orderId, ordinaryTitle, activeTitle, soldTitle, buyer } = fixture;
    const feed = await request('/marketplace');
    expectText(feed, [ordinaryTitle, activeTitle, 'Buy Now'], 'The privacy feed did not render its ordinary and ready sandbox fixtures.');
    if (feed.includes(soldTitle)) throw new LocalHarnessError('The privacy feed exposed the sold sandbox listing.');
    expectText(await request(`/marketplace/${activeId}`), [activeTitle, 'Buy Now'], 'The privacy sandbox detail did not render its ready fixture.');
    expectText(await request(`/marketplace/${ordinaryId}`), [ordinaryTitle], 'The privacy ordinary detail did not render its fixture.');
    const sold = await request(`/marketplace/${soldId}`);
    expectText(sold, [soldTitle, 'SOLD', ' | SANDBOX', 'no real money or delivery'], 'The privacy sandbox detail did not render the sold fixture.');
    const orderPage = await request(`/marketplace/orders/${orderId}`, { cookie: buyer });
    expectText(orderPage, [soldTitle, 'Sandbox payment confirmed', 'Platform fee (10%)'], 'The privacy order page did not render the authorized paid fixture.');
    const orderApi = `/api/marketplace/payments/orders/${orderId}`;
    const dto = await request(orderApi, { cookie: buyer, type: 'application/json' });
    assert.deepEqual(JSON.parse(dto), {
      orderId, listingId: soldId, title: soldTitle, status: 'paid', currency: 'PHP',
      grossMinor: 123450, applicationFeeMinor: 12345, sellerBeforeProcessingMinor: 111105, sandbox: true,
    });
    const denied = await request(orderApi, { cookie: randomBytes(32).toString('base64url'), status: 404, type: 'application/json' });
    assert.match(JSON.parse(denied).error, /^Order unavailable\./);
    for (const path of ['/marketplace/new', '/marketplace/payments', '/marketplace/payments/return', '/marketplace/payments/refresh', '/', '/?view=people']) await request(path);
    await request('/api/auth/me', { type: 'application/json' });
    console.log(`PASS: ${responses} owned responses; sandbox feed/detail, paid order page and exact API DTO verified; private canaries absent.`);
  } finally {
    try { await stop(server); }
    finally {
      if (seedAttempted) {
        assert.equal(sql(fixture.cleanup).trim(), '0', 'Privacy fixture cleanup failed.');
        console.log('PASS: exact privacy fixtures removed.');
      }
    }
  }
}

// Prevent these Next child processes from opening provider connections, even if a
// fixture regresses into a provider-backed path. The explicit proxy is their only upstream.
function restrictOutbound() {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const [options] = Array.isArray(args[0]) ? args[0] : args;
    if (options?.host !== hostname || Number(options.port) !== 55451) throw new Error('Privacy child refused an outbound connection.');
    return connect.apply(this, args);
  };
}

async function serve() {
  const app = require('next')({ dev: false, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const listener = http.createServer((req, res) => {
    res.setHeader(ownerHeader, process.env.FB08_LOCAL_PRIVACY_RUN);
    void handle(req, res);
  });
  await listen(listener);
  process.send('ready');
}

if (require.main === module) {
  assertNoDotenv();
  restrictOutbound();
  if (process.argv[2] === '--build') {
    const cli = require.resolve('next/dist/bin/next');
    process.argv = [process.execPath, cli, 'build'];
    require(cli);
  } else if (process.argv[2] === '--serve' && process.send) {
    void serve().catch(() => { process.exitCode = 1; process.disconnect?.(); });
  } else process.exitCode = 1;
}

module.exports = { preflight, verify };
