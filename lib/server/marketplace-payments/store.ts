import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../supabase-admin';
import { MarketplaceError } from '../../../features/marketplace/validation';
import type { PaymentStore, PreparedOrder, StoredOrder } from './contracts';

function checked(error: { message: string } | null) {
  if (!error) return;
  if (/request_conflict|reservation_conflict/.test(error.message)) throw new MarketplaceError('This item or submission is already reserved.', 409);
  if (/listing_unavailable|order_unavailable/.test(error.message)) throw new MarketplaceError('Item or order unavailable.', 404);
  if (/seller_unavailable|amount_ineligible/.test(error.message)) throw new MarketplaceError('Payments are unavailable for this item.', 409);
  throw new MarketplaceError('Payments are temporarily unavailable.', 503);
}
function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new MarketplaceError('Payments are temporarily unavailable.', 503);
  return result;
}
export function storedOrder(row: Record<string, unknown>): StoredOrder {
  return {
    id: String(row.id), tenant: String(row.tenant), listingId: String(row.listing_id), sellerId: String(row.seller_id),
    accountId: String(row.account_id), buyerAccessHash: String(row.buyer_access_hash), readExpiresAt: String(row.read_expires_at),
    submissionKey: String(row.submission_key), state: row.state as StoredOrder['state'], title: String(row.title),
    grossMinor: integer(row.gross_minor), feeMinor: integer(row.fee_minor), currency: 'php', livemode: false,
    sessionId: row.session_id as string | null, paymentIntentId: row.payment_intent_id as string | null,
    createKey: String(row.create_key), checkoutExpiresAt: integer(row.checkout_expires_at), preparedAt: String(row.prepared_at),
    stripeApiVersion: row.stripe_api_version as string | null, createParams: row.create_params as Record<string, unknown> | null,
  };
}
export function createPaymentStore(db: SupabaseClient = getSupabaseAdminClient()): PaymentStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args); checked(error); return data;
  }
  return {
    async consumeRate(actor, action, limit) { return await rpc('marketplace_consume_rate', { p_actor: actor, p_action: action, p_limit: limit }) === true; },
    async findSeller(emailNormalized, tenant) {
      const { data, error } = await db.from('marketplace_payment_sellers').select('id,email_normalized,tenant').eq('tenant', tenant).eq('email_normalized', emailNormalized).maybeSingle(); checked(error);
      return data ? { id: data.id, emailNormalized: data.email_normalized, tenant: data.tenant } : null;
    },
    async reserve(input) { return storedOrder(await rpc('marketplace_reserve_order', { p_tenant: input.tenant, p_listing_id: input.listingId, p_buyer_hash: input.buyerAccessHash, p_key: input.submissionKey, p_now: input.now.toISOString() })); },
    async prepareCheckout(input) {
      const order = storedOrder(await rpc('marketplace_prepare_checkout', { p_tenant: input.tenant, p_order_id: input.orderId, p_params: input.params, p_api_version: input.apiVersion }));
      if (!order.createParams || !order.stripeApiVersion) throw new MarketplaceError('Could not prepare payment.', 503);
      return order as PreparedOrder;
    },
    async attachSession(orderId, tenant, canonical) { return storedOrder(await rpc('marketplace_attach_checkout', { p_tenant: tenant, p_order_id: orderId, p_checkout: canonical })); },
    async findOrder(orderId, tenant) {
      const { data, error } = await db.from('marketplace_orders').select('*').eq('id', orderId).eq('tenant', tenant).maybeSingle(); checked(error); return data ? storedOrder(data) : null;
    },
    async applyCheckout(input) {
      const result = await rpc('marketplace_apply_checkout', { p_tenant: input.tenant, p_order_id: input.orderId, p_event_id: input.eventId, p_event_type: input.eventType, p_checkout: input.canonical, p_now: input.now.toISOString() });
      if (!['paid', 'expired', 'held', 'duplicate', 'review'].includes(result)) throw new MarketplaceError('Could not confirm payment.', 503);
      return result;
    },
    async saveSettlement(orderId, tenant, settlement) {
      for (const amount of [settlement.grossMinor, settlement.applicationFeeMinor, settlement.stripeFeeMinor, settlement.otherFeeMinor, settlement.netMinor]) integer(amount);
      const { error } = await db.from('marketplace_orders').update({ settlement }).eq('id', orderId).eq('tenant', tenant).eq('state', 'paid'); checked(error);
    },
    async findInventory(listingId, tenant) {
      const { data: binding, error } = await db.from('marketplace_payment_inventory').select('listing_id').eq('listing_id', listingId).eq('tenant', tenant).maybeSingle(); checked(error);
      if (!binding) return null;
      const { data, error: listingError } = await db.from('marketplace_listings').select('id,inventory_kind,status').eq('id', listingId).maybeSingle(); checked(listingError);
      return data ? { listingId: data.id, inventoryKind: data.inventory_kind, status: data.status } : null;
    },
    async findPaidWebhookReceipt(orderId, tenant) {
      const { data, error } = await db.from('marketplace_stripe_events').select('event_id,event_type').eq('order_id', orderId).eq('tenant', tenant).eq('event_type', 'checkout.session.completed').eq('outcome', 'paid').eq('source', 'webhook').order('created_at').limit(1).maybeSingle(); checked(error);
      return data ? { eventId: data.event_id, eventType: 'checkout.session.completed' } : null;
    },
    async listReconciliationOrders(tenant) {
      // Paginate to avoid silently dropping holds past PostgREST's row limit.
      const result: StoredOrder[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from('marketplace_orders').select('*').eq('tenant', tenant).or('state.in.(preparing,open,review),and(state.eq.paid,settlement.is.null)').order('id').range(offset, offset + 499); checked(error);
        result.push(...(data ?? []).map(storedOrder));
        if (!data || data.length < 500) return result;
      }
    },
  };
}
