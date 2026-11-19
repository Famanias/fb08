/** Real committed reservation/HTTP concurrency on an explicitly selected disposable local API. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { createPaymentStore } from '../lib/server/marketplace-payments/store';
import { handleBuyerSession, handleCheckout, requireBuyer } from '../lib/server/marketplace-payments/checkout-handlers';
import { createStripeGateway, type PaymentSdk } from '../lib/server/marketplace-payments/stripe-gateway';
import type { PaymentDeps } from '../lib/server/marketplace-payments/contracts';

async function main() {
  const target = process.env.MARKETPLACE_TEST_SUPABASE_URL;
  if (!target) throw new Error('Set MARKETPLACE_TEST_SUPABASE_URL to a disposable local Supabase API.');
  const url = new URL(target);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Refusing non-local Supabase URL.');
  const key = process.env.MARKETPLACE_TEST_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set MARKETPLACE_TEST_SERVICE_ROLE_KEY for the local test stack.');
  const db = createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID(); const tenant = `checkout-${run}`; const sellerId = randomUUID(); const accountId = `acct_${run.replaceAll('-', '')}`;
  const listingIds: string[] = []; const actors = new Set<string>(); const sessions = new Map<string, Stripe.Checkout.Session>();
  const created: Array<{ params: Stripe.Checkout.SessionCreateParams; options: Stripe.RequestOptions }> = [];
  const store = createPaymentStore(db); const baseRate = store.consumeRate;
  store.consumeRate = async (actor, action, limit) => { actors.add(actor); return baseRate(actor, action, limit); };
  let now = new Date(); let loseCreate = false; let deleted = false; let accountReads = 0; let sessionReads = 0; let loseAttach = false;
  const originalAttach = store.attachSession;
  store.attachSession = async (...args) => { const result = await originalAttach(...args); if (loseAttach) { loseAttach = false; throw new Error('Committed attach response lost'); } return result; };
  const checked = (result: { error: { code?: string } | null }) => { if (result.error) throw new Error(`Local fixture database operation failed (${result.error.code ?? 'unknown'})`); };
  const unused = async (): Promise<never> => { throw new Error('Unexpected provider operation'); };
  const sdk: PaymentSdk = { charges: { retrieve: unused }, balanceTransactions: { retrieve: unused }, accounts: { create: unused, async retrieve(id) {
    accountReads++;
    if (deleted) return { id, object: 'account', deleted: true } as Stripe.DeletedAccount;
    return { id, object: 'account', country: 'US', details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: { card_payments: 'active' }, requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] }, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant, seller_id: sellerId } } as unknown as Stripe.Account;
  } }, accountLinks: { create: unused }, paymentIntents: { cancel: unused, retrieve: unused }, checkout: { sessions: { expire: unused,
    async create(params, options) {
      created.push({ params: structuredClone(params), options: { ...options } });
      assert.equal(options.stripeAccount, accountId); assert.equal(options.apiVersion, '2026-10-28.endive');
      let session = sessions.get(options.idempotencyKey!);
      if (!session) {
        session = { id: `cs_test_${randomBytes(12).toString('hex')}`, object: 'checkout.session', status: 'open', payment_status: 'unpaid', livemode: false, currency: 'php', amount_total: 123450, payment_intent: null, expires_at: params.expires_at, client_reference_id: params.client_reference_id, metadata: params.metadata, url: 'https://checkout.stripe.com/c/pay/fixture', payment_method_types: ['card', 'link'], wallet_options: params.wallet_options, line_items: { data: [{ quantity: 1 }], has_more: false } } as unknown as Stripe.Checkout.Session;
        sessions.set(options.idempotencyKey!, session);
      }
      if (loseCreate) { loseCreate = false; throw new Error('Accepted create response lost'); }
      return session;
    },
    async retrieve(id, _params, options) { sessionReads++; assert.equal(options.stripeAccount, accountId); assert.equal(options.apiVersion, '2026-10-28.endive'); const s = [...sessions.values()].find(s => s.id === id); assert.ok(s); return s; },
  } } };
  const deps: PaymentDeps = { store, context: { tenant, origin: 'https://market.example.invalid', enabled: true }, secret: `fictional-checkout-secret-${run}`, now: () => now, randomBytes, authenticateUser: unused, stripe: createStripeGateway({ tenant, origin: 'https://market.example.invalid', country: 'US', secretKey: 'sk_test_fixture' }, sdk, () => now) };
  const request = (listingId: string, cookie = `__Host-fb08_mp_buyer=${randomBytes(32).toString('base64url')}`, submissionKey = randomUUID(), extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => new Request('https://market.example.invalid/api/marketplace/payments/checkout', { method: 'POST', headers: { origin: deps.context.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'idempotency-key': submissionKey, cookie, ...headers }, body: JSON.stringify({ listingId, ...extra }) });
  const resetRates = async () => { if (actors.size) checked(await db.from('marketplace_rate_limits').delete().in('actor_hash', [...actors]).in('action', ['payment-checkout-ip', 'payment-buyer-session-ip'])); };
  async function listing(kind: 'sandbox' | 'ordinary' | 'demo' = 'sandbox', price = '1234.50', status = 'active', binding = tenant) {
    const id = randomUUID(); listingIds.push(id);
    checked(await db.from('marketplace_listings').insert({ id, title: 'Fictional Checkout fixture', description: 'Local test only', price, category: 'Other', seller_display_name: 'Test', image_path: `listings/${id}.webp`, inventory_kind: kind, status }));
    checked(await db.from('marketplace_listing_contacts').insert({ listing_id: id, seller_email: `${run}@example.invalid` }));
    if (kind === 'sandbox') checked(await db.from('marketplace_payment_inventory').insert({ listing_id: id, tenant: binding, seller_id: binding === tenant ? sellerId : null }));
    return id;
  }
  async function ready() {
    const lease = randomBytes(32).toString('hex');
    assert.equal(await store.acquireAccountRefresh(accountId, tenant, lease), true);
    assert.equal(await store.saveAccountReadiness(accountId, tenant, lease, { ready: true, connection: 'ready' }, new Date().toISOString()), true);
  }
  try {
    checked(await db.from('marketplace_payment_sellers').insert({ id: sellerId, tenant, email_normalized: `${run}@example.invalid`, verified_at: now.toISOString() }));
    const slot = await store.ensureSellerAccountSlot(sellerId, tenant); await store.saveSellerAccount(sellerId, tenant, accountId, slot.accountCreateKey); await ready();
    const raceListing = await listing();
    const responses = await Promise.all(Array.from({ length: 20 }, () => handleCheckout(request(raceListing), deps)));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 409).length, 19);
    assert.equal(new Set(created.map(c => c.options.idempotencyKey)).size, 1); assert.equal(created.length, 1); assert.equal(accountReads, 1);
    const held = await db.from('marketplace_orders').select('id,state').eq('listing_id', raceListing); checked(held); assert.equal(held.data?.length, 1); assert.equal(held.data![0].state, 'open');
    assert.equal(sessions.size, 1);
    console.log('PASS: parallel_buyers_create_only_one_session: 20 HTTP requests => 1 created, 19 conflicts; 1 hold, 1 session, 1 key, 1 fresh account read.');
    await resetRates();
    const beforeIneligible = created.length;
    for (const [kind, price, status, binding] of [['ordinary', '1234.50', 'active', tenant], ['demo', '1234.50', 'active', tenant], ['sandbox', '0', 'active', tenant], ['sandbox', '99.99', 'active', tenant], ['sandbox', '1000000', 'active', tenant], ['sandbox', '1234.50', 'sold', tenant], ['sandbox', '1234.50', 'active', `${tenant}-foreign`]] as const) {
      const id = await listing(kind, price, status, binding); assert.equal((await handleCheckout(request(id), deps)).status, 409, `${kind}/${price}/${status}/${binding}`);
      const rows = await db.from('marketplace_orders').select('id').eq('listing_id', id); checked(rows); assert.equal(rows.data?.length, 0);
    }
    checked(await db.from('marketplace_connected_accounts').update({ ready: false, connection: 'restricted' }).eq('tenant', tenant));
    assert.equal((await handleCheckout(request(await listing()), deps)).status, 409); await ready();
    deleted = true; const deletedListing = await listing(); assert.equal((await handleCheckout(request(deletedListing), deps)).status, 503); deleted = false;
    assert.equal((await store.findSellerAccount(sellerId, tenant))?.ready, false); await ready();
    assert.equal(created.length, beforeIneligible);
    console.log('PASS: only_sandbox_ready_matching_tenant_can_pay: ordinary/demo/zero/tiny/large/sold/foreign/restricted/deleted rejected; no Checkout create.');
    const guarded = await listing(); const reservesBefore = await db.from('marketplace_orders').select('id').eq('listing_id', guarded); checked(reservesBefore);
    assert.equal((await handleCheckout(request(guarded, ''), deps)).status, 401);
    assert.equal((await handleCheckout(request(guarded, undefined, undefined, { price: 1, accountId: 'acct_rogue', fee: 0 }), deps)).status, 400);
    assert.equal((await handleCheckout(request(guarded, undefined, undefined, {}, { origin: 'https://evil.invalid' }), deps)).status, 403);
    assert.equal((await handleCheckout(request(guarded, undefined, undefined, { extra: 'x'.repeat(9000) }), deps)).status, 413);
    const rows = await db.from('marketplace_orders').select('id').eq('listing_id', guarded); checked(rows); assert.equal(rows.data?.length, 0);
    await resetRates();
    const retryListing = await listing(); const cookie = `__Host-fb08_mp_buyer=${randomBytes(32).toString('base64url')}`; const retryKey = randomUUID(); const send = () => handleCheckout(request(retryListing, cookie, retryKey), deps);
    loseCreate = true; assert.equal((await send()).status, 503);
    const frozen = await db.from('marketplace_orders').select('*').eq('listing_id', retryListing).single(); checked(frozen); assert.ok(frozen.data.create_params); assert.equal(frozen.data.gross_minor, 123450); assert.equal(frozen.data.fee_minor, 12345);
    loseAttach = true; assert.equal((await send()).status, 503);
    assert.equal((await store.getPublicPaymentStates([retryListing], deps.context))[retryListing].availability, 'reserved');
    const resume = () => handleCheckout(request(retryListing, cookie, retryKey, { resumeOnly: true }), deps);
    const readsBeforeDenied = sessionReads;
    for (const denied of [
      request(retryListing, undefined, retryKey, { resumeOnly: true }),
      request(retryListing, '', retryKey, { resumeOnly: true }),
      request(retryListing, cookie, randomUUID(), { resumeOnly: true }),
      request(guarded, cookie, retryKey, { resumeOnly: true }),
    ]) assert.equal((await handleCheckout(denied, deps)).status, 409);
    assert.equal(sessionReads, readsBeforeDenied);
    const stale = await db.from('marketplace_orders').select('id').eq('listing_id', guarded); checked(stale); assert.equal(stale.data?.length, 0);
    const resumed = await resume();
    assert.equal(resumed.status, 201);
    assert.deepEqual(await resumed.json(), { orderId: frozen.data.id, url: 'https://checkout.stripe.com/c/pay/fixture' });
    const retryCreates = created.filter(c => c.options.idempotencyKey === frozen.data.create_key); assert.equal(retryCreates.length, 2); assert.deepEqual(retryCreates[0], retryCreates[1]);
    assert.equal((await handleCheckout(request(guarded, cookie, retryKey), deps)).status, 409);
    const bootstrap = new Request('https://market.example.invalid/api/marketplace/payments/buyer-session', { method: 'POST', headers: { origin: deps.context.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie }, body: '{}' });
    const proofBefore = requireBuyer(bootstrap, deps).accessHash; const boot = await handleBuyerSession(bootstrap, deps); assert.equal(boot.status, 204); assert.equal(boot.headers.get('set-cookie')!.split(';')[0], cookie); assert.equal(proofBefore, frozen.data.buyer_access_hash);

    const previous = await store.findOrder(frozen.data.id, tenant); assert.ok(previous);
    const canonical = await deps.stripe.readCheckout(previous);
    assert.equal(await store.applyCheckout({ orderId: previous.id, tenant, eventId: 'operator:' + randomUUID(), eventType: 'operator.reconcile', canonical: { ...canonical, status: 'expired', url: null }, now }), 'expired');
    const createsBeforeExpiryReply = created.length;
    const terminal = await resume();
    assert.equal(terminal.status, 201);
    assert.deepEqual(await terminal.json(), { orderId: previous.id, url: deps.context.origin + '/marketplace/orders/' + previous.id, expired: true });
    assert.equal(created.length, createsBeforeExpiryReply);
    assert.equal((await store.getPublicPaymentStates([retryListing], deps.context))[retryListing].availability, 'ready');
    const fresh = await handleCheckout(request(retryListing, cookie, randomUUID()), deps);
    assert.equal(fresh.status, 201);
    assert.notEqual((await fresh.json()).orderId, previous.id);
    assert.equal(created.length, createsBeforeExpiryReply + 1);
    console.log('PASS: same cookie/listing/key resumed one real reservation; absent/wrong proof and stale resume made no provider calls or new hold; persisted expiry allowed an explicit fresh key.');

    const ambiguousListing = await listing(); const ambiguousKey = randomUUID(); loseCreate = true;
    assert.equal((await handleCheckout(request(ambiguousListing, cookie, ambiguousKey), deps)).status, 503);
    const callsBeforeClock = created.length;
    now = new Date(+now + 61000); assert.equal((await handleCheckout(request(ambiguousListing, cookie, ambiguousKey), deps)).status, 503);
    now = new Date(+now + 24 * 3600000); assert.equal((await handleCheckout(request(ambiguousListing, cookie, ambiguousKey), deps)).status, 503);
    assert.equal(created.length, callsBeforeClock);
    const ambiguous = await db.from('marketplace_orders').select('state').eq('listing_id', ambiguousListing); checked(ambiguous); assert.equal(ambiguous.data?.length, 1); assert.equal(ambiguous.data![0].state, 'preparing');
    console.log('PASS: lost create/committed attach responses recover exact key/params; bootstrap preserves order proof; unsafe retry clocks retain one hold without rekey/release.');
  } finally {
    checked(await db.from('marketplace_stripe_events').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_orders').delete().eq('tenant', tenant));
    if (listingIds.length) { checked(await db.from('marketplace_payment_inventory').delete().in('listing_id', listingIds)); checked(await db.from('marketplace_listings').delete().in('id', listingIds)); }
    checked(await db.from('marketplace_connected_accounts').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_payment_sellers').delete().eq('tenant', tenant));
    await resetRates();
    const left = await db.from('marketplace_orders').select('id').eq('tenant', tenant); checked(left); assert.equal(left.data?.length, 0);
    console.log('PASS: exact local Checkout fixtures removed.');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Local Checkout checks failed.'); process.exitCode = 1; });
