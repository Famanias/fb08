import type { PaymentDeps, SellerAccount } from './contracts';
import { MarketplaceError } from '../../../features/marketplace/validation';
import { jsonResponse } from '../route-helpers';
import { createPaymentDeps } from './dependencies';
import { requireSeller } from './seller-authority';
import { proofHash } from './proof';
import { assertPaymentOrigin, paymentErrorResponse, readPaymentJson } from './request';

function unavailable(): never { throw new MarketplaceError('Payments temporarily unavailable.', 503); }
export async function refreshKnownAccount(account: SellerAccount, deps: PaymentDeps): Promise<SellerAccount> {
  const tenant = deps.context.tenant; const leaseId = deps.randomBytes(32).toString('hex');
  if (!await deps.store.acquireAccountRefresh(account.accountId, tenant, leaseId)) unavailable();
  let canonical;
  try { canonical = await deps.stripe.readAccount(account.accountId); }
  catch {
    await deps.store.saveAccountReadiness(account.accountId, tenant, leaseId, { ready: false, connection: 'restricted' }, deps.now().toISOString());
    unavailable();
  }
  const matches = canonical.accountId === account.accountId && canonical.metadata.fb08_app === 'marketplace-payments-v1' && canonical.metadata.tenant === tenant && canonical.metadata.seller_id === account.sellerId;
  const readiness = { ready: matches && canonical.ready, connection: matches ? canonical.connection : 'restricted' as const };
  if (!await deps.store.saveAccountReadiness(account.accountId, tenant, leaseId, readiness, canonical.checkedAt)) unavailable();
  return { ...account, ...readiness, checkedAt: canonical.checkedAt };
}
async function onboarding(req: Request, injected: PaymentDeps | undefined, refresh: boolean): Promise<Response> {
  try {
    const deps = injected ?? createPaymentDeps(true);
    if (!deps.context.enabled) unavailable();
    assertPaymentOrigin(req, deps.context); const body = await readPaymentJson(req);
    const seller = await requireSeller(req, deps);
    if (Object.keys(body).length) throw new MarketplaceError('Invalid request.');
    const actor = proofHash('browser', JSON.stringify(['connect', deps.context.tenant, seller.id]), deps.secret);
    if (!await deps.store.consumeRate(actor, 'payment-connect-seller', 20)) throw new MarketplaceError('Too many attempts.', 429);
    let account = await deps.store.findSellerAccount(seller.id, deps.context.tenant);
    if (!account) {
      if (refresh) unavailable();
      const slot = await deps.store.ensureSellerAccountSlot(seller.id, deps.context.tenant);
      let id = slot.accountId;
      if (!id) {
        const age = +deps.now() - Date.parse(slot.preparedAt);
        if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600000) unavailable();
        id = (await deps.stripe.ensureAccount(seller, slot.accountCreateKey)).accountId;
        await deps.store.saveSellerAccount(seller.id, deps.context.tenant, id, slot.accountCreateKey);
      }
      account = await deps.store.findSellerAccount(seller.id, deps.context.tenant);
      if (!account || account.accountId !== id) unavailable();
    }
    return jsonResponse(await deps.stripe.onboardingLink(account.accountId, deps.context.origin));
  } catch (error) { return paymentErrorResponse(error); }
}
export const handleConnect = (req: Request, deps?: PaymentDeps) => onboarding(req, deps, false);
export const handleConnectRefresh = (req: Request, deps?: PaymentDeps) => onboarding(req, deps, true);
