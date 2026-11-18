import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { proofHash, newCapability, capabilityCookie } from './proof';

test('buyer and rate-limit proofs use separate domains', () => {
  const secret = 'fictional-test-secret-for-payments';
  const value = newCapability(randomBytes);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(proofHash('buyer-session', value, secret), proofHash('browser', value, secret));
});
test('capability cookies are private and expire', () => {
  const cookie = capabilityCookie('buyer', 'test-capability', 3600, true);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=3600']) assert.ok(cookie.includes(flag));
  assert.ok(cookie.startsWith('__Host-fb08_mp_buyer='));
  assert.ok(capabilityCookie('buyer', 'test', 604800, false).includes('Max-Age=604800'));
  assert.throws(() => capabilityCookie('buyer', 'bad; injected=x', 3600, true));
});
