# Stripe Connect Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add verified guest seller onboarding and webhook-confirmed, single-item sandbox purchases to the existing Marketplace using direct Stripe Connect charges and a 10% application fee.

**Architecture:** Keep Marketplace's injected handler/store pattern and existing custom Board sessions. Private Supabase records bind verified seller email, connected account, explicit sandbox inventory, buyer proof and immutable order amounts; atomic RPCs reserve inventory and finalize verified payments. Hosted onboarding and Checkout use a server-only Stripe adapter, with Connect webhooks and an operator reconciler sharing the same validation/transition service.

**Tech Stack:** Existing Next.js 15.5.29 / React 19.3.1 / TypeScript / Supabase JS 2.119.0, official Stripe Node SDK, PostgreSQL RPCs, existing `node:test`/`tsx`, Resend HTTPS ownership-code delivery, existing Vercel project.

**Spec:** [2026-11-17-stripe-connect-payments-design.md](../specs/2026-11-17-stripe-connect-payments-design.md). Read it before execution; the ownership choice and provider prerequisites are proposed decisions for review, not previously verified infrastructure.

## Global Constraints

- Preserve the existing React 19 / Next.js 15 App Router / TypeScript / Supabase / Vercel application and nostalgic Marketplace styling.
- Use only assessor-provided shared Stripe sandbox credentials; never use live keys, real cards, real identity documents, real bank details, or real inventory for payment QA.
- Use direct charges on the seller connected account with a 10% application fee; all money movement and payouts are simulated.
- Enable purchases only for explicitly classified sandbox listings belonging to a verified seller whose Stripe readiness has been confirmed.
- Signature-verified webhook processing, never a redirect or browser parameter, confirms paid status and marks the correct sandbox listing Sold.
- Keep seller contacts, buyer data, connected account IDs, order authorization proofs, and provider secrets out of public listing DTOs, HTML, metadata, logs, and public database reads.
- Keep Board/People custom sessions separate from Marketplace seller and buyer proofs; no ordinary Marketplace login or registration flow.
- Apply only additive Marketplace migrations; never replay or repair unrelated historical migrations or overwrite existing listings.
- No implementation, dependency installation, migration application, Stripe credential use, webhook registration, hosting configuration, deployment, sending, or submission is authorized during planning.

## Review Focus

Each initially uncovered condition below is pinned by the named test in its owning task.

1. Ambiguous Checkout creation followed by expiry of Stripe's idempotency retention must keep the listing held, never create a second payable session — Task 4 `ambiguous_creation_never_rekeys_or_time_releases`.
2. A paid event arriving before the Checkout create response is stored must bind only the canonical matching session and sell once — Task 5 `webhook_can_bind_preparing_order_once`.
3. Two tabs/buyers paying around reservation expiry must never acquire two valid sessions or downgrade a paid sale — Tasks 1/4/5 concurrent database and expiry tests.
4. Case/whitespace email variants, a wrong-browser code, or an inaccessible demo inbox must never grant a different seller's payment destination — Task 2 ownership tests and Task 1 fixture classification checks.
5. A legitimate signed event from another candidate or another deployment tenant must return 200 without modifying our inventory or exposing data — Task 5 `foreign_signed_events_are_noops`.

---

## Execution boundary and inspected baseline

This is one payment feature; execute tasks sequentially because they share schema and state transitions. Planning is complete only when these documents are saved and reviewed. Future checkboxes are unexecuted instructions, not claims of changes or tests already performed.

Worktree already exists through Orca: `E:/orca/workspaces/fb08/stripe-connect-payments-plan`, branch `Famanias/stripe-connect-payments-plan`, base `15fbf94690b5d64bab57724f09f4cc0145f4dcd3`. All three main refs and remote main matched at inspection. No applicable `AGENTS.md`. Existing `npm test`: 37 passed. No credentials were read or checked; no linked database or deployment was inspected. Recheck main/worktree status before authorized implementation; preserve any newer changes.

Important existing boundaries:

- `marketplace-store.ts`: `browse`, active-only `find`, `consumeRate`, `upload`, `cleanup`, `publish`, `inquire`; public listing column allowlist.
- `marketplace-handlers.ts`: same-origin protection, bounded streaming bodies, private errors, injected `MarketplaceStore`, `AUTH_SESSION_SECRET` HMAC abuse counters. Keep these behaviors.
- `supabase/migrations/20261116180858_fb08_marketplace.sql`: original schema/write RPCs. `20261116182303_marketplace_literal_search.sql`: active-only browse. **Do not edit applied migrations.**
- `auth.ts`/`route-helpers.ts`, `board-handlers.ts`, `profile-handlers.ts`: custom Board/People sessions; do not migrate to Supabase Auth or use a Board session to prove listing ownership.
- Scripts are operator-only Node/tsx programs; original demo seeder has deterministic IDs, immutable manifest checks, and dry-run default. Existing live verifier creates and deletes its own ordinary listing.

## File map and shared contracts

New payment-specific code lives together under `features/marketplace/payments/` and `lib/server/marketplace-payments/`; do not reorganize existing Board/Marketplace code.

| Files | Responsibility |
|---|---|
| `features/marketplace/payments/types.ts`, `rules.ts`, `rules.test.ts` | Public payment DTOs, pure minor-unit/fee/state/display rules; no provider/server imports |
| `lib/server/marketplace-payments/contracts.ts`, `store.ts` | Private types, dependency interfaces and Supabase/RPC adapter |
| `lib/server/marketplace-payments/request.ts`, `proof.ts`, `seller-mailer.ts`, `seller-handlers.ts` | Bounded browser requests, hashes/cookies, ownership-code delivery and seller proof |
| `lib/server/marketplace-payments/config.ts`, `stripe-gateway.ts`, `connect-handlers.ts` | Fail-closed configuration, SDK calls, seller account/onboarding lifecycle |
| `lib/server/marketplace-payments/checkout-handlers.ts` | Buyer bootstrap, reservation, Checkout creation/retries |
| `lib/server/marketplace-payments/reconcile.ts`, `webhook-handler.ts`, `order-handlers.ts` | Canonical validation, monotonic fulfillment, raw signature ingress, scoped read DTO |
| New `*.test.ts` beside each tested module | Existing injected `node:test` style; no provider credentials |
| `app/api/marketplace/payments/{seller/challenge,seller/verify,seller/logout,seller/status,connect,connect/refresh,buyer-session,checkout}/route.ts` | Thin method-specific Node wrappers; file paths are the brace expansions |
| `app/api/marketplace/payments/orders/[orderId]/route.ts`, `app/api/marketplace/stripe/webhook/route.ts` | Scoped GET status and public signed POST webhook |
| `app/marketplace/payments/page.tsx`, `app/marketplace/payments/return/page.tsx`, `app/marketplace/payments/refresh/page.tsx`, `app/marketplace/orders/[orderId]/page.tsx` | Seller panel/onboarding return/refresh and private guest order page |
| `features/marketplace/components/{SellerPaymentsPanel,BuyNowButton,OrderConfirmation}.tsx` | Compact retro controls, hosted redirects, persisted-status polling |
| New generated migrations `*_marketplace_payments.sql`, `*_marketplace_payment_functions.sql` | Additive tables/grants and transaction functions; filenames assigned by CLI during execution |
| `supabase/tests/marketplace-payments.sql`, `scripts/test-marketplace-payments-db.ts` | Rolled-back SQL assertions and local-stack committed concurrency tests |
| `scripts/lib/marketplace-demo-fixtures.ts`, `scripts/classify-marketplace-demos.ts`, `scripts/reconcile-marketplace-payments.ts`, `scripts/verify-marketplace-payments.ts` | Shared deterministic fixture expectations, exact-ID classification, stuck-order recovery, read-only acceptance evidence checks |
| `docs/MARKETPLACE_PAYMENTS.md`, existing Marketplace docs, `.env.example`, package files | Runbook, limitations, environment names, reproducible test/dependency commands |

