import Stripe from 'stripe';
import type { StripeGateway, StoredOrder } from './contracts';
import { validUuid } from '../../../features/marketplace/validation';

// Official stripe@23.1.0 (Node >=20). Keep snapshot webhook version identical.
export const STRIPE_API_VERSION = '2026-10-28.endive' satisfies Stripe.LatestApiVersion;
export type OnboardingSdk = {
  accounts: {
    create(params: Stripe.AccountCreateParams, options: Stripe.RequestOptions): Promise<Stripe.Account>;
    retrieve(id: string, params: Stripe.AccountRetrieveParams, options: Stripe.RequestOptions): Promise<Stripe.Account | Stripe.DeletedAccount>;
  };
  accountLinks: { create(params: Stripe.AccountLinkCreateParams, options: Stripe.RequestOptions): Promise<Stripe.AccountLink> };
};
export type PaymentSdk = OnboardingSdk & {
  checkout: { sessions: {
    create(params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions): Promise<Stripe.Checkout.Session>;
    expire(id: string, params: Stripe.Checkout.SessionExpireParams, options: Stripe.RequestOptions): Promise<Stripe.Checkout.Session>;
    retrieve(id: string, params: Stripe.Checkout.SessionRetrieveParams, options: Stripe.RequestOptions): Promise<Stripe.Checkout.Session>;
  } };
  charges: { retrieve(id: string, params: Stripe.ChargeRetrieveParams, options: Stripe.RequestOptions): Promise<Stripe.Charge> };
  balanceTransactions: { retrieve(id: string, params: Stripe.BalanceTransactionRetrieveParams, options: Stripe.RequestOptions): Promise<Stripe.BalanceTransaction> };
  paymentIntents: { cancel(id: string, params: Stripe.PaymentIntentCancelParams, options: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>; retrieve(id: string, params: Stripe.PaymentIntentRetrieveParams, options: Stripe.RequestOptions): Promise<Stripe.PaymentIntent> };
};
const bounded = { timeout: 5000, maxNetworkRetries: 1 };
function accountId(value: string) { if (!/^acct_[A-Za-z0-9]{1,100}$/.test(value)) throw new Error('Account unavailable.'); }
export function assertCheckoutUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw new Error('Checkout unavailable.');
}
export function createStripeGateway(config: { secretKey: string; tenant: string; country: string; origin: string; webhookSecret?: string }, injected?: PaymentSdk, now: () => Date = () => new Date()): StripeGateway {
  // Lazy: status/logout can construct dependencies without Stripe/email settings.
  let sdk = injected;
  function client(): PaymentSdk {
    if (!/^sk_test_[A-Za-z0-9]+$/.test(config.secretKey) || !/^[A-Z]{2}$/.test(config.country)) throw new Error('Payment configuration unavailable.');
    return sdk ??= new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, ...bounded });
  }
  function checkoutOptions(order: StoredOrder): Stripe.RequestOptions {
    accountId(order.accountId);
    if (order.tenant !== config.tenant || !validUuid(order.id) || !validUuid(order.listingId) || !order.stripeApiVersion || order.stripeApiVersion.length > 100) throw new Error('Checkout unavailable.');
    return { ...bounded, stripeAccount: order.accountId, apiVersion: order.stripeApiVersion };
  }
  return {
    async ensureAccount(seller, createKey) {
      if (seller.tenant !== config.tenant || !validUuid(seller.id) || !createKey || createKey.length > 255) throw new Error('Account unavailable.');
      const account = await client().accounts.create({ country: config.country, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } }, capabilities: { card_payments: { requested: true } }, metadata: { fb08_app: 'marketplace-payments-v1', tenant: config.tenant, seller_id: seller.id } }, { ...bounded, idempotencyKey: createKey });
      accountId(account.id);
      if (account.metadata?.fb08_app !== 'marketplace-payments-v1' || account.metadata.tenant !== config.tenant || account.metadata.seller_id !== seller.id) throw new Error('Account unavailable.');
      return { accountId: account.id };
    },
    async readAccount(id) {
      accountId(id); const account = await client().accounts.retrieve(id, {}, bounded); const checkedAt = now().toISOString();
      if ('deleted' in account && account.deleted) return { accountId: id, ready: false, connection: 'restricted', metadata: {}, checkedAt };
      const a = account as Stripe.Account; const r = a.requirements; const c = a.controller; const metadata = a.metadata ?? {};
      const attributed = a.id === id && metadata.fb08_app === 'marketplace-payments-v1' && metadata.tenant === config.tenant && validUuid(metadata.seller_id);
      const controller = c?.fees?.payer === 'account' && c.losses?.payments === 'stripe' && c.requirement_collection === 'stripe' && c.stripe_dashboard?.type === 'full';
      const clear = !!r && !r.disabled_reason && r.currently_due?.length === 0 && r.past_due?.length === 0 && r.pending_verification?.length === 0 && r.errors?.length === 0;
      const ready = attributed && controller && a.country === config.country && a.details_submitted === true && a.charges_enabled === true && a.payouts_enabled === true && a.capabilities?.card_payments === 'active' && clear;
      return { accountId: id, ready, connection: ready ? 'ready' : (!attributed || !controller || a.country !== config.country || !!r?.disabled_reason ? 'restricted' : 'pending'), metadata, checkedAt };
    },
    async onboardingLink(id, origin) {
      accountId(id); if (origin !== config.origin) throw new Error('Account unavailable.');
      const link = await client().accountLinks.create({ account: id, type: 'account_onboarding', return_url: `${origin}/marketplace/payments/return`, refresh_url: `${origin}/marketplace/payments/refresh` }, bounded);
      const url = new URL(link.url); if (url.protocol !== 'https:' || url.hostname !== 'connect.stripe.com' || url.port || url.username || url.password) throw new Error('Account unavailable.');
      return { url: link.url };
    },
    async createCheckout(order) {
      const options = checkoutOptions(order);
      if (!order.createParams || order.createKey !== `${order.tenant}:checkout:${order.id}:v1` || order.createKey.length > 255) throw new Error('Checkout unavailable.');
      // The strict database validator owns this immutable JSON snapshot. Do not rebuild it here.
      const session = await client().checkout.sessions.create(order.createParams as Stripe.Checkout.SessionCreateParams, { ...options, idempotencyKey: order.createKey });
      if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(session.id) || session.livemode !== false || !session.url) throw new Error('Checkout unavailable.');
      assertCheckoutUrl(session.url);
      return { sessionId: session.id, url: session.url };
    },
    async expireCheckout(order) {
      const options = checkoutOptions(order);
      let canonical = await this.readCheckout(order);
      if (canonical.status === 'open') {
        try { await client().checkout.sessions.expire(canonical.sessionId, {}, options); }
        catch (error) {
          // A concurrent completion can make expire fail. Re-read before deciding.
          canonical = await this.readCheckout(order);
          if (canonical.status === 'open') throw error;
        }
        canonical = await this.readCheckout(order);
      }
      // Checkout-owned intents allow direct cancellation only in requires_capture.
      // Expiration handles other cancellable states; processing/unknown remains held.
      if (canonical.status === 'expired' && canonical.paymentStatus === 'unpaid' && canonical.paymentIntentId && canonical.intentStatus === 'requires_capture') {
        try { await client().paymentIntents.cancel(canonical.paymentIntentId, { cancellation_reason: 'abandoned' }, options); }
        catch (error) {
          canonical = await this.readCheckout(order);
          if (canonical.intentStatus === 'requires_capture') throw error;
        }
        canonical = await this.readCheckout(order);
      }
      return canonical;
    },
    async readSettlement(order) {
      const options = checkoutOptions(order);
      const id = order.paymentIntentId;
      if (!id) return null;
      if (!/^pi_[A-Za-z0-9_]{1,200}$/.test(id)) throw new Error('Settlement unavailable.');
      const intent = await client().paymentIntents.retrieve(id, {}, options);
      if (intent.id !== id || intent.status !== 'succeeded') return null;
      const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
      if (!chargeId) return null;
      if (!/^ch_[A-Za-z0-9_]{1,200}$/.test(chargeId)) throw new Error('Settlement unavailable.');
      const charge = await client().charges.retrieve(chargeId, {}, options);
      const chargeIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (charge.id !== chargeId || chargeIntent !== id || charge.livemode !== false || !charge.paid) return null;
      const balanceId = typeof charge.balance_transaction === 'string' ? charge.balance_transaction : charge.balance_transaction?.id;
      if (!balanceId) return null;
      if (!/^txn_[A-Za-z0-9_]{1,200}$/.test(balanceId)) throw new Error('Settlement unavailable.');
      const balance = await client().balanceTransactions.retrieve(balanceId, {}, options);
      const sourceId = typeof balance.source === 'string' ? balance.source : balance.source?.id;
      if (sourceId !== chargeId) return null;
      const amounts = [balance.amount, balance.fee, balance.net];
      if (balance.id !== balanceId || !/^[a-z]{3}$/.test(balance.currency) || !amounts.every(Number.isSafeInteger) || balance.amount < 0 || balance.fee < 0 || balance.amount - balance.fee !== balance.net || !Array.isArray(balance.fee_details)) return null;
      let applicationFeeMinor = 0; let stripeFeeMinor = 0; let otherFeeMinor = 0;
      for (const fee of balance.fee_details) {
        if (fee.currency !== balance.currency || !Number.isSafeInteger(fee.amount) || fee.amount < 0) return null;
        if (fee.type === 'application_fee') applicationFeeMinor += fee.amount;
        else if (fee.type === 'stripe_fee') stripeFeeMinor += fee.amount;
        else if (['payment_method_passthrough_fee', 'tax', 'withheld_tax', 'stripe_fx_fee'].includes(fee.type)) otherFeeMinor += fee.amount;
        else return null;
      }
      if (applicationFeeMinor + stripeFeeMinor + otherFeeMinor !== balance.fee) return null;
      if (balance.currency === order.currency && (balance.amount !== order.grossMinor || applicationFeeMinor !== order.feeMinor)) return null;
      return { currency: balance.currency, grossMinor: balance.amount, applicationFeeMinor, stripeFeeMinor, otherFeeMinor, netMinor: balance.net };
    },
    verifyEvent(raw, signature) {
      if (!config.webhookSecret || !/^whsec_[A-Za-z0-9]+$/.test(config.webhookSecret)) throw new Error('Webhook unavailable.');
      const event = Stripe.webhooks.constructEvent(raw, signature, config.webhookSecret);
      if (!/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id)) throw new Error('Webhook unavailable.');
      const object = event.data.object as unknown as { id?: unknown; metadata?: Record<string, unknown> };
      const metadata: Record<string, string> = {};
      for (const key of ['fb08_app', 'tenant', 'seller_id', 'order_id', 'listing_id']) {
        const value = object.metadata?.[key]; if (typeof value === 'string' && value.length <= 255) metadata[key] = value;
      }
      return { id: event.id, type: event.type, accountId: event.account ?? null, livemode: event.livemode, objectId: typeof object.id === 'string' ? object.id : '', metadata };
    },
    async readCheckout(order, requestedId) {
      const options = checkoutOptions(order); const id = requestedId ?? order.sessionId;
      if (!id || !/^cs_[A-Za-z0-9_]{1,200}$/.test(id)) throw new Error('Checkout unavailable.');
      const session = await client().checkout.sessions.retrieve(id, { expand: ['line_items', 'payment_intent'] }, options);
      if (session.id !== id || !['open', 'complete', 'expired'].includes(session.status ?? '')) throw new Error('Checkout unavailable.');
      let intent: Stripe.PaymentIntent | null = null;
      if (typeof session.payment_intent === 'string') {
        if (!/^pi_[A-Za-z0-9_]{1,200}$/.test(session.payment_intent)) throw new Error('Checkout unavailable.');
        intent = await client().paymentIntents.retrieve(session.payment_intent, {}, options);
        if (intent.id !== session.payment_intent) throw new Error('Checkout unavailable.');
      } else { intent = session.payment_intent; }
      if (intent && !/^pi_[A-Za-z0-9_]{1,200}$/.test(intent.id)) throw new Error('Checkout unavailable.');
      if (session.url) assertCheckoutUrl(session.url);
      const items = session.line_items;
      // Never accept a truncated or absent list as the one fixed purchased item.
      const itemQuantity = items && items.has_more === false && Array.isArray(items.data) && items.data.length === 1 ? items.data[0]?.quantity : null;
      const quantity = typeof itemQuantity === 'number' && Number.isSafeInteger(itemQuantity) && itemQuantity > 0 ? itemQuantity : 0;
      return { sessionId: session.id, accountId: order.accountId, paymentIntentId: intent?.id ?? null, status: session.status as 'open' | 'complete' | 'expired', paymentStatus: session.payment_status, intentStatus: intent?.status ?? null, livemode: session.livemode || intent?.livemode === true, currency: session.currency, grossMinor: session.amount_total, feeMinor: intent?.application_fee_amount ?? null, quantity, intentAmountReceivedMinor: intent?.amount_received ?? null, intentCurrency: intent?.currency ?? null, url: session.url, expiresAt: session.expires_at, clientReferenceId: session.client_reference_id, metadata: session.metadata ?? {}, intentMetadata: intent?.metadata ?? {} };
    },
  };
}
