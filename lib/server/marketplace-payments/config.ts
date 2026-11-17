import type { PaymentContext } from './contracts';

function unavailable(): never { throw new Error('Payment configuration unavailable.'); }
export function getPaymentContext(env: Partial<NodeJS.ProcessEnv>): PaymentContext {
  if (env.MARKETPLACE_PAYMENTS_ENABLED && !['true', 'false'].includes(env.MARKETPLACE_PAYMENTS_ENABLED)) unavailable();
  const tenant = env.MARKETPLACE_PAYMENT_TENANT; const origin = env.MARKETPLACE_APP_ORIGIN;
  if (!tenant || !/^[a-zA-Z0-9_-]{1,100}$/.test(tenant) || !origin) unavailable();
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) unavailable();
  } catch { unavailable(); }
  return { tenant, origin, enabled: env.MARKETPLACE_PAYMENTS_ENABLED === 'true' };
}
export function getStripeConfig(env: Partial<NodeJS.ProcessEnv>): { secretKey: string; country: string } {
  const secretKey = env.STRIPE_SECRET_KEY; const country = env.MARKETPLACE_STRIPE_ACCOUNT_COUNTRY;
  if (!secretKey || !/^sk_test_[A-Za-z0-9]+$/.test(secretKey) || !country || !/^[A-Z]{2}$/.test(country)) unavailable();
  return { secretKey, country };
}
export function getPaymentConfig(env: Partial<NodeJS.ProcessEnv>): PaymentContext & { country: string; secretKey: string; webhookSecret: string } {
  // Disabled default leaves ordinary Marketplace usable with no payment settings.
  if (!env.MARKETPLACE_PAYMENTS_ENABLED || env.MARKETPLACE_PAYMENTS_ENABLED === 'false') return { tenant: '', origin: '', enabled: false, country: '', secretKey: '', webhookSecret: '' };
  const context = getPaymentContext(env); const stripe = getStripeConfig(env);
  if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || !/^pk_test_[A-Za-z0-9]+$/.test(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    || !env.STRIPE_WEBHOOK_SECRET || !/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET)
    || !env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32
    || !env.RESEND_API_KEY || !/^re_[A-Za-z0-9_-]+$/.test(env.RESEND_API_KEY)
    || !env.MARKETPLACE_SELLER_EMAIL_FROM || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.MARKETPLACE_SELLER_EMAIL_FROM)
    || env.MARKETPLACE_SELLER_EMAIL_FROM !== env.MARKETPLACE_SELLER_EMAIL_FROM.trim().toLowerCase()
    || env.MARKETPLACE_SELLER_EMAIL_FROM.endsWith('.invalid') || env.MARKETPLACE_SELLER_EMAIL_FROM.endsWith('@resend.dev')) unavailable();
  return { ...context, ...stripe, webhookSecret: env.STRIPE_WEBHOOK_SECRET };
}
