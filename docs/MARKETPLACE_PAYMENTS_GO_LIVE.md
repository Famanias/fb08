# Launch fb/08 Marketplace sandbox payments on Vercel

The implementation can run on the public Vercel site. **Only the verification so far ran locally.** The payment code is on branch `Famanias/stripe-connect-payments-plan` through commit `133e5a8a1928888e89c8b964a14f8d9bf2e64dad`. It passed 146 tests, lint, typecheck, a production build, SQL and concurrency checks, and a privacy scan with local fixtures. The hosted payment migrations, email delivery, Stripe compatibility, webhook registration, and an actual sandbox Checkout are still pending.

The launch target is **public hosting with Stripe sandbox payments** at `https://fb08.vercel.app/marketplace`. Money movement is simulated. The implementation requires `pk_test_` and `sk_test_` keys and limits purchases to fictional sandbox listings. A real-money launch would require a separately scoped change and review. [Stripe sandbox testing](https://docs.stripe.com/testing)

## 1. What you provide and what your agent does

| You or the account owner | Your agent, once it has access and authorization |
| --- | --- |
| Identify the existing `fb08` project in Vercel, its GitHub repo `Famanias/fb08`, the intended Supabase project, and the person who can authorize any production changes. | Confirm project IDs, repository, commit, domains, environment scopes, database migration history, and recovery point. Prepare the preview and report its exact origin. |
| Provide the assessor’s **matching publishable and secret sandbox keys**, or have the assessor install them in the project. Confirm who can register a Connect webhook in that sandbox. | Verify sandbox identity and Connect permissions through the authorized account or credentials. Confirm the permitted connected-account country and verify PHP direct charges and the application fee in preview. |
| Supply a domain or subdomain you control for Resend and an inbox you can open for the seller test. A DNS owner must add Resend’s displayed records if the sending domain is new. | Set up or verify the sender with delegated access. Use a sending key scoped to that domain where available, install it in Vercel, and verify receipt through the app’s seller flow. |
| Enter private values into the hosting dashboard or the approved secret manager. Complete any dashboard sign-in, inbox verification, or Stripe-hosted test fields your agent cannot access. | Install environment configuration where authorized, register only the app’s endpoints, apply the exact migrations, redeploy, run acceptance, and collect redacted evidence. |
| Authorize the public cutover after reviewing preview evidence. Submit the assessment yourself if required. | Present the preview result, exact production commit and rollback point. After authorization, deploy, run public-site smoke tests and supply submission materials. |

Give the agent the Vercel project/team name, approved Supabase project reference, Stripe sandbox name, verified sender address, controlled inbox address, and any known country constraint. Share private credentials through secure configuration only. The controlled inbox is used to receive a genuine seller code. The separate identity, banking, and buyer details entered into Stripe should be fictional test data. [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction) · [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction)

If you have only the two Stripe keys, you still need Resend, an inbox, and the ability to register a Connect webhook. The webhook signing secret becomes available after the endpoint is created. If the assessor owns the shared dashboard and the key lacks endpoint permissions, send them the exact endpoint requirements from step 4 and have them enter the endpoint secret directly into the matching Vercel environment.

## 2. Identify the release and choose a preview origin

- [ ] Confirm the worktree or GitHub branch contains `133e5a8a1928888e89c8b964a14f8d9bf2e64dad`. The remote branch may be behind the local worktree. Use this SHA or a reviewed descendant containing the full implementation. Record the deployed SHA at every stage. Push the feature branch if needed and authorized. A merge into the Vercel Production Branch may deploy automatically, so use the feature branch for preview first.
- [ ] Confirm Vercel’s existing team and project, Git association, Production Branch, and `fb08.vercel.app` domain before linking a CLI checkout or deploying. Use the existing project. Record the current production deployment as the recovery point.
- [ ] Pick one stable HTTPS preview branch domain or alias that continues to point to the newest preview redeploy. Have a reviewer open that same origin. Avoid bouncing between generated deployment URLs. Seller proof cookies and Checkout return URLs depend on the configured host.
- [ ] Pick stable namespaces such as `fb08-stripe-preview` and `fb08-stripe-production`. They are examples. Use a separate tenant for each environment even if both use the same Supabase project or Stripe sandbox. Preserve each tenant and exact origin across redeployments. Preview and production use their own endpoint signing secrets, connected accounts, listings and orders.
- [ ] Use an existing staging database for preview if it has the required app baseline, Storage setup and authorized access. If you use the existing shared Supabase project for preview and production, step 3 is a hosted schema change on that shared project. Authorize it before preview, apply each migration once, and use only preview-tenant fictional inventory during preview.

For a fresh checkout, `npm ci`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` reproduce code checks. The optional disposable local integration and privacy commands are in the [technical runbook](MARKETPLACE_PAYMENTS.md#reproducible-local-verification). An earlier local result shows the code works under those fixtures. Preview supplies the provider evidence. [Vercel environments](https://vercel.com/docs/environment-variables) · [Vercel domains and aliases](https://vercel.com/docs/cli/alias)

## 3. Apply the four payment migrations to the authorized Supabase target

Apply the schema **before serving the new app revision**. Existing listing queries on the new revision expect `inventory_kind` even with payments disabled.

1. In the Supabase Dashboard, confirm the exact project reference and compare it to the Vercel Supabase URL. Identify a recent recoverable backup or arrange an approved backup. Use the project’s authenticated migration access. The app’s `SUPABASE_SERVICE_ROLE_KEY` is for server data operations and does not supply SQL migration credentials.
2. Inspect the remote schema and migration history through the exact selected target. Confirm the two original Marketplace migrations and image Storage setup already exist. Confirm which payment migrations, if any, are recorded and which objects exist. Compare any preexisting objects with the reviewed files before deciding what to apply. A schema/history mismatch requires diagnosis before writes.
3. Apply the four missing files **in this order**, using the project’s tracked migration workflow if its preview lists exactly these unapplied changes. The repo’s older Board migration history can differ from the linked project. Do not bulk-push or reset that history. If the normal workflow would replay unrelated files, have the database operator execute the exact files one at a time with error-stop and record those exact applied versions in the migration ledger after verifying the SQL. A history entry alone does not apply SQL.

| Order | File | Adds |
| --- | --- | --- |
| 1 | [20261117004434_marketplace_payments.sql](../supabase/migrations/20261117004434_marketplace_payments.sql) | Inventory classification, tenant binding, private seller and order tables |
| 2 | [20261117004437_marketplace_payment_functions.sql](../supabase/migrations/20261117004437_marketplace_payment_functions.sql) | Publication, verification, readiness, reservation, and fulfillment functions in one transaction |
| 3 | [20261117095439_marketplace_payment_reconciliation.sql](../supabase/migrations/20261117095439_marketplace_payment_reconciliation.sql) | Delayed payment handling, review safeguards, and reconciliation |
| 4 | [20261117102524_marketplace_payment_presentation.sql](../supabase/migrations/20261117102524_marketplace_payment_presentation.sql) | Sold detail visibility, availability, and private order reads |

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

Add the following in the existing Vercel project’s **Settings → Environment Variables**. Start with Preview, scoped to the selected branch where available. Later set Production separately. Retain valid existing Supabase/Board configuration for the selected target. Set `MARKETPLACE_PAYMENTS_ENABLED=false` for the first deployment. A Vercel environment change requires a new deployment to take effect. [Vercel environment configuration](https://vercel.com/docs/environment-variables)

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
| `RESEND_API_KEY` | Server-only `re_` sending key from the Resend account with the verified sender domain. |
| `MARKETPLACE_SELLER_EMAIL_FROM` | A bare lowercase address at the verified sender domain, such as `seller-verify@payments.your-domain.example` with your actual domain substituted. The app rejects `@resend.dev` and `.invalid` senders. This is the **From** address. Your controlled inbox receives the code. |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_` signing secret for this exact environment’s endpoint. Enter it privately after registering the endpoint below. |
| `MARKETPLACE_PAYMENTS_ENABLED` | `false` initially. Set `true` on Preview after the preflight and webhook setup below. Set `true` on Production only at the approved cutover. |

Stripe’s dashboard credentials, the endpoint signing secret, Resend key, Supabase service role, and session secret stay out of public code, support messages, screenshots, shell history and terminal output. The Stripe publishable key and Supabase public configuration are suitable for the browser. Do not use the `MARKETPLACE_TEST_*` variables on Vercel. They belong to the disposable local test harness.

**Preview preflight and endpoint setup**

1. Verify the selected sandbox permits Accounts v1 with the existing full Dashboard controller, Stripe-hosted account onboarding, connected-account fee responsibility and `card_payments`. Check the chosen country and permission to register Connect events. Country or credential format alone cannot prove that PHP direct charges and fees will succeed. That is part of the preview transaction in step 5. Keep the pinned SDK `stripe@23.1.0` and Stripe API version `2026-10-28.endive`. [Stripe controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties) · [Stripe country specifications](https://docs.stripe.com/api/country_specs)
2. Deploy the exact feature revision to the existing project as a **Preview** with the switch off. Use the selected stable origin for all browser tests. Vercel can create the deployment from the approved Git branch or with `vercel deploy` from a checkout whose existing project link has been confirmed. Smoke test the normal Marketplace and Board/People routes. [Vercel deploy command](https://vercel.com/docs/cli/deploy)
3. Make the preview endpoint reachable by Stripe at `<preview-origin>/api/marketplace/stripe/webhook`. If protection blocks it, use an approved preview domain exception where available or have the owner arrange a dedicated QA origin. Vercel also documents automation bypass with a URL query secret, but this is a shared Stripe sandbox where other key holders may be able to see the destination URL. Keep a project-wide bypass secret out of shared Stripe endpoint URLs. Keep public production settings scoped to this project. [Vercel deployment protection options](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection) · [Automation bypass and its scope](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
4. In the assessor’s sandbox, create an endpoint for **Connected accounts**, payload **Snapshot**, API version **`2026-10-28.endive`**. The equivalent API operation is `stripe.webhookEndpoints.create` with `connect: true`, `api_version` set to the pinned version and `enabled_events` set to the three types below. Use the exact HTTPS URL. If a previous attempt may already have created it, inspect only the exact URL and reuse the matching endpoint that belongs to this app. Do not modify other candidates’ endpoints or print an API creation response containing `secret`. [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks?accounts-namespace=v1) · [Webhook endpoint parameters](https://docs.stripe.com/api/webhook_endpoints/create)

   - `account.updated`
   - `checkout.session.completed`
   - `checkout.session.expired`

5. Put this endpoint’s signing secret into Preview as `STRIPE_WEBHOOK_SECRET`. Redeploy with payments still off if you want to verify the route before enabling. An unsigned POST that reaches the app should return `400`. A `404`, redirect, or Vercel access challenge means Stripe cannot yet reach the handler. An unsigned probe verifies reachability only. The real completion event verifies signature and processing.
6. Set Preview `MARKETPLACE_PAYMENTS_ENABLED=true` after the configuration, schema, sender, endpoint, and access preflight passes. Redeploy the same commit at the stable preview origin. This enables the QA flow required to establish actual email delivery and Stripe compatibility, before anyone enables Production.

For the unsigned reachability check, substitute the selected host and run from outside the Vercel session. Use `curl.exe` on Windows PowerShell if `curl` resolves to a PowerShell alias. The expected app response is HTTP `400` with no Stripe signature supplied.

```sh
curl -i -X POST 'https://preview-origin.example/api/marketplace/stripe/webhook' -H 'Content-Type: application/json' -d '{}'
```

## 5. Prove the purchase in preview

- [ ] **Create two sandbox listings.** Visit `/marketplace/new`. Use fictional items, a non-sensitive image, the controlled inbox as the private contact, and the checkbox **This is a fictional sandbox listing: no real money or delivery**. Price one item at **₱1,234.50**. Keep an ordinary listing and a demo available to verify they have no Buy Now. Ordinary listings and the original demos remain inquiry-only.
- [ ] **Verify seller ownership.** On `/marketplace/payments`, enter the same listing email. Open the inbox and enter the six-digit code in the same browser. The app’s code expires after ten minutes. Resend may show an accepted send even if delivery failed, so confirm actual receipt. Click **Connect with Stripe** and complete the chosen country’s **test** onboarding flow with Stripe’s fictional details. Return and use **Check status** if needed. Confirm the account is ready and both matching-email sandbox items show Buy Now. [Stripe Connect test onboarding data](https://docs.stripe.com/connect/testing.md?accounts-namespace=v1)
- [ ] **Pay from a separate buyer browser or profile.** Open the listing at the configured preview origin and click **Buy Now**. Confirm hosted Stripe Checkout shows PHP, quantity one and the exact listing price. Enter `4242 4242 4242 4242`, a future expiration date and any valid three-digit CVC in Stripe Checkout. Keep the same buyer browser on return. [Stripe test cards](https://docs.stripe.com/testing)
- [ ] **Confirm the connected charge and fee.** Verify the charge belongs to the locally recorded connected account. For ₱1,234.50, the gross is `123450` centavos and the application fee is `12345` centavos (₱123.45). The seller remainder before processing is `111105` centavos (₱1,111.05). Confirm actual simulated fee details and net from the connected charge’s balance transaction when available. If the settlement currency differs, report both currencies as provided. If fee data hasn’t arrived, record it as pending. No real payout occurs. [Stripe direct charges and fees](https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted)
- [ ] **Prove the webhook did the work.** The return may initially say **Payment confirmation pending**. Confirm Stripe delivered the owned `checkout.session.completed` event to this endpoint and got `200`. Confirm a paid webhook receipt, one paid private Supabase order, and the correct sandbox listing marked Sold. The buyer page must show **Sandbox payment confirmed** after the persisted update. Confirm the Sold detail URL still opens and the item is absent from the active feed. Do not mark a row paid by hand to pass this check.
- [ ] **Test access and concurrency.** Open the order URL in another browser without the buyer cookie and verify it cannot read the order. Check that two different buyers competing for the other item cannot both start independent payable sessions. The owning tab should be able to resume an existing reserved order after a cancel or reload. Cancel alone leaves a hold. Replay only an event from an owned fixture and verify it does not duplicate the sale. Confirm ordinary/demo listing counts and legitimate inventory effects are unchanged.
- [ ] **Run regressions.** Verify ordinary creation and photo upload, feed filtering, detail, private inquiries, and Board/People/profile/sign-in. If using `test:marketplace:live`, remember it writes and cleans up its own temporary listing. Use it only against an explicitly authorized target with the URL provided; the payment verifier below is read-only.

The authorized agent can confirm the exact paid order without opening a privileged public route. Use an ignored `.env.local` in an operator checkout with the preview tenant/origin and matching provider/DB configuration. Replace the two example arguments with the actual preview origin and the private UUID of the owned QA order. Keep that UUID out of public notes.

```sh
npm run test:marketplace:payments:verify -- --base https://preview-origin.example --order-id 00000000-0000-4000-8000-000000000000
```

Expected report fields are `paid: true`, `sold: true`, `webhookConfirmed: true`, and `feeDetails: "confirmed"` or `"pending"`. The verifier privately checks the connected Stripe objects and Supabase association. It does not confirm an unsigned redirect or repair a missing receipt. Capture a redacted acceptance record with the deploy SHA, preview origin, actual email/onboarding result, Checkout amount, application fee, signed delivery/receipt, and fee status. If any required check fails, report it and keep Production disabled.

## 6. Release to the public site after preview passes

1. Review preview evidence, the exact release commit, and the recovery point with the owner. Confirm which Git or CLI action will deploy to the existing production project before merging the branch. If production uses a separate database, repeat step 3 there before serving the new code. If it shares the already migrated database, verify its schema/history and skip applied files.
2. Add the Production values from the environment table. Use `https://fb08.vercel.app`, the distinct production tenant, and `MARKETPLACE_PAYMENTS_ENABLED=false`. Deploy the tested revision to the existing production project. Check ordinary Marketplace, Board and People. Check that an unsigned POST reaches the app at the public endpoint.
3. Register or verify the separate **production-domain endpoint inside the same authorized Stripe sandbox**:

   ```text
   https://fb08.vercel.app/api/marketplace/stripe/webhook
   ```

   Use the same Connect/snapshot/API version/events from step 4. Put this endpoint’s signing secret in **Production**. Preview and Stripe CLI signing secrets are different. Redeploy after saving the values.
4. Once the owner authorizes enablement, set Production `MARKETPLACE_PAYMENTS_ENABLED=true` and redeploy the verified revision. Use new production-tenant fictional listings. Repeat the actual code delivery, test onboarding, Buy Now, Checkout, signed paid receipt, Sold listing and buyer confirmation checks on the public origin. Run the verifier using production-specific configuration. All Stripe calls remain in the sandbox.
5. Deliver the public Marketplace URL, GitHub repo URL, tested SHA, and sanitized onboarding, Checkout, confirmation and private-row evidence. Redact contact details, access identifiers, account IDs, test secrets and proofs. Keep raw payloads, cookies, order URLs and provider exports private. If submitting the assessment, prepare the material for `apply.capm.us`, choice **4) Stripe Connect**. Submission is manual.

## 7. Diagnose failures and pause safely

| Symptom | First checks |
| --- | --- |
| Buy Now never appears | Verify the active deployment SHA and its env scope, switch, exact origin, listing’s sandbox classification and tenant, private listing email, supported account configuration and current readiness. No Buy Now is expected for ordinary, demo, held, sold or restricted items. |
| Seller code never arrives | Verify actual Resend delivery, verified DNS/sender, key permission and inbox/spam folder. Match the private listing email and use the requesting browser. Request a fresh code within limits after any fix. |
| Onboarding returns but stays pending | Use **Check status** and inspect the owned sandbox account’s details, charge and payout flags, `card_payments`, controller, requirements and country. Returning to the site alone does not activate the account. Resolve the concrete Stripe limitation with the assessor before switching countries, keys, or account model. |
| Stripe delivery fails | A redirect or authentication response points to URL/protection. A `400` for a real Stripe delivery points to signature or request handling. Check the endpoint-specific signing secret, deployment revision and redeploy status. A `503` can come from missing configuration, provider retrieval or the database. Inspect sanitized errors for this app’s event and retry that event through the existing endpoint. |
| Stripe gets `200` but order stays pending | Other candidates’ signed events may receive a successful no-op. Verify this event belongs to the correct sandbox, connected account, environment tenant, order and session. Check canonical currency, amount, quantity and fee. An owned unsettled or mismatched event may leave a hold. Inspect before changing inventory. |
| Buyer cannot reopen confirmation | Use the originating browser, same site origin and unexpired proof. An order UUID alone provides no access. A failed competing buyer can occasionally see a stale Resume button after reload. The server rejects it without creating a new hold or contacting Stripe. |
| Need to stop new orders | Set `MARKETPLACE_PAYMENTS_ENABLED=false` on the affected Vercel environment and redeploy. Preserve the endpoint, signing secret, tenant and schema so existing signed events, order reads and reconciliation can finish. Before rolling back to a revision without the webhook route, reconcile outstanding orders or keep a compatible webhook-serving deployment. Retain payment and receipt history. |

For stuck orders, inspect before applying recovery. The operator reconciler is dry-run by default and applies only with `--apply` against the selected tenant. A per-order failure leaves that order for investigation while independent orders continue. Never create a replacement Checkout key, release an uncertain hold by time alone, or modify another candidate’s records. See [operator recovery details](MARKETPLACE_PAYMENTS.md#operator-inspection-classification-and-recovery).

## Copy this to your agent

> Bring fb/08 Marketplace payments to the existing public Vercel project **in Stripe sandbox mode**, following `docs/MARKETPLACE_PAYMENTS_GO_LIVE.md` and `docs/MARKETPLACE_PAYMENTS.md`. Use the branch `Famanias/stripe-connect-payments-plan` at `133e5a8` or a reviewed descendant. Confirm the existing Vercel project, Git branch, Supabase project, Stripe sandbox, Resend sender and stable preview origin. Tell me which account access or secret configuration you need without asking me to put secrets in chat. Verify and apply only the four reviewed payment migrations to the authorized database. Set up the exact Connect endpoint and do a real sandbox purchase on preview with the controlled inbox. Show me the preview results, release SHA, and recovery point before production enablement. Once authorized, repeat sandbox QA on `https://fb08.vercel.app/marketplace` and deliver redacted evidence. Use only owned fictional fixtures and preserve the existing Board, People, demos and ordinary Marketplace. Keep the assessment submission manual.
