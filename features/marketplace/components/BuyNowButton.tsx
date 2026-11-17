'use client';
import { useRef, useState } from 'react';
import type { PublicPaymentState } from '../payments/types';
import { paymentRequest } from '../payments/service';
import { paymentLabel, SANDBOX_NOTICE } from '../payments/presentation';
export function BuyNowButton({ listingId, paymentState }: { listingId: string; paymentState: PublicPaymentState }) {
  const key = useRef<string | null>(null); const lock = useRef(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  async function buy() {
    if (lock.current) return; lock.current = true; setPending(true); setError('');
    try {
      key.current ??= crypto.randomUUID();
      await paymentRequest('/api/marketplace/payments/buyer-session', {});
      const result = await paymentRequest<{ url: string }>('/api/marketplace/payments/checkout', { listingId }, key.current);
      window.location.assign(result.url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not start Checkout. Please retry.'); lock.current = false; setPending(false); }
  }
  return <section className="payment-box" aria-label="Online payment"><p className="payment-notice">{paymentState.sandbox ? SANDBOX_NOTICE : 'Online payments are available only for explicitly marked sandbox items.'}</p>
    {paymentState.availability === 'ready' ? <><p>Pay for one fictional item through Stripe Checkout. Keep this browser to view confirmation.</p><button className="primary-btn" type="button" disabled={pending} onClick={buy}>{pending ? 'Opening sandbox Checkout…' : 'Buy Now'}</button></> : <p role="status"><strong>{paymentLabel(paymentState)}</strong></p>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
