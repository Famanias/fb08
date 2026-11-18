import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleOrderStatus } from './order-handlers';
import { paymentFixture } from './test-fixture';
import { proofHash } from './proof';

test('order_id_is_not_authority', async () => {
  const { deps, order, reads } = paymentFixture(); const token = 'a'.repeat(43);
  const dto = { orderId: order.id, listingId: order.listingId, title: order.title, status: 'pending', currency: 'PHP', grossMinor: 123450, applicationFeeMinor: 12345, sellerBeforeProcessingMinor: 111105, sandbox: true } as const;
  deps.store.getOrderConfirmation = async (id, hash, tenant, now) => id === order.id && hash === proofHash('buyer-session', token, deps.secret) && tenant === order.tenant && +now < Date.parse(order.readExpiresAt) ? dto : null;
  const request = (id = order.id, cookie = token, query = '') => new Request(`${deps.context.origin}/api/marketplace/payments/orders/${id}${query}`, { headers: cookie ? { cookie: `__Host-fb08_mp_buyer=${cookie}` } : {} });
  const absent = await handleOrderStatus(request('55555555-5555-4555-8555-555555555555'), deps); const absentBody = await absent.json();
  for (const req of [request(order.id, ''), request(order.id, 'b'.repeat(43)), request('bad'), request('')]) {
    const response = await handleOrderStatus(req, deps); assert.equal(response.status, 404); assert.deepEqual(await response.json(), absentBody);
  }
  deps.context.tenant = 'other'; assert.equal((await handleOrderStatus(request(), deps)).status, 404); deps.context.tenant = order.tenant;
  deps.now = () => new Date(order.readExpiresAt); assert.equal((await handleOrderStatus(request(), deps)).status, 404);
  deps.now = () => new Date('2026-11-17T00:00:00Z');
  const valid = await handleOrderStatus(request(), deps); assert.equal(valid.status, 200); assert.equal(valid.headers.get('cache-control'), 'no-store'); assert.equal(valid.headers.get('referrer-policy'), 'no-referrer');
  const confirmation = await valid.json(); assert.deepEqual(confirmation, dto); assert.doesNotMatch(JSON.stringify(confirmation), /sellerEmail|buyerEmail|accountId|sessionId|AccessHash/); assert.deepEqual(reads, []);
});

test('success_parameters_cannot_confirm_payment', async () => {
  const { deps, order } = paymentFixture(); deps.store.getOrderConfirmation = async () => ({ orderId: order.id, listingId: order.listingId, title: order.title, status: 'pending', currency: 'PHP', grossMinor: 123450, applicationFeeMinor: 12345, sellerBeforeProcessingMinor: 111105, sandbox: true });
  const response = await handleOrderStatus(new Request(`${deps.context.origin}/api/marketplace/payments/orders/${order.id}?paid=true&session_id=cs_test_forged`, { headers: { cookie: `__Host-fb08_mp_buyer=${'a'.repeat(43)}` } }), deps);
  assert.equal((await response.json()).status, 'pending'); assert.equal(deps.context.enabled, false);
});
