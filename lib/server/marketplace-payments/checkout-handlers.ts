import type { PaymentDeps, StoredOrder } from './contracts';
import type { CheckoutLaunch } from '../../../features/marketplace/payments/types';
import { MarketplaceError, validUuid } from '../../../features/marketplace/validation';
import { jsonResponse, readCookieValue } from '../route-helpers';
import { createPaymentDeps } from './dependencies';
import { refreshKnownAccount } from './connect-handlers';
import { capabilityCookie, capabilityCookieName, newCapability, proofHash, validCapability } from './proof';
import { assertPaymentOrigin, paymentErrorResponse, readPaymentJson } from './request';
import { STRIPE_API_VERSION, assertCheckoutUrl } from './stripe-gateway';

// Stripe now uses dynamic payment methods. Keep card as the only payment rail
// and hide Link separately, because Stripe handles it as a wallet.
const excludedPaymentMethods = [
  'acss_debit', 'affirm', 'afterpay_clearpay', 'alipay', 'alma', 'amazon_pay',
  'au_becs_debit', 'bacs_debit', 'bancontact', 'billie', 'bizum', 'blik', 'boleto',
  'cashapp', 'crypto', 'customer_balance', 'eps', 'fpx', 'giropay', 'grabpay',
  'ideal', 'kakao_pay', 'klarna', 'konbini', 'kr_card', 'mb_way', 'mobilepay',
  'multibanco', 'naver_pay', 'nz_bank_account', 'oxxo', 'p24', 'pay_by_bank',
  'payco', 'paynow', 'paypal', 'paypay', 'payto', 'pix', 'promptpay', 'revolut_pay',
  'samsung_pay', 'satispay', 'scalapay', 'sepa_debit', 'sequra', 'sofort', 'sunbit',
  'swish', 'twint', 'upi', 'us_bank_account', 'wechat_pay', 'zip',
];

function unavailable(): never { throw new MarketplaceError('Payments unavailable.', 503); }
function secure(deps: PaymentDeps) { return new URL(deps.context.origin).protocol === 'https:'; }
function buyerToken(req: Request, deps: PaymentDeps) { return readCookieValue(req, capabilityCookieName('buyer', secure(deps))); }
async function rate(req: Request, deps: PaymentDeps, action: string) {
  // Only the trusted deployment proxy may supply a client IP; local callers share a budget.
  const ip = process.env.VERCEL ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local';
  const actor = proofHash('browser', JSON.stringify(['ip', deps.context.tenant, ip]), deps.secret);
  if (!await deps.store.consumeRate(actor, action, 20)) throw new MarketplaceError('Too many attempts.', 429);
}
function buyerProof(req: Request, deps: PaymentDeps): { accessHash: string } | null {
  const token = buyerToken(req, deps);
  return validCapability(token) ? { accessHash: proofHash('buyer-session', token, deps.secret) } : null;
}
export function requireBuyer(req: Request, deps: PaymentDeps): { accessHash: string } {
  const buyer = buyerProof(req, deps);
  if (!buyer) throw new MarketplaceError('Start a buyer session.', 401);
  return buyer;
}
function checkoutError(error: unknown): Response {
  if (error instanceof MarketplaceError && error.status === 401) return jsonResponse({ error: 'Start a buyer session to continue.' }, 401);
  if (error instanceof MarketplaceError && error.status === 400) return jsonResponse({ error: 'Invalid payment request.' }, 400);
  if (error instanceof MarketplaceError && error.status === 404) return paymentErrorResponse(new MarketplaceError('Item unavailable.', 409));
  return paymentErrorResponse(error);
}
export async function handleBuyerSession(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = injected ?? createPaymentDeps(true);
    if (!deps.context.enabled) unavailable();
    assertPaymentOrigin(req, deps.context);
    if (Object.keys(await readPaymentJson(req)).length) throw new MarketplaceError('Invalid request.');
    await rate(req, deps, 'payment-buyer-session-ip');
    const previous = buyerToken(req, deps); const token = validCapability(previous) ? previous : newCapability(deps.randomBytes);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': capabilityCookie('buyer', token, 7 * 86400, secure(deps)) } });
  } catch (error) { return checkoutError(error); }
}

