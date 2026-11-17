import type { PaymentDeps } from './contracts';
import { createPaymentDeps } from './dependencies';
import { requireBuyer } from './checkout-handlers';
import { validUuid } from '../../../features/marketplace/validation';
import { jsonResponse } from '../route-helpers';

export async function handleOrderStatus(req: Request, injected?: PaymentDeps): Promise<Response> {
  const headers = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
  const missing = () => jsonResponse({ error: 'Order unavailable. Use the browser where you started this order; access expires after seven days.' }, 404, headers);
  const id = new URL(req.url).pathname.split('/').pop();
  if (!validUuid(id)) return missing();
  try {
    // Existing order authority is independent of the new-purchase switch and provider readiness.
    const deps = injected ?? createPaymentDeps();
    let accessHash: string;
    try { accessHash = requireBuyer(req, deps).accessHash; } catch { return missing(); }
    const order = await deps.store.getOrderConfirmation(id, accessHash, deps.context.tenant, deps.now());
    return order ? jsonResponse(order, 200, headers) : missing();
  } catch { return jsonResponse({ error: 'Could not read order status. Please refresh.' }, 503, headers); }
}
