import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { createStripeGateway, type PaymentSdk } from './stripe-gateway';
import type { PreparedOrder } from './contracts';

const seller = { id: '11111111-1111-4111-8111-111111111111', emailNormalized: 'private@example.invalid', tenant: 'local' };
function fixture(linkUrl = 'https://connect.stripe.com/setup/fixture') {
  let account = { id: 'acct_fixture', object: 'account', country: 'US', details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: { card_payments: 'active' }, requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] }, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: seller.id } } as unknown as Stripe.Account;
  const calls: Array<{ method: string; params: unknown; options: unknown }> = [];
  const unused = async (): Promise<never> => { throw new Error('Unexpected Checkout operation'); };
  const sdk: PaymentSdk = { charges: { retrieve: unused }, balanceTransactions: { retrieve: unused }, checkout: { sessions: { create: unused, retrieve: unused, expire: unused } }, paymentIntents: { retrieve: unused, cancel: unused }, accounts: { async create(params, options) { calls.push({ method: 'create', params, options }); return account; }, async retrieve(id, _params, options) { calls.push({ method: 'retrieve', params: id, options }); return account; } }, accountLinks: { async create(params, options) { calls.push({ method: 'link', params, options }); return { url: linkUrl } as Stripe.AccountLink; } } };
  return { calls, account, setAccount: (a: Stripe.Account) => { account = a; }, gateway: createStripeGateway({ tenant: 'local', country: 'US', secretKey: 'sk_test_fixture', origin: 'https://market.example.invalid' }, sdk, () => new Date('2026-11-17T00:00:00Z')) };
}
test('official adapter creates only the selected controller with opaque metadata and stable key', async () => {
  const f = fixture(); assert.deepEqual(await f.gateway.ensureAccount(seller, 'local:account:opaque:v1'), { accountId: 'acct_fixture' });
  assert.deepEqual(f.calls[0], { method: 'create', params: { country: 'US', controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, capabilities: { card_payments: { requested: true } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: seller.id } }, options: { idempotencyKey: 'local:account:opaque:v1', timeout: 5000, maxNetworkRetries: 1 } });
  await f.gateway.ensureAccount(seller, 'local:account:opaque:v1'); assert.deepEqual(f.calls[1], f.calls[0], 'normal retry preserves exact parameters and key');
  assert.ok(!JSON.stringify(f.calls).includes('private@'));
  await assert.rejects(f.gateway.ensureAccount({ ...seller, tenant: 'foreign' }, 'key')); assert.equal(f.calls.length, 2);
});
test('hosted account link uses only fixed server origin', async () => {
  const f = fixture(); assert.deepEqual(await f.gateway.onboardingLink('acct_fixture', 'https://market.example.invalid'), { url: 'https://connect.stripe.com/setup/fixture' });
  assert.deepEqual(f.calls[0].params, { account: 'acct_fixture', type: 'account_onboarding', return_url: 'https://market.example.invalid/marketplace/payments/return', refresh_url: 'https://market.example.invalid/marketplace/payments/refresh' });
  await assert.rejects(f.gateway.onboardingLink('acct_fixture', 'https://evil.example.invalid')); await assert.rejects(f.gateway.readAccount('bad')); assert.equal(f.calls.length, 1);
});
test('each canonical readiness requirement fails closed and retrieval is bounded', async () => {
  const f = fixture(); assert.equal((await f.gateway.readAccount('acct_fixture')).ready, true);
  assert.deepEqual(f.calls[0].options, { timeout: 5000, maxNetworkRetries: 1 });
  for (const patch of [{ details_submitted: false }, { charges_enabled: false }, { payouts_enabled: false }, { country: 'CA' }, { capabilities: { card_payments: 'inactive' } }, { requirements: null }, { requirements: { ...f.account.requirements, disabled_reason: 'requirements.past_due' } }, { requirements: { ...f.account.requirements, currently_due: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, past_due: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, pending_verification: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, errors: [{}] } }, { controller: { ...f.account.controller, fees: { payer: 'application' } } }, { controller: { ...f.account.controller, losses: { payments: 'application' } } }, { controller: { ...f.account.controller, stripe_dashboard: { type: 'express' } } }, { controller: { ...f.account.controller, requirement_collection: 'application' } }, { metadata: { ...f.account.metadata, tenant: 'foreign' } }, { metadata: { ...f.account.metadata, fb08_app: 'foreign' } }, { deleted: true }]) {
    f.setAccount({ ...f.account, ...patch } as Stripe.Account); assert.equal((await f.gateway.readAccount('acct_fixture')).ready, false, JSON.stringify(patch));
  }
});

