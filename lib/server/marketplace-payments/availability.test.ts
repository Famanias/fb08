import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getListingPaymentState } from './availability';
import { paymentFixture } from './test-fixture';
test('stale known ready detail refreshes canonical account through the existing fence', async () => {
  const { deps, order, writes, reads } = paymentFixture(); deps.context.enabled = true;
  let ready = true; let review = false; let checkedAt = order.preparedAt;
  deps.store.getPublicPaymentStates = async () => ({ [order.listingId]: { sandbox: true, availability: review ? 'unavailable' : ready && +deps.now() - Date.parse(checkedAt) <= 60000 ? 'ready' : 'unavailable' } });
  deps.store.findListingPaymentAccount = async () => review ? null : ({ sellerId: order.sellerId, accountId: order.accountId, ready, connection: ready ? 'ready' : 'restricted', checkedAt, accountCreateKey: 'private' });
  deps.store.saveAccountReadiness = async (_id, _tenant, _lease, value, time) => { ready = value.ready; checkedAt = time; writes.push('saved'); return true; };
  deps.stripe.readAccount = async id => { reads.push(id); return { accountId: id, ready: true, connection: 'ready', metadata: { fb08_app: 'marketplace-payments-v1', tenant: order.tenant, seller_id: order.sellerId }, checkedAt: deps.now().toISOString() }; };
  deps.now = () => new Date('2026-11-17T00:01:01Z');
  assert.deepEqual(await getListingPaymentState(order.listingId, true, deps), { sandbox: true, availability: 'ready' }); assert.deepEqual(reads, [order.accountId]); assert.ok(writes.includes('lease'));
  deps.now = () => new Date('2026-11-17T00:02:02Z'); deps.stripe.readAccount = async () => { throw new Error('private provider failure'); };
  assert.equal((await getListingPaymentState(order.listingId, true, deps)).availability, 'unavailable');
  review = true; const before = writes.length; assert.equal((await getListingPaymentState(order.listingId, true, deps)).availability, 'unavailable'); assert.equal(writes.length, before);
});
