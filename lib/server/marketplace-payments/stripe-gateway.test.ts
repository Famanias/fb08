import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Stripe from 'stripe';
import { createStripeGateway, type OnboardingSdk } from './stripe-gateway';

const seller = { id: '11111111-1111-4111-8111-111111111111', emailNormalized: 'private@example.invalid', tenant: 'local' };
function fixture() {
  let account = { id: 'acct_fixture', object: 'account', country: 'US', details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: { card_payments: 'active' }, requirements: { disabled_reason: null, currently_due: [], past_due: [], pending_verification: [], errors: [] }, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: seller.id } } as unknown as Stripe.Account;
  const calls: Array<{ method: string; params: unknown; options: unknown }> = [];
  const sdk: OnboardingSdk = { accounts: { async create(params, options) { calls.push({ method: 'create', params, options }); return account; }, async retrieve(id, _params, options) { calls.push({ method: 'retrieve', params: id, options }); return account; } }, accountLinks: { async create(params, options) { calls.push({ method: 'link', params, options }); return { url: 'https://connect.stripe.com/setup/fixture' } as Stripe.AccountLink; } } };
  return { calls, account, setAccount: (a: Stripe.Account) => { account = a; }, gateway: createStripeGateway({ tenant: 'local', country: 'US', secretKey: 'sk_test_fixture', origin: 'https://market.example.invalid' }, sdk, () => new Date('2026-11-17T00:00:00Z')) };
}
test('official adapter creates only the selected controller with opaque metadata and stable key', async () => {
  const f = fixture(); assert.deepEqual(await f.gateway.ensureAccount(seller, 'local:account:opaque:v1'), { accountId: 'acct_fixture' });
  assert.deepEqual(f.calls[0], { method: 'create', params: { country: 'US', controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, capabilities: { card_payments: { requested: true } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: seller.id } }, options: { idempotencyKey: 'local:account:opaque:v1', timeout: 5000, maxNetworkRetries: 1 } });
  await f.gateway.ensureAccount(seller, 'local:account:opaque:v1'); assert.deepEqual(f.calls[1], f.calls[0], 'normal retry preserves exact parameters and key');
  assert.ok(!JSON.stringify(f.calls).includes('private@'));
  await assert.rejects(f.gateway.ensureAccount({ ...seller, tenant: 'foreign' }, 'key')); assert.equal(f.calls.length, 2);
});
test('hosted account link uses only fixed server origin', async () => {
  const f = fixture(); assert.deepEqual(await f.gateway.onboardingLink('acct_fixture', 'https://market.example.invalid'), { url: 'https://connect.stripe.com/setup/fixture' });
  assert.deepEqual(f.calls[0].params, { account: 'acct_fixture', type: 'account_onboarding', return_url: 'https://market.example.invalid/marketplace/payments/return', refresh_url: 'https://market.example.invalid/marketplace/payments/refresh' });
  await assert.rejects(f.gateway.onboardingLink('acct_fixture', 'https://evil.example.invalid')); await assert.rejects(f.gateway.readAccount('bad')); assert.equal(f.calls.length, 1);
});
test('each canonical readiness requirement fails closed and retrieval is bounded', async () => {
  const f = fixture(); assert.equal((await f.gateway.readAccount('acct_fixture')).ready, true);
  assert.deepEqual(f.calls[0].options, { timeout: 5000, maxNetworkRetries: 1 });
  for (const patch of [{ details_submitted: false }, { charges_enabled: false }, { payouts_enabled: false }, { country: 'CA' }, { capabilities: { card_payments: 'inactive' } }, { requirements: null }, { requirements: { ...f.account.requirements, disabled_reason: 'requirements.past_due' } }, { requirements: { ...f.account.requirements, currently_due: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, past_due: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, pending_verification: ['individual.id_number'] } }, { requirements: { ...f.account.requirements, errors: [{}] } }, { controller: { ...f.account.controller, fees: { payer: 'application' } } }, { controller: { ...f.account.controller, losses: { payments: 'application' } } }, { controller: { ...f.account.controller, stripe_dashboard: { type: 'express' } } }, { controller: { ...f.account.controller, requirement_collection: 'application' } }, { metadata: { ...f.account.metadata, tenant: 'foreign' } }, { metadata: { ...f.account.metadata, fb08_app: 'foreign' } }, { deleted: true }]) {
    f.setAccount({ ...f.account, ...patch } as Stripe.Account); assert.equal((await f.gateway.readAccount('acct_fixture')).ready, false, JSON.stringify(patch));
  }
});
