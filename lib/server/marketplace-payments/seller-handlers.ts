import type { SellerPaymentStatus } from '../../../features/marketplace/payments/types';
import { MarketplaceError } from '../../../features/marketplace/validation';
import { jsonResponse } from '../route-helpers';
import { refreshKnownAccount } from './connect-handlers';
import type { PaymentDeps } from './contracts';
import { createPaymentDeps } from './dependencies';
import { paymentErrorResponse } from './request';
import { requireSeller } from './seller-authority';

export async function handleSellerStatus(req: Request, injected?: PaymentDeps): Promise<Response> {
  try {
    const deps = injected ?? createPaymentDeps();
    const status = (connection: SellerPaymentStatus['connection']) =>
      jsonResponse({ connection, paymentsEnabled: deps.context.enabled } satisfies SellerPaymentStatus);
    let seller;
    try {
      seller = await requireSeller(req, deps);
    } catch (error) {
      if (error instanceof MarketplaceError && error.status === 401) return status('sign_in_required');
      if (error instanceof MarketplaceError && error.status === 409) return status('listing_required');
      throw error;
    }
    const account = await deps.store.findSellerAccount(seller.id, deps.context.tenant);
    if (account) {
      const age = +deps.now() - Date.parse(account.checkedAt);
      const current = !Number.isFinite(age) || age < 0 || age > 60000
        ? await refreshKnownAccount(account, deps)
        : account;
      return status(current.connection);
    }
    return status(await deps.store.findSellerConnection(seller.id, deps.context.tenant) ?? 'not_connected');
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
