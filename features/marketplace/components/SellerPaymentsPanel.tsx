'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { paymentRequest } from '../payments/service';
import { SANDBOX_NOTICE, sellerConnectionCopy } from '../payments/presentation';
import type { SellerPaymentStatus } from '../payments/types';

const STATUS_URL = '/api/marketplace/payments/seller/status';

export function SellerPaymentsPanel({ mode = 'manage', initial }: {
  mode?: 'manage' | 'return' | 'refresh';
  initial?: SellerPaymentStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    if (initial) return;
    let active = true;
    paymentRequest<SellerPaymentStatus>(STATUS_URL).then(value => {
      if (active) setStatus(value);
    }).catch(() => {
      if (active) setError('Could not check seller payments. Please try again.');
    });
    return () => { active = false; };
  }, [initial]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete this request. Please retry.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  const connection = status?.connection;
  const canConnect = status?.paymentsEnabled && connection !== 'sign_in_required' && connection !== 'listing_required' && connection !== 'ready';

  return (
    <div className="panel-box">
      <div className="panel-title"><h2>Seller payments</h2><span className="soft-badge">SANDBOX</span></div>
      <div className="panel-content">
        <p className="payment-notice">{SANDBOX_NOTICE}</p>
        {mode === 'return' && <p>Stripe has sent you back. Check your connection status below.</p>}
        {mode === 'refresh' && <p>If the Stripe link expired, request a fresh one.</p>}
        {status?.paymentsEnabled === false && <p role="status">Sandbox Checkout is paused.</p>}
        {!status && !error && <p role="status">Checking seller payments…</p>}
        {connection === 'sign_in_required' && <Link className="primary-btn" href="/#account">Sign in to fb/08</Link>}
        {connection === 'listing_required' && <Link className="primary-btn" href="/marketplace/new">Post a sandbox listing</Link>}
        {connection && connection !== 'sign_in_required' && connection !== 'listing_required' && (
          <p role="status"><strong>{sellerConnectionCopy(connection)}</strong></p>
        )}
        {(canConnect || error || connection === 'ready' || connection === 'pending' || connection === 'restricted') && (
          <div className="payment-actions">
            {canConnect && <button className="primary-btn" type="button" disabled={pending} onClick={() => void run(async () => {
              const refresh = mode === 'refresh' && connection !== 'not_connected';
              const path = refresh ? 'connect/refresh' : 'connect';
              const value = await paymentRequest<{ url: string }>('/api/marketplace/payments/' + path, {});
              window.location.assign(value.url);
            })}>{mode === 'refresh' && connection !== 'not_connected' ? 'Request new Stripe link' : connection === 'not_connected' ? 'Connect with Stripe' : 'Continue Stripe onboarding'}</button>}
            <button className="secondary-btn" type="button" disabled={pending} onClick={() => void run(async () => {
              setStatus(await paymentRequest<SellerPaymentStatus>(STATUS_URL));
            })}>Check status</button>
          </div>
        )}
        {error && <p className="error-box" role="alert">{error}</p>}
      </div>
    </div>
  );
}
