import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { handleStripeWebhook } from './webhook-handler';
import { createStripeGateway } from './stripe-gateway';
import { paymentFixture } from './test-fixture';

const secret = `whsec_${randomBytes(32).toString('hex')}`;
function fixture() {
  const f = paymentFixture();
  f.deps.stripe.verifyEvent = createStripeGateway({ tenant: 'local', origin: f.deps.context.origin, country: '', secretKey: '', webhookSecret: secret }).verifyEvent;
  const event = { id: 'evt_fixture', type: 'checkout.session.completed', account: f.order.accountId, livemode: false, data: { object: { id: f.order.sessionId, object: 'checkout.session', metadata: f.canonical().metadata } } };
  const request = (e: unknown = event, timestamp = Math.floor(Date.now() / 1000), signature?: string) => {
    const body = ` \n${JSON.stringify(e, null, 2)}\n `;
    return new Request('https://market.example.invalid/api/marketplace/stripe/webhook', { method: 'POST', body, headers: { 'stripe-signature': signature ?? Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp }) } });
  };
  return { ...f, event, request };
}
test('signature before state: missing bad stale signatures reject and exact raw whitespace verifies', async () => {
  const f = fixture();
  assert.equal((await handleStripeWebhook(f.request(undefined, undefined, ''), f.deps)).status, 400);
  assert.equal((await handleStripeWebhook(f.request(undefined, undefined, 'bad'), f.deps)).status, 400);
  assert.equal((await handleStripeWebhook(f.request(undefined, Math.floor(Date.now() / 1000) - 600), f.deps)).status, 400);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  assert.equal((await handleStripeWebhook(f.request(), f.deps)).status, 200); assert.equal(f.order.state, 'paid');
});
test('body streaming bound rejects over 1MiB even with forged content length', async () => {
  const f = fixture(); const req = new Request('https://market.example.invalid', { method: 'POST', body: ' '.repeat(1048577), headers: { 'stripe-signature': 'bad', 'content-length': '1' } });
  assert.equal((await handleStripeWebhook(req, f.deps)).status, 413); assert.equal(f.writes.length, 0);
});
test('foreign_signed_events_are_noops', async () => {
  const variants = [ { livemode: true }, { type: 'charge.succeeded' }, { account: 'acct_foreign' }, { account: null }, { data: { object: { id: 'cs_foreign', metadata: { tenant: 'foreign' } } } }, { data: { object: { id: 'cs_foreign', metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', order_id: '99999999-9999-4999-8999-999999999999' } } } } ];
  for (const patch of variants) {
    const f = fixture(); const foreignResponse = await handleStripeWebhook(f.request({ ...f.event, ...patch }), f.deps);
    const foreignDatabaseWrites = f.writes; const foreignStripeReads = f.reads;
    assert.equal(foreignResponse.status, 200); assert.equal(foreignDatabaseWrites.length, 0); assert.equal(foreignStripeReads.length, 0);
  }
});
test('known transient failure returns 503 without accepted receipt and authenticated retry succeeds', async () => {
  const f = fixture(); const apply = f.deps.store.applyCheckout; f.deps.store.applyCheckout = async () => { throw new Error('transaction rolled back'); };
  assert.equal((await handleStripeWebhook(f.request(), f.deps)).status, 503); assert.equal(f.writes.length, 0);
  f.deps.store.applyCheckout = apply; assert.equal((await handleStripeWebhook(f.request(), f.deps)).status, 200); assert.equal(f.order.state, 'paid');
});
test('stale_account_event_cannot_restore_readiness: canonical restricted account and contended lease', async () => {
  const f = fixture(); let leased = false;
  f.deps.store.acquireAccountRefresh = async () => { if (leased) return false; leased = true; return true; };
  const event = { ...f.event, type: 'account.updated', data: { object: { id: f.order.accountId, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: f.order.sellerId }, charges_enabled: true } } };
  const results = await Promise.all([1, 2].map(() => handleStripeWebhook(f.request(event), f.deps)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 503]); assert.deepEqual(f.writes, [{ ready: false, connection: 'restricted' }]);
});
test('public Node route ignores framework context and verifies signed foreign traffic while purchases are disabled', async () => {
  const { POST } = await import('../../../app/api/marketplace/stripe/webhook/route');
  const env = { MARKETPLACE_PAYMENT_TENANT: 'route-fixture', MARKETPLACE_APP_ORIGIN: 'https://market.example.invalid', MARKETPLACE_PAYMENTS_ENABLED: 'false', AUTH_SESSION_SECRET: 'fictional-route-session-secret-at-least32characters', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-service-key', STRIPE_WEBHOOK_SECRET: secret };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch; let networkCalls = 0;
  try {
    Object.assign(process.env, env); globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected network'); };
    const f = fixture(); const req = f.request({ ...f.event, livemode: true });
    const response: Response = await Reflect.apply(POST, undefined, [req, { params: Promise.resolve({}) }]);
    assert.equal(response.status, 200); assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
