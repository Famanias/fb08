# fb/08 Marketplace

Marketplace extends the existing Next.js 15 App Router application and the existing Supabase/Vercel projects. Board, People, profiles, session cookies and their write permissions are preserved.

## Routes and design

- `/marketplace`: public feed with URL search/category/sort/view filters and 18 listings per page. PostgreSQL filters the entire active inventory and returns an exact total, including for an out-of-range page.
- `/marketplace/new`: guest listing creation, drag/drop or file picker, preview, replace, client/server validation and retry-safe publication.
- `/marketplace/[id]`: direct, refreshable item detail and private buyer inquiry form. Invalid and absent UUIDs return HTTP 404.
- `/api/marketplace/listings`: public GET and validated multipart POST.
- `/api/marketplace/inquiries`: validated POST only. No public inquiry-read endpoint or inbox.

The native React components in `features/marketplace/components` translate `FB08_MARKETPLACE_SINGLE_FILE.html`. Its scoped CSS preserves Tahoma, classic blue, compact controls, bordered cards and three columns with responsive rails. Shared `components/BoardHeader.tsx` supplies navigation. Prototype inventory, hash routing, localStorage database operations, fabricated counters and the public Local Inbox were intentionally omitted. There is no extra account requirement or change to Board authorization.

## Data and security

Applied migrations:

- `20261116180858_fb08_marketplace.sql`: public listing fields; private contacts, inquiries, idempotency records and persistent hourly abuse counters; constraints, indexes, atomic write functions and Storage bucket.
- `20261116182303_marketplace_literal_search.sql`: parameterized, literal substring search over title, description, category and public display name; stable sorting/pagination/count in PostgreSQL.

All five new tables have RLS enabled. Anonymous/authenticated roles receive SELECT only on active public listings and EXECUTE only on the public invoker browse function. Private table grants and write-function EXECUTE are revoked from PUBLIC, anon and authenticated. Server writes use the existing service-role helper. The three write/rate functions are security invoker with an empty search path and executable only by service_role. Public DTOs explicitly whitelist fields; provider errors and private request bodies are never logged or returned.

`marketplace-images` is a public-read bucket accepting WebP with a 3 MiB object limit. It has no public upload/update/delete policy. The browser submits one multipart request capped at 3.5 MiB; the selected photo is limited to **3 MiB**, below Vercel's function body limit. Sharp decodes actual JPEG/PNG/WebP bytes, checks MIME against decoded format, rejects animation/corruption and images over 25 megapixels, strips metadata, rotates and resizes to at most 1800×1800, then re-encodes WebP. Random server-generated UUID paths are bound to the listing transaction. No untrusted path, base64 database photo or arbitrary remote URL is accepted.

Same-origin and Fetch Metadata checks, honeypots, bounded streamed bodies and persistent rate limits apply server-side. Vercel's overwritten `x-forwarded-for` address is HMAC-hashed with the existing session secret; raw IPs are not stored. Outside Vercel, clients share a single local budget. Limits are 10 publication attempts and 30 inquiry attempts per hour/address, including retries. Shared networks therefore share a budget. These controls reduce abuse; they are not CAPTCHA or moderation.

Listings and private seller contact are committed atomically. UUID submission keys and fingerprints suppress accidental duplicates, including concurrent retries. Inquiry insertion checks that the listing is still active and commits before success is shown. The exact confirmation is “Your message has been saved.” **No email delivery, seller notification or seller inbox is implemented.** The UI explains this before posting and sending an inquiry.

Confirmed duplicate publication uploads are removed immediately when unreferenced. After an ambiguous upload/publish failure, immediate deletion is unsafe because a database transaction may still commit. Such photos are retained for delayed reconciliation. Run the restricted maintenance utility periodically:

```powershell
node --env-file=.env.local --import=tsx scripts/cleanup-marketplace-images.ts
node --env-file=.env.local --import=tsx scripts/cleanup-marketplace-images.ts --apply
```

It defaults to a dry run and removes only unreferenced UUID WebP objects older than 24 hours; referenced photos are retained. Scheduling this utility is an operator action; no cron has been provisioned. Database idempotency records remain for retry safety.

## Environment and local commands

