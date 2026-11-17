'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { OrderConfirmation as Confirmation } from '../payments/types';
import { formatPrice } from '../types';
import { feeCopy, orderHeading, SANDBOX_NOTICE } from '../payments/presentation';
export function OrderConfirmation({ initial }: { initial: Confirmation }) {
  const [order, setOrder] = useState(initial); const [error, setError] = useState(''); const [lost, setLost] = useState(false); const [timedOut, setTimedOut] = useState(false); const [pending, setPending] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/marketplace/payments/orders/${initial.orderId}`, { cache: 'no-store', credentials: 'same-origin', signal });
    if (response.status === 404) { setLost(true); return; }
    if (!response.ok) throw new Error('Could not read payment status. Please refresh.');
    const next: Confirmation = await response.json(); setOrder(next); setError('');
  }, [initial.orderId]);
  useEffect(() => {
    if (order.status !== 'pending' || lost) return;
    const controller = new AbortController(); const deadline = Date.now() + 60000; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); } catch { if (!controller.signal.aborted) setError('Could not read payment status. Please refresh.'); }
      if (controller.signal.aborted) return;
      if (Date.now() >= deadline) setTimedOut(true); else timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 2000); return () => { controller.abort(); clearTimeout(timer); };
  }, [order.status, lost, refresh]);
  if (lost) return <div className="error-box" role="alert">Order unavailable. Use the browser where you started this order. Access expires after seven days; a lost cookie cannot be recovered here.</div>;
  return <article className="panel-box"><div className="panel-title"><h2 aria-live="polite">{orderHeading(order.status)}</h2></div><div className="panel-content"><p className="payment-notice">{SANDBOX_NOTICE}</p><h3>{order.title}</h3>
    <p role="status">{order.status === 'pending' ? 'Waiting for verified payment confirmation. Returning from Checkout does not confirm a payment.' : order.status === 'paid' ? 'The verified sandbox payment has been recorded. This item is Sold.' : order.status === 'review' ? 'This payment needs operator investigation. Do not start another payment for this item.' : 'This payment session expired without a confirmed sale.'}</p>
    {timedOut && order.status === 'pending' && <p>Payment confirmation pending. Automatic checks have stopped after 60 seconds. You can refresh status below.</p>}
    <dl className="detail-info payment-amounts"><dt>Sandbox total</dt><dd>{formatPrice(order.grossMinor / 100)}</dd><dt>Platform fee (10%)</dt><dd>{formatPrice(order.applicationFeeMinor / 100)}</dd><dt>Seller before processing fees</dt><dd>{formatPrice(order.sellerBeforeProcessingMinor / 100)}</dd></dl><p className="field-help">{feeCopy}</p>
    {error && <p className="error-box" role="alert">{error}</p>}<div className="payment-actions"><button className="secondary-btn" type="button" disabled={pending} onClick={async () => { setPending(true); try { await refresh(); } catch { setError('Could not read payment status. Please refresh.'); } finally { setPending(false); } }}>{pending ? 'Checking…' : 'Refresh payment status'}</button><Link href={`/marketplace/${order.listingId}`}>View listing</Link></div><p className="field-help">Private to the browser that started this order. Access expires after seven days.</p></div></article>;
}
