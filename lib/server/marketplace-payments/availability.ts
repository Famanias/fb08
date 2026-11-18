import type { PublicPaymentState } from '../../../features/marketplace/payments/types';
import type { PaymentDeps } from './contracts';
import { createPaymentDeps } from './dependencies';
import { refreshKnownAccount } from './connect-handlers';

export async function getListingPaymentState(listingId: string, sandbox: boolean, injected?: PaymentDeps): Promise<PublicPaymentState> {
  const fallback: PublicPaymentState = { sandbox, availability: 'unavailable' };
  try {
    const deps = injected ?? createPaymentDeps(true);
    let state = (await deps.store.getPublicPaymentStates([listingId], deps.context))[listingId] ?? fallback;
    if (!deps.context.enabled || !sandbox || state.availability !== 'unavailable') return state;
    // This private, tenant-scoped mapping excludes review-frozen, removed and held inventory.
    const account = await deps.store.findListingPaymentAccount(listingId, deps.context);
    if (!account) return state;
    const age = +deps.now() - Date.parse(account.checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > 60000) {
      await refreshKnownAccount(account, deps);
      state = (await deps.store.getPublicPaymentStates([listingId], deps.context))[listingId] ?? fallback;
    }
    return state;
  } catch { return fallback; }
}
