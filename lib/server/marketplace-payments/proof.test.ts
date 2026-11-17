import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { normalizeSellerEmail, proofHash, codeHash, newCapability, capabilityCookie } from './proof';

test('normalization preserves distinct seller addresses', () => {
  assert.equal(normalizeSellerEmail(' Seller@Example.invalid '), 'seller@example.invalid');
  assert.notEqual(normalizeSellerEmail('a+one@example.invalid'), normalizeSellerEmail('a@example.invalid'));
  for (const value of [null, {}, 'bad', 'a@b\n.test', 'a b@example.invalid', 'a@@example.invalid']) assert.throws(() => normalizeSellerEmail(value));
});
test('proofs have separate domains and bind every challenge field', () => {
  const secret = 'fictional-test-secret-for-payments';
  const value = newCapability(randomBytes);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new Set(['seller-session', 'buyer-session', 'browser', 'email'].map(p => proofHash(p as 'email', value, secret))).size, 4);
  const base = codeHash('id', 'seller@example.invalid', 'browser', '123456', secret);
  for (const fields of [['other', 'seller@example.invalid', 'browser', '123456'], ['id', 'other@example.invalid', 'browser', '123456'], ['id', 'seller@example.invalid', 'other', '123456'], ['id', 'seller@example.invalid', 'browser', '123457']]) assert.notEqual(codeHash(fields[0], fields[1], fields[2], fields[3], secret), base);
});
test('capability cookies are private and expire', () => {
  const cookie = capabilityCookie('seller', 'test-capability', 3600, true);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=3600']) assert.ok(cookie.includes(flag));
  assert.ok(cookie.startsWith('__Host-fb08_mp_seller='));
  assert.ok(capabilityCookie('verify', '', 0, false).startsWith('fb08_mp_verify=;'));
  assert.ok(capabilityCookie('buyer', 'test', 604800, false).includes('Max-Age=604800'));
  assert.throws(() => capabilityCookie('seller', 'bad; injected=x', 3600, true));
});