Define these shared contracts before consumers; property names below are normative:

```ts
// features/marketplace/payments/types.ts
type PaymentAvailability = 'unavailable' | 'ready' | 'reserved' | 'sold';
type PublicPaymentState = { sandbox: boolean; availability: PaymentAvailability };
type OrderConfirmation = {
  orderId: string; listingId: string; title: string;
  status: 'pending' | 'paid' | 'expired' | 'review';
  currency: 'PHP'; grossMinor: number; applicationFeeMinor: number;
  sellerBeforeProcessingMinor: number; sandbox: true;
};
// Rules: decimalToMinor(value: string): number; applicationFeeMinor(gross: number): number.

// lib/server/marketplace-payments/contracts.ts — private, never client imports
type PaymentContext = { tenant: string; origin: string; enabled: boolean };
type OrderState = 'preparing' | 'open' | 'paid' | 'expired' | 'review';
type SellerIdentity = { id: string; emailNormalized: string; tenant: string };
type SellerAccount = {
  sellerId: string; accountId: string; ready: boolean;
  connection: 'pending' | 'ready' | 'restricted';
  checkedAt: string; accountCreateKey: string;
};
type PendingSellerAccount = {
  sellerId: string; accountId: string | null; accountCreateKey: string;
  preparedAt: string;
};
type StoredOrder = {
  id: string; tenant: string; listingId: string; sellerId: string;
  accountId: string; buyerAccessHash: string; readExpiresAt: string;
  submissionKey: string; state: OrderState; title: string;
  grossMinor: number; feeMinor: number; currency: 'php'; livemode: false;
  sessionId: string | null; paymentIntentId: string | null;
  createKey: string; checkoutExpiresAt: number; preparedAt: string;
  stripeApiVersion: string | null; createParams: Record<string, unknown> | null;
};
type PreparedOrder = StoredOrder & {
  stripeApiVersion: string; createParams: Record<string, unknown>;
};
type CanonicalCheckout = {
  sessionId: string; accountId: string; paymentIntentId: string | null;
  status: 'open' | 'complete' | 'expired'; paymentStatus: string;
  intentStatus: string | null; livemode: boolean; currency: string | null;
  grossMinor: number | null; feeMinor: number | null; quantity: number;
  intentAmountReceivedMinor: number | null; intentCurrency: string | null;
  url: string | null; expiresAt: number; clientReferenceId: string | null;
  metadata: Record<string, string>; intentMetadata: Record<string, string>;
};
type Settlement = {
  currency: string; grossMinor: number; applicationFeeMinor: number;
  stripeFeeMinor: number; otherFeeMinor: number; netMinor: number;
};
```

All external identifiers validate before provider calls. Stripe SDK types stay inside the gateway. `PaymentDeps` in `contracts.ts` contains `store: PaymentStore`, `stripe: StripeGateway`, `mailer: SellerMailer`, `context: PaymentContext`, `secret: string`, `now: () => Date`, and `randomBytes: (size:number) => Buffer`; construct production dependencies lazily inside handlers, inject fakes in tests. Return private errors as allowlisted status/copy only. No network setup at module import/build time.

### Task 1: Add explicit inventory classification and atomic payment storage

**Files:** Create shared types/rules/contracts/store and their tests from the map; two generated migrations; `supabase/tests/marketplace-payments.sql`; `scripts/test-marketplace-payments-db.ts`; `scripts/lib/marketplace-demo-fixtures.ts`; `scripts/classify-marketplace-demos.ts` and `scripts/classify-marketplace-demos.test.ts`. Modify `features/marketplace/{types,validation}.ts`, their tests, `lib/server/{marketplace-store,marketplace-handlers}.ts` and handler tests, `scripts/seed-marketplace-demos.ts`, `package.json`. Preserve original public RPC signatures except where a new RPC is explicitly named below.

**Interfaces:**

- Extend `CreateListingInput` with `inventoryKind: 'ordinary'|'sandbox'` (missing input defaults ordinary); `PublicListing` adds `inventoryKind: 'ordinary'|'demo'|'sandbox'`, never a tenant/account/contact. Browser cannot submit `demo` or payment tenant. `MarketplaceStore.publish(..., input, paymentTenant?: string): Promise<string>` passes the tenant only from server configuration.
- `PaymentStore` methods are Promise-returning: `consumeRate(actor:string,action:string,limit:number): boolean`; `findSeller(emailNormalized:string,tenant:string): SellerIdentity|null`; `reserve(input:{listingId:string;buyerAccessHash:string;submissionKey:string;tenant:string;now:Date}): StoredOrder`; `prepareCheckout(input:{orderId:string;tenant:string;params:Record<string,unknown>;apiVersion:string}): PreparedOrder`; `attachSession(orderId:string,tenant:string,canonical:CanonicalCheckout): StoredOrder`; `findOrder(orderId:string,tenant:string): StoredOrder|null`; `applyCheckout(input:{orderId:string;tenant:string;eventId:string;eventType:string;canonical:CanonicalCheckout;now:Date}): 'paid'|'expired'|'held'|'duplicate'|'review'`; `saveSettlement(orderId:string,tenant:string,settlement:Settlement): void`. Wrap each listed result in `Promise<...>` in the actual interface. Remaining seller methods are defined in Tasks2/3 in the same interface.
- Read-only operator store methods: `findInventory(listingId:string,tenant:string):Promise<{listingId:string;inventoryKind:'ordinary'|'demo'|'sandbox';status:'active'|'sold'|'removed'}|null>`; `findPaidWebhookReceipt(orderId:string,tenant:string):Promise<{eventId:string;eventType:'checkout.session.completed'}|null>`; `listReconciliationOrders(tenant:string):Promise<StoredOrder[]>`. These private queries support Tasks5/7 without exposing an inspection API. Receipt lookup accepts only a signature-verified completed-event receipt whose outcome is paid, never an operator receipt.
- `decimalToMinor('1234.50')` is 123450; `applicationFeeMinor(123450)` is 12345; `(10005)` rounds to 1001. Reject malformed decimal strings, negatives and unsafe integers. Payment eligibility bound is 10000..99999999 minor units, separate from unchanged listing validation bounds.

