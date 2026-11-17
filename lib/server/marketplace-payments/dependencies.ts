import { randomBytes } from 'node:crypto';
import type { PaymentDeps } from './contracts';
import { getPaymentContext, getPaymentConfig } from './config';
import { createPaymentStore } from './store';
import { createSellerMailer } from './seller-mailer';
import { createStripeGateway } from './stripe-gateway';

export function createPaymentDeps(newPayments = false): PaymentDeps {
  const config = newPayments ? getPaymentConfig(process.env) : getPaymentContext(process.env);
  const context = { tenant: config.tenant, origin: config.origin, enabled: config.enabled };
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Payment configuration unavailable.');
  return { context, secret, store: createPaymentStore(), mailer: createSellerMailer(), stripe: createStripeGateway({ ...context, secretKey: process.env.STRIPE_SECRET_KEY ?? '', country: process.env.MARKETPLACE_STRIPE_ACCOUNT_COUNTRY ?? '' }), now: () => new Date(), randomBytes };
}
