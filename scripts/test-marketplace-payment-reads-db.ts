/** Real scoped reads and availability against an explicitly owned loopback PostgREST DB. No provider calls. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createPaymentStore } from '../lib/server/marketplace-payments/store';
import { createMarketplaceStore } from '../lib/server/marketplace-store';
import { handleOrderStatus } from '../lib/server/marketplace-payments/order-handlers';
import { getListingPaymentState } from '../lib/server/marketplace-payments/availability';
import { proofHash } from '../lib/server/marketplace-payments/proof';
import type { PaymentDeps } from '../lib/server/marketplace-payments/contracts';

async function main() {
  const target = process.env.MARKETPLACE_TEST_SUPABASE_URL; if (!target) throw new Error('Explicit local API required.');
  const url = new URL(target); if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Refusing non-local API.');
  const key = process.env.MARKETPLACE_TEST_SERVICE_ROLE_KEY; if (!key) throw new Error('Local fixture key required.');
  const db = createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const checked = (result: { error: { code?: string } | null }) => { if (result.error) throw new Error(`Local read fixture DB error (${result.error.code}).`); };
  const tenant = `reads-${randomUUID()}`; const sellerId = randomUUID(); const accountId = `acct_${randomBytes(10).toString('hex')}`; const listingId = randomUUID();
  const buyer = randomBytes(32).toString('base64url'); const secret = 'local-read-fixture-secret-at-least32chars'; const store = createPaymentStore(db); const marketplace = createMarketplaceStore(db);
  let now = new Date(); let providerReads = 0; let canonicalReady = true; let providerFailure = false;
  const unused = async (): Promise<never> => { throw new Error('Unexpected provider operation'); };
  const deps: PaymentDeps = { context: { tenant, origin: 'http://localhost:3000', enabled: true }, store, secret, randomBytes, now: () => now, mailer: { sendCode: unused }, stripe: { ensureAccount: unused, onboardingLink: unused, createCheckout: unused, readCheckout: unused, expireCheckout: unused, readSettlement: unused, verifyEvent: () => { throw new Error('Unexpected event'); }, async readAccount(id) { providerReads++; assert.equal(id, accountId); if (providerFailure) throw new Error('Local injected failure'); return { accountId, ready: canonicalReady, connection: canonicalReady ? 'ready' : 'restricted', checkedAt: now.toISOString(), metadata: { fb08_app: 'marketplace-payments-v1', tenant, seller_id: sellerId } }; } } };
  const request = (id: string, token = buyer, query = '') => new Request(`http://localhost/api/marketplace/payments/orders/${id}${query}`, { headers: token ? { cookie: `fb08_mp_buyer=${token}` } : {} });
  try {
    checked(await db.from('marketplace_listings').insert({ id: listingId, title: tenant, description: 'Fictional local scoped-read fixture', price: '1234.50', category: 'Other', seller_display_name: 'Local fixture', image_path: `listings/${listingId}.webp`, inventory_kind: 'sandbox' }));
    checked(await db.from('marketplace_listing_contacts').insert({ listing_id: listingId, seller_email: `${sellerId}@example.invalid` }));
    checked(await db.from('marketplace_payment_inventory').insert({ listing_id: listingId, tenant }));
    checked(await db.from('marketplace_payment_sellers').insert({ id: sellerId, tenant, email_normalized: `${sellerId}@example.invalid`, verified_at: now.toISOString() }));
    checked(await db.from('marketplace_connected_accounts').insert({ tenant, seller_id: sellerId, account_id: accountId, ready: true, connection: 'ready', checked_at: now.toISOString(), account_create_key: randomUUID() }));
    assert.equal((await store.getPublicPaymentStates([listingId], deps.context))[listingId].availability, 'ready'); assert.equal(providerReads, 0);
    // Advance past display TTL in the DB while fake time advances for the production refresh helper.
    checked(await db.from('marketplace_connected_accounts').update({ checked_at: new Date(+now - 61000).toISOString() }).eq('tenant', tenant));
    assert.equal((await getListingPaymentState(listingId, true, deps)).availability, 'ready'); assert.equal(providerReads, 1);
    canonicalReady = false; checked(await db.from('marketplace_connected_accounts').update({ checked_at: new Date(+now - 61000).toISOString() }).eq('tenant', tenant));
    assert.equal((await getListingPaymentState(listingId, true, deps)).availability, 'unavailable');
    providerFailure = true; checked(await db.from('marketplace_connected_accounts').update({ checked_at: new Date(+now - 61000).toISOString() }).eq('tenant', tenant));
    assert.equal((await getListingPaymentState(listingId, true, deps)).availability, 'unavailable');
    checked(await db.from('marketplace_payment_inventory').update({ review_required: true }).eq('tenant', tenant)); const before = providerReads;
    assert.equal((await getListingPaymentState(listingId, true, deps)).availability, 'unavailable'); assert.equal(providerReads, before);
    checked(await db.from('marketplace_payment_inventory').update({ review_required: false }).eq('tenant', tenant));
    checked(await db.from('marketplace_connected_accounts').update({ ready: true, connection: 'ready', checked_at: now.toISOString() }).eq('tenant', tenant));
    const order = await store.reserve({ listingId, tenant, buyerAccessHash: proofHash('buyer-session', buyer, secret), submissionKey: randomUUID(), now });
    deps.context.enabled = false;
    const absent = await handleOrderStatus(request(randomUUID()), deps); const denied = await absent.json();
    for (const req of [request(order.id, ''), request(order.id, randomBytes(32).toString('base64url')), request('bad'), request('')]) { const response = await handleOrderStatus(req, deps); assert.equal(response.status, 404); assert.deepEqual(await response.json(), denied); }
    deps.context.tenant = 'wrong'; assert.equal((await handleOrderStatus(request(order.id), deps)).status, 404); deps.context.tenant = tenant;
    const valid = await handleOrderStatus(request(order.id, buyer, '?paid=true&session_id=cs_test_forged'), deps); assert.equal(valid.status, 200); const dto = await valid.json();
    assert.equal(dto.status, 'pending'); assert.equal(Object.keys(dto).length, 9); assert.doesNotMatch(JSON.stringify(dto), /sellerEmail|buyerEmail|accountId|sessionId|AccessHash/);
    now = new Date(order.readExpiresAt); assert.equal((await handleOrderStatus(request(order.id), deps)).status, 404); now = new Date();
    checked(await db.from('marketplace_orders').update({ state: 'expired' }).eq('id', order.id));
    checked(await db.from('marketplace_stripe_events').insert({ tenant, event_id: `operator:${order.id}`, order_id: order.id, event_type: 'operator.reconcile', outcome: 'review', source: 'operator' }));
    assert.equal((await store.getOrderConfirmation(order.id, proofHash('buyer-session', buyer, secret), tenant, now))?.status, 'review');
    // A newer, legitimate paid order must not inherit this expired order's receipt.
    const newer = await store.reserve({ listingId, tenant, buyerAccessHash: proofHash('buyer-session', buyer, secret), submissionKey: randomUUID(), now });
    checked(await db.from('marketplace_orders').update({ state: 'paid' }).eq('id', newer.id)); checked(await db.from('marketplace_listings').update({ status: 'sold' }).eq('id', listingId));
    assert.equal((await store.getOrderConfirmation(newer.id, proofHash('buyer-session', buyer, secret), tenant, now))?.status, 'paid');
    assert.equal((await marketplace.find(listingId))?.status, 'sold'); assert.equal((await marketplace.browse({ q: tenant, category: 'All', sort: 'newest', page: 0 })).total, 0);
    await assert.rejects(marketplace.inquire(randomUUID(), 'a'.repeat(64), { listingId, buyerEmail: 'fixture@example.invalid', buyerName: '', message: 'Test inquiry' }), error => error instanceof Error && 'status' in error && error.status === 404);
    checked(await db.from('marketplace_listings').update({ status: 'removed' }).eq('id', listingId)); assert.equal(await marketplace.find(listingId), null);
    console.log('PASS real scoped read: absent/wrong/other tenant/expired => identical404; valid disabled-switch DTO pending despite forged success; no provider read for order or browse.');
    console.log('PASS real availability: ready after61s refresh; restricted/failure/review unavailable; sold detail retained/feed excludes/inquiry rejects/removed absent; own review receipt preserves newer paid.');
  } finally {
    checked(await db.from('marketplace_stripe_events').delete().eq('tenant', tenant)); checked(await db.from('marketplace_orders').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_connected_accounts').delete().eq('tenant', tenant)); checked(await db.from('marketplace_payment_sellers').delete().eq('tenant', tenant)); checked(await db.from('marketplace_payment_inventory').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_listing_contacts').delete().eq('listing_id', listingId)); checked(await db.from('marketplace_listings').delete().eq('id', listingId));
    console.log('PASS exact owned local read fixtures removed.');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Local read tests failed.'); process.exitCode = 1; });