- [ ] **Step 1: Write failing pure and database assertions.** `rules.test.ts` asserts the exact amounts above, 10000/99999999 allowed and 0/9999/100000000 ineligible. SQL tests assert private table/RPC denial for both anon and authenticated; ordinary/demo reservations rejected; wrong tenant rejected; same buyer/key returns the same order; changed listing/key reuse conflicts; paid cannot demote; contact/account IDs absent from public listing fields. Local concurrency runner creates a run-scoped sandbox fixture and asserts 20 concurrent `reserve` requests yield one order/hold and 19 conflicts, and two concurrent paid transitions yield one sale. Create only test fixtures, clean up exact run IDs in `finally`; refuse any non-local Supabase URL.

  Pin the monetary assertions directly (the remaining database cases use the fixtures described above):
  ```ts
  test('PHP fee uses exact minor units and half-up rounding', () => {
    assert.equal(decimalToMinor('1234.50'), 123450);
    assert.equal(applicationFeeMinor(123450), 12345);
    assert.equal(applicationFeeMinor(10005), 1001);
    assert.throws(() => decimalToMinor('1e3'));
    assert.throws(() => decimalToMinor('0.001'));
  });
  ```
- [ ] **Step 2: Run red checks.** `node --import=tsx --test features/marketplace/payments/rules.test.ts` must fail for missing rules; after configuring a disposable local stack, SQL/concurrency checks must fail for absent schema/functions. Discover installed Supabase CLI version/help first; do not target a linked hosted database for these tests. No dependencies need installation for the existing test runner.
- [ ] **Step 3: Implement the data boundaries.** Generate migration names using `supabase migration new marketplace_payments` and `supabase migration new marketplace_payment_functions` after checking CLI help; record the exact generated paths. Add `inventory_kind` default ordinary to listings. Add private RLS tables `marketplace_payment_inventory` (listing PK, tenant), `marketplace_payment_sellers` (UUID, tenant, normalized email unique per tenant, verified_at), `marketplace_seller_challenges`, `marketplace_seller_sessions`, `marketplace_connected_accounts` (unique tenant/seller and unique account ID, readiness fields, pending creation key), `marketplace_orders`, `marketplace_stripe_events` (tenant/event unique, minimal identifiers/outcome, no payload). Order FKs restrict deletion of payment history; no cascading deletion of paid orders. Keep event/account/tenant/authorization columns private. Represent integer amounts with bigint plus bounds that safely map to JS numbers.
- [ ] **Step 4: Implement atomic RPCs and adapter.** New invoker RPCs with `search_path=''` and service-role-only EXECUTE: `marketplace_reserve_order(p_tenant text,p_listing_id uuid,p_buyer_hash text,p_key uuid,p_now timestamptz) returns jsonb`; `marketplace_prepare_checkout(p_tenant text,p_order_id uuid,p_params jsonb,p_api_version text) returns jsonb`; `marketplace_attach_checkout(p_tenant text,p_order_id uuid,p_checkout jsonb) returns jsonb`; `marketplace_apply_checkout(p_tenant text,p_order_id uuid,p_event_id text,p_event_type text,p_checkout jsonb,p_now timestamptz) returns text`. Lock the listing, snapshot SQL price and private email/account mapping, check current readiness, and enforce partial unique holding/paid indexes. Prepare stores the first validated params/API version under the order lock, cross-checking gross/fee/currency/quantity/metadata with snapshots; subsequent calls return those original params without overwriting. All fulfillment, receipt and listing changes commit together. Existing `marketplace_publish` keeps its signature but atomically creates classification/private tenant binding from server-validated input; require tenant for sandbox, reject for ordinary. Duplicate publication cannot reclassify/rebind an existing row. Keep the wrapper's fingerprint bound to inventory kind. RPC calls never span Stripe requests.
- [ ] **Step 5: Implement safe fixture classification.** Extract `fixtureId(namespace:string,slug:string):string` and `expectedDemoRows():DemoExpectation[]` into `scripts/lib/marketplace-demo-fixtures.ts`; `DemoExpectation` has exact existing `id,title,description,price,category,sellerDisplayName,imagePath,sellerEmail` fields, all derived from the checked-in manifest and original deterministic algorithm. Seeder and classifier import this shared source. Classifier default is inspection only. `--apply` calls `marketplace_classify_demo_inventory(p_expected jsonb) returns jsonb` once, service-only, checking full fields/private contact inside a transaction, aborting on any mismatch and reporting missing IDs without creating them. It changes only kind to demo. Update the existing seeder to invoke that same exact-ID classification for its own verified rows; no email replacement, purchase binding or title-prefix discovery. Test a forged `[Demo]` title, one changed manifest row, missing fixture and repeat apply; assert ordinary rows and private contacts unchanged. Use injected fake DB for the unit test; do not execute hosted seeding here.
- [ ] **Step 6: Run green checks and commit.** Run pure tests, existing Marketplace tests, rolled-back SQL tests and the local concurrency runner using the exact local target syntax discovered from CLI help. Expected: all pass, one winner, no grants to private tables/functions, no fixtures left behind. Add the new unit test paths to the explicit `npm test` list. `git add` only these task files and generated migrations; `git commit -m "feat: add isolated marketplace payment storage"`.

### Task 2: Prove seller email ownership without registering users

**Files:** Create `request.ts`, `proof.ts`, `seller-mailer.ts`, `seller-handlers.ts` and `proof.test.ts`, `seller-handlers.test.ts` under `lib/server/marketplace-payments/`; create challenge/verify/logout/status route wrappers; extend contracts/store and second generated migration; update `.env.example` and `package.json` test list.

**Interfaces:**

- `SellerMailer.sendCode({to:string,code:string,expiresMinutes:10}): Promise<void>`; `createSellerMailer(): SellerMailer` uses Resend HTTPS only.
- `normalizeSellerEmail(value:unknown): string`; `proofHash(purpose:'seller-session'|'buyer-session'|'browser'|'email',value:string,secret:string): string`; `codeHash(challengeId:string,email:string,browserHash:string,code:string,secret:string): string`; `newCapability(randomBytes): string`; `capabilityCookie(kind:'seller'|'buyer'|'verify',value:string,maxAge:number,secure:boolean): string`.
- `requireSeller(req:Request,deps:PaymentDeps): Promise<SellerIdentity>` checks stored proof/tenant/expiry; never Board auth. Handler exports `handleSellerChallenge`, `handleSellerVerify`, `handleSellerLogout`, `handleSellerStatus`, each `(req:Request,deps?:PaymentDeps): Promise<Response>`.
- Store additions: `issueChallenge({id,emailNormalized,tenant,browserHash,codeHash,expiresAt}): Promise<void>`; `consumeChallenge({id,tenant,browserHash,candidateHash,sessionHash,now}): Promise<SellerIdentity|null>`; `findSellerSession(sessionHash,tenant,now): Promise<SellerIdentity|null>`; `revokeSellerSession(sessionHash,tenant): Promise<void>`. Consumption atomically increments failed attempts and creates the verified identity/session on success. Challenges and sessions are never publicly readable.
- `request.ts` provides `assertPaymentOrigin(req,context):void`, `readPaymentJson(req,maxBytes=8192):Promise<Record<string,unknown>>`, `paymentErrorResponse(error):Response`; reuse `jsonResponse` and `readCookieValue` only, not Board's error logger. Missing/wrong/malformed browser requests fail before mail/Stripe calls.

