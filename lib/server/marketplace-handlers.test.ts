import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHmac } from 'node:crypto';
import { prepareImage } from './marketplace-image';
import { MarketplaceError } from '../../features/marketplace/validation';
import { handleBrowse, handleCreate, handleInquiry } from './marketplace-handlers';
import type { MarketplaceStore } from './marketplace-store';

const ID = 'f06c79bc-9136-4c31-8ad5-53cc7e082900';
function fixture() {
  const calls: string[] = [];
  const store: MarketplaceStore = {
    async browse(filters) { calls.push(`browse:${filters.category}:${filters.page}`); return { listings: [], total: 0, hasMore: false }; },
    async find() { return null; }, async consumeRate() { calls.push('rate'); return true; },
    async upload() { calls.push('upload'); }, async cleanup() { calls.push('cleanup'); },
    async publish() { calls.push('publish'); return ID; }, async inquire() { calls.push('inquire'); return ID; },
  };
  return { store, calls, secret: 'test-secret-only-for-marketplace-tests' };
}
const origin = 'https://fb08.example';
function inquiryRequest(body: unknown, headers = {}) {
  return new Request(`${origin}/api/marketplace/inquiries`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': ID, ...headers }, body: JSON.stringify(body) });
}
const inquiry = { listingId: ID, buyerEmail: 'buyer@example.com', message: 'Is it available?' };
test('inquiry succeeds only after confirmed persistence and returns no contact payload', async () => {
  const deps = fixture();
  const response = await handleInquiry(inquiryRequest(inquiry), deps);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { message: 'Your message has been saved.' });
  assert.deepEqual(deps.calls, ['rate', 'inquire']);
});
test('failed persistence cannot produce success or disclose sensitive errors', async () => {
  const deps = fixture();
  deps.store.inquire = async () => { throw new Error('buyer@example.com PRIVATE_BODY secret'); };
  const response = await handleInquiry(inquiryRequest(inquiry), deps);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /buyer@|PRIVATE_BODY|secret/);
});
test('cross-origin, malformed, oversized and invalid inquiry requests never write', async () => {
  for (const request of [inquiryRequest(inquiry, { origin: 'https://evil.example' }), inquiryRequest({ ...inquiry, message: ' ' }), inquiryRequest(inquiry, { 'idempotency-key': 'bad' }), inquiryRequest({ ...inquiry, message: 'a'.repeat(20000) })]) {
    const deps = fixture();
    assert.ok((await handleInquiry(request, deps)).status >= 400);
    assert.ok(!deps.calls.includes('inquire'));
  }
});
test('rate limits reject writes before storage or persistence', async () => {
  const deps = fixture(); deps.store.consumeRate = async () => false;
  assert.equal((await handleInquiry(inquiryRequest(inquiry), deps)).status, 429);
  assert.deepEqual(deps.calls, []);
});
test('browse forwards validated server filters and rejects malformed filters', async () => {
  const deps = fixture();
  assert.equal((await handleBrowse(new Request(`${origin}/api/marketplace/listings?category=Books&page=2`), deps)).status, 200);
  assert.deepEqual(deps.calls, ['browse:Books:2']);
  assert.equal((await handleBrowse(new Request(`${origin}/api/marketplace/listings?sort=private`), deps)).status, 400);
});
async function createRequest(extra: Record<string, string> = {}) {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3b5998' } }).png().toBuffer();
  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  for (const [key, value] of Object.entries({ title: 'Camera', description: 'Works', price: '10.50', category: 'Electronics', sellerEmail: 'private@example.com' })) form.set(key, value);
  form.set('photo', new File([bytes], 'camera.png', { type: 'image/png' }));
  return new Request(`${origin}/api/marketplace/listings`, { method: 'POST', headers: { origin, 'idempotency-key': ID }, body: form });
}
test('publication uploads a decoded image, saves atomically and cleans up unused upload', async () => {
  const deps = fixture();
  const response = await handleCreate(await createRequest(), deps);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: ID });
  assert.deepEqual(deps.calls, ['rate', 'upload', 'publish', 'cleanup']);
});
test('signed-out sandbox publication stops before storage or persistence', async () => {
  const deps = { ...fixture(), paymentTenant: 'local', authenticateUser: async () => null };
  assert.equal((await handleCreate(await createRequest({ inventoryKind: 'sandbox' }), deps)).status, 401);
  assert.deepEqual(deps.calls, []);
});
test('sandbox publication binds the server session and fingerprints the owner', async () => {
  const ownerId = 'a93628b8-10dc-43ff-98ea-a8147d3d253f';
  const otherId = 'fe600332-5f04-4a8a-93e5-a744542fa5ba';
  let userId = ownerId;
  const deps = { ...fixture(), paymentTenant: 'local', authenticateUser: async () => ({ id: userId }) };
  const calls: Array<{ fingerprint: string; owner: unknown }> = [];
  deps.store.publish = async (_key, fingerprint, _id, _path, _input, owner) => { calls.push({ fingerprint, owner }); return ID; };
  assert.equal((await handleCreate(await createRequest(), deps)).status, 201);
  assert.equal((await handleCreate(await createRequest({ inventoryKind: 'sandbox' }), deps)).status, 201);
  userId = otherId;
  assert.equal((await handleCreate(await createRequest({ inventoryKind: 'sandbox' }), deps)).status, 201);
  assert.deepEqual(calls.map(call => call.owner), [undefined, { tenant: 'local', userId: ownerId }, { tenant: 'local', userId: otherId }]);
  assert.equal(new Set(calls.map(call => call.fingerprint)).size, 3);
  for (const field of ['paymentTenant', 'ownerUserId']) {
    assert.equal((await handleCreate(await createRequest({ inventoryKind: 'sandbox', [field]: ownerId }), deps)).status, 400);
  }
  assert.equal(calls.length, 3);
});

test('ordinary publication retry preserves the pre-inventory-kind fingerprint and original request key', async () => {
  const deps = fixture(); const request = await createRequest(); const form = await request.clone().formData();
  const image = await prepareImage(form.get('photo') as File);
  // Literal normalization/order from old main, before inventoryKind was introduced.
  const legacy = { title: 'Camera', description: 'Works', price: '10.50', category: 'Electronics', sellerEmail: 'private@example.com', sellerDisplayName: 'Guest Seller' };
  const hash = (value: string | Buffer) => createHmac('sha256', deps.secret).update(value).digest('hex');
  const persistedFingerprint = hash(JSON.stringify(legacy) + hash(image));
  deps.store.publish = async (key, fingerprint) => {
    assert.equal(key, ID);
    if (fingerprint !== persistedFingerprint) throw new MarketplaceError('Request conflict.', 409);
    return ID;
  };
  const response = await handleCreate(request, deps);
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { id: ID });
  assert.equal((await handleCreate(await createRequest({ inventoryKind: 'ordinary' }), deps)).status, 201);
  assert.equal((await handleCreate(await createRequest({ inventoryKind: 'sandbox' }), { ...deps, paymentTenant: 'local', authenticateUser: async () => ({ id: ID }) })).status, 409, 'sandbox cannot reuse an ordinary request fingerprint');
});
test('ambiguous publication failure retains the photo until safe orphan reconciliation', async () => {
  const deps = fixture(); deps.store.publish = async () => { throw new Error('private@example.com'); };
  const response = await handleCreate(await createRequest(), deps);
  assert.equal(response.status, 503);
  assert.deepEqual(deps.calls, ['rate', 'upload']);
  assert.doesNotMatch(await response.text(), /private@example/);
});
