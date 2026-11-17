/** Signed HTTP ingress + production SDK adapter + real owned local PostgREST transactions. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createPaymentStore } from '../lib/server/marketplace-payments/store';
import { createStripeGateway, type PaymentSdk } from '../lib/server/marketplace-payments/stripe-gateway';
import { handleStripeWebhook } from '../lib/server/marketplace-payments/webhook-handler';
import { reconcileOrder } from '../lib/server/marketplace-payments/reconcile';
import type { PaymentDeps, StoredOrder } from '../lib/server/marketplace-payments/contracts';

async function main() {
  const target = process.env.MARKETPLACE_TEST_SUPABASE_URL; if (!target) throw new Error('An explicitly selected disposable local API is required.');
  const api = new URL(target);
  if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || api.username || api.password) throw new Error('Refusing non-local API.');
  const key = process.env.MARKETPLACE_TEST_SERVICE_ROLE_KEY; if (!key) throw new Error('Explicit local fixture key required.');
  const databaseWrites: string[] = []; const stripeReads: string[] = []; const soldUpdates: string[] = [];
  const db = createClient(api.href, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) databaseWrites.push(new URL(String(input)).pathname);
    return fetch(input, init);
  } } });
  const checked = (result: { error: { code?: string } | null }) => { if (result.error) throw new Error(`Owned event fixture database error (${result.error.code ?? 'unknown'}).`); };
  const run = randomUUID(); const tenant = `events-${run}`; const sellerId = randomUUID(); const accountId = `acct_${run.replaceAll('-', '')}`;
  const listings: string[] = []; const sessions = new Map<string, Stripe.Checkout.Session>(); const racing = new Set<string>();
  const secret = `whsec_${randomBytes(32).toString('hex')}`; const now = new Date();
  const unused = async (): Promise<never> => { throw new Error('Unexpected provider operation'); };
  const sdk: PaymentSdk = { accounts: { create: unused, async retrieve(id) {
    stripeReads.push(id); assert.equal(id, accountId);
    return { id, object: 'account', country: 'US', details_submitted: true, charges_enabled: false, payouts_enabled: false, capabilities: { card_payments: 'inactive' }, requirements: { disabled_reason: 'requirements.past_due', currently_due: [], past_due: [], pending_verification: [], errors: [] }, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant, seller_id: sellerId } } as unknown as Stripe.Account;
  } }, accountLinks: { create: unused }, charges: { retrieve: unused }, balanceTransactions: { retrieve: unused }, paymentIntents: { retrieve: unused, cancel: unused }, checkout: { sessions: { create: unused,
    async retrieve(id, _params, options) { stripeReads.push(id); assert.equal(options.stripeAccount, accountId); const s = sessions.get(id); assert.ok(s); return structuredClone(s); },
    async expire(id, _params, options) { stripeReads.push(`expire:${id}`); assert.equal(options.stripeAccount, accountId); const s = sessions.get(id)!;
      if (racing.has(id)) { s.status = 'complete'; s.payment_status = 'paid'; (s.payment_intent as Stripe.PaymentIntent).status = 'succeeded'; throw new Error('Completion won expiry race'); }
      s.status = 'expired'; return structuredClone(s);
    },
  } } };
  const store = createPaymentStore(db); const originalApply = store.applyCheckout;
  store.applyCheckout = async input => { const result = await originalApply(input); if (result === 'paid') soldUpdates.push(input.orderId); return result; };
  const deps: PaymentDeps = { store, stripe: createStripeGateway({ tenant, origin: 'https://market.example.invalid', country: 'US', secretKey: 'sk_test_fixture', webhookSecret: secret }, sdk), context: { tenant, origin: 'https://market.example.invalid', enabled: false }, mailer: { sendCode: unused }, secret: 'fictional-session-secret-at-least32characters', now: () => now, randomBytes };
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handleStripeWebhook(new Request('http://127.0.0.1/webhook', { method: 'POST', body: Buffer.concat(chunks), headers: { 'stripe-signature': String(req.headers['stripe-signature'] ?? '') } }), deps);
      res.writeHead(response.status); res.end();
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const endpoint = `http://127.0.0.1:${address.port}/webhook`;
  function event(order: StoredOrder, type = 'checkout.session.completed', id = `evt_${randomBytes(12).toString('hex')}`) {
    return { id, type, livemode: false, account: accountId, data: { object: { id: sessionId(order), object: 'checkout.session', metadata: sessions.get(sessionId(order))!.metadata } } };
  }
  async function send(e: unknown) { const body = ` \n${JSON.stringify(e, null, 2)}\n`; return fetch(endpoint, { method: 'POST', body, headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) } }); }
  function sessionId(order: StoredOrder) { return `cs_test_${order.id.replaceAll('-', '')}`; }
  async function fixture() {
    const listingId = randomUUID(); listings.push(listingId);
    checked(await db.from('marketplace_listings').insert({ id: listingId, title: 'Fictional signed event fixture', description: 'Local test only', price: '1234.50', category: 'Other', seller_display_name: 'Test', image_path: `listings/${listingId}.webp`, inventory_kind: 'sandbox' }));
    checked(await db.from('marketplace_listing_contacts').insert({ listing_id: listingId, seller_email: `${run}@example.invalid` }));
    checked(await db.from('marketplace_payment_inventory').insert({ listing_id: listingId, tenant }));
    const order = await store.reserve({ listingId, tenant, buyerAccessHash: 'fixture-buyer', submissionKey: randomUUID(), now });
    const metadata = { fb08_app: 'marketplace-payments-v1', tenant, order_id: order.id, listing_id: listingId };
    const prepared = await store.prepareCheckout({ orderId: order.id, tenant, apiVersion: '2026-10-28.endive', params: { mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id, expires_at: order.checkoutExpiresAt, metadata, line_items: [{ quantity: 1, price_data: { currency: 'php', unit_amount: 123450 } }], payment_intent_data: { application_fee_amount: 12345, metadata } } });
    sessions.set(sessionId(order), { id: sessionId(order), object: 'checkout.session', status: 'complete', payment_status: 'paid', livemode: false, currency: 'php', amount_total: 123450, expires_at: order.checkoutExpiresAt, client_reference_id: order.id, metadata, line_items: { data: [{ quantity: 1 }], has_more: false }, url: null, payment_intent: { id: `pi_${order.id.replaceAll('-', '')}`, object: 'payment_intent', status: 'succeeded', application_fee_amount: 12345, amount_received: 123450, currency: 'php', metadata } } as unknown as Stripe.Checkout.Session);
    return prepared;
  }
  try {
    checked(await db.from('marketplace_payment_sellers').insert({ id: sellerId, tenant, email_normalized: `${run}@example.invalid`, verified_at: now.toISOString() }));
    const slot = await store.ensureSellerAccountSlot(sellerId, tenant); await store.saveSellerAccount(sellerId, tenant, accountId, slot.accountCreateKey);
    const lease = randomBytes(32).toString('hex'); assert.ok(await store.acquireAccountRefresh(accountId, tenant, lease)); assert.ok(await store.saveAccountReadiness(accountId, tenant, lease, { ready: true, connection: 'ready' }, now.toISOString()));
    const preattach = await fixture(); const signed = event(preattach); const duplicates = await Promise.all(Array.from({ length: 20 }, (_, i) => send(i % 2 ? signed : event(preattach))));
    assert.ok(duplicates.every(r => r.status === 200));
    const paid = await db.from('marketplace_orders').select('id').eq('id', preattach.id).eq('state', 'paid'); checked(paid);
    const paidOrders = paid.data!; assert.equal(paidOrders.length, 1); assert.equal(soldUpdates.length, 1);
    assert.equal((await store.findOrder(preattach.id, tenant))?.sessionId, sessionId(preattach));
    const canonical = await deps.stripe.readCheckout(preattach, sessionId(preattach)); assert.equal((await store.attachSession(preattach.id, tenant, canonical)).state, 'paid');
    assert.ok(await store.findPaidWebhookReceipt(preattach.id, tenant));
    assert.equal((await send(event(preattach, 'checkout.session.expired'))).status, 200); assert.equal((await store.findOrder(preattach.id, tenant))?.state, 'paid');
    console.log('PASS webhook_can_bind_preparing_order_once: 20 signed duplicate/semantic events => one paid order, one sale, exact initial binding; late expiry never downgrades.');
    const beforeWrites = databaseWrites.length; const beforeReads = stripeReads.length;
    for (const patch of [{ livemode: true }, { account: 'acct_foreign' }, { account: null }, { type: 'charge.succeeded' }, { data: { object: { id: 'cs_foreign', metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'foreign', order_id: preattach.id } } } }, { data: { object: { id: 'cs_foreign', metadata: { fb08_app: 'marketplace-payments-v1', tenant, order_id: randomUUID() } } } }]) {
      const foreignResponse = await send({ ...signed, ...patch }); assert.equal(foreignResponse.status, 200);
    }
    const foreignDatabaseWrites = databaseWrites.slice(beforeWrites); const foreignStripeReads = stripeReads.slice(beforeReads);
    assert.equal(foreignDatabaseWrites.length, 0); assert.equal(foreignStripeReads.length, 0);
    console.log('PASS foreign_signed_events_are_noops: signed foreign/live/unsupported/missing account/order => 200, zero database writes, zero provider reads.');
    const delayed = await fixture(); const delayedSession = sessions.get(sessionId(delayed))!; delayedSession.payment_status = 'unpaid'; (delayedSession.payment_intent as Stripe.PaymentIntent).status = 'processing'; const delayedEvent = event(delayed);
    assert.equal((await send(delayedEvent)).status, 200); assert.equal((await store.findOrder(delayed.id, tenant))?.state, 'preparing');
    delayedSession.payment_status = 'paid'; (delayedSession.payment_intent as Stripe.PaymentIntent).status = 'succeeded';
    assert.equal((await send(delayedEvent)).status, 200); assert.equal((await store.findOrder(delayed.id, tenant))?.state, 'paid');
    const operator = await fixture(); assert.equal(await reconcileOrder(operator, deps, undefined), 'held', 'unbound unsafe/no-ready operation remains frozen');
    // A known bound canonical session may be reconciled without new-purchase readiness.
    await store.attachSession(operator.id, tenant, await deps.stripe.readCheckout(operator, sessionId(operator)));
    assert.equal(await reconcileOrder((await store.findOrder(operator.id, tenant))!, deps), 'paid'); assert.equal(await store.findPaidWebhookReceipt(operator.id, tenant), null);
    assert.equal((await send(event(operator))).status, 200); assert.ok(await store.findPaidWebhookReceipt(operator.id, tenant)); assert.equal(soldUpdates.filter(id => id === operator.id).length, 1);
    console.log('PASS delayed same-event paid advances held receipt; operator fulfillment stays distinct and later signed webhook establishes real paid evidence without another sale.');
    // Reset readiness because the frozen original-operation attempt retrieved a restricted account.
    const lease2 = randomBytes(32).toString('hex'); assert.ok(await store.acquireAccountRefresh(accountId, tenant, lease2)); assert.ok(await store.saveAccountReadiness(accountId, tenant, lease2, { ready: true, connection: 'ready' }, now.toISOString()));
    for (const mismatch of ['amount', 'quantity', 'currency', 'fee', 'listing', 'intent-metadata', 'received', 'session']) {
      const order = await fixture(); const session = sessions.get(sessionId(order))!;
      const intent = session.payment_intent as Stripe.PaymentIntent;
      await store.attachSession(order.id, tenant, await deps.stripe.readCheckout(order, session.id));
      if (mismatch === 'amount') session.amount_total = 123451;
      if (mismatch === 'quantity') session.line_items!.data[0].quantity = 2;
      if (mismatch === 'currency') session.currency = 'usd';
      if (mismatch === 'fee') intent.application_fee_amount = 12346;
      if (mismatch === 'listing') session.metadata!.listing_id = randomUUID();
      if (mismatch === 'intent-metadata') intent.metadata = { ...intent.metadata, order_id: randomUUID() };
      if (mismatch === 'received') intent.amount_received = 123449;
      const incoming = event(order);
      if (mismatch === 'session') { const different = structuredClone(session); different.id = `cs_test_${randomBytes(12).toString('hex')}`; sessions.set(different.id, different); incoming.data.object.id = different.id; }
      assert.equal((await send(incoming)).status, 200);
      assert.equal((await store.findOrder(order.id, tenant))?.state, 'review', mismatch);
      assert.equal((await store.findInventory(order.listingId, tenant))?.status, 'active');
    }
    console.log('PASS known_mismatch_never_sells: canonical amount/quantity/PHP/fee/listing/Intent metadata/received/session mismatches record review and keep inventory active.');
    const expiry = await fixture(); const exp = sessions.get(sessionId(expiry))!; exp.status = 'expired'; exp.payment_status = 'unpaid'; (exp.payment_intent as Stripe.PaymentIntent).status = 'processing';
    assert.equal((await send(event(expiry, 'checkout.session.expired'))).status, 200); assert.equal((await store.findOrder(expiry.id, tenant))?.state, 'preparing');
    (exp.payment_intent as Stripe.PaymentIntent).status = 'canceled'; assert.equal((await send(event(expiry, 'checkout.session.expired'))).status, 200); assert.equal((await store.findOrder(expiry.id, tenant))?.state, 'expired');
    const race = await fixture(); const s = sessions.get(sessionId(race))!; s.status = 'open'; s.payment_status = 'unpaid'; (s.payment_intent as Stripe.PaymentIntent).status = 'requires_action'; racing.add(s.id);
    await store.attachSession(race.id, tenant, await deps.stripe.readCheckout(race, s.id));
    deps.now = () => new Date((race.checkoutExpiresAt + 1) * 1000);
    const results = await Promise.all([reconcileOrder((await store.findOrder(race.id, tenant))!, deps), send(event(race))]);
    assert.equal((results[1] as Response).status, 200); assert.equal((await store.findOrder(race.id, tenant))?.state, 'paid'); assert.equal(soldUpdates.filter(id => id === race.id).length, 1);
    console.log('PASS expiry_requires_terminal_intent: processing held; verified canceled released; real operator-expire versus signed completion race retrieves winner and sells once.');
    const staleAccount = { id: `evt_${randomBytes(12).toString('hex')}`, type: 'account.updated', created: Math.floor(+now / 1000) - 3600, livemode: false, account: accountId, data: { object: { id: accountId, metadata: { fb08_app: 'marketplace-payments-v1', tenant, seller_id: sellerId }, charges_enabled: true, payouts_enabled: true } } };
    const refreshes = await Promise.all([send(staleAccount), send({ ...staleAccount, id: `evt_${randomBytes(12).toString('hex')}` })]);
    assert.ok(refreshes.every(r => [200, 503].includes(r.status))); assert.ok(refreshes.some(r => r.status === 200));
    assert.equal((await store.findAccountById(accountId, tenant))?.ready, false);
    console.log('PASS stale_account_event_cannot_restore_readiness: two signed stale-ready payloads use fenced canonical restricted refresh; ready remains false.');

  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    checked(await db.from('marketplace_stripe_events').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_orders').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_payment_inventory').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_connected_accounts').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_payment_sellers').delete().eq('id', sellerId).eq('tenant', tenant));
    if (listings.length) checked(await db.from('marketplace_listings').delete().in('id', listings));
    console.log('PASS exact owned signed-event fixtures removed.');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Owned event checks failed.'); process.exitCode = 1; });