- [ ] **Step 1: Write failing ownership tests.** In-memory mailer captures only fictional test codes; fake clock fixes expiry. `verified_email_claims_only_matching_tenant` asserts trim/case match and distinct plus addresses. `codes_are_single_use_and_browser_bound` asserts wrong nonce, ten-minute expiry, fifth failed guess and replay deny; two simultaneous valid exchanges produce one session. `challenge_response_does_not_enumerate` asserts same 202 shape for no listing, demo `.invalid`, and existing email; external delivery exceptions never include address/code. `typed_email_or_board_session_is_not_authority` asserts connect authorization 401 without Marketplace proof. `ownership_rate_limits` asserts the spec's three/email and ten/IP sends, 30/IP verification attempts, and challenge replacement invalidation. Cookie tests assert HttpOnly/Lax/Secure/Path=/ and expiry. Capture handler logs and assert no code/address/provider payload emitted.

  Include these assertions in the named normalization/cookie tests:
  ```ts
  assert.equal(normalizeSellerEmail(' Seller@Example.invalid '), 'seller@example.invalid');
  assert.notEqual(normalizeSellerEmail('a+one@example.invalid'), normalizeSellerEmail('a@example.invalid'));
  const cookie = capabilityCookie('seller', 'test-capability', 3600, true);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=3600']) {
    assert.ok(cookie.includes(flag));
  }
  ```
- [ ] **Step 2: Run red.** `node --import=tsx --test lib/server/marketplace-payments/proof.test.ts lib/server/marketplace-payments/seller-handlers.test.ts`; expected missing exports/failed ownership assertions.
- [ ] **Step 3: Implement proof, mail and RPCs.** Add service-only `marketplace_issue_seller_challenge` and `marketplace_consume_seller_challenge` RPCs with arguments matching the store additions. Store code HMAC/browser hash, not plaintext. A generic challenge response is `{challengeId:string,message:'If delivery is available, a verification code has been sent.'}` plus verify-browser cookie (600 seconds). Reuse a valid existing verify-browser nonce on resend so earlier same-email/browser challenges can be invalidated atomically; generate it only when absent/invalid. Verify JSON `{challengeId,code}` requires that cookie; success is `{verified:true}` plus seller cookie (3600 seconds), never email or Stripe account ID. Log out revokes current Marketplace seller proof and clears that cookie. Status returns `{verified:boolean,connection:'not_connected'|'pending'|'ready'|'restricted'}` without identifying contact fields. Resend calls use bounded timeout, no provider response logging, verified sender, no link tracking, idempotency by challenge ID, and no automatic duplicate send after an ambiguous response. No public development bypass. Restrict codes to six numeric digits and comparison to equal-length timing-safe values.
- [ ] **Step 4: Run green and commit.** Run new tests plus SQL tests for challenge attempts, single-use consumption, expiry and grants; run existing auth/Board/profile tests unchanged. Expected all pass without external email/configuration. Commit the exact files as `feat: verify marketplace seller email ownership`.

### Task 3: Add fail-closed Stripe onboarding and readiness

**Files:** Create `config.ts`, `stripe-gateway.ts`, `connect-handlers.ts`, `config.test.ts`, `stripe-gateway.test.ts`, `connect-handlers.test.ts`; extend contracts/store/migration; create connect/connect-refresh wrappers; modify package files and `.env.example`.

**Interfaces:**

- `getPaymentConfig(env:NodeJS.ProcessEnv): PaymentContext & {country:string;secretKey:string;webhookSecret:string}` validates all required names/test mode and fixed HTTPS origin (localhost only for local). `enabled=false` permits the ordinary Marketplace to work without Stripe configuration. Check `context.enabled` before new onboarding/Checkout creation, independently of webhook/order-read/reconciler operation. Secrets never leave server dependency construction.
- `StripeGateway` methods: `ensureAccount(seller:SellerIdentity,createKey:string):Promise<{accountId:string}>`; `readAccount(accountId:string):Promise<{accountId:string;ready:boolean;connection:'pending'|'ready'|'restricted';metadata:Record<string,string>;checkedAt:string}>`; `onboardingLink(accountId:string,origin:string):Promise<{url:string}>`; `createCheckout(order:PreparedOrder):Promise<{sessionId:string;url:string}>`; `readCheckout(order:StoredOrder,sessionId?:string):Promise<CanonicalCheckout>`; `expireCheckout(order:StoredOrder):Promise<CanonicalCheckout>`; `readSettlement(order:StoredOrder):Promise<Settlement|null>`; `verifyEvent(raw:Buffer,signature:string): VerifiedPaymentEvent`. Define `VerifiedPaymentEvent` as `{id:string;type:string;accountId:string|null;livemode:boolean;objectId:string;metadata:Record<string,string>}`; parse only after SDK verification. Task4 implements Checkout methods, Task5 settlement/event methods in this adapter.
- Store additions: `ensureSellerAccountSlot(sellerId:string,tenant:string):Promise<PendingSellerAccount>` reserves/reuses a durable creation key before `accountId` exists; `saveSellerAccount(sellerId:string,tenant:string,accountId:string,createKey:string):Promise<void>`; `findSellerAccount(sellerId:string,tenant:string):Promise<SellerAccount|null>`; `findAccountById(accountId:string,tenant:string):Promise<SellerAccount|null>`; `acquireAccountRefresh(accountId:string,tenant:string,leaseId:string):Promise<boolean>`; `saveAccountReadiness(accountId:string,tenant:string,leaseId:string,readiness:{ready:boolean;connection:'pending'|'ready'|'restricted'},checkedAt:string):Promise<boolean>`. Account slot creation/attach use service-only atomic `marketplace_ensure_account_slot(p_tenant text,p_seller_id uuid)` and `marketplace_save_account(p_tenant text,p_seller_id uuid,p_account_id text,p_create_key text)` RPCs. Refresh lease lasts20seconds according to DB time; save requires its unexpired fencing ID and releases it. Use equivalent service-only acquire/save RPCs, never a transaction spanning HTTP. A superseded refresh cannot restore readiness; busy/expired lease makes new checkout fail503. In this gateway, bound account retrieval to5seconds and at most one retry so it fits the lease. Keep pending account creation timestamps for the23-hour ambiguity freeze.
- `handleConnect`, `handleConnectRefresh` use verified seller only and return `{url:string}` for Stripe-hosted onboarding. Refresh uses POST after an authorized refresh page loads. Never take account/country/return URL from the browser. `handleSellerStatus` refreshes known account if cache >60 seconds; a return parameter cannot set ready.