export async function ensureCheckout(order: StoredOrder, deps: PaymentDeps): Promise<CheckoutLaunch> {
  if (order.tenant !== deps.context.tenant || !validUuid(order.id) || !validUuid(order.listingId)) unavailable();
  const metadata = { fb08_app: 'marketplace-payments-v1', tenant: order.tenant, order_id: order.id, listing_id: order.listingId };
  const orderUrl = `${deps.context.origin}/marketplace/orders/${order.id}`;
  const expiredCheckout = { orderId: order.id, url: orderUrl, expired: true } as const;
  if (order.state === 'expired') return expiredCheckout;
  // prepareCheckout returns the first persisted snapshot on retries, including across deployments.
  const prepared = await deps.store.prepareCheckout({ orderId: order.id, tenant: order.tenant, apiVersion: STRIPE_API_VERSION, params: {
    mode: 'payment', excluded_payment_method_types: excludedPaymentMethods,
    wallet_options: { link: { display: 'never' } },
    client_reference_id: order.id, expires_at: order.checkoutExpiresAt, metadata,
    line_items: [{ quantity: 1, price_data: { currency: 'php', unit_amount: order.grossMinor, product_data: { name: order.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Sandbox item' } } }],
    payment_intent_data: { application_fee_amount: order.feeMinor, metadata },
    success_url: orderUrl, cancel_url: `${deps.context.origin}/marketplace/${order.listingId}`,
    automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false }, allow_promotion_codes: false, after_expiration: { recovery: { enabled: false } },
  } });
  if (prepared.state === 'expired') return expiredCheckout;
  if (prepared.state === 'paid' || prepared.state === 'review') return { orderId: order.id, url: orderUrl };
  let sessionId = prepared.sessionId;
  if (!sessionId) {
    if (!deps.context.enabled) unavailable();
    const age = +deps.now() - Date.parse(prepared.preparedAt);
    if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600000 || prepared.checkoutExpiresAt - +deps.now() / 1000 < 1800) unavailable();
    // The reservation is already committed. Only its winner refreshes, avoiding account-lease contention between buyers.
    const account = await deps.store.findAccountById(prepared.accountId, prepared.tenant);
    if (!account || account.sellerId !== prepared.sellerId || !(await refreshKnownAccount(account, deps)).ready) unavailable();
    // Readiness HTTP/lock waits can consume the last safe seconds of the unchanged expiry.
    if (prepared.checkoutExpiresAt - +deps.now() / 1000 < 1800 || +deps.now() - Date.parse(prepared.preparedAt) >= 23 * 3600000) unavailable();
    sessionId = (await deps.stripe.createCheckout(prepared)).sessionId;
  }
  const canonical = await deps.stripe.readCheckout(prepared, sessionId);
  const attached = await deps.store.attachSession(order.id, prepared.tenant, canonical);
  if (attached.state === 'expired') return expiredCheckout;
  if (attached.state !== 'open' || attached.sessionId !== canonical.sessionId || canonical.status !== 'open' || canonical.paymentStatus !== 'unpaid') return { orderId: order.id, url: orderUrl };
  if (!canonical.url) unavailable();
  assertCheckoutUrl(canonical.url);
  return { orderId: order.id, url: canonical.url };
}

export async function handleCheckout(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = injected ?? createPaymentDeps(true);
    if (!deps.context.enabled) unavailable();
    assertPaymentOrigin(req, deps.context);
    const body = await readPaymentJson(req);
    const resumeOnly = body.resumeOnly === true;
    const key = req.headers.get('idempotency-key');
    if (!validUuid(body.listingId) || Object.keys(body).length !== (resumeOnly ? 2 : 1) || !validUuid(key)) throw new MarketplaceError('Invalid request.');
    const buyer = resumeOnly ? buyerProof(req, deps) : requireBuyer(req, deps);
    await rate(req, deps, 'payment-checkout-ip');
    if (!buyer) throw new MarketplaceError('Item unavailable.', 409);
    const identity = { listingId: body.listingId, tenant: deps.context.tenant, buyerAccessHash: buyer.accessHash, submissionKey: key };
    // A reserved page can outlive its hold. A resume click never creates a reservation.
    const order = resumeOnly ? await deps.store.findCheckoutReservation(identity) : await deps.store.reserve({ ...identity, now: deps.now() });
    if (!order) throw new MarketplaceError('Item unavailable.', 409);
    return jsonResponse(await ensureCheckout(order, deps), 201);
  } catch (error) { return checkoutError(error); }
}
