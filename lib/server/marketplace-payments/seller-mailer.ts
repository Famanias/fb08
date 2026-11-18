import type { SellerMailer } from './contracts';
import { normalizeSellerEmail } from './proof';
import { validUuid } from '../../../features/marketplace/validation';

export type { SellerMailer } from './contracts';
// Construction has no configuration or network side effects. Resend itself
// requires this sender's domain to be verified; no fallback sender is used.
export function createSellerMailer(): SellerMailer {
  return { async sendCode(input) {
    try {
      const key = process.env.RESEND_API_KEY; const from = process.env.MARKETPLACE_SELLER_EMAIL_FROM;
      if (!key || !/^re_[A-Za-z0-9_-]+$/.test(key) || !from || normalizeSellerEmail(from) !== from || from.endsWith('.invalid') || from.endsWith('@resend.dev')
        || normalizeSellerEmail(input.to) !== input.to || input.to.endsWith('.invalid') || !validUuid(input.challengeId) || !/^\d{6}$/.test(input.code) || input.expiresMinutes !== 10) throw new Error();
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `marketplace-seller/${input.challengeId}` },
        body: JSON.stringify({ from, to: [input.to], subject: 'Your Marketplace seller verification code', text: `Your Marketplace verification code is ${input.code}. It expires in 10 minutes. If you did not request it, ignore this message.` }),
      });
      // No links or HTML, no provider payload parsing/logging, and no retry
      // after a timeout or ambiguous response.
      await response.body?.cancel();
      if (!response.ok) throw new Error();
    } catch { throw new Error('Seller code delivery unavailable.'); }
  } };
}
