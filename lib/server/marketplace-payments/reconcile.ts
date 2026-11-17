import { randomUUID } from 'node:crypto';
import type { CanonicalCheckout, PaymentDeps, PreparedOrder, StoredOrder } from './contracts';
import { refreshKnownAccount } from './connect-handlers';

/** Attribution checks precede any provider mutation; the transaction repeats these under locks. */
export function checkoutMatches(order: StoredOrder, c: CanonicalCheckout): boolean {
  const metadata = { fb08_app: 'marketplace-payments-v1', tenant: order.tenant, order_id: order.id, listing_id: order.listingId };
  const matchesMetadata = (actual: Record<string, string>) => Object.keys(actual).length === 4 && Object.entries(metadata).every(([key, value]) => actual[key] === value);
  return !!order.createParams && c.accountId === order.accountId && !c.livemode && c.currency === order.currency && c.grossMinor === order.grossMinor && c.quantity === 1 && c.expiresAt === order.checkoutExpiresAt && c.clientReferenceId === order.id && (!order.sessionId || c.sessionId === order.sessionId) && (!order.paymentIntentId || c.paymentIntentId === order.paymentIntentId) && matchesMetadata(c.metadata) && (c.paymentIntentId ? c.feeMinor === order.feeMinor && matchesMetadata(c.intentMetadata) : c.feeMinor === null || c.feeMinor === order.feeMinor);
}
export async function enrichSettlement(order: StoredOrder, deps: PaymentDeps): Promise<void> {
  if (order.state !== 'paid' || order.tenant !== deps.context.tenant) return;
  const settlement = await deps.stripe.readSettlement(order);
  if (settlement) await deps.store.saveSettlement(order.id, order.tenant, settlement);
}
export async function reconcileOrder(order: StoredOrder, deps: PaymentDeps, event?: { id: string; type: string; sessionId: string }): Promise<'paid' | 'expired' | 'held' | 'duplicate' | 'review'> {
  if (order.tenant !== deps.context.tenant) throw new Error('Order unavailable.');
  let sessionId = event?.sessionId ?? order.sessionId;
  if (!sessionId) {
    // Only retry the exact persisted operation while both original safety windows remain valid.
    const safe = () => {
      const age = +deps.now() - Date.parse(order.preparedAt);
      return order.state === 'preparing' && !!order.createParams && !!order.stripeApiVersion && Number.isFinite(age) && age >= 0 && age < 23 * 3600000 && order.checkoutExpiresAt - +deps.now() / 1000 >= 1800;
    };
    if (!safe()) return 'held';
    const account = await deps.store.findAccountById(order.accountId, order.tenant);
    if (!account || account.sellerId !== order.sellerId || !(await refreshKnownAccount(account, deps)).ready || !safe()) return 'held';
    sessionId = (await deps.stripe.createCheckout(order as PreparedOrder)).sessionId;
  }
  let canonical = await deps.stripe.readCheckout(order, sessionId);
  if (checkoutMatches(order, canonical) && order.state !== 'paid' && (canonical.status === 'expired' || (!event && canonical.status === 'open' && canonical.expiresAt <= +deps.now() / 1000))) {
    // Provider expiration/cancellation is followed by a fresh canonical read, including completion races.
    canonical = await deps.stripe.expireCheckout({ ...order, sessionId });
  }
  const outcome = await deps.store.applyCheckout({ orderId: order.id, tenant: order.tenant, eventId: event?.id ?? `operator:${order.id}:${randomUUID()}`, eventType: event?.type ?? 'operator.reconcile', canonical, now: deps.now() });
  if (outcome === 'paid' || outcome === 'duplicate') {
    // Paid fulfillment is committed already. Missing/transient balance data is retried separately.
    try { const stored = await deps.store.findOrder(order.id, order.tenant); if (stored) await enrichSettlement(stored, deps); } catch { /* Leave fee details pending; do not make a committed sale depend on enrichment. */ }
  }
  return outcome;
}
