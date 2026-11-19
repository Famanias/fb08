# Launch fb/08 Marketplace sandbox payments on Vercel

The launch target is **public hosting with Stripe sandbox payments** at `https://fb08.vercel.app/marketplace`. Money movement is simulated. The implementation requires `pk_test_` and `sk_test_` keys and limits purchases to fictional sandbox listings. A real-money launch would require a separately scoped change and review. [Stripe sandbox testing](https://docs.stripe.com/testing)

## Rollout status on November 19, 2026

**Preview completed an end-to-end sandbox purchase. Public sandbox payments remain disabled pending approval and Production configuration.**

| Area | Completed and verified |
| --- | --- |
| Production release | The existing Vercel project `fb08` serves `Famanias/fb08` from `main` at `8da7243a2478643cd2e0580fb5eaba03971c24c4`. The current deployment, `fb08-mdwsmqzf3-team-e2117dad.vercel.app`, is the pre-enablement Vercel recovery point. Payments are disabled by default in this build. |
| Hosted database | All seven payment migrations in [step 3](#3-apply-the-payment-migrations-to-the-authorized-supabase-target) are recorded as applied in the shared Supabase project. Verified tenant-scoped ownership, private tables, and service-only Checkout, publication and account-slot RPCs. The seventh migration's internal commit applied it during a planned rollback check, with Preview purchasing paused. The installed function matched the reviewed file, and the standalone rollback assertions passed before the ledger was recorded. The encrypted pre-ownership backup and the prior Checkout function definition are under `%LOCALAPPDATA%\fb08\marketplace-recovery`. A restore drill remains pending. |
| Existing Marketplace | The public listing detail changed from HTTP `500` to `200` after the schema update. The feed and image loaded, and Board, People, and session check routes returned `200`. The exact-manifest classifier verified 21 demo listings and zero missing fixtures after classification. Demos are inquiry-only. |
| Preview deployment | `Famanias/stripe-connect-payments-plan` at `1bc52f31c1671d6b6bf679bff2c4e9e87cbd7577` deployed as `dpl_GootQpYtgjrtVoBooqyPydonkCj3`. Payments are enabled in tenant `fb08-stripe-preview`. The disabled Preview recovery deployment is `dpl_DqiGNQQ3CZ1MyGRTFbaiVXkMvHb7`. A Vercel Deployment Protection Exception applies to the stable branch domain. |
| Hosted Preview smoke test | Before enablement, a guest received `401` for sandbox publication, a signed-in seller published a listing scoped to that account, and another account saw its own listing-required status. Ordinary Marketplace, image upload, inquiries, Board, People, and session checks also passed. The verifier cleaned up its temporary fixtures. |
| Preview Stripe setup | Preview uses the project owner's personal Stripe sandbox. Stripe reported `US` and lists PHP as a supported charge currency. The active Preview destination is a Connected accounts Snapshot subscription with the pinned API version. Its signing secret is configured on the Preview branch. The previous own-account subscription was disabled. |
| Stripe onboarding | A signed-in fb/08 seller published fictional inventory and completed Stripe-hosted US sandbox onboarding in Brave. Stripe reported active card payments, enabled charges and payouts, and no outstanding requirements. A connected-account update refreshed the app's seller status to ready. |
| Checkout compatibility | Stripe rejected a Checkout request using `payment_method_types`. Its original reservation and request remain recorded without a Stripe session, and its listing was retired. New sessions use Stripe's dynamic payment methods with non-card methods excluded and Link hidden. The app verifies the returned configuration before giving the buyer the Checkout URL. [Stripe Checkout Session parameters](https://docs.stripe.com/api/checkout/sessions/create) |
| Paid purchase and webhook | A guest in a private Brave window paid **₱1,234.50** with a Stripe test card. The verified direct charge included a **₱123.45** platform fee and **₱1,111.05** before processing fees. Stripe's USD settlement showed **$19.39 gross**, **$1.94 platform fee**, **$1.05 processing fee** and **$16.40 net**. Stripe's automatic `checkout.session.completed` delivery received HTTP `200` at 00:40 UTC. The read-only verifier confirmed the succeeded payment, one paid order, the signed receipt, Sold status and settlement fees. The buyer saw **Sandbox payment confirmed**. The [Sold listing](https://fb08-git-famanias-stripe-connect-payments-plan-team-e2117dad.vercel.app/marketplace/647bc59c-b52b-4c38-b68a-b6e0cf5f2404) still opens and is absent from the active feed. |
| Checkout privacy and concurrency | The paid order page and API returned `404` without the buyer cookie. Concurrent guest requests produced one `201` and one `409`. The winning guest resumed the same Stripe session. An automatic `checkout.session.expired` delivery released that unpaid hold, and the fixture was retired. A signed replay of the Stripe-retrieved completion event returned `200` and left the sale and receipt unchanged. |
| Production preflight | The public Marketplace, listing details and images, Board, People, and session reads passed. All seven migrations are applied and the private tables and RPCs remain restricted. The public site still serves `8da7243` and needs its own payment environment settings and Connect webhook. The 21 demo listings remain inquiry-only. |
| Code and regression checks | The Checkout revision passed 139 tests, lint, typecheck, a production build and the hosted rollback-only SQL assertions for the installed function. The hosted smoke test passed Marketplace publication and image upload, browsing, detail, inquiries, privacy, Board, People and auth. It removed its temporary fixtures. |
| Dependency audit | The installed Next.js version includes a transitive PostCSS dependency with high-severity advisories involving untrusted CSS input. Review and update the dependency in a separately tested change. [PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849) |

**Stable Preview origin** is `https://fb08-git-famanias-stripe-connect-payments-plan-team-e2117dad.vercel.app`.

### Remaining work

1. After the owner approves cutover, deploy the tested revision to Production with payments disabled. Configure tenant `fb08-stripe-production`, the public origin, the authorized sandbox keys, and a separate Production webhook and signing secret. Verify reachability and run the disabled smoke checks. See [step 6](#6-release-to-the-public-site-after-preview-passes).
2. Enable the Production switch and redeploy. Create a new production-tenant fictional listing and complete a separate seller connection and sandbox purchase on the public origin. Verify its signed paid receipt, Sold status, and private confirmation.

The assessment asks candidates to use its supplied sandbox keys. The project owner's sandbox is configured for Preview testing. Confirm with the assessor before submitting evidence generated with that sandbox. [Assessment instructions](https://tremendous-tiger-a4a.notion.site/Test-4-Stripe-Connect-41400bbdfc3b80a2909add50ab807591)

## 1. What you provide and what your agent does

| You or the account owner | Your agent, once it has access and authorization |
| --- | --- |
| Identify the existing `fb08` project in Vercel, its GitHub repo `Famanias/fb08`, the intended Supabase project, and the person who can authorize any production changes. | Confirm project IDs, repository, commit, domains, environment scopes, database migration history, and recovery point. Prepare the preview and report its exact origin. |
| Provide the assessor’s **matching publishable and secret sandbox keys**, or have the assessor install them in the project. Confirm who can register a Connect webhook in that sandbox. | Verify sandbox identity and Connect permissions through the authorized account or credentials. Confirm the permitted connected-account country and verify PHP direct charges and the application fee in preview. |
| Use a dedicated fb/08 test account for seller acceptance. | Sign in, publish fictional listings, and verify that Stripe setup is scoped to that account and Preview tenant. |
| Enter private values into the hosting dashboard or the approved secret manager. Complete any dashboard sign-in or Stripe-hosted test fields your agent cannot access. | Install environment configuration where authorized, register only the app’s endpoints, apply the exact migrations, redeploy, run acceptance, and collect redacted evidence. |
| Authorize the public cutover after reviewing preview evidence. Submit the assessment yourself if required. | Present the preview result, exact production commit and rollback point. After authorization, deploy, run public-site smoke tests and supply submission materials. |

Use fictional identity, banking, and buyer details for the Stripe test. Share private credentials through secure configuration.

If you have only the two Stripe keys, you still need the ability to register a Connect webhook. The webhook signing secret becomes available after the endpoint is created. If the assessor owns the shared dashboard and the key lacks endpoint permissions, send them the exact endpoint requirements from step 4 and have them enter the endpoint secret directly into the matching Vercel environment.

## 2. Identify the release and choose a preview origin

- [x] Confirmed the deployed Preview and Production revisions both contain `133e5a8a1928888e89c8b964a14f8d9bf2e64dad`. Record the deployed SHA again after each redeploy.
- [x] Confirmed the existing `fb08` project in Vercel, the `Famanias/fb08` Git association, the `main` Production Branch, and the `fb08.vercel.app` domain. The recovery deployment is recorded above.
- [x] Selected and verified a stable HTTPS branch alias. Use the same origin for review, fb/08 sessions, Checkout return URLs, and the Preview webhook.
- [x] Selected `fb08-stripe-preview` and `fb08-stripe-production`. Preview uses its namespace now. Configure the latter at Production cutover. Each environment uses its own endpoint signing secret, connected accounts, listings, and orders.
- [x] Confirmed Preview and Production use the existing shared Supabase project with the required baseline and Storage. Use only Preview-tenant fictional inventory during Preview acceptance.

For a fresh checkout, `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` reproduce code checks. The optional disposable local integration and privacy commands are in the [technical runbook](MARKETPLACE_PAYMENTS.md#reproducible-local-verification). An earlier local result shows the code works under those fixtures. Preview supplies the provider evidence. [Vercel environments](https://vercel.com/docs/environment-variables) · [Vercel domains and aliases](https://vercel.com/docs/cli/alias)

## 3. Apply the payment migrations to the authorized Supabase target

**All seven versions are applied to the shared Supabase project.** If deploying to another Supabase target, confirm that it has the Board user table, Marketplace baseline, and Storage setup before applying the payment migrations.

1. In the Supabase Dashboard, confirm the exact project reference and compare it to the Vercel Supabase URL. Identify a recent recoverable backup or arrange an approved backup. Use the project’s authenticated migration access. The app’s `SUPABASE_SERVICE_ROLE_KEY` is for server data operations and does not supply SQL migration credentials.
2. Inspect the remote schema and migration history through the exact selected target. Confirm the two original Marketplace migrations and image Storage setup already exist. Confirm which payment migrations, if any, are recorded and which objects exist. Compare any preexisting objects with the reviewed files before deciding what to apply. A schema/history mismatch requires diagnosis before writes.
3. Apply the missing files **in this order**, using the project’s tracked migration workflow if its preview lists exactly these unapplied changes. The repo’s older Board migration history can differ from the linked project. Do not bulk-push or reset that history. If the normal workflow would replay unrelated files, have the database operator execute the exact files one at a time with error-stop and record those exact applied versions in the migration ledger after verifying the SQL. A history entry alone does not apply SQL.

| Order | File | Adds |
| --- | --- | --- |
| 1 | [20261117004434_marketplace_payments.sql](../supabase/migrations/20261117004434_marketplace_payments.sql) | Inventory classification, tenant binding, private seller and order tables |
| 2 | [20261117004437_marketplace_payment_functions.sql](../supabase/migrations/20261117004437_marketplace_payment_functions.sql) | Publication, verification, readiness, reservation, and fulfillment functions in one transaction |
| 3 | [20261117095439_marketplace_payment_reconciliation.sql](../supabase/migrations/20261117095439_marketplace_payment_reconciliation.sql) | Delayed payment handling, review safeguards, and reconciliation |
| 4 | [20261117102524_marketplace_payment_presentation.sql](../supabase/migrations/20261117102524_marketplace_payment_presentation.sql) | Sold detail visibility, availability, and private order reads |
| 5 | [20261118151539_marketplace_account_sellers.sql](../supabase/migrations/20261118151539_marketplace_account_sellers.sql) | Signed-in seller ownership, atomic listing binding, and account-scoped Checkout |
| 6 | [20261118223225_marketplace_connect_v2_account_creation.sql](../supabase/migrations/20261118223225_marketplace_connect_v2_account_creation.sql) | Accounts v2 creation slots for new sellers |
| 7 | [20261119002749_marketplace_dynamic_card_checkout.sql](../supabase/migrations/20261119002749_marketplace_dynamic_card_checkout.sql) | Validation for dynamic card Checkout and preservation of prior request snapshots |

For the exact-file route, one possible agent command is `psql -X -v ON_ERROR_STOP=1 -f <reviewed-file>` after validating the connection and configuring the target securely through libpq settings or a connection profile. Use Supabase’s direct connection or session pooler as appropriate. Apply only a reviewed, unapplied file each time and stop at the first error. Check the installed CLI’s `--help` if using it for history or migration operations because CLI v2 and v3 use different targeting flags. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Migration tracking](https://supabase.com/docs/guides/deployment/database-migrations) · [Backups](https://supabase.com/docs/guides/platform/backups)

4. Verify the schema, required RLS and grants, and private-table/RPC access restrictions with authorized checks before enabling payments. Anonymous callers should see only the allowed public listing fields. They must be unable to read seller contacts, challenges, connected-account records and orders or execute payment write RPCs. Repeat the ordinary listing, image, inquiry and Board/People smoke checks after deploying with the switch off. If the schema or grants differ, keep payments disabled and report the exact failure.
5. On the approved database containing the original 21 stock demos, run the classifier in inspection mode first. Review the exact manifest results. Apply only if the IDs and immutable fields agree, including private contact and image path. Repeat the inspection to verify classification. Demos remain inquiry-only and keep their existing photos and contacts. For an empty staging database, record the expected absent fixtures and create new QA listings through the app. Do not seed or reclassify unrelated rows.

```sh
# Run from the repo with the authorized database's server configuration in ignored .env.local.
node --env-file=.env.local --import=tsx scripts/classify-marketplace-demos.ts
# After inspecting the exact manifest and obtaining authorization for this target:
node --env-file=.env.local --import=tsx scripts/classify-marketplace-demos.ts --apply
```

## 4. Configure Vercel and register the preview webhook

The existing Supabase and session variables are present in both Vercel environments. Preview has the Marketplace and Stripe settings for the project owner's sandbox. Set the Production values separately at cutover. A Vercel environment change requires a new deployment to take effect. [Vercel environment configuration](https://vercel.com/docs/environment-variables)

| Variable | Where it comes from and what to enter |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Approved target’s project API URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same project’s public publishable key. Existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the legacy fallback. |
| `SUPABASE_SERVICE_ROLE_KEY` | Same project’s server-only service role credential used by the app. |
| `AUTH_SESSION_SECRET` | Existing server-side session/HMAC secret. Payments require at least 32 characters. Preserve the configured value if valid. If shorter, plan rotation with the owner because it can invalidate existing sessions, buyer proofs, and idempotent retries. |
| `MARKETPLACE_PAYMENT_TENANT` | Stable distinct namespace from step 2, containing only letters, digits, `_`, or `-`. |
| `MARKETPLACE_APP_ORIGIN` | Exact stable browser origin. For production use `https://fb08.vercel.app`. Exclude the trailing slash, path, and query string. |
| `MARKETPLACE_STRIPE_ACCOUNT_COUNTRY` | Uppercase two-letter country confirmed for the assessor’s sandbox and chosen Connect configuration. PHP pricing alone does not determine the country. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | The assessor’s `pk_test_` publishable key. The app validates it even though hosted redirects need no browser Stripe SDK. |
| `STRIPE_SECRET_KEY` | The assessor’s matching `sk_test_` key, server-only. |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_` signing secret for this exact environment’s endpoint. Enter it privately after registering the endpoint below. |
| `MARKETPLACE_PAYMENTS_ENABLED` | `false` initially. Set `true` on Preview after the preflight and webhook setup below. Set `true` on Production only at the approved cutover. |

Stripe’s dashboard credentials, the endpoint signing secret, Supabase service role, and session secret stay out of public code, support messages, screenshots, shell history and terminal output. The Stripe publishable key and Supabase public configuration are suitable for the browser. Do not use the `MARKETPLACE_TEST_*` variables on Vercel. They belong to the disposable local test harness.

**Preview preflight and endpoint setup**

1. Verify the selected sandbox can create Accounts v2 merchants with a full Dashboard and `card_payments`, issue Stripe-hosted account links, and retrieve the v1 readiness representation. Account creation uses `2026-11-18.endive`. The Checkout and snapshot webhook API uses `2026-10-28.endive`. Verify PHP direct charges and fees in step 5. [Stripe Accounts compatibility](https://docs.stripe.com/connect/accounts-v2/migrate-integration#use-v2-accounts-in-v1-endpoints) · [Stripe country specifications](https://docs.stripe.com/api/country_specs)
2. Deploy the account-based seller revision as a **Preview** with the switch off after applying its migration. Use the stable origin for all browser tests and redeploy the same branch after changing environment variables. [Vercel deploy command](https://vercel.com/docs/cli/deploy)
3. The stable Preview domain exception is active. An unsigned POST to `https://fb08-git-famanias-stripe-connect-payments-plan-team-e2117dad.vercel.app/api/marketplace/stripe/webhook` reached the handler and returned `400`. Use that exact HTTPS destination when registering in Stripe. [Vercel Deployment Protection Exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)
4. In the selected sandbox, create a **Connected accounts** destination with **Snapshot** payloads and API version **`2026-10-28.endive`**. For API setup, use `stripe.v2.core.eventDestinations.create` with `events_from: ['@accounts']`, `event_payload: 'snapshot'`, `snapshot_api_version` set to the pinned version, and the three enabled events below. Request `webhook_endpoint.signing_secret` in `include` and save it directly to secure configuration. Verify that the destination reports `@accounts` before reuse. Inspect only this app's exact HTTPS destination. [Stripe event destination parameters](https://docs.stripe.com/api/v2/core/event-destinations/create)

   - `account.updated`
   - `checkout.session.completed`
   - `checkout.session.expired`

5. Put this endpoint’s signing secret into Preview as `STRIPE_WEBHOOK_SECRET`. Redeploy with payments still off if you want to verify the route before enabling. An unsigned POST that reaches the app should return `400`. A `404`, redirect, or Vercel access challenge means Stripe cannot yet reach the handler. An unsigned probe verifies reachability only. The real completion event verifies signature and processing.
6. Set Preview `MARKETPLACE_PAYMENTS_ENABLED=true` after the configuration, schema, endpoint, and access preflight passes. Redeploy the same commit at the stable preview origin. This enables the QA flow for seller sign-in and Stripe compatibility before Production.

For the unsigned reachability check, substitute the selected host and run from outside the Vercel session. Use `curl.exe` on Windows PowerShell if `curl` resolves to a PowerShell alias. The expected app response is HTTP `400` with no Stripe signature supplied.

```sh
curl -i -X POST 'https://preview-origin.example/api/marketplace/stripe/webhook' -H 'Content-Type: application/json' -d '{}'
```

## 5. Prove the purchase in preview

The completed purchase and the reservation, replay, privacy and regression checks are recorded in the [November 19 rollout status](#rollout-status-on-november-19-2026). Use this checklist when retesting a new deployment or tenant.

- [ ] **Create two sandbox listings.** Sign in to fb/08, then visit `/marketplace/new`. Use fictional items, a non-sensitive image, a fictional inquiry address, and the checkbox **This is a fictional sandbox listing: no real money or delivery**. Price one item at **₱1,234.50**. Keep an ordinary listing and a demo available to verify they have no Buy Now. Ordinary listings and the original demos remain inquiry-only.
- [ ] **Connect Stripe as the signed-in seller.** On `/marketplace/payments`, click **Connect with Stripe** and complete test onboarding with fictional details. Return and use **Check status**. Confirm both listings from that account show Buy Now after the connection becomes ready. Check that another account using the same inquiry address has separate ownership. [Stripe Connect test onboarding data](https://docs.stripe.com/connect/testing.md?accounts-namespace=v1)
- [ ] **Pay from a separate buyer browser or profile.** Open the listing at the configured preview origin and click **Buy Now**. Confirm hosted Stripe Checkout shows PHP, quantity one and the exact listing price. Enter `4242 4242 4242 4242`, a future expiration date and any valid three-digit CVC in Stripe Checkout. Keep the same buyer browser on return. [Stripe test cards](https://docs.stripe.com/testing)
- [ ] **Confirm the connected charge and fee.** Verify the charge belongs to the locally recorded connected account. For ₱1,234.50, the gross is `123450` centavos and the application fee is `12345` centavos (₱123.45). The seller remainder before processing is `111105` centavos (₱1,111.05). Confirm actual simulated fee details and net from the connected charge’s balance transaction when available. If the settlement currency differs, report both currencies as provided. If fee data hasn’t arrived, record it as pending. No real payout occurs. [Stripe direct charges and fees](https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted)
- [ ] **Prove the webhook did the work.** The return may initially say **Payment confirmation pending**. Confirm Stripe delivered the owned `checkout.session.completed` event to this endpoint and got `200`. Confirm a paid webhook receipt, one paid private Supabase order, and the correct sandbox listing marked Sold. The buyer page must show **Sandbox payment confirmed** after the persisted update. Confirm the Sold detail URL still opens and the item is absent from the active feed. Do not mark a row paid by hand to pass this check.
- [ ] **Test access and concurrency.** Open the order URL in another browser without the buyer cookie and verify it cannot read the order. Check that two different buyers competing for the other item cannot both start independent payable sessions. The owning tab should be able to resume an existing reserved order after a cancel or reload. Cancel alone leaves a hold. Replay only an event from an owned fixture and verify it does not duplicate the sale. Confirm ordinary/demo listing counts and legitimate inventory effects are unchanged.
- [ ] **Run regressions.** Verify ordinary creation and photo upload, feed filtering, detail, private inquiries, and Board/People/profile/sign-in. If using `test:marketplace:live`, remember it writes and cleans up its own temporary listing. Use it only against an explicitly authorized target with the URL provided; the payment verifier below is read-only.

The authorized agent can confirm the exact paid order without opening a privileged public route. Use an ignored `.env.local` in an operator checkout with the preview tenant/origin and matching provider/DB configuration. Replace the two example arguments with the actual preview origin and the private UUID of the owned QA order. Keep that UUID out of public notes.

```sh
npm run test:marketplace:payments:verify -- --base https://preview-origin.example --order-id 00000000-0000-4000-8000-000000000000
```

Expected report fields are `paid: true`, `sold: true`, `webhookConfirmed: true`, and `feeDetails: "confirmed"` or `"pending"`. The verifier privately checks the connected Stripe objects and Supabase association. It does not confirm an unsigned redirect or repair a missing receipt. Capture a redacted acceptance record with the deploy SHA, preview origin, seller sign-in and onboarding result, Checkout amount, application fee, signed delivery/receipt, and fee status. If any required check fails, report it and keep Production disabled.

## 6. Release to the public site after preview passes

1. Review preview evidence, the exact release commit, and the recovery point with the owner. Confirm which Git or CLI action will deploy to the existing production project before merging the branch. If production uses a separate database, repeat step 3 there before serving the new code. If it shares the already migrated database, verify its schema/history and skip applied files.
2. Add the Production values from the environment table. Use `https://fb08.vercel.app`, the distinct production tenant, and `MARKETPLACE_PAYMENTS_ENABLED=false`. Deploy the tested revision to the existing production project. Check ordinary Marketplace, Board and People. Check that an unsigned POST reaches the app at the public endpoint.
3. Register or verify the separate **production-domain endpoint inside the same authorized Stripe sandbox**:

   ```text
   https://fb08.vercel.app/api/marketplace/stripe/webhook
   ```

   Use the same Connect/snapshot/API version/events from step 4. Put this endpoint’s signing secret in **Production**. Preview and Stripe CLI signing secrets are different. Redeploy after saving the values.
4. Once the owner authorizes enablement, set Production `MARKETPLACE_PAYMENTS_ENABLED=true` and redeploy the verified revision. Use new production-tenant fictional listings. Repeat seller sign-in, account-owned publication, test onboarding, Buy Now, Checkout, signed paid receipt, Sold listing and buyer confirmation checks on the public origin. Run the verifier using production-specific configuration. All Stripe calls remain in the sandbox.
5. Deliver the public Marketplace URL, GitHub repo URL, tested SHA, and sanitized onboarding, Checkout, confirmation and private-row evidence. Redact contact details, access identifiers, account IDs, test secrets and proofs. Keep raw payloads, cookies, order URLs and provider exports private. If submitting the assessment, prepare the material for `apply.capm.us`, choice **4) Stripe Connect**. Submission is manual.

## 7. Diagnose failures and pause safely

| Symptom | First checks |
| --- | --- |
| Buy Now never appears | Verify the active deployment SHA and its env scope, the switch, exact origin, and the listing’s sandbox classification, tenant, and recorded owner. Check the owner’s Stripe account configuration and readiness. |
| Seller payments asks you to sign in or publish a listing | Check the fb/08 session at the stable site origin. Sign in through the Board account panel, then publish a new sandbox listing from that account. Preexisting sandbox listings without an owner stay inquiry-only. |
| Onboarding returns but stays pending | Use **Check status** and inspect the owned sandbox account’s details, charge and payout flags, `card_payments`, controller, requirements and country. Returning to the site alone does not activate the account. Resolve the concrete Stripe limitation with the assessor before switching countries, keys, or account model. |
| Stripe delivery fails | A redirect or authentication response points to URL/protection. A `400` for a real Stripe delivery points to signature or request handling. Check the endpoint-specific signing secret, deployment revision and redeploy status. A `503` can come from missing configuration, provider retrieval or the database. Inspect sanitized errors for this app’s event and retry that event through the existing endpoint. |
| Stripe gets `200` but order stays pending | Other candidates’ signed events may receive a successful no-op. Verify this event belongs to the correct sandbox, connected account, environment tenant, order and session. Check canonical currency, amount, quantity and fee. An owned unsettled or mismatched event may leave a hold. Inspect before changing inventory. |
| Buyer cannot reopen confirmation | Use the originating browser, same site origin and unexpired proof. An order UUID alone provides no access. A failed competing buyer can occasionally see a stale Resume button after reload. The server rejects it without creating a new hold or contacting Stripe. |
| Need to stop new orders | Set `MARKETPLACE_PAYMENTS_ENABLED=false` on the affected Vercel environment and redeploy. Preserve the endpoint, signing secret, tenant and schema so existing signed events, order reads and reconciliation can finish. Before rolling back to a revision without the webhook route, reconcile outstanding orders or keep a compatible webhook-serving deployment. Retain payment and receipt history. |

For stuck orders, inspect before applying recovery. The operator reconciler is dry-run by default and applies only with `--apply` against the selected tenant. A per-order failure leaves that order for investigation while independent orders continue. Never create a replacement Checkout key, release an uncertain hold by time alone, or modify another candidate’s records. See [operator recovery details](MARKETPLACE_PAYMENTS.md#operator-inspection-classification-and-recovery).

## Copy this to your agent

> Resume the fb/08 Marketplace **Stripe sandbox** rollout using the verified Preview results, release SHA, and recovery point above. After authorization, follow step 6 on `https://fb08.vercel.app/marketplace`. Verify a new production-tenant sandbox purchase and deliver redacted evidence. The assessment submission is manual.
