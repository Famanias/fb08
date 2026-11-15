import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveThreadAnonTag } from './anon-tag';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  hashPassword,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from './auth';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

test('hashPassword and verifyPassword accept 1-char and arbitrary non-empty passwords', () => {
  const hashA = hashPassword('a');
  const hashX = hashPassword('x');

  assert.equal(verifyPassword('a', hashA), true);
  assert.equal(verifyPassword('b', hashA), false);
  assert.equal(verifyPassword('x', hashX), true);
  assert.equal(verifyPassword('a', 'malformed-hash'), false);
  assert.notEqual(hashPassword('a'), hashPassword('a'));
});

test('signSessionToken and verifySessionToken round-trip and reject tampered or expired tokens', () => {
  const startMs = 1_700_000_000_000;
  const token = signSessionToken(
    { userId: '11111111-1111-4111-8111-111111111111', username: 'Alice' },
    TEST_SECRET,
    startMs
  );

  const valid = verifySessionToken(token, TEST_SECRET, startMs + 60_000);
  assert.deepEqual(valid?.userId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(valid?.username, 'Alice');

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifySessionToken(tampered, TEST_SECRET, startMs + 60_000), null);

  const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
  assert.equal(verifySessionToken(token, TEST_SECRET, startMs + thirtyOneDaysMs), null);
});

test('buildSessionCookieHeader sets HttpOnly, SameSite=Lax, Path=/ and Secure only in prod', () => {
  const devCookie = buildSessionCookieHeader('tok', false);
  assert.match(devCookie, new RegExp(`^${SESSION_COOKIE_NAME}=tok;`));
  assert.match(devCookie, /HttpOnly/);
  assert.match(devCookie, /SameSite=Lax/);
  assert.match(devCookie, /Path=\//);
  assert.doesNotMatch(devCookie, /Secure/);

  const prodCookie = buildSessionCookieHeader('tok', true);
  assert.match(prodCookie, /Secure/);

  const cleared = buildClearSessionCookieHeader(true);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
});

test('deriveThreadAnonTag is deterministic within a thread and distinct across threads and users', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const thread1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const thread2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const tagA1 = deriveThreadAnonTag(userA, thread1, TEST_SECRET);
  const tagA1Again = deriveThreadAnonTag(userA, thread1, TEST_SECRET);
  const tagA2 = deriveThreadAnonTag(userA, thread2, TEST_SECRET);
  const tagB1 = deriveThreadAnonTag(userB, thread1, TEST_SECRET);

  assert.match(tagA1, /^[0-9a-f]{6}$/);
  assert.equal(tagA1, tagA1Again);
  assert.notEqual(tagA1, tagA2);
  assert.notEqual(tagA1, tagB1);
});
