'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore, useTransition } from 'react';
import type { PublicPaymentState } from '../payments/types';
import { readCheckoutKey, submitCheckout } from '../payments/service';
import { paymentLabel, SANDBOX_NOTICE } from '../payments/presentation';

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export function BuyNowButton({ listingId, paymentState }: { listingId: string; paymentState: PublicPaymentState }) {
  const router = useRouter();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const { availability } = paymentState;
  const hasKey = useSyncExternalStore(subscribeToStorage, () => {
    try { return readCheckoutKey(window.sessionStorage, listingId) !== null; } catch { return false; }
  }, () => false);

  async function buy() {
    if (lock.current || refreshing) return;
    lock.current = true;
    setPending(true);
    setError('');
    setExpired(false);
    try {
      const result = await submitCheckout(window.sessionStorage, listingId, availability);
      if (!result) return;
      if (result.expired) {
        setExpired(true);
        startRefresh(() => router.refresh());
        return;
      }
      window.location.assign(result.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start Checkout. Please retry.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  const ready = availability === 'ready';
  const canResume = paymentState.sandbox && availability === 'reserved' && hasKey;
  const actionLabel = canResume ? 'Resume Checkout' : hasKey ? 'Retry Checkout' : 'Buy Now';
  return <section className="payment-box" aria-label="Online payment"><p className="payment-notice">{paymentState.sandbox ? SANDBOX_NOTICE : 'Online payments are available only for explicitly marked sandbox items.'}</p>
    {ready ? <p>Pay for one fictional item through Stripe Checkout. Keep this browser to view confirmation.</p> : <p role="status"><strong>{paymentLabel(paymentState)}</strong></p>}
    {(ready || canResume) && <button className="primary-btn" type="button" disabled={pending || refreshing} onClick={buy}>{refreshing ? 'Refreshing availability…' : pending ? 'Opening sandbox Checkout…' : actionLabel}</button>}
    {expired && <p role="status">This Checkout expired. You can try again when the item is available.</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
