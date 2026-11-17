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
test('account slot and refresh adapter preserve tenant, creation key and fencing arguments', async () => {
  const calls: Array<{ path: string; body: Record<string, unknown>; url: URL }> = [];
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : {}, url });
    if (url.pathname.endsWith('marketplace_ensure_account_slot')) return Response.json({ seller_id: 'seller', account_id: null, account_create_key: 'stable', prepared_at: '2026-11-17T00:00:00Z' });
    if (url.pathname.endsWith('marketplace_connected_accounts')) return Response.json(null);
    return Response.json(true);
  } } });
  const store = createPaymentStore(db);
  assert.deepEqual(await store.ensureSellerAccountSlot('seller', 'local'), { sellerId: 'seller', accountId: null, accountCreateKey: 'stable', preparedAt: '2026-11-17T00:00:00Z' });
  await store.saveSellerAccount('seller', 'local', 'acct_fixture', 'stable'); assert.equal(await store.acquireAccountRefresh('acct_fixture', 'local', 'fence'), true);
  assert.equal(await store.saveAccountReadiness('acct_fixture', 'local', 'fence', { ready: false, connection: 'pending' }, '2026-11-17T00:00:00Z'), true);
  assert.deepEqual(calls.slice(0, 4).map(c => c.body), [{ p_tenant: 'local', p_seller_id: 'seller' }, { p_tenant: 'local', p_seller_id: 'seller', p_account_id: 'acct_fixture', p_create_key: 'stable' }, { p_tenant: 'local', p_account_id: 'acct_fixture', p_lease_id: 'fence' }, { p_tenant: 'local', p_account_id: 'acct_fixture', p_lease_id: 'fence', p_ready: false, p_connection: 'pending', p_checked_at: '2026-11-17T00:00:00Z' }]);
  assert.equal(await store.findAccountById('acct_fixture', 'local'), null); assert.equal(calls[4].url.searchParams.get('tenant'), 'eq.local'); assert.equal(calls[4].url.searchParams.get('account_id'), 'eq.acct_fixture');
});

test('seller proof adapter scopes private reads and RPC arguments', async () => {
  const calls: Array<{ url: URL; body: Record<string, unknown> | null }> = [];
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname.endsWith('marketplace_consume_seller_challenge')) return Response.json({ id: 'seller', tenant: 'local', email_normalized: 'seller@example.invalid' });
    return Response.json(null);
  } } });
  const store = createPaymentStore(db); const now = new Date('2026-11-17T00:00:00Z');
  await store.issueChallenge({ id: 'challenge', emailNormalized: 'seller@example.invalid', tenant: 'local', browserHash: 'browser', codeHash: 'code', expiresAt: now.toISOString() });
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/marketplace_issue_seller_challenge'); assert.equal(calls[0].body?.p_browser_hash, 'browser'); assert.equal(calls[0].body?.p_tenant, 'local');
  assert.deepEqual(await store.consumeChallenge({ id: 'challenge', tenant: 'local', browserHash: 'browser', candidateHash: 'candidate', sessionHash: 'session', now }), { id: 'seller', tenant: 'local', emailNormalized: 'seller@example.invalid' });
  assert.equal(calls[1].body?.p_candidate_hash, 'candidate'); assert.equal(calls[1].body?.p_now, now.toISOString());
  assert.equal(await store.findChallenge('challenge', 'local', 'browser', now), null);
  const query = calls[2].url.searchParams;
  for (const [k, v] of Object.entries({ id: 'eq.challenge', tenant: 'eq.local', browser_nonce_hash: 'eq.browser', attempts: 'lt.5', consumed_at: 'is.null', expires_at: `gt.${now.toISOString()}` })) assert.equal(query.get(k), v);
  assert.equal(await store.findSellerSession('session', 'local', now), null);
  assert.equal(calls[3].url.searchParams.get('tenant'), 'eq.local'); assert.equal(calls[3].url.searchParams.get('token_hash'), 'eq.session');
  await store.revokeSellerSession('session', 'local'); assert.equal(calls[4].url.searchParams.get('tenant'), 'eq.local');
  await store.findSellerAccount('seller', 'local'); assert.equal(calls[5].url.searchParams.get('seller_id'), 'eq.seller'); assert.equal(calls[5].url.searchParams.get('tenant'), 'eq.local');
});
test('paid receipt query requires completed paid webhook and tenant predicates', async () => {
  let query = new URL('http://localhost');
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async input => {
    query = new URL(String(input)); return Response.json([]);
  } } });
  assert.equal(await createPaymentStore(db).findPaidWebhookReceipt('order', 'local'), null);
  for (const [key, value] of Object.entries({ tenant: 'eq.local', order_id: 'eq.order', event_type: 'eq.checkout.session.completed', outcome: 'eq.paid', source: 'eq.webhook' })) assert.equal(query.searchParams.get(key), value);
});

test('cached seller connection includes pending mappings without a provider ID', async () => {
  let query = new URL('http://localhost');
  const db = createClient('http://127.0.0.1:54321', 'test-only', { global: { fetch: async input => {
    query = new URL(String(input)); return Response.json({ connection: 'pending' });
  } } });
  assert.equal(await createPaymentStore(db).findSellerConnection('seller', 'local'), 'pending');
  assert.equal(query.searchParams.get('seller_id'), 'eq.seller'); assert.equal(query.searchParams.get('tenant'), 'eq.local');
  assert.equal(query.searchParams.get('select'), 'connection'); assert.equal(query.searchParams.get('account_id'), null);
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
