import type { PaymentDeps, VerifiedPaymentEvent } from './contracts';
import { validUuid } from '../../../features/marketplace/validation';
import { createPaymentDeps } from './dependencies';
import { refreshKnownAccount } from './connect-handlers';
import { reconcileOrder } from './reconcile';

const maxBytes = 1024 * 1024;
function response(status: number) { return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function rawBody(req: Request): Promise<Buffer | null> {
  if (Number(req.headers.get('content-length')) > maxBytes) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) return Buffer.concat(chunks);
      size += value.byteLength; if (size > maxBytes) { await reader.cancel(); return null; } chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}
export async function handleStripeWebhook(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const raw = await rawBody(req); if (!raw) return response(413);
    const signature = req.headers.get('stripe-signature'); if (!signature) return response(400);
    const deps = injected ?? createPaymentDeps(); let event: VerifiedPaymentEvent;
    try { event = deps.stripe.verifyEvent(raw, signature); } catch { return response(400); }
    if (event.livemode || !['checkout.session.completed', 'checkout.session.expired', 'account.updated'].includes(event.type) || !event.accountId || !/^acct_[A-Za-z0-9]{1,100}$/.test(event.accountId) || event.metadata.fb08_app !== 'marketplace-payments-v1' || event.metadata.tenant !== deps.context.tenant) return response(200);
    const account = await deps.store.findAccountById(event.accountId, deps.context.tenant); if (!account) return response(200);
    if (event.type === 'account.updated') {
      if (event.objectId !== account.accountId || event.metadata.seller_id !== account.sellerId) return response(200);
      await refreshKnownAccount(account, deps); return response(200);
    }
    if (!validUuid(event.metadata.order_id) || !/^cs_[A-Za-z0-9_]{1,200}$/.test(event.objectId)) return response(200);
    const order = await deps.store.findOrder(event.metadata.order_id, deps.context.tenant);
    if (!order || order.accountId !== account.accountId || order.sellerId !== account.sellerId) return response(200);
    await reconcileOrder(order, deps, { id: event.id, type: event.type, sessionId: event.objectId });
    return response(200);
  } catch { return response(503); }
}
