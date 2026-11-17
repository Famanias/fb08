import Stripe from 'stripe';
import type { OnboardingStripeGateway } from './contracts';
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
const bounded = { timeout: 5000, maxNetworkRetries: 1 };
function accountId(value: string) { if (!/^acct_[A-Za-z0-9]{1,100}$/.test(value)) throw new Error('Account unavailable.'); }
export function createStripeGateway(config: { secretKey: string; tenant: string; country: string; origin: string }, injected?: OnboardingSdk, now: () => Date = () => new Date()): OnboardingStripeGateway {
  // Lazy: status/logout can construct dependencies without Stripe/email settings.
  let sdk = injected;
  function client(): OnboardingSdk {
    if (!/^sk_test_[A-Za-z0-9]+$/.test(config.secretKey) || !/^[A-Z]{2}$/.test(config.country)) throw new Error('Payment configuration unavailable.');
    return sdk ??= new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, ...bounded });
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
      const url = new URL(link.url); if (url.protocol !== 'https:' || url.hostname !== 'connect.stripe.com' || url.username || url.password) throw new Error('Account unavailable.');
      return { url: link.url };
    },
  };
}
