import { createHmac } from 'node:crypto';

/** Derive a deterministic 6-char hex tag scoped strictly to one (user, thread) pair. */
export function deriveThreadAnonTag(
  userId: string,
  threadId: string,
  secretOverride?: string
): string {
  const secret = (secretOverride ?? process.env.AUTH_SESSION_SECRET ?? '').trim();
  if (secret.length < 16) {
    throw new Error(
      'AUTH_SESSION_SECRET is missing or too short (minimum 16 characters).'
    );
  }
  return createHmac('sha256', secret)
    .update(`${threadId}:${userId}`)
    .digest('hex')
    .slice(0, 6);
}
