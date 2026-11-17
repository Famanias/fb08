'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { OrderConfirmation as Confirmation } from '../payments/types';
import { formatPrice } from '../types';
import { feeCopy, orderHeading, SANDBOX_NOTICE } from '../payments/presentation';
import { createOrderMonitor, type OrderMonitorState } from '../payments/order-monitor';
export function OrderConfirmation({ initial }: { initial: Confirmation }) {
  const [state, setState] = useState<OrderMonitorState>({ order: initial, error: '', lost: false, timedOut: false, pending: false });
  const monitorRef = useRef<ReturnType<typeof createOrderMonitor> | null>(null);
  const { order, error, lost, timedOut, pending } = state;
  useEffect(() => {
    const monitor = createOrderMonitor(initial, async signal => {
      const response = await fetch(`/api/marketplace/payments/orders/${initial.orderId}`, { cache: 'no-store', credentials: 'same-origin', signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not read payment status. Please refresh.');
      return await response.json() as Confirmation;
    }, setState);
    monitorRef.current = monitor; monitor.start();
    return () => { monitor.dispose(); if (monitorRef.current === monitor) monitorRef.current = null; };
  }, [initial]);
  if (lost) return <div className="error-box" role="alert">Order unavailable. Use the browser where you started this order. Access expires after seven days; a lost cookie cannot be recovered here.</div>;
  return <article className="panel-box"><div className="panel-title"><h2 aria-live="polite">{orderHeading(order.status)}</h2></div><div className="panel-content"><p className="payment-notice">{SANDBOX_NOTICE}</p><h3>{order.title}</h3>
    <p role="status">{order.status === 'pending' ? 'Waiting for verified payment confirmation. Returning from Checkout does not confirm a payment.' : order.status === 'paid' ? 'The verified sandbox payment has been recorded. This item is Sold.' : order.status === 'review' ? 'This payment needs operator investigation. Do not start another payment for this item.' : 'This payment session expired without a confirmed sale.'}</p>
    {timedOut && order.status === 'pending' && <p>Payment confirmation pending. Automatic checks have stopped after 60 seconds. You can refresh status below.</p>}
    <dl className="detail-info payment-amounts"><dt>Sandbox total</dt><dd>{formatPrice(order.grossMinor / 100)}</dd><dt>Platform fee (10%)</dt><dd>{formatPrice(order.applicationFeeMinor / 100)}</dd><dt>Seller before processing fees</dt><dd>{formatPrice(order.sellerBeforeProcessingMinor / 100)}</dd></dl><p className="field-help">{feeCopy}</p>
    {error && <p className="error-box" role="alert">{error}</p>}<div className="payment-actions"><button className="secondary-btn" type="button" disabled={pending} onClick={() => monitorRef.current?.refresh()}>{pending ? 'Checking…' : 'Refresh payment status'}</button><Link href={`/marketplace/${order.listingId}`}>View listing</Link></div><p className="field-help">Private to the browser that started this order. Access expires after seven days.</p></div></article>;
}
