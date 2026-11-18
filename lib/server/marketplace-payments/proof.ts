import { createHmac } from 'node:crypto';
import { MarketplaceError } from '../../../features/marketplace/validation';

export function normalizeSellerEmail(value: unknown): string {
  if (typeof value !== 'string') throw new MarketplaceError('Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
    || email.split('@')[0].length > 64 || email.startsWith('.') || email.includes('..') || email.includes('.@')) throw new MarketplaceError('Enter a valid email address.');
  return email;
}
function hmac(parts: string[], secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(['fb08-marketplace-payments-v1', ...parts])).digest('hex');
}
export function proofHash(purpose: 'seller-session' | 'buyer-session' | 'browser' | 'email', value: string, secret: string): string {
  return hmac([purpose, value], secret);
}
export function codeHash(challengeId: string, email: string, browserHash: string, code: string, secret: string): string {
  return hmac(['seller-code', challengeId, email, browserHash, code], secret);
}
export function newCapability(randomBytes: (size: number) => Buffer): string { return randomBytes(32).toString('base64url'); }
export function capabilityCookieName(kind: 'seller' | 'buyer' | 'verify', secure: boolean): string {
  return `${secure ? '__Host-' : ''}fb08_mp_${kind}`;
}
export function validCapability(value: string | null): value is string { return value !== null && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function capabilityCookie(kind: 'seller' | 'buyer' | 'verify', value: string, maxAge: number, secure: boolean): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || !Number.isSafeInteger(maxAge) || maxAge < 0) throw new Error('Invalid capability cookie');
  return `${capabilityCookieName(kind, secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