function checkoutFixture() {
  const id = '22222222-2222-4222-8222-222222222222'; const listingId = '33333333-3333-4333-8333-333333333333';
  const metadata = { fb08_app: 'marketplace-payments-v1', tenant: 'local', order_id: id, listing_id: listingId };
  const params = { mode: 'payment', payment_method_types: ['card'], client_reference_id: id, expires_at: 1794875460, metadata, line_items: [{ quantity: 1, price_data: { currency: 'php', unit_amount: 123450, product_data: { name: 'Fictional item' } } }], payment_intent_data: { application_fee_amount: 12345, metadata } };
  const order: PreparedOrder = { id, tenant: 'local', listingId, sellerId: seller.id, accountId: 'acct_fixture', buyerAccessHash: 'secret-hash', readExpiresAt: '2026-11-24T00:00:00Z', submissionKey: id, state: 'preparing', title: 'Fictional item', grossMinor: 123450, feeMinor: 12345, currency: 'php', livemode: false, sessionId: null, paymentIntentId: null, createKey: `local:checkout:${id}:v1`, checkoutExpiresAt: 1794875460, preparedAt: '2026-11-17T00:00:00Z', stripeApiVersion: '2026-10-28.endive', createParams: params };
  const calls: Array<{ method: string; params: unknown; options: Stripe.RequestOptions }> = [];
  let session = { id: 'cs_test_fixture', object: 'checkout.session', status: 'open', payment_status: 'unpaid', livemode: false, currency: 'php', amount_total: 123450, payment_intent: null, expires_at: 1794875460, client_reference_id: id, metadata, url: 'https://checkout.stripe.com/c/pay/fixture', line_items: { data: [{ quantity: 1 }], has_more: false } } as unknown as Stripe.Checkout.Session;
  let intent = { id: 'pi_fixture', object: 'payment_intent', application_fee_amount: 12345, status: 'succeeded', amount_received: 123450, currency: 'php', metadata } as unknown as Stripe.PaymentIntent;
  let failIntent = false; let race = false; let balance: Partial<Stripe.BalanceTransaction> | null = null;
  const unused = async (): Promise<never> => { throw new Error('Unexpected SDK call'); };
  const sdk = { charges: { async retrieve(id: string, _p: Stripe.ChargeRetrieveParams, options: Stripe.RequestOptions) { calls.push({ method: 'charge', params: id, options }); return { id, object: 'charge', paid: true, livemode: false, payment_intent: 'pi_fixture', balance_transaction: balance ? 'txn_fixture' : null } as Stripe.Charge; } }, balanceTransactions: { async retrieve(id: string, _p: Stripe.BalanceTransactionRetrieveParams, options: Stripe.RequestOptions) { calls.push({ method: 'balance', params: id, options }); return { id, source: 'ch_fixture', ...balance } as Stripe.BalanceTransaction; } }, accounts: { create: unused, retrieve: unused }, accountLinks: { create: unused }, checkout: { sessions: {
    async expire(id: string, _p: Stripe.Checkout.SessionExpireParams, options: Stripe.RequestOptions) { calls.push({ method: 'expire', params: id, options }); if (race) { session = { ...session, status: 'complete', payment_status: 'paid', payment_intent: 'pi_fixture' }; throw new Error('Already complete'); } session = { ...session, status: 'expired' }; return session; },
    async create(p: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) { calls.push({ method: 'create', params: p, options }); return session; },
    async retrieve(id: string, p: Stripe.Checkout.SessionRetrieveParams, options: Stripe.RequestOptions) { calls.push({ method: 'retrieve', params: { id, ...p }, options }); return session; },
  } }, paymentIntents: { async cancel(id: string, _p: Stripe.PaymentIntentCancelParams, options: Stripe.RequestOptions) { calls.push({ method: 'cancel', params: id, options }); intent = { ...intent, status: 'canceled' }; return intent; }, async retrieve(id: string, p: Stripe.PaymentIntentRetrieveParams, options: Stripe.RequestOptions) { calls.push({ method: 'intent', params: { id, ...p }, options }); if (failIntent) throw new Error('intent retrieval failed'); return { ...intent, latest_charge: 'ch_fixture' }; } } };
  const gateway = createStripeGateway({ tenant: 'local', country: 'US', secretKey: 'sk_test_fixture', origin: 'https://market.example.invalid' }, sdk);
  return { order, calls, metadata, gateway, session: () => session, setSession: (patch: Partial<Stripe.Checkout.Session>) => { session = { ...session, ...patch }; }, setIntent: (patch: Partial<Stripe.PaymentIntent>) => { intent = { ...intent, ...patch }; }, failIntent: () => { failIntent = true; }, completeDuringExpire: () => { race = true; }, setBalance: (value: Partial<Stripe.BalanceTransaction>) => { balance = value; } };
}

