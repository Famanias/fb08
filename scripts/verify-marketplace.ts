/** Real, isolated integration check. Requires server credentials; never exposed as an API. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
// Optional ignored file containing a Vercel deployment-protection cookie.
// This is infrastructure access only, never an fb/08 user session.
const cookie = process.argv[3] ? readFileSync(process.argv[3], 'utf8').trim() : '';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { auth: { persistSession: false } });
const keys: string[] = []; const ids: string[] = [];
const title = 'Marketplace verification ' + randomUUID().slice(0, 8);
const sellerEmail = 'verification-seller@example.invalid'; const buyerEmail = 'verification-buyer@example.invalid';
async function api(path: string, init: RequestInit = {}) { return fetch(base + path, { ...init, headers: { origin: base, ...(cookie ? { cookie } : {}), ...init.headers }, signal: AbortSignal.timeout(60000) }); }
async function publish(key: string) {
  const bytes = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#3b5998' } }).png().toBuffer();
  const form = new FormData();
  for (const [name, value] of Object.entries({ title, description: 'Temporary automated verification item. Removed immediately after testing.', price: '1234.50', category: 'Electronics', sellerDisplayName: 'Verification', sellerEmail })) form.set(name, value);
  form.set('photo', new File([bytes], 'verification.png', { type: 'image/png' }));
  return api('/api/marketplace/listings', { method: 'POST', headers: { 'idempotency-key': key }, body: form });
}
async function main() {
try {
  const key = randomUUID(); keys.push(key);
  const response = await publish(key); assert.equal(response.status, 201, await response.clone().text());
  const { id } = await response.json(); ids.push(id);
  const repeat = await publish(key); assert.equal(repeat.status, 201, await repeat.clone().text()); assert.equal((await repeat.json()).id, id);
  const row = await db.from('marketplace_listings').select('id,image_path,price').eq('id', id).single(); assert.ifError(row.error); assert.equal(Number(row.data?.price), 1234.5);
  const contact = await db.from('marketplace_listing_contacts').select('seller_email').eq('listing_id', id).single(); assert.ifError(contact.error); assert.equal(contact.data?.seller_email, sellerEmail);
  const feed = await api('/api/marketplace/listings?q=' + encodeURIComponent(title)); assert.equal(feed.status, 200); const page = await feed.json();
  assert.equal(page.total, 1); assert.equal(page.listings[0].id, id); assert.ok(!JSON.stringify(page).includes(sellerEmail));
  const image = await fetch(page.listings[0].imageUrl); assert.equal(image.status, 200); assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
  for (const suffix of ['&category=Electronics', '&sort=price_asc', '&sort=price_desc', '&sort=name']) {
    const sorted = await (await api('/api/marketplace/listings?q=' + encodeURIComponent(title) + suffix)).json(); assert.equal(sorted.listings[0].id, id);
  }
  const mismatch = await (await api('/api/marketplace/listings?q=' + encodeURIComponent(title) + '&category=Books')).json(); assert.equal(mismatch.total, 0);
  const older = await (await api('/api/marketplace/listings?q=' + encodeURIComponent(title) + '&page=1')).json(); assert.deepEqual(older.listings, []);
  for (const query of ['%', '_', ',(status.eq.removed)', '"', '\\']) { const search = await api('/api/marketplace/listings?q=' + encodeURIComponent(query)); assert.equal(search.status, 200, await search.clone().text()); assert.equal((await search.json()).total, 0, 'Search metacharacters must be literals'); }
  // Separate requests carry no cookies or shared browser storage.
  const detail = await api('/marketplace/' + id); assert.equal(detail.status, 200); const html = await detail.text(); assert.ok(html.includes(title)); assert.ok(!html.includes(sellerEmail));
  const missing = await api('/marketplace/not-a-uuid'); assert.equal(missing.status, 404);
  assert.equal((await api('/marketplace/' + randomUUID())).status, 404);
  const inquiryKey = randomUUID(); keys.push(inquiryKey);
  const send = () => api('/api/marketplace/inquiries', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': inquiryKey }, body: JSON.stringify({ listingId: id, buyerEmail, buyerName: 'Verification', message: 'Private integration verification message.' }) });
  assert.equal((await send()).status, 201); assert.equal((await send()).status, 201);
  const saved = await db.from('marketplace_inquiries').select('id,buyer_email,message', { count: 'exact' }).eq('listing_id', id); assert.ifError(saved.error); assert.equal(saved.count, 1); assert.equal(saved.data?.[0].buyer_email, buyerEmail);
  for (const table of ['marketplace_listing_contacts', 'marketplace_inquiries', 'marketplace_requests', 'marketplace_rate_limits']) {
    const read = await anon.from(table).select('*'); assert.ok(read.error || read.data?.length === 0, table + ' must be private');
  }
  const publicRow = await anon.from('marketplace_listings').select('*').eq('id', id).single(); assert.ifError(publicRow.error); assert.ok(!JSON.stringify(publicRow.data).includes(sellerEmail));
  const unauthorized = await anon.from('marketplace_listings').update({ title: 'UNAUTHORIZED' }).eq('id', id); assert.ok(unauthorized.error);
  const remove = await anon.storage.from('marketplace-images').remove([row.data!.image_path]); assert.ok(remove.error || remove.data?.length === 0);
  assert.equal((await fetch(page.listings[0].imageUrl)).status, 200);
  assert.equal((await api('/api/marketplace/inquiries', { method: 'POST', headers: { origin: 'https://evil.invalid', 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify({ listingId: id, buyerEmail, message: 'Rejected' }) })).status, 403);
  for (const path of ['/', '/?view=people', '/api/threads', '/api/profiles', '/api/auth/me']) assert.equal((await api(path)).status, 200, path);
  console.log(JSON.stringify({ base, create: 'PASS (row, contact and decoded Storage object)', browse: 'PASS (independent reads, category, search, all sorts, page boundary)', detail: 'PASS (direct HTML, invalid UUID 404)', inquiry: 'PASS (authorized row inspection, retry deduplication)', privacy: 'PASS (anonymous private reads and writes denied)', regression: 'PASS (Board, People, auth routes)' }, null, 2));
} finally {
  const photos = await db.from('marketplace_listings').select('image_path').in('id', ids);
  if (ids.length) { const result = await db.from('marketplace_listings').delete().in('id', ids); assert.ifError(result.error); }
  if (photos.data?.length) { const result = await db.storage.from('marketplace-images').remove(photos.data.map(photo => photo.image_path)); assert.ifError(result.error); }
  if (keys.length) { const result = await db.from('marketplace_requests').delete().in('request_key', keys); assert.ifError(result.error); }
  console.log('Temporary verification listings, contacts, inquiries and photos cleaned up.');
}
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1; });
