import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PaymentDeps, PaymentStore, PendingSellerAccount, SellerAccount } from './contracts';
import { handleConnect, handleConnectRefresh, refreshKnownAccount } from './connect-handlers';
import { handleSellerStatus, handleSellerLogout } from './seller-handlers';

function fixture() {
  const seller = { id: randomUUID(), emailNormalized: 'private@example.invalid', tenant: 'local' };
  let slot: PendingSellerAccount | null = null; let account: SellerAccount | null = null; let lease: string | null = null; let now = new Date('2026-11-17T00:00:00Z'); let allowed = true; let authenticated = true;
  const calls = { created: [] as string[], linkedBeforeUrl: [] as boolean[], reads: 0, rates: [] as string[] }; const unused = async (): Promise<never> => { throw new Error('Unexpected store operation'); };
  const store: PaymentStore = { reserve: unused, prepareCheckout: unused, attachSession: unused, findOrder: unused, applyCheckout: unused, saveSettlement: unused, findInventory: unused, findPaidWebhookReceipt: unused, listReconciliationOrders: unused, findSeller: unused, issueChallenge: unused, findChallenge: unused, consumeChallenge: unused, revokeSellerSession: unused,
    async consumeRate(_actor, action) { calls.rates.push(action); return allowed; }, async findSellerSession(_hash, tenant) { return authenticated && tenant === seller.tenant ? seller : null; },
    async ensureSellerAccountSlot() { slot ??= { sellerId: seller.id, accountId: null, accountCreateKey: 'local:account:fixed:v1', preparedAt: now.toISOString() }; return { ...slot }; },
    async saveSellerAccount(_seller, _tenant, id, key) { assert.equal(key, slot!.accountCreateKey); if (slot!.accountId && slot!.accountId !== id) throw new Error('reassignment'); slot!.accountId = id; account = { sellerId: seller.id, accountId: id, ready: false, connection: 'pending', checkedAt: '', accountCreateKey: key }; },
    async findSellerAccount() { return account; }, async findAccountById() { return account; }, async findSellerConnection() { return account?.connection ?? (slot ? 'pending' : null); },
    async acquireAccountRefresh(_id, _tenant, id) { if (lease) return false; lease = id; if (account) account.ready = false; return true; },
    async saveAccountReadiness(_id, _tenant, id, readiness, checkedAt) { if (lease !== id) return false; lease = null; Object.assign(account!, readiness, { checkedAt }); return true; },
  };
  const deps: PaymentDeps = { store, context: { tenant: 'local', origin: 'https://market.example.invalid', enabled: true }, secret: 'fictional-test-session-secret-32-characters', now: () => now, randomBytes, mailer: { sendCode: unused }, stripe: { createCheckout: unused, readCheckout: unused,
    async ensureAccount(_seller, key) { calls.created.push(key); return { accountId: 'acct_fixture' }; }, async onboardingLink() { calls.linkedBeforeUrl.push(!!account); return { url: 'https://connect.stripe.com/setup/fixture' }; }, async readAccount(id) { calls.reads++; return { accountId: id, ready: false, connection: 'pending', metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: seller.id }, checkedAt: now.toISOString() }; },
  } };
  const req = (body: unknown = {}, headers: Record<string, string> = {}) => new Request(`${deps.context.origin}/api/marketplace/payments/connect?ready=true`, { method: 'POST', headers: { origin: deps.context.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie: '__Host-fb08_mp_seller=' + Buffer.alloc(32, 1).toString('base64url'), ...headers }, body: JSON.stringify(body) });
  return { deps, req, seller, calls, account: () => account, slot: () => slot, setNow: (v: string) => { now = new Date(v); }, setAllowed: (v: boolean) => { allowed = v; }, setAuth: (v: boolean) => { authenticated = v; }, setLease: (v: string | null) => { lease = v; } };
}
test('onboarding_requires_verified_seller and rejects posted authority and cross-origin', async () => {
  const f = fixture();
  const invalidHeaders: Record<string, string>[] = [{ cookie: '' }, { cookie: 'fb08_session=board' }, { origin: 'https://evil.example.invalid' }, { 'sec-fetch-site': 'cross-site' }];
  for (const headers of invalidHeaders) assert.ok([401, 403].includes((await handleConnect(f.req({ email: 'private@example.invalid', accountId: 'acct_rogue' }, headers), f.deps)).status));
  f.deps.context.tenant = 'foreign'; assert.equal((await handleConnect(f.req(), f.deps)).status, 401); f.deps.context.tenant = 'local';
  assert.equal((await handleConnect(f.req({ accountId: 'acct_rogue', country: 'CA', returnUrl: 'https://evil.example.invalid' }), f.deps)).status, 400); assert.equal(f.calls.created.length, 0);
  f.deps.context.enabled = false; assert.equal((await handleConnect(f.req(), f.deps)).status, 503);
});
test('parallel_connect_uses_one_account_slot and persists before link', async () => {
  const f = fixture(); const responses = await Promise.all([handleConnect(f.req(), f.deps), handleConnect(f.req(), f.deps)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]); assert.equal(f.account()?.accountId, 'acct_fixture'); assert.ok(f.calls.created.every(k => k === 'local:account:fixed:v1')); assert.ok(f.calls.linkedBeforeUrl.every(Boolean));
  const creates = f.calls.created.length; assert.equal((await handleConnectRefresh(f.req(), f.deps)).status, 200); assert.equal(f.calls.created.length, creates);
  f.setAllowed(false); assert.equal((await handleConnectRefresh(f.req(), f.deps)).status, 429); assert.ok(f.calls.rates.includes('payment-connect-seller'));
});
test('ambiguous_creation_freezes_after_23_hours_without_rekeying', async () => {
  const f = fixture(); f.deps.stripe.ensureAccount = async (_s, key) => { f.calls.created.push(key); throw new Error('private provider timeout'); };
  assert.equal((await handleConnect(f.req(), f.deps)).status, 503); f.setNow('2026-11-17T22:59:00Z'); assert.equal((await handleConnect(f.req(), f.deps)).status, 503);
  f.setNow('2026-11-17T23:00:00Z'); assert.equal((await handleConnect(f.req(), f.deps)).status, 503); assert.equal(f.calls.created.length, 2); assert.equal(f.slot()?.accountCreateKey, 'local:account:fixed:v1');
});
test('ambiguous creation retry recovers the original account under the same key', async () => {
  const f = fixture(); let failed = false;
  f.deps.stripe.ensureAccount = async (_seller, key) => { f.calls.created.push(key); if (!failed) { failed = true; throw new Error('accepted remotely, response lost'); } return { accountId: 'acct_original' }; };
  assert.equal((await handleConnect(f.req(), f.deps)).status, 503); assert.equal(f.account(), null);
  const retry = await handleConnect(f.req(), f.deps); assert.equal(retry.status, 200); assert.equal(f.account()?.accountId, 'acct_original'); assert.deepEqual(f.calls.created, ['local:account:fixed:v1', 'local:account:fixed:v1']);
  assert.deepEqual(await retry.json(), { url: 'https://connect.stripe.com/setup/fixture' });
});
test('return_is_not_readiness and status caches canonical pending for at most 60 seconds', async () => {
  const f = fixture(); await handleConnect(f.req(), f.deps); const status = await handleSellerStatus(f.req(), f.deps);
  assert.equal(f.account()?.ready, false); assert.equal(status.status, 200); assert.equal((await status.json()).connection, 'pending'); assert.equal(f.calls.reads, 1);
  await handleSellerStatus(f.req(), f.deps); assert.equal(f.calls.reads, 1); f.setNow('2026-11-17T00:01:01Z'); await handleSellerStatus(f.req(), f.deps); assert.equal(f.calls.reads, 2);
});
test('API failures, wrong seller metadata, busy and superseded refresh cannot authorize purchases', async () => {
  const f = fixture(); await handleConnect(f.req(), f.deps); const account = f.account()!;
  f.deps.stripe.readAccount = async id => ({ accountId: id, ready: true, connection: 'ready', metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: 'foreign' }, checkedAt: f.deps.now().toISOString() });
  assert.equal((await refreshKnownAccount(account, f.deps)).ready, false);
  f.deps.stripe.readAccount = async () => { throw new Error('secret provider error'); }; await assert.rejects(refreshKnownAccount(account, f.deps)); assert.equal(account.ready, false);
  f.setLease('busy'); await assert.rejects(refreshKnownAccount(account, f.deps));
  f.setLease(null); f.deps.stripe.readAccount = async id => { f.setLease('superseding'); return { accountId: id, ready: true, connection: 'ready', metadata: { fb08_app: 'marketplace-payments-v1', tenant: 'local', seller_id: f.seller.id }, checkedAt: f.deps.now().toISOString() }; };
  await assert.rejects(refreshKnownAccount(account, f.deps)); assert.equal(account.ready, false);
});
test('disabled purchases preserve seller proof, status and logout; API failure returns private 503', async () => {
  const f = fixture(); await handleConnect(f.req(), f.deps); f.deps.context.enabled = false;
  let revoked = false; f.deps.store.revokeSellerSession = async () => { revoked = true; };
  assert.equal((await handleSellerLogout(f.req(), f.deps)).status, 200); assert.equal(revoked, true);
  const pending = await handleSellerStatus(f.req(), f.deps); assert.equal(pending.status, 200); assert.equal((await pending.json()).verified, true);
  f.setNow('2026-11-17T00:02:00Z'); f.deps.stripe.readAccount = async () => { throw new Error('private@example.invalid provider secret'); };
  const failed = await handleSellerStatus(f.req(), f.deps); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('private')); assert.equal(f.account()?.ready, false);
});
