import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inspectPaymentOrder, parsePaymentInspectionArgs } from './verify-marketplace-payments';
import { paymentFixture } from '../lib/server/marketplace-payments/test-fixture';

function fixture() {
  const f = paymentFixture(); f.order.state = 'paid'; f.order.paymentIntentId = 'pi_fixture';
  const evidence = { listingId: f.order.listingId, inventoryKind: 'sandbox' as const, status: 'sold' as const, priceMinor: 123450, orderIds: [f.order.id] };
  f.deps.store.inspectInventory = async (id, tenant) => { assert.equal(id, f.order.listingId); assert.equal(tenant, 'local'); return evidence; };
  f.deps.store.findPaidWebhookReceipt = async (id, tenant) => { assert.equal(id, f.order.id); assert.equal(tenant, 'local'); return { eventId: 'evt_fixture', eventType: 'checkout.session.completed' }; };
  f.deps.stripe.readSettlement = async () => ({ currency: 'php', grossMinor: 123450, applicationFeeMinor: 12345, stripeFeeMinor: 1000, otherFeeMinor: 0, netMinor: 110105 });
  return { ...f, evidence, input: { base: f.deps.context.origin, orderId: f.order.id } };
}

test('inspector confirms exact canonical paid sale and webhook receipt without any mutation', async () => {
  const f = fixture();
  const providerMutationCalls: string[] = []; const databaseMutationCalls: string[] = [];
  const readMethods = ['findOrder', 'findAccountById', 'inspectInventory', 'findPaidWebhookReceipt'];
  f.deps.store = new Proxy(f.deps.store, { get(target, property) { if (readMethods.includes(String(property))) return target[property as keyof typeof target]; return async () => { databaseMutationCalls.push(String(property)); throw new Error('Unexpected database operation'); }; } });
  f.deps.stripe = new Proxy(f.deps.stripe, { get(target, property) { if (['readCheckout', 'readSettlement'].includes(String(property))) return target[property as keyof typeof target]; return async () => { providerMutationCalls.push(String(property)); throw new Error('Unexpected provider operation'); }; } });
  assert.deepEqual(await inspectPaymentOrder(f.input, f.deps), { paid: true, sold: true, webhookConfirmed: true, feeDetails: 'confirmed' });
  assert.equal(providerMutationCalls.length, 0); assert.equal(databaseMutationCalls.length, 0);
  assert.deepEqual(f.writes, []); assert.ok(!f.reads.includes('expire'));
});

test('fee details remain pending for inconsistent PHP amounts and malformed settlement arithmetic', async () => {
  for (const patch of [{ grossMinor: 123451, netMinor: 110106 }, { applicationFeeMinor: 1, netMinor: 122449 }, { netMinor: 0 }, { stripeFeeMinor: -1 }]) {
    const f = fixture(); f.deps.stripe.readSettlement = async () => ({ currency: 'php', grossMinor: 123450, applicationFeeMinor: 12345, stripeFeeMinor: 1000, otherFeeMinor: 0, netMinor: 110105, ...patch });
    assert.equal((await inspectPaymentOrder(f.input, f.deps)).feeDetails, 'pending');
  }
});

test('inspector rejects origin and identifier mistakes before database or provider calls', async () => {
  for (const patch of [{ base: 'https://foreign.example' }, { base: 'https://market.example.invalid/' }, { base: 'https://market.example.invalid?secret=PRIVATE' }, { orderId: 'bad' }]) {
    const f = fixture(); const databaseCalls: string[] = [];
    f.deps.store = new Proxy(f.deps.store, { get(_target, method) { return async () => { databaseCalls.push(String(method)); throw new Error('must not read'); }; } });
    await assert.rejects(inspectPaymentOrder({ ...f.input, ...patch }, f.deps), /^Error: Payment inspection failed\.$/);
    assert.deepEqual(databaseCalls, []);
    assert.deepEqual(f.reads, []);
  }
});

test('inspector refuses foreign orders, live provider objects, altered price/fee/intent and attribution', async () => {
  const changes = [() => ({ tenant: 'foreign' }), () => ({ id: '55555555-5555-4555-8555-555555555555' }), () => ({ feeMinor: 1 }), () => ({ state: 'open' as const })];
  for (const change of changes) { const f = fixture(); Object.assign(f.order, change()); await assert.rejects(inspectPaymentOrder(f.input, f.deps)); assert.deepEqual(f.writes, []); }
  for (const patch of [{ livemode: true }, { grossMinor: 1 }, { feeMinor: 1 }, { intentAmountReceivedMinor: 1 }, { intentCurrency: 'usd' }, { intentStatus: 'processing' }, { paymentIntentId: 'pi_other' }, { metadata: {} }, { accountId: 'acct_other' }, { quantity: 2 }]) {
    const f = fixture(); f.setCanonical(patch); await assert.rejects(inspectPaymentOrder(f.input, f.deps)); assert.deepEqual(f.writes, []);
  }
});

test('inspector refuses ordinary/demo inventory, changed price, wrong listing and multiple holds/sales', async () => {
  for (const patch of [{ inventoryKind: 'ordinary' }, { inventoryKind: 'demo' }, { status: 'active' }, { listingId: 'other' }, { priceMinor: 123451 }, { orderIds: [] }, { orderIds: ['other'] }, { orderIds: ['other', 'second'] }]) {
    const f = fixture(); Object.assign(f.evidence, patch); await assert.rejects(inspectPaymentOrder(f.input, f.deps)); assert.deepEqual(f.writes, []);
  }
});

test('inspector requires a real paid webhook receipt and matching seller account', async () => {
  for (const receipt of [null, { eventId: 'operator:fixture', eventType: 'checkout.session.completed' as const }]) {
    const f = fixture(); f.deps.store.findPaidWebhookReceipt = async () => receipt; await assert.rejects(inspectPaymentOrder(f.input, f.deps));
  }
  const f = fixture(); f.deps.store.findAccountById = async () => null; await assert.rejects(inspectPaymentOrder(f.input, f.deps)); assert.deepEqual(f.writes, []);
});

test('settlement absent or provider failure stays explicitly pending without disclosing private payloads', async () => {
  for (const throws of [false, true]) {
    const f = fixture(); f.deps.stripe.readSettlement = async () => { if (throws) throw new Error('sk_test_PRIVATE buyer@example.invalid 123456 browser-proof'); return null; };
    assert.deepEqual(await inspectPaymentOrder(f.input, f.deps), { paid: true, sold: true, webhookConfirmed: true, feeDetails: 'pending' }); assert.deepEqual(f.writes, []);
  }
  const f = fixture(); f.deps.stripe.readCheckout = async () => { throw new Error('sk_test_PRIVATE buyer@example.invalid 123456 browser-proof'); };
  await assert.rejects(inspectPaymentOrder(f.input, f.deps), /^Error: Payment inspection failed\.$/);
});

test('CLI arguments are exact and imports of all operator scripts perform no setup or output', () => {
  assert.deepEqual(parsePaymentInspectionArgs(['--base', 'https://owned.invalid', '--order-id', 'id']), { base: 'https://owned.invalid', orderId: 'id' });
  for (const args of [[], ['--apply'], ['--base', 'a', '--order-id', 'b', '--base', 'c']]) assert.throws(() => parsePaymentInspectionArgs(args));
  const child = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', "await import('./scripts/verify-marketplace-payments.ts'); await import('./scripts/classify-marketplace-demos.ts'); await import('./scripts/reconcile-marketplace-payments.ts')"], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' } });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
});
