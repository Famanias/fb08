/** Called only by the guarded local harness. Presence-only output, no values or raw HTML. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
module.exports = async function ({ token, anonToken, sql }) {
  const canaries = ['LOCAL_ONLY_AUTH_CANARY_7739', 'sk_test_LOCALONLYSTRIPECANARY7739', 'whsec_LOCALONLYWEBHOOKCANARY7739', 're_LOCALONLYMAILCANARY7739', 'private-seller-canary-7739@example.invalid', 'private-buyer-proof-canary-7739', 'acct_LOCALONLYACCOUNTCANARY7739', 'LOCAL_ONLY_BROWSER_NONCE_CANARY7739', 'LOCAL_ONLY_OTP_CANARY7739'];
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55451', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonToken, SUPABASE_SERVICE_ROLE_KEY: token, AUTH_SESSION_SECRET: canaries[0], MARKETPLACE_PAYMENTS_ENABLED: 'false', MARKETPLACE_PAYMENT_TENANT: 'local-privacy', MARKETPLACE_APP_ORIGIN: 'http://127.0.0.1:55452', MARKETPLACE_STRIPE_ACCOUNT_COUNTRY: 'US', STRIPE_SECRET_KEY: canaries[1], STRIPE_WEBHOOK_SECRET: canaries[2], RESEND_API_KEY: canaries[3], MARKETPLACE_SELLER_EMAIL_FROM: canaries[4] };
  async function child(args) {
    const code = await new Promise((resolve, reject) => { const p = spawn(process.execPath, args, { env, stdio: 'inherit' }); p.on('exit', resolve); p.on('error', reject); });
    assert.equal(code, 0, 'Local privacy build failed.');
  }
  // No dev server exists. Finish the production build before starting Next.
  await child(['node_modules/next/dist/bin/next', 'build']);
  let assets = 0;
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(js|json|html|map|css)$/.test(entry.name)) { const content = readFileSync(path, 'utf8'); assets++; assert.ok(![token, ...canaries].some(value => content.includes(value)), 'Private canary present in public build asset.'); }
    }
  }
  scan('.next/static'); console.log(`PASS: ${assets} public build assets; private canaries absent.`);
  const id = '77390000-0000-4000-8000-000000000001';
  sql(`insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path) values('${id}','Fictional privacy fixture','Local only',100,'Other','Test','listings/${id}.webp'); insert into public.marketplace_listing_contacts values('${id}','${canaries[4]}');`);
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '55452'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${env.MARKETPLACE_APP_ORIGIN}/marketplace`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
    const paths = ['/marketplace', '/marketplace/new', `/marketplace/${id}`, '/marketplace/payments', '/marketplace/payments/return', '/marketplace/payments/refresh', `/marketplace/orders/${id}`, '/', '/?view=people', '/api/auth/me'];
    for (const path of paths) {
      const response = await fetch(env.MARKETPLACE_APP_ORIGIN + path, { headers: { cookie: `fb08_mp_buyer=${canaries[5]}; fb08_mp_seller=${canaries[7]}` }, signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, 'Local rendered route failed.');
      const html = await response.text(); assert.ok(![token, ...canaries].some(value => html.includes(value)), 'Private canary present in rendered HTML/JSON.');
    }
    console.log(`PASS: ${paths.length} rendered Marketplace/Board/People/auth responses; private canaries absent.`);
  } finally {
    server.kill(); await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
    sql(`delete from public.marketplace_listings where id='${id}';`);
  }
};
