import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSellerMailer } from './seller-mailer';

test('Resend HTTPS mail is bounded, idempotent and never retries or exposes responses', async () => {
  const before = { key: process.env.RESEND_API_KEY, from: process.env.MARKETPLACE_SELLER_EMAIL_FROM, fetch: globalThis.fetch };
  process.env.RESEND_API_KEY = 're_fictional_local_test'; process.env.MARKETPLACE_SELLER_EMAIL_FROM = 'verify@example.test';
  const calls: RequestInit[] = [];
  try {
    globalThis.fetch = async (url, init) => { assert.equal(url, 'https://api.resend.com/emails'); calls.push(init!); return Response.json({ id: 'fictional' }); };
    const mailer = createSellerMailer(); const input = { to: 'recipient@example.test', code: '123456', expiresMinutes: 10 as const, challengeId: '10000000-0000-4000-8000-000000000001' };
    await mailer.sendCode(input);
    assert.equal(calls[0].method, 'POST'); assert.ok(calls[0].signal instanceof AbortSignal);
    const headers = new Headers(calls[0].headers); assert.equal(headers.get('Idempotency-Key'), 'marketplace-seller/10000000-0000-4000-8000-000000000001');
    const body = JSON.parse(String(calls[0].body)); assert.deepEqual(body.to, [input.to]); assert.ok(body.text.includes(input.code)); assert.equal(body.html, undefined); assert.ok(!body.text.includes('http'));
    globalThis.fetch = async () => { calls.push({}); throw new Error('private provider recipient@example.test 123456'); };
    await assert.rejects(mailer.sendCode(input), e => e instanceof Error && !/private|recipient|123456/.test(e.message)); assert.equal(calls.length, 2);
    globalThis.fetch = async () => { calls.push({}); return Response.json({ message: 'private payload' }, { status: 422 }); };
    await assert.rejects(mailer.sendCode(input), e => e instanceof Error && !/payload/.test(e.message)); assert.equal(calls.length, 3);
    await assert.rejects(mailer.sendCode({ ...input, to: 'demo@example.invalid' })); assert.equal(calls.length, 3);
    delete process.env.RESEND_API_KEY; await assert.rejects(createSellerMailer().sendCode(input)); assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = before.fetch;
    for (const [name, value] of [['RESEND_API_KEY', before.key], ['MARKETPLACE_SELLER_EMAIL_FROM', before.from]]) if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
