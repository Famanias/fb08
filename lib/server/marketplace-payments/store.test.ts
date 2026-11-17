import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createPaymentStore, storedOrder } from './store';

test('RPC adapter passes tenant and buyer proof privately and hides database errors', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ message: 'reservation_conflict private@example.invalid', code: 'P0001' }, { status: 400 });
  } } });
  const store = createPaymentStore(db);
  await assert.rejects(store.reserve({ tenant: 'local', listingId: 'id', buyerAccessHash: 'private-proof', submissionKey: 'key', now: new Date('2026-11-17T00:00:00Z') }), error => error instanceof Error && !error.message.includes('private') && 'status' in error && error.status === 409);
  assert.equal(requests[0].body.p_tenant, 'local'); assert.equal(requests[0].body.p_buyer_hash, 'private-proof');
  assert.ok(requests[0].url.endsWith('/rpc/marketplace_reserve_order'));
});
test('unsafe bigint rows fail closed rather than silently losing cents', () => {
  assert.throws(() => storedOrder({ gross_minor: '9007199254740993', fee_minor: 1, checkout_expires_at: 1 }));
});
test('paid receipt query requires completed paid webhook and tenant predicates', async () => {
  let query = new URL('http://localhost');
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async input => {
    query = new URL(String(input)); return Response.json([]);
  } } });
  assert.equal(await createPaymentStore(db).findPaidWebhookReceipt('order', 'local'), null);
  for (const [key, value] of Object.entries({ tenant: 'eq.local', order_id: 'eq.order', event_type: 'eq.checkout.session.completed', outcome: 'eq.paid', source: 'eq.webhook' })) assert.equal(query.searchParams.get(key), value);
});
test('reconciliation includes unenriched paid orders and paginates tenant-scoped work', async () => {
  let query = new URL('http://localhost');
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async input => {
    query = new URL(String(input)); return Response.json([]);
  } } });
  assert.deepEqual(await createPaymentStore(db).listReconciliationOrders('local'), []);
  assert.equal(query.searchParams.get('tenant'), 'eq.local');
  assert.equal(query.searchParams.get('or'), '(state.in.(preparing,open,review),and(state.eq.paid,settlement.is.null))');
  assert.equal(query.searchParams.get('limit'), '500');
});
