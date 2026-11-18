import { createHmac } from 'node:crypto';
export function proofHash(purpose: 'buyer-session' | 'browser', value: string, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(['fb08-marketplace-payments-v1', purpose, value])).digest('hex');
}
export function newCapability(randomBytes: (size: number) => Buffer): string { return randomBytes(32).toString('base64url'); }
export function capabilityCookieName(kind: 'buyer', secure: boolean): string {
  return `${secure ? '__Host-' : ''}fb08_mp_${kind}`;
}
export function validCapability(value: string | null): value is string { return value !== null && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function capabilityCookie(kind: 'buyer', value: string, maxAge: number, secure: boolean): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || !Number.isSafeInteger(maxAge) || maxAge < 0) throw new Error('Invalid capability cookie');
  return `${capabilityCookieName(kind, secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
