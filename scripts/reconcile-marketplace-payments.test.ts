import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMarketplacePayments, parseReconcileArgs, runReconciliation } from './reconcile-marketplace-payments';
import { paymentFixture } from '../lib/server/marketplace-payments/test-fixture';

test('reconciler is tenant scoped and read only by default with allowlisted output', async () => {
  const f = paymentFixture(); let tenant = '';
  f.deps.store.listReconciliationOrders = async t => { tenant = t; return [f.order, { ...f.order, tenant: 'foreign', accountId: 'acct_foreign' }]; };
  const result = await reconcileMarketplacePayments(f.deps);
  assert.equal(tenant, 'local'); assert.deepEqual(result, [{ orderId: f.order.id, state: 'open', action: 'inspect-session' }]);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  assert.ok(!JSON.stringify(result).includes('acct_')); assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(parseReconcileArgs([]), { apply: false }); assert.deepEqual(parseReconcileArgs(['--apply']), { apply: true }); assert.throws(() => parseReconcileArgs(['--account', 'acct_foreign']));
});
test('explicit apply uses operator provenance while disabled new purchases still reconcile', async () => {
  const f = paymentFixture(); f.deps.store.listReconciliationOrders = async () => [f.order];
  assert.deepEqual(await reconcileMarketplacePayments(f.deps, true), [{ orderId: f.order.id, state: 'open', action: 'paid' }]);
  assert.equal((f.writes[0] as { eventType: string }).eventType, 'operator.reconcile');
});
test('unbound unsafe retry is visibly frozen and paid fee enrichment does not reapply sale', async () => {
  const f = paymentFixture(); f.order.sessionId = null; f.order.state = 'preparing'; f.deps.now = () => new Date('2026-11-19T00:00:00Z');
  f.deps.store.listReconciliationOrders = async () => [f.order];
  assert.equal((await reconcileMarketplacePayments(f.deps))[0].action, 'frozen-review-evidence'); assert.equal((await reconcileMarketplacePayments(f.deps, true))[0].action, 'held');
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  f.order.state = 'paid'; f.order.paymentIntentId = 'pi_fixture';
  assert.equal((await reconcileMarketplacePayments(f.deps, true))[0].action, 'fee-details-pending'); assert.deepEqual(f.reads, ['settlement']); assert.equal(f.writes.length, 0);
});

for (const source of ['provider', 'store'] as const) {
  test(`apply continues to the next order after a ${source} failure and reports only the failed order ID and state`, async () => {
    const f = paymentFixture();
    const blocked = { ...f.order, id: '55555555-5555-4555-8555-555555555555', sessionId: 'cs_test_blocked' };
    const read = f.deps.stripe.readCheckout;
    const apply = f.deps.store.applyCheckout;
    f.deps.store.listReconciliationOrders = async () => [blocked, f.order];
    f.deps.stripe.readCheckout = async (order, id) => {
      if (order.id === blocked.id && source === 'provider') throw new Error('sensitive provider detail acct_blocked');
      return read(order, id);
    };
    f.deps.store.applyCheckout = async input => {
      if (input.orderId === blocked.id) throw new Error('sensitive database detail');
      return apply(input);
    };

    const output: string[] = [];
    assert.equal(await runReconciliation(f.deps, true, line => output.push(line)), 1);
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]), [
      { orderId: blocked.id, state: 'open', action: 'failed' },
      { orderId: f.order.id, state: 'open', action: 'paid' },
    ]);
    assert.equal(blocked.state, 'open');
    assert.equal(f.order.state, 'paid');
    assert.equal(f.writes.length, 1);
  });
}
