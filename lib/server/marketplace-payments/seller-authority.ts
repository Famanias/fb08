import type { PaymentDeps, SellerIdentity } from './contracts';
import { MarketplaceError } from '../../../features/marketplace/validation';
export async function requireSeller(req: Request, deps: PaymentDeps): Promise<SellerIdentity> {
  const user = await deps.authenticateUser(req);
  if (!user) throw new MarketplaceError('Sign in to fb/08 to manage payments.', 401);
  const seller = await deps.store.findSellerForUser(user.id, deps.context.tenant);
  if (!seller || seller.tenant !== deps.context.tenant) throw new MarketplaceError('Create a sandbox listing to connect Stripe.', 409);
  return seller;
}
