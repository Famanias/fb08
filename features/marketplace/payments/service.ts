import { validUuid } from '../validation';
import type { CheckoutLaunch, PaymentAvailability } from './types';

export async function paymentRequest<T>(path: string, body?: Record<string, unknown>, key?: string): Promise<T> {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Payments are temporarily unavailable. Please try again.');
  return result as T;
}

type CheckoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const checkoutSlot = (listingId: string) => `marketplace:checkout:${listingId}`;

export function readCheckoutKey(storage: CheckoutStorage, listingId: string): string | null {
  const key = storage.getItem(checkoutSlot(listingId));
  return validUuid(key) ? key : null;
}

export async function submitCheckout(storage: CheckoutStorage, listingId: string, availability: PaymentAvailability): Promise<CheckoutLaunch | null> {
  const key = readCheckoutKey(storage, listingId);
  const resumeOnly = availability === 'reserved';
  if (resumeOnly ? !key : availability !== 'ready') return null;

  if (!resumeOnly) await paymentRequest('/api/marketplace/payments/buyer-session', {});
  let submissionKey = key;
  if (!submissionKey) {
    submissionKey = crypto.randomUUID();
    // Persist the retry identifier before a request can commit. The buyer proof stays in the HttpOnly cookie.
    storage.setItem(checkoutSlot(listingId), submissionKey);
  }
  const body = resumeOnly ? { listingId, resumeOnly: true } : { listingId };
  const result = await paymentRequest<CheckoutLaunch>('/api/marketplace/payments/checkout', body, submissionKey);
  if (result.expired === true && readCheckoutKey(storage, listingId) === submissionKey) storage.removeItem(checkoutSlot(listingId));
  return result;
}
