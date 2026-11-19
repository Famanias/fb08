// Private server contracts. Never import these from client components.
import type { OrderConfirmation, PublicPaymentState } from '../../../features/marketplace/payments/types';
export type PaymentContext = { tenant: string; origin: string; enabled: boolean };
export type OrderState = 'preparing' | 'open' | 'paid' | 'expired' | 'review';
export type SellerIdentity = { id: string; tenant: string };
export type SellerAccount = {
  sellerId: string; accountId: string; ready: boolean;
  connection: 'pending' | 'ready' | 'restricted'; checkedAt: string; accountCreateKey: string;
};
export type PendingSellerAccount = { sellerId: string; accountId: string | null; accountCreateKey: string; preparedAt: string };
export type StoredOrder = {
  id: string; tenant: string; listingId: string; sellerId: string;
  accountId: string; buyerAccessHash: string; readExpiresAt: string;
  submissionKey: string; state: OrderState; title: string;
  grossMinor: number; feeMinor: number; currency: 'php'; livemode: false;
  sessionId: string | null; paymentIntentId: string | null;
  createKey: string; checkoutExpiresAt: number; preparedAt: string;
  stripeApiVersion: string | null; createParams: Record<string, unknown> | null;
};
export type PreparedOrder = StoredOrder & { stripeApiVersion: string; createParams: Record<string, unknown> };
export type CanonicalCheckout = {
  sessionId: string; accountId: string; paymentIntentId: string | null;
  status: 'open' | 'complete' | 'expired'; paymentStatus: string;
  intentStatus: string | null; livemode: boolean; currency: string | null;
  grossMinor: number | null; feeMinor: number | null; quantity: number;
  intentAmountReceivedMinor: number | null; intentCurrency: string | null;
  url: string | null; expiresAt: number; clientReferenceId: string | null;
  metadata: Record<string, string>; intentMetadata: Record<string, string>;
};
export type Settlement = { currency: string; grossMinor: number; applicationFeeMinor: number; stripeFeeMinor: number; otherFeeMinor: number; netMinor: number };
export type AccountReadiness = { accountId: string; ready: boolean; connection: 'pending' | 'ready' | 'restricted'; metadata: Record<string, string>; checkedAt: string };
export type VerifiedPaymentEvent = { id: string; type: string; accountId: string | null; livemode: boolean; objectId: string; metadata: Record<string, string> };
export interface StripeGateway {
  ensureAccount(seller: SellerIdentity, createKey: string): Promise<{ accountId: string }>;
  readAccount(accountId: string): Promise<AccountReadiness>;
  onboardingLink(accountId: string, origin: string): Promise<{ url: string }>;
  createCheckout(order: PreparedOrder): Promise<{ sessionId: string; url: string }>;
  readCheckout(order: StoredOrder, sessionId?: string): Promise<CanonicalCheckout>;
  expireCheckout(order: StoredOrder): Promise<CanonicalCheckout>;
  readSettlement(order: StoredOrder): Promise<Settlement | null>;
  verifyEvent(raw: Buffer, signature: string): VerifiedPaymentEvent;
}
export type OnboardingStripeGateway = Pick<StripeGateway, 'ensureAccount' | 'readAccount' | 'onboardingLink'>;
export type CheckoutStripeGateway = OnboardingStripeGateway & Pick<StripeGateway, 'createCheckout' | 'readCheckout'>;
export type PaymentDeps = {
  store: PaymentStore; stripe: StripeGateway; context: PaymentContext; secret: string;
  authenticateUser: (req: Request) => Promise<{ id: string } | null>;
  now: () => Date; randomBytes: (size: number) => Buffer;
};
type CheckoutReservation = { listingId: string; buyerAccessHash: string; submissionKey: string; tenant: string };
export interface PaymentStore {
  getPublicPaymentStates(listingIds: string[], context: PaymentContext): Promise<Record<string, PublicPaymentState>>;
  findListingPaymentAccount(listingId: string, context: PaymentContext): Promise<SellerAccount | null>;
  getOrderConfirmation(orderId: string, buyerHash: string, tenant: string, now: Date): Promise<OrderConfirmation | null>;
  consumeRate(actor: string, action: string, limit: number): Promise<boolean>;
  findSellerForUser(userId: string, tenant: string): Promise<SellerIdentity | null>;
  findSellerAccount(sellerId: string, tenant: string): Promise<SellerAccount | null>;
  ensureSellerAccountSlot(sellerId: string, tenant: string): Promise<PendingSellerAccount>;
  saveSellerAccount(sellerId: string, tenant: string, accountId: string, createKey: string): Promise<void>;
  findAccountById(accountId: string, tenant: string): Promise<SellerAccount | null>;
  acquireAccountRefresh(accountId: string, tenant: string, leaseId: string): Promise<boolean>;
  saveAccountReadiness(accountId: string, tenant: string, leaseId: string, readiness: Pick<AccountReadiness, 'ready' | 'connection'>, checkedAt: string): Promise<boolean>;
  findSellerConnection(sellerId: string, tenant: string): Promise<'pending' | 'ready' | 'restricted' | null>;
  reserve(input: CheckoutReservation & { now: Date }): Promise<StoredOrder>;
  findCheckoutReservation(input: CheckoutReservation): Promise<StoredOrder | null>;
  prepareCheckout(input: { orderId: string; tenant: string; params: Record<string, unknown>; apiVersion: string }): Promise<PreparedOrder>;
  attachSession(orderId: string, tenant: string, canonical: CanonicalCheckout): Promise<StoredOrder>;
  findOrder(orderId: string, tenant: string): Promise<StoredOrder | null>;
  applyCheckout(input: { orderId: string; tenant: string; eventId: string; eventType: string; canonical: CanonicalCheckout; now: Date }): Promise<'paid' | 'expired' | 'held' | 'duplicate' | 'review'>;
  saveSettlement(orderId: string, tenant: string, settlement: Settlement): Promise<void>;
  findInventory(listingId: string, tenant: string): Promise<{ listingId: string; inventoryKind: 'ordinary' | 'demo' | 'sandbox'; status: 'active' | 'sold' | 'removed' } | null>;
  inspectInventory(listingId: string, tenant: string): Promise<{ listingId: string; inventoryKind: string; status: string; priceMinor: number; orderIds: string[] } | null>;
  findPaidWebhookReceipt(orderId: string, tenant: string): Promise<{ eventId: string; eventType: 'checkout.session.completed' } | null>;
  listReconciliationOrders(tenant: string): Promise<StoredOrder[]>;
}
