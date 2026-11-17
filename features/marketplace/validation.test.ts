import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateListing, validateInquiry, parseFilters, publicListing } from './validation';

const listing = { title: ' Camera ', description: ' Works well ', price: '2500.50', category: 'Electronics', sellerEmail: ' seller@example.com ', sellerDisplayName: '' };
test('inventory defaults ordinary and cannot accept demo or a browser tenant', () => {
  assert.equal(validateListing(listing).inventoryKind, 'ordinary');
  assert.equal(validateListing({ ...listing, inventoryKind: 'sandbox' }).inventoryKind, 'sandbox');
  for (const patch of [{ inventoryKind: 'demo' }, { paymentTenant: 'forged' }, { tenant: 'forged' }]) assert.throws(() => validateListing({ ...listing, ...patch }));
});
test('listing validation trims content and preserves exact decimal prices', () => {
  assert.deepEqual(validateListing(listing), { ...listing, title: 'Camera', description: 'Works well', sellerEmail: 'seller@example.com', sellerDisplayName: 'Guest Seller', inventoryKind: 'ordinary' });
  assert.equal(validateListing({ ...listing, price: '999999999.99' }).price, '999999999.99');
  for (const price of ['', '-1', 'NaN', 'Infinity', '1e3', '1000000000', '0.001']) assert.throws(() => validateListing({ ...listing, price }));
});
test('listing validation rejects invalid categories, emails, lengths and non-string fields', () => {
  for (const patch of [{ title: ' ' }, { title: 'a'.repeat(101) }, { description: ' ' }, { description: 'a'.repeat(2001) }, { category: 'All' }, { sellerEmail: 'bad' }, { sellerDisplayName: 'x'.repeat(51) }, { title: {} }]) assert.throws(() => validateListing({ ...listing, ...patch }));
});
test('inquiries require valid listing UUID, contact and nonblank bounded message', () => {
  const input = { listingId: 'f06c79bc-9136-4c31-8ad5-53cc7e082900', buyerEmail: 'a@example.com', message: ' Hello ', buyerName: '' };
  assert.equal(validateInquiry(input).message, 'Hello');
  for (const patch of [{ listingId: 'invalid' }, { buyerEmail: '' }, { message: ' ' }, { message: 'x'.repeat(1001) }, { buyerName: 'x'.repeat(51) }]) assert.throws(() => validateInquiry({ ...input, ...patch }));
});
test('filters reject query injection and unbounded pagination', () => {
  assert.deepEqual(parseFilters(new URLSearchParams('q=camera&category=Electronics&sort=price_asc&page=2')), { q: 'camera', category: 'Electronics', sort: 'price_asc', page: 2 });
  for (const query of ['category=Unknown', 'sort=private', 'page=-1', 'page=1.5', 'page=100001', 'q=' + 'x'.repeat(101)]) assert.throws(() => parseFilters(new URLSearchParams(query)));
  assert.equal(parseFilters(new URLSearchParams('q=a%25_b%2C%28')).q, 'a%_b,(');
});
test('public DTO explicitly omits private and unexpected database columns', () => {
  const dto = publicListing({ id: 'id', title: 'Title', description: 'Desc', price: '12.50', currency: 'PHP', category: 'Home', seller_display_name: 'Guest', image_path: 'path', status: 'active', created_at: 'date', seller_email: 'secret@example.com', buyer_email: 'buyer@example.com', message: 'private' }, 'https://example.com/photo');
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'title', 'description', 'price', 'currency', 'category', 'sellerDisplayName', 'imageUrl', 'createdAt', 'status', 'inventoryKind', 'paymentState'].sort());
  assert.equal(dto.price, 12.5);
  assert.ok(!JSON.stringify(dto).includes('secret'));
});
