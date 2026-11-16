# Marketplace Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task.

**Goal:** Add the supplied 2008-style Marketplace to the existing fb/08 app with real Supabase persistence and private inquiries.

**Architecture:** App Router pages reuse BoardHeader. A scoped Marketplace feature contains public DTOs, validation, forms and feed components. Server handlers use the existing admin client; additive SQL provides private contacts/inquiries, atomic publication, idempotency and persistent rate limits.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase, node:test/tsx, Sharp.

**Spec:** `D:/downloads/FB08_MARKETPLACE_FULLSTACK_CLI_MASTER_PROMPT.md`; approved UI `D:/downloads/FB08_MARKETPLACE_SINGLE_FILE.html`.

## Global Constraints

- Preserve Board, People, profiles and custom session permissions.
- Native React, real routes, seven stored categories, PHP prices, no demo inventory or public inbox.
- Private emails and inquiry contents never enter public DTOs or logs.
- Server-only writes, RLS and explicit grants; no unrelated database modifications.
- Cap uploaded images at 3 MiB and multipart requests at 3.5 MiB, below Vercel's 4.5 MB function limit. Decode and re-encode accepted JPEG/PNG/WebP images server-side before uploading; strip metadata.
- The supplied execution directive authorizes proceeding after this short plan without another approval gate.

## Review Focus

- Retried publication/inquiry requests must not duplicate rows or leak images.
- Spoofed, malformed, oversized and decompression-heavy images must be rejected.
- Cross-origin requests, malformed filters and oversized bodies must fail safely.
- Search and pagination must query all active listings with stable tie-breakers.
- Supabase errors must preserve form state and never claim success or disclose private input.

### Task 1: Validated server data flow

**Files:** `features/marketplace/{types,validation}.ts`, `lib/server/marketplace-{store,handlers,image}.ts`, `app/api/marketplace/**`, `supabase/migrations/*marketplace.sql`.

- [x] Add failing validation, privacy, upload and handler tests using existing node:test conventions.
- [x] Implement bounded parsing, same-origin checks, decoded image upload, explicit public DTO mapping, database filtering/sorting/pagination, transactional publish/inquiry RPCs, idempotency and persistent rate limiting.
- [x] Inspect the linked database before applying only the additive Marketplace migrations; verify anonymous grants and existing table counts.
- [x] Run the new tests and existing suite.

### Task 2: Reference-matched native UI

**Files:** `components/BoardHeader.tsx`, `app/marketplace/**`, `features/marketplace/components/**`, scoped `marketplace.css`.

- [x] Add shared Marketplace navigation preserving existing callback behavior.
- [x] Translate reference styles into a scoped stylesheet and React layouts, feed, cards, photo/create and inquiry forms; no reference DOM delegation or local persistence.
- [x] Use URL filters/sort/view, server pagination, direct detail pages, true 404 and recoverable errors; honest saved-message wording.
- [x] Verify keyboard-accessible controls and widths 375, 390, 768, 1024 and 1440.

### Task 3: Verification and deployment

**Files:** `docs/MARKETPLACE_IMPLEMENTATION.md`, `scripts/verify-marketplace.ts`, package scripts.

- [x] Run full tests, TypeScript, lint and production build; review changed boundaries.
- [x] Exercise actual upload, listing, independent-client reads, deep links and inquiry persistence; verify public privacy and write denial, clean test data afterwards.
- [x] Deploy a preview through the existing Vercel project, verify it, then deploy production on the existing public domain.
- [x] Document actual evidence, remaining limitations, commands, migration/rollback and env names only.

## Final decisions and evidence

- Used a 3 MiB multipart proxy with Sharp instead of separate signed upload authorization; accepted explicitly by the supplied upload-size caveat.
- Added a second invoker migration for literal parameterized search after real tests exposed PostgREST wildcard behavior; it also returns empty stale pages with accurate counts.
- Removed the global loading boundary after testing showed missing listings returned streaming HTTP 200; both malformed and absent valid UUIDs now return HTTP 404.
- Independent review found an ambiguous-RPC cleanup race. A failing regression test demonstrated it; immediate cleanup now runs only after confirmed completion, with a restricted 24-hour orphan reconciliation utility for failures. Reviewer rechecked the fix with seven passing handler tests and no remaining Important findings.
- Full suite: 37 pass. Lint, TypeScript and production build pass. SQL transaction tests and two post-migration security advisor checks pass.
- All four acceptance flows, database/private-table verification and Board/People/auth routes passed on local, preview and `https://fb08.vercel.app` production. Temporary test inventory, inquiries, contacts, photos and idempotency keys were removed.
