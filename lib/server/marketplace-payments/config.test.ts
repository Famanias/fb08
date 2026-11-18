import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentConfig, getPaymentContext } from './config';
import { createPaymentDeps } from './dependencies';

const env = { MARKETPLACE_PAYMENTS_ENABLED: 'true', MARKETPLACE_PAYMENT_TENANT: 'preview-test', MARKETPLACE_APP_ORIGIN: 'https://market.example.invalid', MARKETPLACE_STRIPE_ACCOUNT_COUNTRY: 'US', STRIPE_SECRET_KEY: 'sk_test_fixture', NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', AUTH_SESSION_SECRET: 'fictional-test-session-secret-32-characters' };
test('config_rejects_live_or_missing_configuration', () => {
  assert.equal(getPaymentConfig({}).enabled, false);
  assert.throws(() => getPaymentConfig({ MARKETPLACE_PAYMENTS_ENABLED: 'true' }));
  assert.deepEqual(getPaymentConfig(env), { tenant: 'preview-test', origin: 'https://market.example.invalid', enabled: true, country: 'US', secretKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture' });
  for (const key of Object.keys(env)) {
    const missing = { ...env }; delete missing[key as keyof typeof missing];
    if (key !== 'MARKETPLACE_PAYMENTS_ENABLED') assert.throws(() => getPaymentConfig(missing), e => e instanceof Error && !e.message.includes('fixture'));
  }
  for (const override of [{ STRIPE_SECRET_KEY: 'sk_live_private' }, { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_private' }, { MARKETPLACE_APP_ORIGIN: 'http://market.example.invalid' }, { MARKETPLACE_APP_ORIGIN: 'https://market.example.invalid/path' }, { MARKETPLACE_APP_ORIGIN: 'https://user:password@market.example.invalid' }, { MARKETPLACE_STRIPE_ACCOUNT_COUNTRY: 'ZZZ' }, { MARKETPLACE_PAYMENTS_ENABLED: 'yes' }]) assert.throws(() => getPaymentConfig({ ...env, ...override }));
  assert.equal(getPaymentConfig({ ...env, MARKETPLACE_APP_ORIGIN: 'http://localhost:3000' }).origin, 'http://localhost:3000');
});
test('existing payment context does not require enabled purchases or email credentials', () => {
  assert.deepEqual(getPaymentContext({ MARKETPLACE_PAYMENT_TENANT: 'preview-test', MARKETPLACE_APP_ORIGIN: env.MARKETPLACE_APP_ORIGIN }), { tenant: 'preview-test', origin: env.MARKETPLACE_APP_ORIGIN, enabled: false });
});
test('dependency context contains only nonsecret operation context', () => {
  const values = { ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-test-only' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { assert.deepEqual(createPaymentDeps(true).context, { tenant: 'preview-test', origin: 'https://market.example.invalid', enabled: true }); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
