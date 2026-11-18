/** Operator-only. Inspection is the default; --apply reconciles existing owned operations. */
import { pathToFileURL } from 'node:url';
import type { PaymentDeps } from '../lib/server/marketplace-payments/contracts';
import { createPaymentDeps } from '../lib/server/marketplace-payments/dependencies';
import { reconcileOrder } from '../lib/server/marketplace-payments/reconcile';

export function parseReconcileArgs(args: string[]): { apply: boolean } {
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Use only --apply to change existing owned orders.');
  return { apply: args.includes('--apply') };
}
export async function reconcileMarketplacePayments(deps: PaymentDeps, apply = false): Promise<Array<{ orderId: string; state: string; action: string }>> {
  const orders = await deps.store.listReconciliationOrders(deps.context.tenant);
  const results = [];
  for (const order of orders) {
    if (order.tenant !== deps.context.tenant) continue;
    const state = order.state;
    const age = +deps.now() - Date.parse(order.preparedAt);
    let action = order.state === 'paid' ? 'inspect-fee-details' : order.sessionId ? 'inspect-session' : order.state === 'preparing' && order.createParams && order.stripeApiVersion && age >= 0 && age < 23 * 3600000 && order.checkoutExpiresAt - +deps.now() / 1000 >= 1800 ? 'retry-original-operation' : 'frozen-review-evidence';
    if (apply) {
      try {
        if (order.state === 'paid') {
          const settlement = await deps.stripe.readSettlement(order);
          if (settlement) await deps.store.saveSettlement(order.id, order.tenant, settlement);
          action = settlement ? 'fee-details-saved' : 'fee-details-pending';
        } else action = await reconcileOrder(order, deps);
      } catch {
        // Preserve persisted state for retry and omit provider and database error details.
        action = 'failed';
      }
    }
    results.push({ orderId: order.id, state, action });
  }
  return results;
}

export async function runReconciliation(deps: PaymentDeps, apply: boolean, write = console.log): Promise<number> {
  const results = await reconcileMarketplacePayments(deps, apply);
  write(JSON.stringify(results));
  return results.some(result => result.action === 'failed') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const { apply } = parseReconcileArgs(process.argv.slice(2));
    return runReconciliation(createPaymentDeps(), apply);
  }).then(code => { process.exitCode = code; }).catch(() => { console.error('Payment reconciliation stopped. Review owned orders and retry; no replacement key or timer release is permitted.'); process.exitCode = 1; });
}
