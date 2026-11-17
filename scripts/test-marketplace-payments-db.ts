/** Committed concurrency fixtures, exclusively on an explicitly selected local API. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createPaymentStore } from '../lib/server/marketplace-payments/store';
import type { CanonicalCheckout } from '../lib/server/marketplace-payments/contracts';
import { codeHash, proofHash } from '../lib/server/marketplace-payments/proof';

async function main() {
  const target = process.env.MARKETPLACE_TEST_SUPABASE_URL;
  if (!target) throw new Error('Set MARKETPLACE_TEST_SUPABASE_URL to a disposable local Supabase API.');
  const url = new URL(target);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Refusing non-local Supabase URL.');
  const key = process.env.MARKETPLACE_TEST_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Set MARKETPLACE_TEST_SERVICE_ROLE_KEY for the local test stack.');
  const db = createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = createPaymentStore(db);
  const run = randomUUID(); const listingId = randomUUID(); const sellerId = randomUUID();
  const tenant = `test-${run}`; const accountId = `acct_${run.replaceAll('-', '')}`;
  const proofSecret = 'fictional-local-proof-test-secret';
  const browserHash = proofHash('browser', run, proofSecret);
  const rateActions = [`proof-send-email-${run}`, `proof-send-ip-${run}`, `proof-verify-ip-${run}`];
  const checked = (result: { error: { code?: string } | null }) => { if (result.error) throw new Error(`Local fixture database operation failed (${result.error.code ?? 'unknown'})`); };
  try {
    checked(await db.from('marketplace_listings').insert({ id: listingId, title: 'Fictional concurrency fixture', description: 'Local test only', price: '1234.50', category: 'Other', seller_display_name: 'Test', image_path: `listings/${listingId}.webp`, inventory_kind: 'sandbox' }));
    checked(await db.from('marketplace_listing_contacts').insert({ listing_id: listingId, seller_email: `${run}@example.invalid` }));
    checked(await db.from('marketplace_payment_inventory').insert({ listing_id: listingId, tenant }));
    checked(await db.from('marketplace_payment_sellers').insert({ id: sellerId, tenant, email_normalized: `${run}@example.invalid`, verified_at: new Date().toISOString() }));
    assert.equal(await store.findSellerConnection(sellerId, tenant), null);
    checked(await db.from('marketplace_connected_accounts').insert({ seller_id: sellerId, tenant, account_create_key: `create-${run}` }));
    assert.equal(await store.findSellerConnection(sellerId, tenant), 'pending');
    assert.equal(await store.findSellerAccount(sellerId, tenant), null);
    checked(await db.from('marketplace_connected_accounts').update({ account_id: accountId, ready: true, connection: 'ready', checked_at: new Date().toISOString() }).eq('seller_id', sellerId).eq('tenant', tenant));
    const challengeId = randomUUID(); const proofNow = new Date(); const email = `${run}@example.invalid`;
    const candidateHash = codeHash(challengeId, email, browserHash, '123456', proofSecret);
    await store.issueChallenge({ id: challengeId, emailNormalized: email, tenant, browserHash, codeHash: candidateHash, expiresAt: new Date(+proofNow + 600000).toISOString() });
    assert.ok(await store.findChallenge(challengeId, tenant, browserHash, proofNow));
    const sessionHashes = [1, 2].map(i => proofHash('seller-session', `${run}-${i}`, proofSecret));
    const exchanges = await Promise.all(sessionHashes.map(sessionHash => store.consumeChallenge({ id: challengeId, tenant, browserHash, candidateHash, sessionHash, now: proofNow })));
    assert.equal(exchanges.filter(Boolean).length, 1);
    const winningHash = sessionHashes[exchanges.findIndex(Boolean)];
    assert.equal((await store.findSellerSession(winningHash, tenant, proofNow))?.id, sellerId);
    assert.equal(await store.findSellerSession(winningHash, 'foreign', proofNow), null);
    assert.equal(await store.findSellerSession(winningHash, tenant, new Date(+proofNow + 3600000)), null);
    assert.equal((await store.findSellerAccount(sellerId, tenant))?.accountId, accountId);
    assert.equal(await store.findSellerAccount(sellerId, 'foreign'), null);
    await store.revokeSellerSession(winningHash, 'foreign'); assert.ok(await store.findSellerSession(winningHash, tenant, proofNow));
    await store.revokeSellerSession(winningHash, tenant); assert.equal(await store.findSellerSession(winningHash, tenant, proofNow), null);
    const proofSessions = await db.from('marketplace_seller_sessions').select('token_hash').eq('tenant', tenant); checked(proofSessions); assert.equal(proofSessions.data?.length, 1);
    for (const [index, limit] of [3, 10, 30].entries()) {
      const results = await Promise.all(Array.from({ length: limit + 1 }, () => store.consumeRate(browserHash, rateActions[index], limit)));
      assert.equal(results.filter(Boolean).length, limit);
    }
    console.log('PASS: 2 simultaneous proof exchanges => 1 session; tenant/expiry/revocation and durable 3/10/30 budgets verified.');
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => store.reserve({ listingId, tenant, buyerAccessHash: `buyer-${run}-${i}`, submissionKey: randomUUID(), now: new Date() })));
    const wins = attempts.filter(result => result.status === 'fulfilled');
    assert.equal(wins.length, 1); assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 19);
    const order = wins[0].value;
    const holds = await db.from('marketplace_orders').select('id').eq('listing_id', listingId); checked(holds); assert.equal(holds.data?.length, 1);
    const metadata = { fb08_app: 'marketplace-payments-v1', tenant, order_id: order.id, listing_id: listingId };
    await store.prepareCheckout({ orderId: order.id, tenant, apiVersion: 'local-test', params: {
      mode: 'payment', payment_method_types: ['card'], client_reference_id: order.id, expires_at: order.checkoutExpiresAt, metadata,
      line_items: [{ quantity: 1, price_data: { currency: 'php', unit_amount: 123450 } }],
      payment_intent_data: { application_fee_amount: 12345, metadata },
    } });
    const canonical: CanonicalCheckout = { sessionId: `cs_${run}`, accountId, paymentIntentId: `pi_${run}`, status: 'complete', paymentStatus: 'paid', intentStatus: 'succeeded', livemode: false, currency: 'php', grossMinor: 123450, feeMinor: 12345, quantity: 1, intentAmountReceivedMinor: 123450, intentCurrency: 'php', url: null, expiresAt: order.checkoutExpiresAt, clientReferenceId: order.id, metadata, intentMetadata: metadata };
    const transitions = await Promise.all([1, 2].map(i => store.applyCheckout({ orderId: order.id, tenant, eventId: `evt_${run}_${i}`, eventType: 'checkout.session.completed', canonical, now: new Date() })));
    assert.deepEqual(transitions.sort(), ['duplicate', 'paid']);
    assert.equal((await store.findOrder(order.id, tenant))?.state, 'paid');
    assert.equal((await store.findInventory(listingId, tenant))?.status, 'sold');
    assert.ok(await store.findPaidWebhookReceipt(order.id, tenant));
    assert.equal(await store.findOrder(order.id, 'foreign'), null);
    assert.equal((await store.listReconciliationOrders(tenant)).length, 1, 'paid order awaiting fee enrichment remains in operator work');
    await store.saveSettlement(order.id, tenant, { currency: 'php', grossMinor: 123450, applicationFeeMinor: 12345, stripeFeeMinor: 1000, otherFeeMinor: 0, netMinor: 110105 });
    assert.equal((await store.listReconciliationOrders(tenant)).length, 0, 'enriched paid order leaves operator work');
    assert.equal((await store.findOrder(order.id, tenant))?.state, 'paid');
    console.log('PASS: 20 concurrent reservations => 1 hold, 19 conflicts; 2 paid transitions => 1 sale.');
  } finally {
    checked(await db.from('marketplace_stripe_events').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_orders').delete().eq('listing_id', listingId).eq('tenant', tenant));
    checked(await db.from('marketplace_payment_inventory').delete().eq('listing_id', listingId).eq('tenant', tenant));
    checked(await db.from('marketplace_connected_accounts').delete().eq('seller_id', sellerId).eq('tenant', tenant));
    checked(await db.from('marketplace_seller_challenges').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_seller_sessions').delete().eq('tenant', tenant));
    checked(await db.from('marketplace_rate_limits').delete().eq('actor_hash', browserHash).in('action', rateActions));
    checked(await db.from('marketplace_payment_sellers').delete().eq('id', sellerId).eq('tenant', tenant));
    checked(await db.from('marketplace_listings').delete().eq('id', listingId));
    const left = await db.from('marketplace_listings').select('id').eq('id', listingId); checked(left); assert.equal(left.data?.length, 0);
    console.log('PASS: exact run fixtures removed.');
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Local payment checks failed.'); process.exitCode = 1; });
