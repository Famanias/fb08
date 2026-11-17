import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentDeps, PaymentStore, SellerIdentity, SellerAccount } from './contracts';
import { handleSellerChallenge, handleSellerVerify, handleSellerLogout, handleSellerStatus, requireSeller } from './seller-handlers';
import { proofHash } from './proof';

function fixture() {
  let now = new Date('2026-11-17T00:00:00Z');
  const mail: Array<{ to: string; code: string; expiresMinutes: 10; challengeId: string }> = [];
  const challenges = new Map<string, { id: string; emailNormalized: string; tenant: string; browserHash: string; codeHash: string; expiresAt: string; attempts: number; consumed: boolean }>();
  const sellers = new Map<string, SellerIdentity>();
  const sessions = new Map<string, { seller: SellerIdentity; expires: number }>();
  const rates = new Map<string, number>();
  let account: SellerAccount | null = null;
  let pendingMapping = false;
  const unused = async (): Promise<never> => { throw new Error('Unexpected store operation'); };
  const store: PaymentStore = {
    reserve: unused, prepareCheckout: unused, attachSession: unused, findOrder: unused, applyCheckout: unused, saveSettlement: unused, findInventory: unused, findPaidWebhookReceipt: unused, listReconciliationOrders: unused,
    async findSeller(email, tenant) { return sellers.get(`${tenant}:${email}`) ?? null; },
    async consumeRate(actor, action, limit) { const key = `${actor}:${action}`; const n = (rates.get(key) ?? 0) + 1; rates.set(key, n); return n <= limit; },
    async issueChallenge(input) {
      for (const c of challenges.values()) if (c.tenant === input.tenant && c.emailNormalized === input.emailNormalized && c.browserHash === input.browserHash) c.consumed = true;
      challenges.set(input.id, { ...input, attempts: 0, consumed: false });
    },
    async findChallenge(id, tenant, browser, time) { const c = challenges.get(id); return c && c.tenant === tenant && c.browserHash === browser && !c.consumed && c.attempts < 5 && Date.parse(c.expiresAt) > +time ? c : null; },
    async consumeChallenge(input) {
      const c = challenges.get(input.id);
      if (!c || c.tenant !== input.tenant || c.browserHash !== input.browserHash || c.consumed || c.attempts >= 5 || Date.parse(c.expiresAt) <= +input.now) return null;
      if (!timingSafeEqual(Buffer.from(c.codeHash, 'hex'), Buffer.from(input.candidateHash, 'hex'))) { c.attempts++; return null; }
      c.consumed = true;
      const key = `${c.tenant}:${c.emailNormalized}`;
      const seller = sellers.get(key) ?? { id: randomUUID(), tenant: c.tenant, emailNormalized: c.emailNormalized };
      sellers.set(key, seller); sessions.set(input.sessionHash, { seller, expires: +input.now + 3600000 }); return seller;
    },
    async findSellerSession(hash, tenant, time) { const s = sessions.get(hash); return s && s.seller.tenant === tenant && s.expires > +time ? s.seller : null; },
    async revokeSellerSession(hash, tenant) { if (sessions.get(hash)?.seller.tenant === tenant) sessions.delete(hash); },
    async findSellerAccount() { return account; },
    async findSellerConnection() { return account?.connection ?? (pendingMapping ? 'pending' : null); },
  };
  const deps: PaymentDeps = { store, mailer: { async sendCode(input) { mail.push(input); } }, context: { tenant: 'local', origin: 'https://market.example.invalid', enabled: true }, secret: 'fictional-test-secret-for-payments', now: () => now, randomBytes };
  const req = (body: unknown, cookie?: string, headers: Record<string, string> = {}) => new Request(`${deps.context.origin}/api/marketplace/payments/seller`, { method: 'POST', headers: { origin: deps.context.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
  const cookie = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
  async function challenge(email = 'Seller@Example.invalid', browser?: string) { const res = await handleSellerChallenge(req({ email }, browser), deps); assert.equal(res.status, 202); return { id: (await res.json()).challengeId as string, browser: cookie(res), code: mail.at(-1)!.code }; }
  const verify = (c: Awaited<ReturnType<typeof challenge>>, code = c.code, browser = c.browser) => handleSellerVerify(req({ challengeId: c.id, code }, browser), deps);
  return { deps, req, cookie, mail, challenges, sessions, sellers, rates, challenge, verify, setPendingMapping: () => { pendingMapping = true; }, setNow: (value: string) => { now = new Date(value); }, setAccount: (value: SellerAccount) => { account = value; } };
}

test('verified_email_claims_only_matching_tenant', async () => {
  const f = fixture(); const c = await f.challenge(' Seller@Example.invalid '); const verified = await f.verify(c);
  assert.equal(verified.status, 200); assert.deepEqual(await verified.json(), { verified: true });
  const seller = await requireSeller(f.req({}, f.cookie(verified)), f.deps);
  assert.equal(seller.emailNormalized, 'seller@example.invalid');
  await assert.rejects(requireSeller(f.req({}, f.cookie(verified)), { ...f.deps, context: { ...f.deps.context, tenant: 'other' } }));
  const plus = await f.challenge('seller+one@example.invalid'); const other = await f.verify(plus);
  assert.notEqual((await requireSeller(f.req({}, f.cookie(other)), f.deps)).id, seller.id);
});
test('codes_are_single_use_and_browser_bound', async () => {
  const f = fixture(); const c = await f.challenge();
  assert.equal((await f.verify(c, c.code, '__Host-fb08_mp_verify=' + randomBytes(32).toString('base64url'))).status, 400);
  const results = await Promise.all([f.verify(c), f.verify(c)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); assert.equal(f.sessions.size, 1);
  assert.equal((await f.verify(c)).status, 400);
  const expired = await f.challenge('expired@example.invalid'); f.setNow('2026-11-17T00:10:00Z'); assert.equal((await f.verify(expired)).status, 400);
});
test('fifth failed guess exhausts a challenge', async () => {
  const f = fixture(); const c = await f.challenge(); const wrong = c.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await f.verify(c, wrong)).status, 400);
  assert.equal(f.challenges.get(c.id)?.attempts, 5); assert.equal((await f.verify(c)).status, 400);
});
test('challenge_response_does_not_enumerate or leak mail errors', async () => {
  const f = fixture();
  f.sellers.set('local:existing@example.invalid', { id: randomUUID(), tenant: 'local', emailNormalized: 'existing@example.invalid' });
  for (const email of ['absent@example.invalid', 'demo@example.invalid', 'existing@example.invalid']) {
    f.deps.mailer.sendCode = async () => { throw new Error(`provider payload ${email} 123456`); };
    const res = await handleSellerChallenge(f.req({ email }), f.deps);
    assert.equal(res.status, 202); const body = await res.json(); assert.deepEqual(Object.keys(body).sort(), ['challengeId', 'message']); assert.equal(body.message, 'If delivery is available, a verification code has been sent.');
  }
});
test('typed_email_or_board_session_is_not_authority', async () => {
  const f = fixture();
  for (const token of ['', 'fb08_session=fake-board-proof', '__Host-fb08_mp_seller=' + randomBytes(32).toString('base64url')]) await assert.rejects(requireSeller(f.req({ email: 'seller@example.invalid', accountId: 'acct_rogue' }, token), f.deps), e => e instanceof Error && 'status' in e && e.status === 401);
});
test('ownership_rate_limits and challenge replacement invalidation', async () => {
  const f = fixture(); const first = await f.challenge(); const second = await f.challenge('seller@example.invalid', first.browser);
  assert.equal(second.browser, first.browser); assert.equal((await f.verify(first)).status, 400);
  await f.challenge('seller@example.invalid', first.browser);
  assert.equal((await handleSellerChallenge(f.req({ email: 'seller@example.invalid' }), f.deps)).status, 429);
  const ip = fixture();
  for (let i = 0; i < 10; i++) await ip.challenge(`seller${i}@example.invalid`);
  assert.equal((await handleSellerChallenge(ip.req({ email: 'eleventh@example.invalid' }), ip.deps)).status, 429);
  const attempts = fixture(); const c = await attempts.challenge(); const wrong = c.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 30; i++) assert.equal((await attempts.verify(c, wrong)).status, 400);
  assert.equal((await attempts.verify(c)).status, 429);
});
test('status and logout use stored session expiry and private DTOs', async () => {
  const f = fixture(); const c = await f.challenge(); const v = await f.verify(c); const cookie = f.cookie(v);
  assert.deepEqual(await (await handleSellerStatus(f.req({}, cookie), f.deps)).json(), { verified: true, connection: 'not_connected' });
  for (const connection of ['pending', 'ready', 'restricted'] as const) {
    f.setAccount({ sellerId: 'id', accountId: 'acct_private', ready: connection === 'ready', connection, checkedAt: f.deps.now().toISOString(), accountCreateKey: 'private' });
    assert.deepEqual(await (await handleSellerStatus(f.req({}, cookie), f.deps)).json(), { verified: true, connection });
  }
  const logout = await handleSellerLogout(f.req({}, cookie), f.deps); assert.equal(logout.status, 200); assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  assert.deepEqual(await (await handleSellerStatus(f.req({}, cookie), f.deps)).json(), { verified: false, connection: 'not_connected' });
  const next = await f.verify(await f.challenge('other@example.invalid')); f.setNow('2026-11-17T01:00:00Z');
  await assert.rejects(requireSeller(f.req({}, f.cookie(next)), f.deps));
});
test('malformed and cross-origin requests fail before any mail or store work', async () => {
  const f = fixture();
  const invalidHeaders: Record<string, string>[] = [{ origin: '' }, { origin: 'https://evil.invalid' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': '' }, { 'content-type': 'text/plain' }, { 'content-length': '9000' }];
  for (const headers of invalidHeaders) {
    const res = await handleSellerChallenge(f.req({ email: 'seller@example.invalid' }, undefined, headers), f.deps); assert.ok([400, 403, 413, 415].includes(res.status));
  }
  for (const body of ['{', '[]', 'null']) assert.equal((await handleSellerChallenge(new Request(f.req({}), { body }), f.deps)).status, 400);
  for (const code of ['12345', '1234567', 'abcdef', 123456]) assert.equal((await handleSellerVerify(f.req({ challengeId: randomUUID(), code }), f.deps)).status, 400);
  assert.equal(f.mail.length, 0); assert.equal(f.rates.size, 0);
});
test('handler logs contain no contact, code, or provider payload', async () => {
  const f = fixture(); const logs: unknown[] = []; const previous = { error: console.error, log: console.log, warn: console.warn };
  console.error = console.log = console.warn = (...args) => { logs.push(args); };
  try { f.deps.mailer.sendCode = async () => { throw new Error('secret@example.invalid 123456 provider payload'); }; await handleSellerChallenge(f.req({ email: 'secret@example.invalid' }), f.deps); }
  finally { Object.assign(console, previous); }
  assert.deepEqual(logs, []);
  assert.equal(proofHash('seller-session', 'x', f.deps.secret).length, 64);
});

test('stream limits and disabled configuration fail closed with private errors', async () => {
  const f = fixture();
  const large = await handleSellerChallenge(new Request(f.req({}), { body: ' '.repeat(8193) }), f.deps);
  assert.equal(large.status, 413); assert.equal(f.mail.length, 0); assert.equal(f.rates.size, 0);
  const disabled = { ...f.deps, context: { ...f.deps.context, enabled: false } };
  assert.equal((await handleSellerChallenge(f.req({ email: 'seller@example.invalid' }), disabled)).status, 503);
  f.deps.store.findChallenge = async () => { throw new Error('private@example.invalid provider 123456'); };
  const c = await f.challenge(); const res = await f.verify(c); assert.equal(res.status, 503); assert.ok(!/private@|123456|provider/.test(await res.text()));
});

test('status and logout do not depend on sender configuration', async () => {
  const f = fixture();
  Object.defineProperty(f.deps, 'mailer', { get() { throw new Error('Mail configuration must not be read'); } });
  assert.equal((await handleSellerStatus(f.req({}), f.deps)).status, 200);
  assert.equal((await handleSellerLogout(f.req({}), f.deps)).status, 200);
});

test('durable mapping without a provider account ID reports pending', async () => {
  const f = fixture(); const verified = await f.verify(await f.challenge());
  f.setPendingMapping();
  assert.deepEqual(await (await handleSellerStatus(f.req({}, f.cookie(verified)), f.deps)).json(), { verified: true, connection: 'pending' });
});