- [ ] **Step 1: Write failing config/gateway/handler tests.** `config_rejects_live_or_missing_configuration` asserts disabled default, valid sandbox-only enabled configuration, wrong origin and missing webhook/email config fail closed with no secret in error. `onboarding_requires_verified_seller` denies arbitrary email/account ID, Board cookie, cross-origin and foreign tenant. `parallel_connect_uses_one_account_slot` asserts one persisted account and stable create key after double click/timeout. `return_is_not_readiness` leaves incomplete account disabled; each false readiness condition, deleted account and API failure disables Buy Now. `stale_account_event_cannot_restore_readiness` is completed in Task 5. SDK fake asserts exact controller properties, metadata, server country and hosted `account_onboarding`, no private email, no destination-charge options. Timeouts beyond 23 hours freeze an ambiguous account-creation slot for reconciliation rather than rekeying.

  Pin the initial configuration behavior without credentials:
  ```ts
  assert.equal(getPaymentConfig({}).enabled, false);
  assert.throws(() => getPaymentConfig({ MARKETPLACE_PAYMENTS_ENABLED: 'true' }));
  // In return_is_not_readiness, after the injected incomplete-account read:
  assert.equal(savedAccount.ready, false);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).connection, 'pending');
  ```
- [ ] **Step 2: Run red.** `node --import=tsx --test lib/server/marketplace-payments/config.test.ts lib/server/marketplace-payments/stripe-gateway.test.ts lib/server/marketplace-payments/connect-handlers.test.ts`; expected missing implementation or contract failures.
- [ ] **Step 3: Add the official SDK and implement onboarding.** During authorized execution only, query the current official SDK release/engines, install `stripe` with `--save-exact`, record exact installed version and stable supported API version in `stripe-gateway.ts` and runbook; update lockfile. Use bounded SDK timeout/retries with stable account creation parameters and key. Implement Accounts v1 controller configuration and readiness from the spec. Request/verify the needed card capability for the supported country; do not demand an unnecessary destination-transfer flow. Persist account ID before issuing Account Link. Use server-built `/marketplace/payments/return` and `/marketplace/payments/refresh` URLs. Never store the single-use link or change the mapping from posted values. Pin webhook snapshot version to the selected SDK API version during later registration. Do not contact Stripe in unit tests.
- [ ] **Step 4: Document and later perform the compatibility gate.** Add a runbook checklist for platform identity/Connect authority, supported country/controller/onboarding, PHP/card/application-fee compatibility and Connect endpoint permission. Actual credentialed checks wait for implementation authorization and secure credential access; any unsupported choice blocks external QA with an explicit finding. Keep local progress possible. Update `.env.example` with empty values/comments for all spec names; no invented valid keys or literal supplied credentials.
- [ ] **Step 5: Run green and commit.** Run new tests, `npm run typecheck` and lint for touched files; verify client files import neither SDK nor private contracts. Commit as `feat: add verified Stripe seller onboarding`.

### Task 4: Reserve one sandbox item and create retry-safe hosted Checkout

**Files:** Create `checkout-handlers.ts`, `checkout-handlers.test.ts`; extend gateway/tests/store; create buyer-session/checkout route wrappers; update test list.

**Interfaces:** `handleBuyerSession(req:Request,deps?:PaymentDeps):Promise<Response>` sets a seven-day opaque buyer cookie and returns204; `requireBuyer(req:Request,deps:PaymentDeps): {accessHash:string}` validates its random-token shape; `handleCheckout(req:Request,deps?:PaymentDeps):Promise<Response>` accepts only JSON `{listingId:string}` and UUID `Idempotency-Key`, returning201 `{orderId:string,url:string}` or400/401/409/429/503. Require buyer bootstrap first; no order is reserved on missing proof. `ensureCheckout(order:StoredOrder,deps:PaymentDeps):Promise<{orderId:string,url:string}>` first calls `prepareCheckout` to persist/reuse parameters and obtain `PreparedOrder`, then performs identical-key retries, never new-order fallback. Reserve returns the same stored order for same buyer/key.

- [ ] **Step 1: Write failing Checkout tests.** `checkout_uses_sql_snapshot_and_connected_account` sends a tampered price/account/fee and asserts rejected unknown fields (400), then valid input asserts SDK gross 123450/php, fee12345, quantity1/card-only, stable metadata and `stripeAccount` from order. `only_sandbox_ready_matching_tenant_can_pay` covers ordinary, demo, zero/tiny/too-large price, wrong tenant, restricted/deleted seller and sold listing; no Stripe call. `parallel_buyers_create_only_one_session` races 20 requests over the local store adapter and counts one hold/one create key. `ambiguous_creation_never_rekeys_or_time_releases` loses provider response and DB attach response, repeats same params/key, then advances beyond the retry window and asserts hold/review, no new key/session. `buyer_cookie_precedes_checkout` asserts a missing cookie reserves nothing and returns401. Cross-origin/oversize/rate tests assert no reserve. Reusing a key for another listing returns409. A declined card stays in the same open session; cancel URL never calls a release RPC.

  In the20-request race, assert the observable outcome and persisted cardinality:
  ```ts
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 19);
  assert.equal(new Set(recordedCreateKeys).size, 1);
  assert.equal(holdingOrders.length, 1);
  ```
- [ ] **Step 2: Run red.** `node --import=tsx --test lib/server/marketplace-payments/checkout-handlers.test.ts lib/server/marketplace-payments/stripe-gateway.test.ts`; expected missing handler/SDK parameter failures.
- [ ] **Step 3: Implement bootstrap, reservation and SDK creation.** Limit buyer bootstrap and checkout to 20/hour/IP each; use persistent payment action names and no raw IPs. Buyer bootstrap preserves an existing valid capability instead of rotating it on every click; add a test that a second purchase leaves the first order readable. Refresh the locally mapped seller account just before reserve/create; on a failed readiness refresh, save not-ready and fail closed. `reserve` checks tenant binding and snapshots SQL amounts. Persist all Stripe creation parameters/API version, fixed initial expiry, safe product title and deterministic idempotency key before its first call; reuse `createParams` verbatim on retry even across a deployment. Use `payment_intent_data.application_fee_amount`, matching Session/Intent metadata, `client_reference_id=order.id`, fixed origin success URL `/marketplace/orders/{id}`, cancel URL to listing, no adaptive pricing/recovery/taxes/promotions. Set expiry to preparedAt +31 minutes; retry only if Stripe still accepts that unchanged expiry (at least 30 minutes ahead), otherwise leave held for reconciliation. Never reuse a pruned key to create a replacement after 23 hours. A known successful create/attach returns Checkout URL from Stripe; a retry of an already-bound open session retrieves its URL server-side. A paid/expired retry returns the order page URL with its status, not a fresh Checkout. Strictly allow returned HTTPS Stripe Checkout/onboarding hosts before browser navigation.
- [ ] **Step 4: Run green and commit.** Run handler/gateway tests and the local concurrency runner with controlled provider fakes. Expected one payable session per listing, stable retry data, no inventory release on clock/error/cancel. Commit as `feat: reserve sandbox listings for direct Checkout`.

### Task 5: Verify Connect events and atomically confirm sales

**Files:** Create `reconcile.ts`, `webhook-handler.ts`, `reconcile.test.ts`, `webhook-handler.test.ts`; extend gateway/store/tests; create public webhook wrapper; create `scripts/reconcile-marketplace-payments.ts` and its test; update test list.

