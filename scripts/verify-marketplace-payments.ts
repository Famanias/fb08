/** Operator-only read inspection. Never reconciles, refreshes readiness or creates provider objects. */
import { pathToFileURL } from 'node:url';
import type { PaymentDeps, Settlement } from '../lib/server/marketplace-payments/contracts';
import { validUuid } from '../features/marketplace/validation';
import { applicationFeeMinor } from '../features/marketplace/payments/rules';
import { checkoutMatches } from '../lib/server/marketplace-payments/reconcile';
import { createPaymentDeps } from '../lib/server/marketplace-payments/dependencies';

export type PaymentInspectionReport = { paid: boolean; sold: boolean; webhookConfirmed: boolean; feeDetails: 'confirmed' | 'pending' };
type InspectionInput = { base: string; orderId: string };
function requireEvidence(value: unknown): asserts value { if (!value) throw new Error('Payment inspection failed.'); }
function validSettlement(s: Settlement, grossMinor: number, feeMinor: number): boolean {
  const amounts = [s.grossMinor, s.applicationFeeMinor, s.stripeFeeMinor, s.otherFeeMinor, s.netMinor];
  // Balance settlement may use another currency. Never label the PHP remainder as net payout.
  return /^[a-z]{3}$/.test(s.currency) && amounts.every(n => Number.isSafeInteger(n) && n >= 0)
    && s.grossMinor - s.applicationFeeMinor - s.stripeFeeMinor - s.otherFeeMinor === s.netMinor
    && (s.currency !== 'php' || s.grossMinor === grossMinor && s.applicationFeeMinor === feeMinor);
}
export async function inspectPaymentOrder(input: InspectionInput, deps: PaymentDeps): Promise<PaymentInspectionReport> {
  try {
    const url = new URL(input.base);
    requireEvidence(input.base === deps.context.origin && url.origin === input.base && !url.username && !url.password
      && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      && validUuid(input.orderId));
    const order = await deps.store.findOrder(input.orderId, deps.context.tenant);
    requireEvidence(order && order.id === input.orderId && order.tenant === deps.context.tenant && order.livemode === false && order.currency === 'php'
      && order.state === 'paid' && validUuid(order.listingId) && validUuid(order.sellerId) && /^acct_[A-Za-z0-9]+$/.test(order.accountId)
      && order.sessionId && /^cs_test_[A-Za-z0-9_]+$/.test(order.sessionId) && order.paymentIntentId && /^pi_[A-Za-z0-9_]+$/.test(order.paymentIntentId)
      && Number.isSafeInteger(order.grossMinor) && order.grossMinor > 0 && order.feeMinor === applicationFeeMinor(order.grossMinor));
    const account = await deps.store.findAccountById(order.accountId, order.tenant);
    requireEvidence(account && account.accountId === order.accountId && account.sellerId === order.sellerId);
    const inventory = await deps.store.inspectInventory(order.listingId, order.tenant);
    requireEvidence(inventory && inventory.listingId === order.listingId && inventory.inventoryKind === 'sandbox' && inventory.status === 'sold'
      && inventory.priceMinor === order.grossMinor && inventory.orderIds.length === 1 && inventory.orderIds[0] === order.id);
    const receipt = await deps.store.findPaidWebhookReceipt(order.id, order.tenant);
    requireEvidence(receipt && /^evt_[A-Za-z0-9_]+$/.test(receipt.eventId) && receipt.eventType === 'checkout.session.completed');
    const canonical = await deps.stripe.readCheckout(order);
    requireEvidence(checkoutMatches(order, canonical) && canonical.status === 'complete' && canonical.paymentStatus === 'paid'
      && canonical.intentStatus === 'succeeded' && canonical.intentAmountReceivedMinor === order.grossMinor && canonical.intentCurrency === order.currency);
    let settlement: Settlement | null = null;
    try { settlement = await deps.stripe.readSettlement(order); } catch { /* Paid evidence survives delayed balance availability. */ }
    return { paid: true, sold: true, webhookConfirmed: true, feeDetails: settlement && validSettlement(settlement, order.grossMinor, order.feeMinor) ? 'confirmed' : 'pending' };
  } catch { throw new Error('Payment inspection failed.'); }
}

export function parsePaymentInspectionArgs(args: string[]): InspectionInput {
  if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--order-id' || !args[1] || !args[3]) throw new Error('Use --base <origin> --order-id <owned-order-uuid>.');
  return { base: args[1], orderId: args[3] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => inspectPaymentOrder(parsePaymentInspectionArgs(process.argv.slice(2)), createPaymentDeps()))
    .then(report => console.log(JSON.stringify(report)))
    .catch(() => { console.error('Payment inspection failed. Check the owned order, origin, tenant and sandbox evidence privately.'); process.exitCode = 1; });
}
