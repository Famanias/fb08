import type { PaymentContext } from './contracts';
import { MarketplaceError } from '../../../features/marketplace/validation';
import { jsonResponse } from '../route-helpers';

export function assertPaymentOrigin(req: Request, context: PaymentContext): void {
  if (new URL(req.url).origin !== context.origin || req.headers.get('origin') !== context.origin || req.headers.get('sec-fetch-site') !== 'same-origin') throw new MarketplaceError('Please submit from this website.', 403);
}
export async function readPaymentJson(req: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new MarketplaceError('Submit JSON.', 415);
  if (Number(req.headers.get('content-length')) > maxBytes) throw new MarketplaceError('Request too large.', 413);
  if (!req.body) throw new MarketplaceError('Invalid request.');
  const reader = req.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new MarketplaceError('Request too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new MarketplaceError('Invalid request.'); }
}
export function paymentErrorResponse(error: unknown): Response {
  const status = error instanceof MarketplaceError && [400, 401, 403, 404, 409, 413, 415, 429, 503].includes(error.status) ? error.status : 503;
  const messages: Record<number, string> = { 400: 'Invalid or expired verification. Please try again.', 401: 'Verify your seller email to continue.', 403: 'Please submit from this website.', 404: 'Payment unavailable.', 409: 'Payment request conflicts with current state.', 413: 'The request is too large.', 415: 'Submit a JSON request.', 429: 'Too many attempts. Please try again in an hour.', 503: 'Payments are temporarily unavailable. Please try again.' };
  return jsonResponse({ error: messages[status] }, status, status === 429 ? { 'Retry-After': '3600' } : undefined);
}
