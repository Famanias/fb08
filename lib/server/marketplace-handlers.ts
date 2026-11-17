import { createHmac, randomUUID } from 'node:crypto';
import { MarketplaceError, parseFilters, validateInquiry, validateListing, validUuid } from '@/features/marketplace/validation';
import { createMarketplaceStore, type MarketplaceStore } from './marketplace-store';
import { prepareImage } from './marketplace-image';
import { jsonResponse } from './route-helpers';

type Deps = { store?: MarketplaceStore; secret?: string; paymentTenant?: string };
async function safe(run: () => Promise<Response>) {
  try { return await run(); } catch (error) {
    if (error instanceof MarketplaceError) return jsonResponse({ error: error.message, field: error.field }, error.status, error.status === 429 ? { 'Retry-After': '3600' } : undefined);
    // Never log provider errors or request bodies: they can contain contact data.
    return jsonResponse({ error: 'Marketplace is temporarily unavailable. Please try again.' }, 503);
  }
}
function checkOrigin(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new MarketplaceError('Please submit from this website.', 403);
}
function requestKey(req: Request) {
  const key = req.headers.get('idempotency-key');
  if (!validUuid(key)) throw new MarketplaceError('Missing submission key. Reload and try again.');
  return key;
}
function hash(value: string | Buffer, secret: string) { return createHmac('sha256', secret).update(value).digest('hex'); }
function secretFor(deps: Deps) {
  const secret = deps.secret ?? process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('Missing server configuration');
  return secret;
}
async function rateLimit(req: Request, store: MarketplaceStore, action: string, secret: string) {
  // Vercel overwrites x-forwarded-for with the connecting address. Locally all
  // callers share one budget rather than trusting caller-supplied headers.
  const ip = process.env.VERCEL ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local';
  if (!await store.consumeRate(hash(ip, secret), action, action === 'listing' ? 10 : 30)) throw new MarketplaceError('Too many submissions. Please try again in an hour.', 429);
}
async function boundedBody(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length')) > max) throw new MarketplaceError('The request is too large.', 413);
  if (!req.body) throw new MarketplaceError('The request body is missing.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new MarketplaceError('The request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function handleBrowse(req: Request, deps: Deps = {}) {
  return safe(async () => jsonResponse(await (deps.store ?? createMarketplaceStore()).browse(parseFilters(new URL(req.url).searchParams))));
}
export async function handleCreate(req: Request, deps: Deps = {}) {
  return safe(async () => {
    checkOrigin(req); const key = requestKey(req); const secret = secretFor(deps);
    if (!req.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new MarketplaceError('Submit a photo and listing details.');
    const bytes = await boundedBody(req, 3.5 * 1024 * 1024);
    let form: FormData;
    try { form = await new Request(req.url, { method: 'POST', headers: { 'content-type': req.headers.get('content-type')! }, body: bytes as BodyInit }).formData(); }
    catch { throw new MarketplaceError('Could not read the listing form.'); }
    if (form.get('website')) throw new MarketplaceError('Unable to accept this submission.');
    const input = validateListing(Object.fromEntries(form.entries()));
    const paymentTenant = input.inventoryKind === 'sandbox' ? deps.paymentTenant ?? process.env.MARKETPLACE_PAYMENT_TENANT : undefined;
    if (input.inventoryKind === 'sandbox' && (!paymentTenant || !/^[a-zA-Z0-9_-]{1,100}$/.test(paymentTenant))) throw new MarketplaceError('Sandbox listings are temporarily unavailable.', 503);
    const photo = form.get('photo');
    if (!(photo instanceof File)) throw new MarketplaceError('Please upload a photo of your item.', 400, 'photo');
    const store = deps.store ?? createMarketplaceStore();
    await rateLimit(req, store, 'listing', secret);
    const image = await prepareImage(photo);
    const fingerprint = hash(JSON.stringify(input) + hash(image, secret), secret);
    const id = randomUUID(); const path = `listings/${id}.webp`;
    await store.upload(path, image);
    const result = await store.publish(key, fingerprint, id, path, input, paymentTenant);
    // Only a confirmed RPC completion makes immediate cleanup safe. On a lost
    // response its transaction may still be committing; retain the image for
    // the age-gated orphan reconciler instead of racing that transaction.
    await store.cleanup(path).catch(() => undefined);
    return jsonResponse({ id: result }, 201);
  });
}
export async function handleInquiry(req: Request, deps: Deps = {}) {
  return safe(async () => {
    checkOrigin(req); const key = requestKey(req); const secret = secretFor(deps);
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new MarketplaceError('Submit a valid inquiry.');
    const bytes = await boundedBody(req, 16 * 1024);
    let raw: Record<string, unknown>;
    try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); raw = parsed; }
    catch { throw new MarketplaceError('Submit a valid inquiry.'); }
    if (raw.website) throw new MarketplaceError('Unable to accept this submission.');
    const input = validateInquiry(raw); const store = deps.store ?? createMarketplaceStore();
    await rateLimit(req, store, 'inquiry', secret);
    await store.inquire(key, hash(JSON.stringify(input), secret), input);
    return jsonResponse({ message: 'Your message has been saved.' }, 201);
  });
}
