import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSessionToken } from '../auth';
import { getAuthenticatedUser } from '../route-helpers';
import { handleSellerStatus } from './seller-handlers';
import { paymentFixture } from './test-fixture';

const owner = { id: '41111111-1111-4111-8111-111111111111', username: 'owner' };
const visitor = { id: '42222222-2222-4222-8222-222222222222', username: 'visitor' };

function fixture() {
  const { deps, order } = paymentFixture();
  deps.context.enabled = true;
  deps.authenticateUser = req => getAuthenticatedUser(req, {
    async findUserById(id) { return [owner, visitor].find(user => user.id === id) ?? null; },
  }, deps.secret);
  deps.store.findSellerForUser = async (id, tenant) =>
    id === owner.id && tenant === order.tenant ? { id: order.sellerId, tenant } : null;
  deps.store.findSellerAccount = async () => null;
  deps.store.findSellerConnection = async () => 'pending';
  const request = (cookie?: string) =>
    new Request(deps.context.origin + '/api/marketplace/payments/seller/status', { headers: cookie ? { cookie } : {} });
  const cookie = (user: typeof owner) =>
    'fb08_session=' + signSessionToken({ userId: user.id, username: user.username }, deps.secret);
  return { deps, request, cookie };
}

test('seller status ignores legacy proof cookies and rejects forged fb/08 sessions', async () => {
  const f = fixture();
  for (const cookie of [undefined, '__Host-fb08_mp_seller=' + 'x'.repeat(43), f.cookie(owner) + 'x']) {
    const response = await handleSellerStatus(f.request(cookie), f.deps);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connection: 'sign_in_required', paymentsEnabled: true });
  }
});

test('another signed-in user cannot see the owner’s connection or use a different tenant', async () => {
  const f = fixture();
  const otherSeller = await handleSellerStatus(f.request(f.cookie(visitor)), f.deps);
  assert.deepEqual(await otherSeller.json(), { connection: 'listing_required', paymentsEnabled: true });
  f.deps.context.tenant = 'other';
  const foreign = await handleSellerStatus(f.request(f.cookie(owner)), f.deps);
  assert.deepEqual(await foreign.json(), { connection: 'listing_required', paymentsEnabled: true });
});

test('a signed-in seller sees their connection without private account data', async () => {
  const f = fixture();
  const response = await handleSellerStatus(f.request(f.cookie(owner)), f.deps);
  assert.deepEqual(await response.json(), { connection: 'pending', paymentsEnabled: true });
});
