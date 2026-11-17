# Marketplace sandbox payments

Payments default to disabled. Ordinary Marketplace browsing, publication and inquiries do not depend on Stripe settings. New payment operations require explicit server configuration; turning the switch off must preserve existing order reads, signed webhook processing and reconciliation. Seller status/logout use independent tenant/origin/session configuration and never require Resend settings.

The official server SDK is exactly `stripe@23.1.0` (Node >=20), pinned in package.json/lockfile. API requests use stable `2026-10-28.endive`, the installed SDK's supported version. Later Connect snapshot webhook registration must use that same version. The browser receives hosted URLs and public status only, with no SDK, account IDs or private seller email. Account HTTP requests use a five-second timeout and at most one SDK retry, within the database's twenty-second readiness lease.

Accounts v1 with controller properties is the deliberate snapshot-event compatibility choice. The controller is full Dashboard, Stripe requirement collection/payment-loss responsibility, and account fee responsibility. Request `card_payments` only; payments are direct connected-account charges with PHP presentment and a 10% application fee. Do not substitute destination charges, `transfer_data`, `on_behalf_of`, another currency, live keys or a different account model.

Configuration names and empty examples are in `.env.example`. Set `MARKETPLACE_PAYMENT_TENANT` separately for local, stable preview and production; `MARKETPLACE_APP_ORIGIN` is an exact HTTPS origin (HTTP localhost is permitted for local work). `MARKETPLACE_STRIPE_ACCOUNT_COUNTRY` is an explicit operator choice. Stripe secret/publishable keys must have test prefixes; webhook signing, session HMAC and verified Resend sender settings are required before enabling new payment operations. Construction is lazy and does not call providers. These syntactic checks do not establish provider permissions or country/currency compatibility.

## Compatibility gate before hosted QA

No credentialed checks or hosted configuration have been performed. Leave `MARKETPLACE_PAYMENTS_ENABLED=false` until each required check below has evidence from the authorized shared sandbox. Missing support blocks external QA and Buy Now; report the concrete finding without changing the payment model.

- Privately verify the supplied test key's platform identity and Connect authority. Confirm an operator-controlled verification inbox, a verified Resend sending domain and actual code delivery. Use fictional Stripe identity/card/bank data only.
- Verify the selected country permits this Accounts v1 controller, full Dashboard and Stripe-hosted `account_onboarding` links. Check country specifications and request/activate card payments; do not assume Philippine accounts because listings use PHP.
- Complete an owned sandbox onboarding account. Confirm details submitted, charges and payouts enabled, active card capability, matching opaque app/tenant/seller metadata, matching country/controller and no outstanding disabling requirements. Current readiness conservatively also rejects current/past-due requirements, pending verification and requirement errors.
- Verify PHP card presentment, settlement constraints and application-fee support for that platform/country using an owned preview Checkout. Record processor fees and any settlement currency difference; never claim the pre-processing remainder is net payout.
- Verify permission to register a public HTTPS **Connect**, **snapshot** webhook, pinned to `2026-10-28.endive`, with exactly `account.updated`, `checkout.session.completed`, and `checkout.session.expired`. Endpoint/webhook setup belongs to the later authorized integration task.
- Verify the stable preview URL is accessible to Stripe with any preview protection addressed through authorized configuration. Confirm tenant isolation and direct connected-account request scoping before enabling purchases.

## Account lifecycle and recovery

Verified seller proof authorizes Connect/refresh POSTs with exact origin and Fetch Metadata checks plus a persistent twenty-per-hour seller budget. An empty JSON body is required. Country, account ID and return/refresh destinations come from the server. A refresh page must require seller proof and POST to `/api/marketplace/payments/connect/refresh`; GET navigation itself never creates an onboarding link. Return navigation does not establish readiness.

The service-only account-slot RPC reserves one persistent creation key per tenant/seller before calling Stripe. The matching account ID is attached atomically before returning a single-use onboarding link; links are never saved. Ambiguous creation retries reuse the original key/parameters within twenty-three hours. At twenty-three hours, an unlinked slot freezes for operator reconciliation. Never delete/rekey it to try again; first establish the original provider outcome privately and reconcile its matching metadata/key. Freeze country/controller/API configuration while a slot is pending. A configuration change requires operator recovery of the original configuration and provider outcome; an incompatible Stripe idempotency retry fails closed and stays pending under its original key. Do not create a replacement account to work around that failure.

