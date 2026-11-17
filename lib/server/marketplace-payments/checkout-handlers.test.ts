import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CanonicalCheckout, PaymentDeps, PaymentStore, PreparedOrder, StoredOrder } from './contracts';
import { handleBuyerSession, handleCheckout, requireBuyer } from './checkout-handlers';
import { MarketplaceError } from '../../../features/marketplace/validation';

function fixture() {
  let now = new Date('2026-11-17T00:00:00Z'); let allowed = true; let ready = true; let loseCreate = false; let loseAttach = false;
  const listingId = randomUUID(); const key = randomUUID(); const orders: StoredOrder[] = [];
  const calls = { reserve: 0, prepare: 0, reads: 0, creates: [] as PreparedOrder[], rates: [] as { actor: string; action: string; limit: number }[] };
  const unused = async (): Promise<never> => { throw new Error('Unexpected operation'); };
  const account = { sellerId: randomUUID(), accountId: 'acct_fixture', ready: true, connection: 'ready' as const, checkedAt: now.toISOString(), accountCreateKey: 'account-key' };
  const canonical = (o: StoredOrder): CanonicalCheckout => ({ sessionId: 'cs_test_fixture', accountId: o.accountId, paymentIntentId: null, status: 'open', paymentStatus: 'unpaid', intentStatus: null, livemode: false, currency: 'php', grossMinor: 123450, feeMinor: null, quantity: 1, intentAmountReceivedMinor: null, intentCurrency: null, url: 'https://checkout.stripe.com/c/pay/fixture', expiresAt: o.checkoutExpiresAt, clientReferenceId: o.id, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', order_id: o.id, listing_id: o.listingId }, intentMetadata: {} });
  const store: PaymentStore = { getPublicPaymentStates: unused, findListingPaymentAccount: unused, getOrderConfirmation: unused,
    findSeller: unused, issueChallenge: unused, findChallenge: unused, consumeChallenge: unused, findSellerSession: unused, revokeSellerSession: unused, ensureSellerAccountSlot: unused, saveSellerAccount: unused, findSellerConnection: unused, applyCheckout: unused, saveSettlement: unused, findInventory: unused, findPaidWebhookReceipt: unused, listReconciliationOrders: unused,
    async consumeRate(actor, action, limit) { calls.rates.push({ actor, action, limit }); return allowed; },
    async findSellerAccount() { return account; }, async findAccountById() { return account; }, async acquireAccountRefresh() { return true; }, async saveAccountReadiness(_id, _tenant, _lease, value) { Object.assign(account, value); return true; },
    async reserve(input) {
      calls.reserve++;
      const previous = orders.find(o => o.buyerAccessHash === input.buyerAccessHash && o.submissionKey === input.submissionKey);
      if (previous) { if (previous.listingId !== input.listingId) throw new MarketplaceError('Conflict', 409); return { ...previous }; }
      if (orders.some(o => o.listingId === input.listingId)) throw new MarketplaceError('Conflict', 409);
      const id = randomUUID(); const order: StoredOrder = { id, tenant: 'local', listingId: input.listingId, sellerId: account.sellerId, accountId: account.accountId, buyerAccessHash: input.buyerAccessHash, readExpiresAt: new Date(+now + 604800000).toISOString(), submissionKey: input.submissionKey, state: 'preparing', title: 'Fictional item\u0000\n   safe title', grossMinor: 123450, feeMinor: 12345, currency: 'php', livemode: false, sessionId: null, paymentIntentId: null, createKey: `local:checkout:${id}:v1`, checkoutExpiresAt: Math.floor(+now / 1000) + 1860, preparedAt: now.toISOString(), stripeApiVersion: null, createParams: null };
      orders.push(order); return { ...order };
    },
    async prepareCheckout(input) { calls.prepare++; const o = orders.find(o => o.id === input.orderId)!; o.createParams ??= structuredClone(input.params); o.stripeApiVersion ??= input.apiVersion; return { ...o } as PreparedOrder; },
    async attachSession(id, _tenant, c) { const o = orders.find(o => o.id === id)!; o.sessionId = c.sessionId; o.state = 'open'; if (loseAttach) { loseAttach = false; throw new Error('DB committed, response lost'); } return { ...o }; },
    async findOrder(id, tenant) { return orders.find(o => o.id === id && o.tenant === tenant) ?? null; },
  };
  const deps: PaymentDeps = { store, context: { tenant: 'local', origin: 'https://market.example.invalid', enabled: true }, secret: 'fictional-32-character-payment-session-secret', now: () => now, randomBytes, mailer: { sendCode: unused }, stripe: { expireCheckout: unused, readSettlement: unused, verifyEvent: () => { throw new Error('Unexpected event'); },
    ensureAccount: unused, onboardingLink: unused,
    async readAccount(id) { return { accountId: id, ready, connection: ready ? 'ready' : 'restricted', checkedAt: now.toISOString(), metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: account.sellerId } }; },
    async createCheckout(o) { assert.ok(orders[0].createParams, 'parameters persisted before provider'); calls.creates.push(structuredClone(o)); if (loseCreate) { loseCreate = false; throw new Error('provider accepted, response lost'); } return { sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/fixture' }; },
    async readCheckout(o) { calls.reads++; return canonical(o); },
  } };
  const buyer = '__Host-fb08_mp_buyer=' + Buffer.alloc(32, 1).toString('base64url');
  const req = (body: unknown = { listingId }, headers: Record<string, string> = {}) => new Request(`${deps.context.origin}/api/marketplace/payments/checkout`, { method: 'POST', headers: { origin: deps.context.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'idempotency-key': key, cookie: buyer, ...headers }, body: JSON.stringify(body) });
  return { deps, req, calls, orders, listingId, key, buyer, account, setNow: (v: string) => { now = new Date(v); }, setAllowed: (v: boolean) => { allowed = v; }, setReady: (v: boolean) => { ready = v; }, loseCreate: () => { loseCreate = true; }, loseAttach: () => { loseAttach = true; } };
}

test('checkout_uses_sql_snapshot_and_connected_account', async () => {
  const f = fixture();
  assert.equal((await handleCheckout(f.req({ listingId: f.listingId, price: 1, accountId: 'acct_rogue', fee: 0 }), f.deps)).status, 400);
  assert.equal(f.calls.reserve, 0);
  const res = await handleCheckout(f.req(), f.deps); assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { orderId: f.orders[0].id, url: 'https://checkout.stripe.com/c/pay/fixture' });
  const o = f.calls.creates[0]; const m = { fb08_app: 'marketplace-payments-v1', tenant: 'local', order_id: o.id, listing_id: f.listingId };
  assert.equal(o.accountId, 'acct_fixture');
  assert.deepEqual(o.createParams, { mode: 'payment', payment_method_types: ['card'], client_reference_id: o.id, expires_at: 1794875460, metadata: m, line_items: [{ quantity: 1, price_data: { currency: 'php', unit_amount: 123450, product_data: { name: 'Fictional item safe title' } } }], payment_intent_data: { application_fee_amount: 12345, metadata: m }, success_url: `https://market.example.invalid/marketplace/orders/${o.id}`, cancel_url: `https://market.example.invalid/marketplace/${f.listingId}`, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false }, allow_promotion_codes: false, after_expiration: { recovery: { enabled: false } } });
});

test('buyer_cookie_precedes_checkout and bootstrap preserves earlier purchase capability', async () => {
  const f = fixture();
  for (const cookie of ['', 'fb08_session=board', '__Host-fb08_mp_buyer=bad']) assert.equal((await handleCheckout(f.req(undefined, { cookie }), f.deps)).status, 401);
  assert.equal(f.calls.reserve, 0);
  const bootstrap = await handleBuyerSession(f.req({}, { cookie: '' }), f.deps); assert.equal(bootstrap.status, 204);
  const cookie = bootstrap.headers.get('set-cookie')!; assert.match(cookie, /^__Host-fb08_mp_buyer=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  const proof = requireBuyer(f.req({}, { cookie: cookie.split(';')[0] }), f.deps);
  assert.equal((await handleCheckout(f.req(undefined, { cookie: cookie.split(';')[0] }), f.deps)).status, 201);
  const again = await handleBuyerSession(f.req({}, { cookie: cookie.split(';')[0] }), f.deps); assert.equal(again.status, 204); assert.equal(again.headers.get('set-cookie'), cookie);
  assert.equal(requireBuyer(f.req({}, { cookie: again.headers.get('set-cookie')!.split(';')[0] }), f.deps).accessHash, f.orders[0].buyerAccessHash);
  assert.equal(proof.accessHash, f.orders[0].buyerAccessHash);
  assert.equal((await handleCheckout(f.req({ listingId: randomUUID() }, { cookie: cookie.split(';')[0], 'idempotency-key': randomUUID() }), f.deps)).status, 201);
  assert.equal(f.orders[0].buyerAccessHash, f.orders[1].buyerAccessHash, 'second purchase retains first order authority');
});

test('origin/body/key/rate guards reserve nothing and actions hash IP budgets', async () => {
  const f = fixture();
  for (const [headers, status] of [[{ origin: 'https://evil.example.invalid' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-length': '9000' }, 413], [{ 'idempotency-key': 'bad' }, 400]] as const) assert.equal((await handleCheckout(f.req(undefined, headers), f.deps)).status, status);
  assert.equal((await handleCheckout(f.req({ listingId: f.listingId, extra: 'x'.repeat(9000) }), f.deps)).status, 413);
  f.setAllowed(false); assert.equal((await handleCheckout(f.req(), f.deps)).status, 429); assert.equal((await handleBuyerSession(f.req({}), f.deps)).status, 429);
  assert.equal(f.calls.reserve, 0); assert.equal(f.calls.creates.length, 0);
  assert.deepEqual(f.calls.rates.map(r => [r.action, r.limit]), [['payment-checkout-ip', 20], ['payment-buyer-session-ip', 20]]);
  assert.ok(f.calls.rates.every(r => /^[a-f0-9]{64}$/.test(r.actor)));
});

test('fresh canonical readiness failure keeps reservation held without creating Checkout', async () => {
  const f = fixture(); f.setReady(false);
  assert.equal((await handleCheckout(f.req(), f.deps)).status, 503); assert.equal(f.account.ready, false); assert.equal(f.calls.creates.length, 0); assert.equal(f.orders[0].state, 'preparing');
  f.setReady(true); assert.equal((await handleCheckout(f.req(), f.deps)).status, 201);
  const g = fixture(); g.deps.stripe.readAccount = async () => { throw new Error('private provider secret'); };
  const failure = await handleCheckout(g.req(), g.deps); assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('private')); assert.equal(g.account.ready, false); assert.equal(g.calls.creates.length, 0);
});

test('ambiguous_creation_never_rekeys_or_time_releases', async () => {
  const f = fixture(); f.loseCreate(); assert.equal((await handleCheckout(f.req(), f.deps)).status, 503);
  f.setNow('2026-11-17T00:00:30Z'); f.loseAttach(); assert.equal((await handleCheckout(f.req(), f.deps)).status, 503);
  assert.deepEqual(f.calls.creates[0].createParams, f.calls.creates[1].createParams); assert.equal(f.calls.creates[0].createKey, f.calls.creates[1].createKey);
  assert.equal((await handleCheckout(f.req(), f.deps)).status, 201); assert.equal(f.calls.creates.length, 2); assert.equal(f.orders.length, 1);
  const g = fixture(); g.loseCreate(); await handleCheckout(g.req(), g.deps);
  g.setNow('2026-11-17T00:01:01Z'); assert.equal((await handleCheckout(g.req(), g.deps)).status, 503);
  g.setNow('2026-11-18T00:00:00Z'); assert.equal((await handleCheckout(g.req(), g.deps)).status, 503);
  assert.equal(g.calls.creates.length, 1); assert.equal(g.orders.length, 1); assert.equal(g.orders[0].state, 'preparing');
});

test('same submission cannot buy another listing and declined/canceled attempts reuse the held open session', async () => {
  const f = fixture(); await handleCheckout(f.req(), f.deps);
  assert.equal((await handleCheckout(f.req({ listingId: randomUUID() }), f.deps)).status, 409);
  assert.equal((await handleCheckout(f.req(), f.deps)).status, 201); assert.equal(f.calls.creates.length, 1); assert.equal(f.orders[0].state, 'open');
  for (const state of ['paid', 'expired', 'review'] as const) { f.orders[0].state = state; const res = await handleCheckout(f.req(), f.deps); assert.equal(res.status, 201); assert.deepEqual(await res.json(), { orderId: f.orders[0].id, url: `https://market.example.invalid/marketplace/orders/${f.orders[0].id}` }); }
  assert.equal(f.calls.creates.length, 1);
});

test('unsafe hosted URL never reaches browser and disabled new creation reserves nothing', async () => {
  const f = fixture(); f.deps.context.enabled = false; assert.equal((await handleCheckout(f.req(), f.deps)).status, 503); assert.equal(f.calls.reserve, 0);
  f.deps.context.enabled = true; const read = f.deps.stripe.readCheckout; f.deps.stripe.readCheckout = async (o, id) => ({ ...await read(o, id), url: 'https://checkout.stripe.com.evil.invalid/c/pay/x' });
  assert.equal((await handleCheckout(f.req(), f.deps)).status, 503);
});
test('late attach paid/review and conflicting bound session only return the scoped order page', async () => {
  for (const state of ['paid', 'review', 'open'] as const) {
    const f = fixture(); const created = await handleCheckout(f.req(), f.deps); assert.equal(created.status, 201);
    f.deps.store.attachSession = async () => ({ ...f.orders[0], state, sessionId: state === 'open' ? 'cs_other_bound' : f.orders[0].sessionId });
    const result = await handleCheckout(f.req(), f.deps); assert.equal(result.status, 201);
    assert.equal((await result.json()).url, `${f.deps.context.origin}/marketplace/orders/${f.orders[0].id}`);
  }
});
