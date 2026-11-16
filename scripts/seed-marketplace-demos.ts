/** Explicit operator-only sample data loader. Never imported by the application.
 * Dry run downloads/decodes photos. --apply publishes the reviewed fixtures.
 * Deterministic IDs make repeated runs skip existing demos without changing them. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import inventory from './marketplace-demo-listings.json';
import { validateListing } from '../features/marketplace/validation';
import { createMarketplaceStore } from '../lib/server/marketplace-store';
import { getSupabaseAdminClient } from '../lib/server/supabase-admin';

const cache = path.resolve('.superpowers/marketplace-demo-photos');
function fixtureId(namespace: string, slug: string) {
  const hash = createHash('sha256').update(`fb08-stock-demo-v1:${namespace}:${slug}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function photo(photoId: number): Promise<Buffer> {
  const filename = path.join(cache, `${photoId}.webp`);
  try { return await readFile(filename); } catch { /* First run downloads the curated stock photo. */ }
  // The hostname and numeric photo ID come exclusively from the checked-in manifest.
  const url = `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=1200`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Stock photo ${photoId} could not be downloaded.`);
  if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Stock photo exceeds download limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Stock photo exceeds download limit.');
  const output = await sharp(bytes, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  if (output.length > 3 * 1024 * 1024) throw new Error('Processed stock photo exceeds bucket limit.');
  await writeFile(filename, output);
  return output;
}
async function main() {
  await mkdir(cache, { recursive: true });
  const apply = process.argv.includes('--apply');
  // Complete every download and validation before publishing any row.
  const prepared = [];
  for (const item of inventory) {
    const input = validateListing({ title: item.title, category: item.category, price: item.price, sellerDisplayName: item.seller, sellerEmail: 'marketplace-demo@example.invalid', description: `DEMO LISTING — NOT FOR SALE. This is fictional sample inventory with a stock photograph. No real seller or item is represented.\n\n${item.description}\n\nStock photo: ${item.photographer} / Pexels\nSource: ${item.source}\nLicense: https://www.pexels.com/license/` });
    prepared.push({ item, input, image: await photo(item.photoId), id: fixtureId('listing', item.slug), key: fixtureId('request', item.slug) });
    console.log(`Prepared ${item.slug}`);
  }
  if (!apply) { console.log(`Dry run complete: ${prepared.length} validated fixtures and downloaded photos. No database writes.`); return; }
  const db = getSupabaseAdminClient(); const store = createMarketplaceStore();
  const manifest = [];
  for (const entry of [...prepared].reverse()) {
    const existing = await db.from('marketplace_listings').select('id,title,seller_display_name,image_path').eq('id', entry.id).maybeSingle();
    if (existing.error) throw new Error('Could not inspect existing sample listings.');
    const imagePath = `listings/${entry.id}.webp`;
    if (existing.data) {
      if (existing.data.title !== entry.input.title || existing.data.seller_display_name !== entry.input.sellerDisplayName || existing.data.image_path !== imagePath) throw new Error('Existing row differs from the demo manifest; refusing to overwrite it.');
      console.log(`Already present: ${entry.item.slug}`);
    } else {
      const storage = await db.storage.from('marketplace-images').list('listings', { search: `${entry.id}.webp`, limit: 2 });
      if (storage.error) throw new Error('Could not inspect demo photo storage.');
      if (!storage.data?.some(file => file.name === `${entry.id}.webp`)) await store.upload(imagePath, entry.image);
      const fingerprint = createHash('sha256').update(JSON.stringify(entry.input) + entry.item.source).digest('hex');
      const published = await store.publish(entry.key, fingerprint, entry.id, imagePath, entry.input);
      if (published !== entry.id) throw new Error('Unexpected demo publication result.');
      console.log(`Published ${entry.item.slug}`);
    }
    manifest.push({ id: entry.id, title: entry.input.title, imagePath, source: entry.item.source });
  }
  await writeFile(path.join(cache, 'published.json'), JSON.stringify(manifest, null, 2));
  const check = await db.from('marketplace_listings').select('id', { count: 'exact' }).in('id', manifest.map(item => item.id));
  if (check.error || check.count !== prepared.length) throw new Error('Could not confirm all sample rows.');
  console.log(`Confirmed ${check.count} demo listings. No existing user listings were changed.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo seeding stopped.'); process.exitCode = 1; });
