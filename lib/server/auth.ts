import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const SESSION_COOKIE_NAME = 'fb08_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface SessionTokenPayload {
  userId: string;
  username: string;
  exp: number;
}

const SCRYPT_KEY_BYTES = 64;
const SCRYPT_SALT_BYTES = 16;

function resolveAuthSecret(secretOverride?: string): string {
  const secret = (secretOverride ?? process.env.AUTH_SESSION_SECRET ?? '').trim();
  if (secret.length < 16) {
    throw new Error(
      'AUTH_SESSION_SECRET is missing or too short (minimum 16 characters).'
    );
  }
  return secret;
}

/** Hash a non-empty password with a random per-user salt using scrypt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES).toString('hex');
  return `${salt}:${derived}`;
}

/** Verify a password against a stored scrypt `salt:hash` value in constant time. */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex || !/^[0-9a-f]+$/i.test(expectedHex)) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Sign an authenticated user session into a compact HMAC-SHA256 token. */
export function signSessionToken(
  payload: { userId: string; username: string },
  secretOverride?: string,
  nowMs: number = Date.now()
): string {
  const secret = resolveAuthSecret(secretOverride);
  const fullPayload: SessionTokenPayload = {
    userId: payload.userId,
    username: payload.username,
    exp: Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify token integrity and expiry, returning null for invalid or expired cookies. */
export function verifySessionToken(
  token: string,
  secretOverride?: string,
  nowMs: number = Date.now()
): SessionTokenPayload | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return null;
  }

  let secret: string;
  try {
    secret = resolveAuthSecret(secretOverride);
  } catch {
    return null;
  }

  const body = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = createHmac('sha256', secret).update(body).digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    ) as Partial<SessionTokenPayload>;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= Math.floor(nowMs / 1000)) {
      return null;
    }
    return {
      userId: parsed.userId,
      username: parsed.username,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function buildSessionCookieHeader(token: string, isProd: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(isProd: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