Status refreshes a linked account when its cached check is older than sixty seconds. Before future Checkout, always call `refreshKnownAccount` even if the display cache is fresh. This helper acquires a service-only database lease, immediately clears readiness, retrieves canonical Stripe state, checks local seller/tenant attribution, and saves only with the unexpired fencing ID. An API failure saves restricted/false where possible and returns 503; busy/expired/superseded leases also return 503. A stale refresh cannot restore readiness. No transaction spans provider HTTP.

Local verification uses injected SDK requests and `node:test`; no provider credentials are needed. `supabase/tests/marketplace-connect.sql` rolls back service-only slot/attachment/fence assertions; `npm run test:marketplace:payments:db` requires explicitly selected loopback test API/key and checks committed concurrent slots, leases, proof exchange, reservations and fulfillment, then removes its exact fixtures.

Official references: [Stripe Node SDK](https://github.com/stripe/stripe-node), [Accounts v1 create](https://docs.stripe.com/api/accounts/create), [Account Links](https://docs.stripe.com/api/account_links/create), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Supabase database functions](https://supabase.com/docs/guides/database/functions).

## Current release boundary

Local implementation and QA are complete. Hosted payment migrations, shared Stripe credentials/authority, connected account country support, verified email delivery, public Connect webhook registration, hosted Checkout, deployment and submission are **pending**. Keep `MARKETPLACE_PAYMENTS_ENABLED=false`. Historical Marketplace release results in `MARKETPLACE_IMPLEMENTATION.md` are not hosted payment acceptance evidence. Final submission remains manual.

Shared sandbox keys expose other candidates' resources and operations. Never enumerate, expire, cancel, attach, classify or delete someone else's records. Every operation uses the configured tenant and opaque app/seller/order/listing metadata; a valid signature from a foreign tenant returns 200 without reads or writes to that tenant. Do not publish raw Dashboard exports, screenshots, emails, cookies, OTPs, order links/proofs, connected account IDs or webhook payloads. Use an approved secure configuration channel for credentials, never CLI argument literals, shell history, npm scripts, git or public issue comments. Real cards, identity documents, bank data and inventory are prohibited in QA.

## Environment and authority

| Names | Scope and purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project/API configuration; legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the optional fallback. Never substitute a service key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server/operator only; private payment/contact tables and service RPCs. |
| `AUTH_SESSION_SECRET` | Server HMAC secret, at least 32 characters for payment proofs. Existing Board sessions remain separate. Rotation invalidates proofs and changes request fingerprints; plan it carefully. |
| `MARKETPLACE_PAYMENTS_ENABLED` | Explicit `true` enables new purchases/onboarding only after the gate; absent/`false` disables them. |
| `MARKETPLACE_PAYMENT_TENANT`, `MARKETPLACE_APP_ORIGIN` | Stable unique deployment namespace and exact origin. No trailing slash/path/query; HTTP loopback is local-only. Never reuse preview/production tenants. |
| `MARKETPLACE_STRIPE_ACCOUNT_COUNTRY` | Explicit, verified supported ISO country, frozen with controller/API configuration during pending creation. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Sandbox `sk_test_`, `pk_test_`, signing `whsec_`; publishable key is syntactically gated but redirect-only UI needs no Stripe.js. All other keys remain server-only. |
| `RESEND_API_KEY`, `MARKETPLACE_SELLER_EMAIL_FROM` | Server email delivery; a bare normalized address at an actually verified domain and a controlled verification inbox are required. No fictional ownership, default sender or inaccessible demo mailbox. |
| `MARKETPLACE_TEST_SUPABASE_URL`, `MARKETPLACE_TEST_SERVICE_ROLE_KEY` | Disposable loopback-only API and short-lived local role token, supplied in child memory by the local runner. Never point them at a hosted service. |
| `MARKETPLACE_TEST_DB_CONTAINER`, `MARKETPLACE_TEST_DB_NAME` | Explicit owned SQL pair for local lock regressions; runner supplies these without secrets. |

Seller ownership uses `lower(trim(email))`, preserves plus addressing/dots, and requires a single-use six-digit code within ten minutes, at most five attempts, browser-bound challenge and durable rate limits. The verified seller cookie lasts one hour. Buyer bootstrap creates a separate opaque browser capability; its order read scope lasts seven days. Proofs are HttpOnly/SameSite cookies (Secure host-prefixed on HTTPS); DB stores hashes, not raw capabilities or codes. Board/People credentials never grant seller/buyer authority.

## Routes and persisted states

| Route | Behavior |
| --- | --- |
| `/marketplace`, `/marketplace/new`, `/marketplace/[id]` | Existing browse/publication/detail/inquiry flows; new publication defaults ordinary, with explicit fictional sandbox opt-in. Sold detail remains public; active feed excludes sold/removed. Removed detail is 404. |
| `/marketplace/payments` | Seller challenge/verify, readiness, Connect, refresh and logout controls. |
| `/marketplace/payments/return`, `/marketplace/payments/refresh` | Return is no proof of readiness. Refresh requires seller proof and a POST; GET never generates a link. |
| `/marketplace/orders/[orderId]` | Private browser-scoped status; noindex/no-referrer/no-store. Polls for at most 60 seconds, then pending plus manual refresh (15-second request deadline); observed paid cannot be demoted by a late response. |
| `/api/marketplace/payments/seller/{challenge,verify,status,logout}` | Same-origin verified seller proof lifecycle; challenge/verify/logout are POST and status is GET. |
| `/api/marketplace/payments/connect`, `/connect/refresh` under the same payments prefix | Proof-protected POSTs; server determines account, country and destinations. |
| `/api/marketplace/payments/buyer-session`, `/checkout` under the same prefix | POST bootstrap and one listing-ID checkout request; no browser-supplied money/account/tenant authority. |
| `/api/marketplace/payments/orders/[orderId]` | GET only the approved order DTO with matching tenant, buyer hash and unexpired read scope. No public DB inspection endpoint exists. |
| `/api/marketplace/stripe/webhook` | Bounded raw-body signed POST; exact registered snapshot event types only. Existing signed processing survives the new-purchase switch being off. |

Inventory kinds are ordinary, demo (both inquiry-only), and sandbox. Sandbox display is unavailable, ready, reserved or sold. Browse reads a batched DB availability cache without provider calls. Eligible detail refreshes readiness after 60 seconds, fences concurrent writes, then rereads eligibility. Checkout independently refreshes the account even when the cache is fresh. A stale detail can show unavailable until refresh succeeds; a review freeze always wins over readiness.

Order states are `preparing` → `open` → `paid` or `expired`, with `review` retaining a conservative hold on anomalous evidence. The unique held/sold association prevents two valid sessions for one item; timeout/browser cancel alone never releases inventory. Immutable order amounts, exact quantity one, PHP currency, canonical session/Intent metadata, account, expiry and original creation parameters are validated again under DB locks. Only succeeded, fully received canonical payment can sell once. A redirect/query parameter never fulfills. Duplicate/delayed events preserve paid and attach only the canonical matching session. A later signed completed receipt can establish webhook evidence for an already operator-reconciled sale without another sale.

PHP prices use integer minor units. Eligibility requires gross of at least ₱100.00 and at most ₱999,999.99. The 10% application fee rounds half up to one minor unit. For ₱1,234.50: gross 123450, fee 12345, seller before processing 111105 minor units. This last number is **not net payout**. Checkout uses direct connected-account charges and disallows adjustable quantity, promotion/tax/shipping/recovery changes. Paid fee enrichment is independent: canonical charge/balance data supplies actual processing/other fees and settlement currency; unknown/delayed fee details remain pending. Application fees are subtracted once, and currency conversion is not invented.

## Additive migrations and permissions

The existing Marketplace baseline is `20261116180858_fb08_marketplace.sql` followed by `20261116182303_marketplace_literal_search.sql`. The four payment migrations, in order, are:

1. `20261117004434_marketplace_payments.sql` — inventory kinds and private payment tables.
2. `20261117004437_marketplace_payment_functions.sql` — service-only proof/account/reservation/fulfillment functions and ordinary/sandbox publication guard.
3. `20261117095439_marketplace_payment_reconciliation.sql` — delayed paid receipts, anomaly evidence and monotonic reconciliation.
4. `20261117102524_marketplace_payment_presentation.sql` — active/sold public detail columns, batched availability and private order confirmation.

On a later authorized hosted rollout, inspect current schema/history and backup first, review exactly these feature files against that schema, and apply only missing reviewed feature migrations in order. Old linked Board history differs from repository filenames: **never** bulk `db push --include-all`, replay/repair Board history, reset a real schema or delete user inventory. No hosted migration has been applied for this feature. Keep explicit public column grants, RLS on private tables, service_role-only RPC execution, security invoker and empty search paths. Run SQL grant/RLS checks and security advisors on the explicitly selected target after authorized changes.

Default ordinary publication preserves the original pre-payment HMAC fingerprint and idempotency key. Explicit sandbox publication hashes its kind separately. SQL independently refuses same-key ordinary→sandbox reclassification, sandbox→ordinary changes or tenant rebinding even if a fingerprint is mistakenly reused. Existing exact demo classification does not change the old ordinary request identity.

## Reproducible local verification

Use Node >=20, dependencies from `npm ci`, and a local Linux Docker engine with `postgres:17-alpine` and `public.ecr.aws/supabase/postgrest:v14.18` already cached. Normal `npm test` runs independently of Docker. Reserve loopback ports 55449/55450/55451, and leave 55452 free for privacy rendering. Run the privacy command from a checkout where `.env.production.local`, `.env.local`, `.env.production` and `.env` are absent. The harness checks for their presence before launching Next and supplies fictional configuration and short-lived local JWTs. Stop existing Next servers in that checkout before rebuilding its `.next` directory.

```sh
# Once, creates a NEW owned stack; refuses existing resource names or a nonempty DB.
node scripts/run-marketplace-payments-local.cjs --setup
# Repeat all SQL and committed concurrency/HTTP/read/lock checks against that stack.
npm run test:marketplace:payments:local
# Same checks, followed sequentially by canary production build, start, public asset/HTML scan.
npm run test:marketplace:payments:privacy
npm test
npm run lint
npm run typecheck
npm run build
```

The harness resolves Docker's selected endpoint, accepts approved local Unix sockets and Windows named pipes, and pins commands to the verified Linux engine. It checks labels, images, the dedicated bridge network, and the exact loopback bindings on `fb08-marketplace-payments-local-db` and `fb08-marketplace-payments-local-rest` before testing. SQL uses the verified DB container ID and `marketplace_payments_local` database. Setup uses cached images and loads the two Marketplace baseline files and all four feature migrations into an empty database. It bootstraps minimal Storage **catalog stubs**. A short-lived local service JWT and loopback `/rest/v1` proxy exercise actual PostgREST, Supabase JS, and PostgreSQL transactions and locks. This disposable Docker network uses local trust authentication.

Six SQL suites run in transactions and roll back. Four committed runners test proof exchange and budgets, account creation and refresh races, 20 competing reservations, one sale under duplicate signed events, late receipts, foreign-event no-ops, terminal expiry races, scoped reads, availability and lease fencing after a lock wait. Random run IDs isolate committed fixtures and cleanup verifies their removal. The account-lock runner applies the same engine, network and DB container checks when invoked directly.

The harness sends readiness, REST forwarding and rendered requests directly over loopback. Its integration and Next subprocesses receive allowlisted environments with Node environment proxies disabled. The privacy runner waits for its own production Next child to bind and reports only results from responses bearing the child's per-run marker. Deadlines cover the build, server startup, requests and server shutdown. Positive checks assert the ordinary listing, a ready sandbox listing, a sold sandbox detail and the paid order page with its matching buyer proof. The order API must return the exact public DTO with that proof and HTTP 404 with a different proof. Public assets are scanned for the injected private configuration. Rendered responses are also scanned for the fixture contact, connected account, Checkout and Intent IDs and the buyer proof and hash. The owned Next serving process's outbound socket guard permits only the loopback PostgREST proxy. The runner verifies exact fixture cleanup after scanning.

`test:marketplace:payments:db` remains the focused concurrency script for a separately selected disposable loopback API using the two `MARKETPLACE_TEST_*` API names above. Prefer the wrapper to avoid handling/logging fixture JWTs. Unit/handler tests cover the four original Marketplace flows, Board/People/custom auth, private DTOs and provider guards. Minimal Storage catalogs do not verify hosted image delivery; local rendering verifies shells/routes and privacy, while original Marketplace SQL/handlers exercise persistence and validation. Prior responsive UI checks remain documented in the implementation review; they do not prove hosted provider acceptance.

CLI discovery on this machine: Supabase 2.119.0 (`supabase --help`, `supabase db --help`, `supabase db query --help`, `supabase migration list --help`), Vercel 62.1.0 (`vercel --version`, `vercel --help`). Stripe CLI is not installed; do not guess commands or install/register/listen against shared credentials automatically. On a later authorized session discover `stripe --version`/`stripe --help` first and follow the installed version. A Supabase update notice to v3.2.0 is informational; no CLI/framework upgrade is part of this task.

## Operator inspection, classification and recovery

After authorized human onboarding/Checkout has produced an owned order, use secure server configuration in ignored `.env.local`:

```sh
npm run test:marketplace:payments:verify -- --base <exact-origin> --order-id <owned-order-uuid>
# Equivalent:
node --env-file=.env.local --import=tsx scripts/verify-marketplace-payments.ts --base <exact-origin> --order-id <owned-order-uuid>
```

This command is strictly read-only. It checks only that tenant/order, matching connected seller, bound sandbox listing/price and one current hold/sale, real paid webhook receipt and canonical sandbox session/Intent. No readiness refresh, reconcile, database write, Checkout creation/expiry/cancel, mail or public inspection endpoint is used. It reports only `{paid,sold,webhookConfirmed,feeDetails}`; all first three must be true or inspection fails generically. Fee details may be confirmed or explicitly pending. Reads are point-in-time evidence; rerun after concurrent state changes. It deliberately does not repair missing receipts. Imports of verifier/classifier/reconciler are safe and perform no setup or output.

```sh
# Exact manifest inspection only, including private contact comparison; output has IDs/counts only.
node --env-file=.env.local --import=tsx scripts/classify-marketplace-demos.ts
# Separate authorized mutation, never classify arbitrary title matches:
node --env-file=.env.local --import=tsx scripts/classify-marketplace-demos.ts --apply
# Default is a tenant-scoped work/action list without provider/DB mutation:
node --env-file=.env.local --import=tsx scripts/reconcile-marketplace-payments.ts
# Separate authorized recovery of original owned operations:
node --env-file=.env.local --import=tsx scripts/reconcile-marketplace-payments.ts --apply
```

Missing demo IDs are reported, not created; any mismatched immutable manifest field/contact aborts all classification. Existing `test:marketplace:live` retains its ordinary temporary fixture and exact cleanup. It writes to its selected application/database and must only run later with target-specific write authorization; it is not the payment inspector.

Recovery must preserve the original account and Checkout idempotency keys/API/parameter snapshots. Safe ambiguous Checkout retries use only the original operation before both 23 hours and its original expiry safety window; outside either window it remains held for private operator evidence. Never rekey/delete a stuck slot, create a second session, time-release a hold or mark paid from a browser. Open/expired Checkout may initially have no Intent: validate against the immutable snapshot for attach/hold only; paid still requires a real succeeded Intent. Expire only an owned canonical session and reread after provider races. Cancel a Checkout-associated Intent only in Stripe's permitted `requires_capture` state; `requires_payment_method`, `processing`, `requires_action` and inaccessible outcomes keep conservative holds. Reconciliation lists paid orders missing settlement for independent enrichment; fully enriched paid and expired rows leave the queue. Operator provenance never substitutes for a signed webhook receipt.

For rollback, turn off new payments, retain signed webhook processing, order reads and operator recovery, and restore a compatible prior deployment only under deployment authorization. Preserve tables, proof/receipt history, pending operations and user data. A schema/data deletion requires its own reviewed retention/export plan; never reset the project. Investigate private generic errors in a controlled environment without logging raw provider/DB/contact payloads.

## Evidence and pending acceptance checklist

Local verification on 2026-11-18 covered 142 unit and handler tests, lint, typecheck, a production build, six SQL suites and four integration runners. The privacy command scanned 63 public assets and 14 responses from its owned server. It verified the public sandbox listings and authorized paid order results and found none of the private canaries. The full run with Node environment proxying enabled sent zero requests to the configured fictional proxy. `module.register()` emits the inherited Node DEP0205 build deprecation warning. The inherited npm audit record contains 23 findings (22 moderate and one high).

Before later hosted acceptance, privately capture: platform/key authority and country/controller/PHP compatibility; actual verification email receipt; owned connected account readiness; one fictional listing gross/application-fee/seller-before-processing values; successful hosted test Checkout; signature-verified own paid receipt; one sold association despite concurrent/replayed events; pending/confirmed actual settlement details; wrong-browser/tenant/private-table denial; Board/People/auth and original Marketplace image/publication/browse/detail/inquiry regression; public bundle/HTML secret/contact scans; and exact fixture cleanup. Record environment/versions/date and pass/pending status without raw IDs/proofs/contacts. Review screenshots manually and publish only sanitized public UI plus captions in a minimal manifest (no private metadata/network exports). Do not commit raw captures. No public screenshot manifest or hosted acceptance result has been produced by the local task.