test('direct Checkout creates verbatim durable snapshot using account, original API and one stable key', async () => {
  const f = checkoutFixture();
  assert.deepEqual(await f.gateway.createCheckout(f.order), { sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/fixture' });
  await f.gateway.createCheckout(f.order);
  assert.deepEqual(f.calls[0], { method: 'create', params: f.order.createParams, options: { timeout: 5000, maxNetworkRetries: 1, stripeAccount: 'acct_fixture', apiVersion: '2026-10-28.endive', idempotencyKey: `local:checkout:${f.order.id}:v1` } });
  assert.deepEqual(f.calls[1], f.calls[0]); assert.ok(!JSON.stringify(f.calls).includes('secret-hash'));
  await assert.rejects(f.gateway.createCheckout({ ...f.order, tenant: 'foreign' }));
  await assert.rejects(f.gateway.createCheckout({ ...f.order, accountId: 'bad' })); assert.equal(f.calls.length, 2);
});

test('canonical Checkout retrieval is account/version scoped and never treats inaccessible PI as absent', async () => {
  const f = checkoutFixture();
  const open = await f.gateway.readCheckout(f.order, 'cs_test_fixture');
  assert.equal(open.feeMinor, null); assert.equal(open.paymentIntentId, null); assert.equal(open.quantity, 1);
  assert.deepEqual(f.calls[0], { method: 'retrieve', params: { id: 'cs_test_fixture', expand: ['line_items', 'payment_intent'] }, options: { timeout: 5000, maxNetworkRetries: 1, stripeAccount: 'acct_fixture', apiVersion: '2026-10-28.endive' } });
  f.setSession({ payment_intent: 'pi_fixture', status: 'complete', payment_status: 'paid' });
  const paid = await f.gateway.readCheckout({ ...f.order, sessionId: 'cs_test_fixture' });
  assert.equal(paid.intentStatus, 'succeeded'); assert.equal(paid.feeMinor, 12345); assert.equal(paid.intentAmountReceivedMinor, 123450); assert.deepEqual(paid.intentMetadata, f.metadata);
  assert.deepEqual(f.calls.at(-1), { method: 'intent', params: { id: 'pi_fixture' }, options: { timeout: 5000, maxNetworkRetries: 1, stripeAccount: 'acct_fixture', apiVersion: '2026-10-28.endive' } });
  f.failIntent(); f.setSession({ status: 'expired', payment_status: 'unpaid' }); await assert.rejects(f.gateway.readCheckout(f.order, 'cs_test_fixture'));
  const before = f.calls.length; await assert.rejects(f.gateway.readCheckout(f.order, 'https://evil.invalid')); assert.equal(f.calls.length, before);
});

test('Checkout browser URLs allow only HTTPS exact hosted Stripe hostname', async () => {
  for (const url of ['http://checkout.stripe.com/pay/x', 'https://checkout.stripe.com.evil.invalid/pay/x', 'https://evil.invalid/pay/x', 'https://user@checkout.stripe.com/pay/x', 'https://checkout.stripe.com:444/pay/x']) {
    const f = checkoutFixture(); f.setSession({ url }); await assert.rejects(f.gateway.createCheckout(f.order));
  }
});

test('onboarding browser URLs also reject nonstandard ports on the allowed host', async () => {
  const f = fixture('https://connect.stripe.com:444/setup/fixture');
  await assert.rejects(f.gateway.onboardingLink('acct_fixture', 'https://market.example.invalid'));
});
test('expanded PI and malformed or truncated line items fail closed without treating failed PI read as absent', async () => {
  const f = checkoutFixture();
  f.setSession({ payment_intent: { id: 'pi_fixture', status: 'succeeded', amount_received: 123450, currency: 'php', application_fee_amount: 12345, metadata: f.metadata } as unknown as Stripe.PaymentIntent });
  assert.equal((await f.gateway.readCheckout(f.order, 'cs_test_fixture')).intentStatus, 'succeeded');
  assert.equal(f.calls.filter(c => c.method === 'intent').length, 0);
  for (const items of [null, {}, { data: [], has_more: false }, { data: [{ quantity: 1 }], has_more: true }, { data: [{ quantity: 1 }, { quantity: 1 }], has_more: false }, { data: [{}], has_more: false }, { data: [{ quantity: -1 }], has_more: false }, { data: [{ quantity: 1.5 }], has_more: false }]) {
    f.setSession({ line_items: items as unknown as Stripe.ApiList<Stripe.LineItem> });
    assert.equal((await f.gateway.readCheckout(f.order, 'cs_test_fixture')).quantity, 0);
  }
});

test('expiry verifies canonical winner and only cancels Checkout PI in permitted requires_capture state', async () => {
  const f = checkoutFixture(); f.order.sessionId = 'cs_test_fixture';
  f.setSession({ payment_intent: 'pi_fixture' }); f.setIntent({ status: 'requires_capture' });
  const expired = await f.gateway.expireCheckout(f.order);
  assert.equal(expired.status, 'expired'); assert.equal(expired.intentStatus, 'canceled');
  assert.deepEqual(f.calls.filter(c => ['expire', 'cancel'].includes(c.method)).map(c => c.method), ['expire', 'cancel']);
  const race = checkoutFixture(); race.order.sessionId = 'cs_test_fixture'; race.completeDuringExpire();
  assert.equal((await race.gateway.expireCheckout(race.order)).paymentStatus, 'paid');
  assert.equal(race.calls.filter(c => c.method === 'cancel').length, 0);
  const processing = checkoutFixture(); processing.order.sessionId = 'cs_test_fixture'; processing.setSession({ status: 'expired', payment_intent: 'pi_fixture' }); processing.setIntent({ status: 'processing' });
  assert.equal((await processing.gateway.expireCheckout(processing.order)).intentStatus, 'processing'); assert.equal(processing.calls.filter(c => c.method === 'cancel').length, 0);
});

test('settlement_does_not_subtract_application_fee_twice and preserves actual settlement currency', async () => {
  for (const currency of ['php', 'usd']) {
    const f = checkoutFixture(); f.order.paymentIntentId = 'pi_fixture'; const scale = currency === 'php' ? 1 : 2;
    f.setBalance({ currency, amount: 123450 * scale, fee: 16345 * scale, net: 107105 * scale, fee_details: [{ application: null, description: null, type: 'application_fee', amount: 12345 * scale, currency }, { application: null, description: null, type: 'stripe_fee', amount: 4000 * scale, currency }] });
    const settlement = await f.gateway.readSettlement(f.order);
    assert.equal(settlement?.netMinor, 107105 * scale); assert.equal(settlement.currency, currency); assert.equal(settlement.grossMinor, 123450 * scale); assert.equal(settlement.applicationFeeMinor, 12345 * scale); assert.equal(settlement.stripeFeeMinor, 4000 * scale);
    assert.ok(f.calls.filter(c => ['intent', 'charge', 'balance'].includes(c.method)).every(c => c.options.stripeAccount === 'acct_fixture'));
  }
  const f = checkoutFixture(); f.order.paymentIntentId = 'pi_fixture';
  assert.equal(await f.gateway.readSettlement(f.order), null);
  f.setBalance({ currency: 'php', amount: 123450, fee: 16345, net: 107105, fee_details: [{ application: null, description: null, type: 'stripe_fee', amount: 4000, currency: 'usd' }] });
  assert.equal(await f.gateway.readSettlement(f.order), null);
});
test('unknown or inconsistent settlement evidence stays pending rather than claiming a net', async () => {
  const f = checkoutFixture(); f.order.paymentIntentId = 'pi_fixture';
  const balance: Partial<Stripe.BalanceTransaction> = { source: 'ch_fixture', currency: 'php', amount: 123450, fee: 16345, net: 107105, fee_details: [{ application: null, description: null, type: 'application_fee', amount: 12345, currency: 'php' }, { application: null, description: null, type: 'unknown_fee', amount: 4000, currency: 'php' }] };
  f.setBalance(balance); assert.equal(await f.gateway.readSettlement(f.order), null);
  f.setBalance({ ...balance, source: 'ch_other', fee_details: balance.fee_details!.map(fee => ({ ...fee, type: fee.type === 'unknown_fee' ? 'stripe_fee' : fee.type })) });
  assert.equal(await f.gateway.readSettlement(f.order), null);
});
test('a live-mode expanded Intent cannot satisfy sandbox canonical validation', async () => {
  const f = checkoutFixture(); f.setSession({ payment_intent: { id: 'pi_fixture', livemode: true, status: 'succeeded', amount_received: 123450, currency: 'php', application_fee_amount: 12345, metadata: f.metadata } as unknown as Stripe.PaymentIntent });
  assert.equal((await f.gateway.readCheckout(f.order, 'cs_test_fixture')).livemode, true);
});