Existing names only, with no new secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or existing `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` — server only
- `AUTH_SESSION_SECRET` — server only

```powershell
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
# With the app running and the intended database configured:
npm run test:marketplace:live
# Or choose a deployment URL:
node --env-file=.env.local --import=tsx scripts/verify-marketplace.ts https://DEPLOYMENT_URL
```

Do not run dev and build simultaneously in the same checkout: they share `.next` output.

The live verifier creates a clearly labeled temporary listing, uploads real binary image data, checks the row/private contact, independent feed/detail/image reads, category/search/sorts/page boundary, actual private inquiry row, idempotent retries, public data privacy, denied anonymous writes and Board/People/auth routes. It removes its own listing, inquiry, contact, idempotency rows and photo in `finally`. It needs private server credentials and must never become an HTTP endpoint. Repeated runs consume the normal abuse budget.

`supabase/tests/marketplace.sql` verifies 21-row pagination, categories beyond the first page, every sort, public seller search, stale pages, database rate limits and grants inside a rolled-back transaction. Test fixtures never become visible to other database sessions:

```powershell
supabase db query --linked --project-ref mqvccxbrsdzysbmedvtw --file supabase/tests/marketplace.sql
supabase db advisors --linked --project-ref mqvccxbrsdzysbmedvtw --type security --level warn
```

## Migration/deployment and rollback

The configured database was inspected before changes: one Board thread, eight Board posts, one user and one profile post; the existing private `board-media` bucket was retained. Only the two Marketplace migrations were applied through the authenticated Supabase CLI and recorded in migration history. Existing remote migration history predates/differs from the repository's old filenames: do **not** blindly run `supabase db push` with `--include-all`, replay historical Board migrations or repair unrelated history.

For another environment, inspect its schema and migration history, take the normal backup, then apply only these two new SQL files in order. Their transactions are additive. Review explicit grants and run the SQL tests/advisors afterwards. Do not drop the schema as a routine rollback.

Use the existing ignored `.vercel/project.json` for project `fb08`. Preview and Production already contain the required environment names. Deploy a preview with `vercel deploy --yes`, test it, then use `vercel deploy --prod --yes` to update the existing `fb08.vercel.app` domain. Confirm Board/People and the four Marketplace flows on that URL. No new Supabase or Vercel project is needed.

For rollback, promote the previous known-good Vercel production deployment. Retain Marketplace tables/photos so submitted user data is preserved. Remove only explicit test fixtures; schema/data deletion requires a separately reviewed retention/export plan.

## Verification record

- Existing baseline: 23 tests passed; baseline lint passed.
- Current unit/handler suite: 37 tests passed, including upload spoofing/corruption/byte/pixel limits, DTO privacy, origin checks, bounded requests, rate denial and ambiguous-publication cleanup behavior.
- Local live integration: all four flows, Storage retrieval, real inquiry row, idempotency, public privacy and Board/People route regression passed.
- SQL transaction tests passed; Supabase security advisors reported no warnings/errors after both migrations.
- TypeScript, ESLint and production build passed. Browser bundle scan found neither the service-role key nor session secret in 44 JavaScript assets.
- Preview `https://fb08-kyx7xc7yc-team-e2117dad.vercel.app`: all four live integration checks and privacy/regression checks passed. Deployment protection was accessed using the authenticated Vercel CLI, without changing protection settings.
- Browser UI: uploaded and published a photo, opened the listing in another tab, submitted the inquiry and inspected its real private database row. Both malformed and valid absent UUIDs returned HTTP 404.
- Browse/create/detail pages checked at 375, 390, 768, 1024 and 1440 CSS pixels: document width matched the viewport and navigation did not overflow.
- Production `https://fb08.vercel.app/marketplace`: deployed to existing Vercel project; full real-database integration verifier passed against the public domain, including confirmed private inquiry persistence, photo retrieval, private table denial and Board/People/auth regression. Verification fixtures were removed.
- `npm audit` reports 23 existing dependency findings (22 moderate, one high in Next's transitive PostCSS). New Sharp/tsx packages have no audit finding. A Next/toolchain upgrade is separate work; no automatic major-version audit fix was applied.