**Interfaces:** `handleStripeWebhook(req:Request,deps?:PaymentDeps):Promise<Response>` verifies raw bytes first. `reconcileOrder(order:StoredOrder,deps:PaymentDeps,event?:{id:string;type:string;sessionId:string}):Promise<'paid'|'expired'|'held'|'duplicate'|'review'>` retrieves canonical scoped state and invokes `applyCheckout`. `refreshKnownAccount(accountId:string,deps:PaymentDeps):Promise<SellerAccount>` implements Task3's fenced lease and rereads Stripe; do not use event payload/timestamps to restore readiness. Implement this account helper in Task3's `connect-handlers.ts` so Checkout can already use it in Task4; Task5 imports it. `readSettlement` retries independently of paid fulfillment. Reconciler script defaults read-only, selects only current tenant orders, and mutates only with `--apply`; no arbitrary account IDs from command input.

- [ ] **Step 1: Write failing signature/scoping/transition tests.** Use a locally generated test signing secret with the SDK signature-test helper; never supplied credentials. Missing/bad/stale signature→400, body>1MiB→413, raw whitespace preserved. `foreign_signed_events_are_noops`: foreign tenant/account/order or live-mode event→200, zero DB writes and no foreign API lookups; supported event missing local account also→200. `known_mismatch_never_sells`: mutate account, session, listing metadata, amount, quantity, PHP currency, fee and Intent metadata one at a time→review, no Sold. `webhook_can_bind_preparing_order_once`: completed paid event before create response binds canonical session; later attach same ID is idempotent and different ID is review. Duplicate event ID and different IDs for same payment produce one paid order/Sold update. Inject failure between event receipt and listing update→rollback/503, retry→paid. Test paid then expired and expired payload with currently-paid canonical session→paid, never downgrade. `expiry_requires_terminal_intent` asserts local clock/cancel/unpaid complete/processing/unknown never releases; verified expired+no Intent or canceled Intent releases; expire-versus-complete race retrieves/finalizes the winner. `stale_account_event_cannot_restore_readiness` uses two concurrent stale events with canonical restricted account→ready=false. `settlement_does_not_subtract_application_fee_twice` uses PHP gross123450, app12345, Stripe fee4000, other0, net107105; also non-PHP settlement remains separately denominated and unavailable balance data stays pending.

  Pin foreign-event and duplicate-payment outcomes after the injected calls:
  ```ts
  assert.equal(foreignResponse.status, 200);
  assert.equal(foreignDatabaseWrites.length, 0);
  assert.equal(foreignStripeReads.length, 0);
  assert.equal(paidOrders.length, 1);
  assert.equal(soldUpdates.length, 1);
  assert.equal(settlement.netMinor, 107105);
  ```
- [ ] **Step 2: Run red.** `node --import=tsx --test lib/server/marketplace-payments/webhook-handler.test.ts lib/server/marketplace-payments/reconcile.test.ts`; expected absent verifier/transitions. Add SQL tests for transactional receipts, duplicate semantic events, monotonic paid and sold-only-sandbox guard; run them red before finalizing RPC logic.
- [ ] **Step 3: Implement signed ingress and fulfillment.** Raw body is read once, signature verified with SDK default tolerance, no JSON parse before verification. Dispatch exactly completed/account.updated/expired; foreign/unsupported signed traffic is an acknowledged no-op. For known local completed/expired work retrieve Session, line item quantity, Intent and fee on order account; validate all bindings in the spec, then use atomic RPC. Do not accept metadata alone as ownership. A canonical paid session requires `status='complete'`, `payment_status='paid'`, succeeded Intent and exact amount_received/currency/application fee before paid mutation. If an event predates DB session attach, permit the one guarded initial binding. API/DB transient failure→503; permanent mismatch→minimal review receipt/200. Store no webhook payload/contacts. Receipt uniqueness must not permanently skip a previously held/nonterminal result: a later canonical reconciliation or authenticated redelivery may advance it to paid while terminal paid remains idempotent. Add that delayed-paid test. Normal200 occurs only after the atomic transaction or safe no-op; no unawaited serverless background fulfillment.
- [ ] **Step 4: Implement release/recovery and fee enrichment.** Session expiry alone is insufficient when an Intent could succeed. `StripeGateway.expireCheckout` expires an open Session, attempts permitted cancellation of its unpaid nonterminal Intent, then retrieves canonical state; verify terminal canceled result before `expired`; processing/unknown retains hold. Reconciler retrieves existing sessions; for ambiguous unbound orders, it may retry identical creation only inside Task4's safe expiry window. Outside it, report/freeze for an operator to locate the exact owned Session via metadata in the connected account and attach/reconcile with reviewed evidence; never guess or release automatically. Apply the same no-rekey rule to ambiguous account slots. A previously terminal-expired order that unexpectedly becomes paid is an anomaly: retain review evidence, stop new purchases on the affected listing for investigation, preserve any newer paid order, and never produce a second sale. Use a synthetic namespaced receipt ID and `eventType='operator.reconcile'` for operator reconciliation through the same RPC, keeping it distinguishable from an actual webhook event. Webhook acceptance must still be demonstrated with a real signed event. Enrich settlement with allowlisted balance fields; compare same-currency fee sums and don't double-subtract. Dry-run prints only own opaque IDs/state/action, no email/code/keys/customer payloads. The purchase kill switch must leave webhook processing, private order reads and reconciliation operational.
- [ ] **Step 5: Run green and commit.** Run new tests, local SQL/concurrency suite including paid/expiry race. Expected one sale, failed transaction retriable, foreign events untouched and fees reconciled. Commit as `feat: confirm marketplace sales from signed Connect events`.

### Task 6: Integrate seller controls, Buy Now and private order confirmation

**Files:** Create the three UI components and four pages from the map; create `order-handlers.ts`, `order-handlers.test.ts`, order status wrapper; modify `app/marketplace/[id]/page.tsx`, `features/marketplace/components/{ListingForm,ListingBrowser,MarketplaceSidebar}.tsx`, `app/marketplace/marketplace.css`, `features/marketplace/{types,validation}.ts`, `lib/server/marketplace-store.ts`, tests and generated function migration as needed. Add `features/marketplace/payments/presentation.test.ts` for pure status rendering decisions.

**Interfaces:** In `store.ts`, `getPublicPaymentStates(listingIds:string[],context:PaymentContext):Promise<Record<string,PublicPaymentState>>` batches database display eligibility for browse (detail passes one ID); never make provider calls per card or include account/email/tenant in public DTO. `getOrderConfirmation(orderId:string,buyerHash:string,tenant:string,now:Date):Promise<OrderConfirmation|null>` and `handleOrderStatus(req:Request,deps?:PaymentDeps):Promise<Response>` return the explicit public confirmation DTO only for matching proof/read expiry. `SellerPaymentsPanel` owns challenge→verify→connect/status flow. `BuyNowButton({listingId,paymentState})` bootstraps buyer then posts listing only. `OrderConfirmation({initial:OrderConfirmation})` polls persisted status with the timing/copy from the spec. Public detail `find` now allows active/sold, rejects removed; browse/count stays active only. Change RLS public SELECT policy to active/sold public listing columns only; private data remains elsewhere.

