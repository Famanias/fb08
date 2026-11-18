import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOrder } from './reconcile';
import { paymentFixture } from './test-fixture';

test('canonical reconciliation applies exact owned canonical state with distinct operator provenance', async () => {
  const f = paymentFixture(); assert.equal(await reconcileOrder(f.order, f.deps), 'paid');
  const input = f.writes[0] as { eventId: string; eventType: string; canonical: unknown };
  assert.match(input.eventId, /^operator:/); assert.equal(input.eventType, 'operator.reconcile'); assert.deepEqual(input.canonical, f.canonical());
  assert.equal(f.order.state, 'paid'); assert.ok(f.reads.includes('settlement'));
});
test('canonical expiry retains holds except after provider terminal confirmation and never mutates mismatch', async () => {
  for (const status of ['processing', 'requires_action', null]) {
    const f = paymentFixture(); f.setOutcome('held'); f.setCanonical({ status: 'expired', paymentStatus: 'unpaid', intentStatus: status });
    assert.equal(await reconcileOrder(f.order, f.deps), 'held'); assert.ok(f.reads.includes('expire'));
  }
  const f = paymentFixture(); f.setOutcome('review'); f.setCanonical({ status: 'expired', quantity: 2 });
  assert.equal(await reconcileOrder(f.order, f.deps), 'review'); assert.ok(!f.reads.includes('expire'));
});
test('ambiguous unbound creation outside original expiry window freezes without API calls or writes', async () => {
  const f = paymentFixture(); f.order.sessionId = null; f.order.state = 'preparing'; f.deps.now = () => new Date('2026-11-18T00:00:00Z');
  assert.equal(await reconcileOrder(f.order, f.deps), 'held'); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});
test('settlement failure is independent of verified fulfillment', async () => {
  const f = paymentFixture(); f.deps.stripe.readSettlement = async () => { throw new Error('Balance pending'); };
  assert.equal(await reconcileOrder(f.order, f.deps), 'paid'); assert.equal(f.order.state, 'paid');
});
test('an existing ambiguous operation may retry only identical stored parameters within its unchanged window', async () => {
  const f = paymentFixture(); f.order.sessionId = null; f.order.state = 'preparing'; f.order.createParams = { sentinel: 'original-snapshot' };
  const original = structuredClone(f.order); const calls: unknown[] = [];
  f.deps.stripe.readAccount = async id => ({ accountId: id, ready: true, connection: 'ready', checkedAt: f.deps.now().toISOString(), metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: f.order.sellerId } });
  f.deps.stripe.createCheckout = async order => { calls.push(structuredClone(order)); return { sessionId: f.canonical().sessionId, url: 'https://checkout.stripe.com/c/pay/fixture' }; };
  assert.equal(await reconcileOrder(f.order, f.deps), 'paid'); assert.deepEqual(calls, [original]);
  assert.equal(f.deps.context.enabled, false, 'kill switch does not disable existing operation recovery');
  const late = paymentFixture(); late.order.sessionId = null; late.order.state = 'preparing';
  late.deps.stripe.readAccount = async id => { late.deps.now = () => new Date('2026-11-17T00:01:01Z'); return { accountId: id, ready: true, connection: 'ready', checkedAt: late.deps.now().toISOString(), metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: late.order.sellerId } }; };
  assert.equal(await reconcileOrder(late.order, late.deps), 'held'); assert.ok(!late.reads.includes('cs_test_fixture'));
});
