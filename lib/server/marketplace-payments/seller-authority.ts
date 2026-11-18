import type { PaymentDeps, SellerIdentity } from './contracts';
import { MarketplaceError } from '../../../features/marketplace/validation';
import { readCookieValue } from '../route-helpers';
import { capabilityCookieName, proofHash, validCapability } from './proof';

export async function requireSeller(req: Request, deps: PaymentDeps): Promise<SellerIdentity> {
  const secure = new URL(deps.context.origin).protocol === 'https:';
  const capability = readCookieValue(req, capabilityCookieName('seller', secure));
  if (!validCapability(capability)) throw new MarketplaceError('Verify seller email.', 401);
  const seller = await deps.store.findSellerSession(proofHash('seller-session', capability, deps.secret), deps.context.tenant, deps.now());
  if (!seller || seller.tenant !== deps.context.tenant) throw new MarketplaceError('Verify seller email.', 401);
  return seller;
}