- [ ] **Step 1: Write failing scoped-read/presentation tests.** `order_id_is_not_authority` asserts absent/wrong cookie, another browser, other tenant, malformed/missing ID and expired read proof all return identical404, no Stripe call. Valid proof sees only DTO keys; no contact/account/Intent/session/hash fields. `success_parameters_cannot_confirm_payment` supplies `paid=true`/session ID to pending order and asserts pending. `sold_detail_remains_public_but_unbuyable` asserts sold detail200, removed404, active-feed count excludes sold, inquiry fails for sold. Presentation assertions cover unavailable/reserved/ready/sold, demo/sandbox labels, incomplete onboarding, lost cookie404, fee-aware copy and pending after timeout. Update existing DTO allowlist tests for only approved additional fields.

  Pin authorization and pending status in their respective handler tests:
  ```ts
  assert.equal(wrongBuyerResponse.status, 404);
  assert.deepEqual(await wrongBuyerResponse.json(), await absentOrderResponse.json());
  assert.equal((await forgedSuccessResponse.json()).status, 'pending');
  assert.doesNotMatch(JSON.stringify(confirmation), /sellerEmail|buyerEmail|accountId|sessionId|AccessHash/);
  ```
- [ ] **Step 2: Run red.** Run order/presentation tests and existing Marketplace validation/handler tests; expect absent order handlers and sold lookup failure.
- [ ] **Step 3: Implement native retro UI and scoped reads.** Add **Seller payments** sidebar link. Seller form uses private email/code with generic feedback and no ordinary registration, supports expiry/retry/logout. Status exposes safe connection state and accurate pending/restricted copy. Refresh landing requires seller proof then a same-origin POST for a new hosted link. Add explicit sandbox checkbox to existing new form; server still defaults ordinary and ignores client tenant. Show **Sandbox demo — no real money or delivery** on sandbox listing, seller panel, Checkout handoff and order pages; use **Buy Now** only for ready, with clear held/unavailable state otherwise. Preserve existing inquiry copy/functionality for active listings and photo/upload limits. Sold detail hides purchase/inquiry controls and displays Sold. Keep `force-dynamic`, no-store responses, private/noindex metadata and `Referrer-Policy: no-referrer` for payment/order pages; no third-party analytics on code/order screens. Read cookies with Next.js 15's awaited cookies API. Public metadata never includes email/order data. Use existing Tahoma/blue/buttons/borders, accessible labels and live status regions; no redesign or new animation library.
- [ ] **Step 4: Run green and browser QA.** Run all tests, `npm run lint`, `npm run typecheck`, then `npm run build` (not simultaneously with dev). Through Orca browser after reading its CLI guide, inspect new and preserved pages at375/768/1440 widths and keyboard-only: codes/errors preserve input appropriately; controls disable during submits; no overflow; success pending cannot appear paid. Check two independent browser contexts: only initiating buyer sees its order; sold listing deep link works without cookies. Local QA uses injected test fixtures; real hosted acceptance is Task8. Commit as `feat: integrate sandbox payments into retro Marketplace`.

### Task 7: Make payment QA and operations reviewable

**Files:** Create `scripts/verify-marketplace-payments.ts`, `docs/MARKETPLACE_PAYMENTS.md`; modify existing Marketplace docs, `.env.example`, package scripts, and `scripts/verify-marketplace.ts` only if new DTO/classification assertions require it. Add `scripts/verify-marketplace-payments.test.ts` and register its unit tests.

**Interfaces:** verifier command `node --env-file=.env.local --import=tsx scripts/verify-marketplace-payments.ts --base <https-origin> --order-id <owned-order-uuid>` is read-only: uses server credentials to inspect only that order/tenant, canonical Stripe objects, associated sandbox listing and own event receipt; it must not create/expire/pay anything or print secrets/contacts. Export `inspectPaymentOrder(input:{base:string;orderId:string},deps:PaymentDeps):Promise<{paid:boolean;sold:boolean;webhookConfirmed:boolean;feeDetails:'confirmed'|'pending'}>` for injected tests; run CLI main only when invoked directly. Apply the same import-safe entry-point pattern to classifier and reconciler scripts. Human Checkout/onboarding steps generate the record first. Existing `test:marketplace:live` retains its ordinary temporary fixture and exact cleanup. Reconciler/classifier remain dry-run by default with separate explicit `--apply`.

- [ ] **Step 1: Write failing verifier guards.** Unit test refuses wrong origin, live provider object, tenant mismatch, ordinary/demo listing, arbitrary order mismatch and missing receipt. Valid paid fixture asserts exact price/fee, one held→sold association, real event receipt and fee enrichment or explicit pending. Test output excludes all credentials, OTPs, browser proofs, contact/customer fields and raw provider errors. A public GitHub screenshot manifest must not contain any private payload. Do not create a public DB inspection endpoint.

  For the valid paid fixture with available settlement, pin the exported report:
  ```ts
  assert.deepEqual(report, {
    paid: true, sold: true, webhookConfirmed: true, feeDetails: 'confirmed',
  });
  assert.equal(providerMutationCalls.length, 0);
  assert.equal(databaseMutationCalls.length, 0);
  ```
- [ ] **Step 2: Run red.** `node --import=tsx --test scripts/verify-marketplace-payments.test.ts`; expect missing verifier/guard failures.
- [ ] **Step 3: Implement read-only verifier and runbook.** Document all environment names, SDK/API versions, account choice/compatibility gate, Resend sender requirement, shared-key risk, money/fee behavior, full route/state model, migration file names/grants, fixture classifier, local DB runner, reconciler recovery, rollback and evidence checklist. Add `test:marketplace:payments:db` for the local-only script, `test:marketplace:payments:verify` for this operator verifier. Do not put `.env` values in npm scripts or shell history. Use CLI help/version discovery for installed Supabase, Stripe and Vercel tools; old linked schema history differs, so never bulk `db push --include-all` or repair Board history.
- [ ] **Step 4: Run green and full local verification.** `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, local SQL tests and local concurrency runner must pass. Verify public bundle scan and sanitized rendered HTML contain no secret/contact/capability values using locally injected canaries and presence-only reporting. Do not print real secrets even when scanning. Test all original Marketplace flows and Board/People/auth under an isolated local configuration; use existing live verifier only later when write authorization applies. Record actual commands/results and unresolved prerequisites. Commit as `docs: add marketplace payment QA and operations runbook`.

### Task 8: Authorized provider setup, preview QA, then production evidence

**Files:** Update only `docs/MARKETPLACE_PAYMENTS.md` with sanitized actual verification results/evidence references and any separately reviewed code fixes. Provider/DB changes are external operations, not additional software projects. **Do not perform this task during planning.** Selecting an execution method does not itself supply provider credentials, an email domain or permission to change unrelated infrastructure. Use existing authorization evidence at execution; obtain only missing authorization before external mutations.

**Interfaces:** Deployed route is `POST https://fb08.vercel.app/api/marketplace/stripe/webhook`; preview has the same path on its stable authorized QA origin. Registration request is `stripe.webhookEndpoints.create({url: exactOrigin + '/api/marketplace/stripe/webhook', connect:true, enabled_events:['checkout.session.completed','account.updated','checkout.session.expired'], api_version: selectedStableVersion, metadata:{fb08_app:'marketplace-payments-v1',tenant}})`. This is an instruction for later SDK/API operation; never output its response's `secret`. A private operator supplies the result directly to `STRIPE_WEBHOOK_SECRET` using secure input. Exactly these three events are necessary for this card-only flow.

- [ ] **Step 1: Establish authorized prerequisites and targeted migration.** Verify secure credentials are assessor sandbox keys and compatibility checklist passes without printing them. Confirm existing Vercel `fb08` project, Supabase target/history/backup and generated migration diff; apply only the two new reviewed migrations to the authorized target. Run grants/advisors/SQL tests with the CLI's explicit intended target. Do not reset production or replay old migrations. Configure email delivery and prove a code reaches the controlled inbox; if no sender/permission, stop hosted seller acceptance and report it, with local work complete. Inspect/classify exact21 existing demos with dry-run first; apply classification only after exact-field match, never alter contacts or ordinary rows.
- [ ] **Step 2: Deploy stable preview with distinct tenant and safe configuration.** Set required Preview environment names using secure input, keep purchases disabled initially, and deploy existing project preview. Establish public HTTPS access to only the needed webhook route without silently disabling all deployment protection. Register exactly our stable preview endpoint with Connect scope, selected version and three events; retain its endpoint ID privately for our operations. If endpoint quota or permission blocks setup, report it; never delete other candidates' endpoints. Securely set signing secret, enable preview payments, redeploy, then confirm signature failure returns400 and a legitimate known event succeeds. Any environment edit requires a new deployment. Local optional testing uses the installed CLI's documented Connect forwarding (`--forward-connect-to localhost:3000/api/marketplace/stripe/webhook`, plus the installed version's snapshot/event filter flags) and its distinct listener secret; never paste a credential-bearing command or mix CLI/deployed secrets.
- [ ] **Step 3: Prove preview end-to-end.** Through normal UI create two new fictional sandbox listings with the controlled inbox and preview tenant. Verify email once, complete hosted onboarding with Stripe's documented fictional data, verify private account mapping/readiness, and see both matching-email listings become purchasable. Confirm an ordinary listing and all21 demos remain unpurchasable. Open Checkout for one item: server snapshot price, quantity1, PHP, 10% fee, direct connected charge. Pay using test4242, future expiry and fictional details. Observe pending/confirmed buyer screen, genuine signature-verified event receipt, private order paid and exact listing sold. Read-only verifier confirms amounts and settlement detail; no assumed processing-fee percentage. Revisit sold deep link and active feed exclusion. Race two browsers on the second test item, cancel/expire safely, test replay/foreign signed events with owned isolated fixtures, and check lost-cookie/no-IDOR behavior. Screenshots redact all contacts/proofs/secrets. Run original Marketplace integration/regression checks against preview with its authorized protection access.
- [ ] **Step 4: Prepare production rollout with no cross-tenant consumption.** Record preview evidence and unresolved issues; fix/retest before rollout. Configure Production's distinct tenant/country/origin/test keys/email setup and **its own** signing secret. Deploy disabled first so the final public endpoint exists, register/reuse only our exact production endpoint, securely set secret, enable and redeploy. Do not reuse preview accounts/order bindings or rebind preview fixtures; create new production sandbox fixtures. This remains test mode on a public website. Confirm live endpoint public HTTPS and valid connected events. Use prior authorization for production if supplied; otherwise the final rollout is the concrete reviewable approval point after preview evidence exists.
- [ ] **Step 5: Prove production acceptance and record deliverables.** Repeat seller onboarding→Buy Now→4242 Checkout→signed webhook→paid order→Sold using only new explicit production sandbox IDs. Deliver `https://fb08.vercel.app/marketplace`, `https://github.com/Famanias/fb08`, redacted onboarding/Checkout/success/private-row screenshots, simulated application-fee and actual fee-aware seller result, test/DB/Board/People regression results, and limits. Optional video≤3minutes. Reviewer notes explain verified email versus literal shortcut, test-only inventory, residual shared-key exposure and pending constraints. Prepare the `apply.capm.us` choice **4) Stripe Connect** material; do not send or submit. Keep evidence truthful: missing credentials/onboarding/webhook/settlement means that acceptance item remains unverified.
- [ ] **Step 6: Verify rollback readiness and commit evidence.** Disable new purchases without disabling webhook completion for outstanding sessions; reconcile outstanding work before promoting an older deployment that lacks the endpoint. Preserve audit tables/paid orders. Remove/reset only exact owned terminal sandbox fixtures under the runbook; use new IDs for repeated sales. Commit sanitized runbook evidence as `docs: record Stripe sandbox acceptance evidence`; never stage `.env*`, provider exports, private screenshots or `.vercel` state.

## Self-review record

Performed by the planner against the companion spec; no implementation review or provider validation is claimed.

| Spec requirement | Owning tasks / check |
|---|---|
| Official SDK, exact environment names, server secrets, unverified capability gate | 3,7,8; fail-closed config and private compatibility checklist |
| Email ownership without registration; matching-email listings | 1,2,3,6,8; atomic challenge/session tests and two-listing preview check |
| Direct connected charges, integer PHP snapshots, 10% fee and processing fees | 1,4,5,8; gateway assertions and canonical settlement check |
| Paid webhook, duplicate/out-of-order events, concurrent Checkout, sold URL/feed | 1,4,5,6; SQL concurrency/receipt tests and scoped UI tests |
| Public exact endpoint/Connect events, secret redeployment, local forwarding | 5,7,8; signed webhook tests and ordered setup runbook |
| Shared sandbox foreign traffic and residual malicious-key risk | 5,7,8; signed foreign-event no-ops, documented remaining risk |
| Explicit demo/new sandbox classification, genuine inventory unaffected | 1,4,6,8; exact-ID migration and ordinary/demo rejection |
| Contact and guest-order privacy | 1,2,5,6,7; grants/DTO/cookie/HTML/log/bundle checks |
| Live URL/repo/screenshots/reviewer notes and no automatic submission | 8; actual evidence only |
| Board/People/custom auth/private inquiries/retro design preserved | 2,6,7,8; existing suite and original integration/browser checks |

Step scan: every task has a red/green or concrete external verification gate and a scoped commit. Types and consumers use the shared contracts; private SDK shapes do not leak to UI. No required independent subsystem was split into an unrelated plan. Review Focus cases have explicit owners/tests. The plan defines decisions and observable assertions without supplying product implementation bodies. Remaining external unknowns (sandbox compatibility, sender/inbox, provider permissions, endpoint capacity) are stated gates, not assumed facts. No known requirement gap remains in the planned scope; this is not a claim of live acceptance.

## Review and execution handoff

Please review this plan and companion design before implementation. Recommended approach: **Subagent-driven**, because seller authorization, monetary binding and transactional event ordering warrant a fresh review at each of the dependent boundaries. **Native** is also available: one implementer executes all tasks, followed by a fresh whole-branch review. No execution begins until the user reviews the plan and chooses an approach.
