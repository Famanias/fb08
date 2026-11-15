# WALL/08 (`fb/08`) Account Auth & 2008-Styled Anonymous Textboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert WALL/08 from an anonymous single-wall guestbook into a public-read, account-gated anonymous textboard with username/password auth (no minimum password length or special-character rules), per-thread anonymous IDs, public edit history, separated reply vs. thread deletion, live Supabase Realtime updates, and Option B's 2-column 2008 Facebook aesthetic.

**Architecture:** Public reads and Realtime subscriptions continue using the browser Supabase client (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) against column-restricted `SELECT`-only views/policies where `author_user_id` is never exposed to `anon`. Registration, login (`scrypt` + HMAC-signed `HttpOnly` session cookies), and all mutations (`threads`, `posts`, `post_edits`) execute in Next.js App Router Route Handlers (`app/api/**`) using a server-only `SUPABASE_SERVICE_ROLE_KEY`, atomic PostgreSQL RPCs, and a private `AUTH_SESSION_SECRET`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@supabase/supabase-js`, PostgreSQL (Supabase), Supabase Realtime, Node `node:crypto` + `node:test`, Playwright.

**Spec:** [2026-11-16-textboard-auth-design.md](file:///E:/orca/fb08/docs/superpowers/specs/2026-11-16-textboard-auth-design.md)

## Global Constraints

- **Accounts:** Simple `username` (`1..24` trimmed chars, case-insensitive unique via `lower(username)`) and `password` (`1..256` chars, **no minimum length > 1, no special characters, no email**).
- **Access Control:** Unauthenticated visitors can read all threads, posts, and edit histories; creating threads, replying, editing, and deleting require an authenticated session cookie.
- **Anonymity:** Account usernames and `author_user_id` must never appear in public database queries, public API payloads, or Supabase Realtime events. Posts show `Anonymous #<6-hex-tag>` deterministically per `(user_id, thread_id)`.
- **Edit History & Deletion Separation:** Authors edit only their own non-deleted posts (appending prior text to `board_post_edits`). Reply deletion (`#2+` only) sets `deleted_at`, replaces `message` with `'[deleted]'`, and removes its edit history. Opening post `#1` cannot be deleted via post deletion; creators use the dedicated **Delete Thread** flow (`DELETE /api/threads/[threadId]`).
- **Security:** `SUPABASE_SERVICE_ROLE_KEY` and `AUTH_SESSION_SECRET` must remain server-only (never `NEXT_PUBLIC_`). All browser inputs are rendered as plain text in React (no `dangerouslySetInnerHTML`).
- **Aesthetic:** Preserve the 2008 Facebook palette (`#3b5998`, `#d8dfea`, `#eceff5`, `#f7f7f7`, `#5b74a8`) and crisp boxy cards in Option B's 2-column layout (`Account + Active Threads` sidebar on the left; `Thread Index / Open Thread` panel on the right).

## Review Focus

- **Authorization enforcement (`401`/`403`):** Editing or deleting another user's post or thread (and any mutation while signed out) fails loudly on the server.
- **Concurrent reply numbering race:** Two simultaneous replies in the same thread must serialize safely on `(thread_id, post_number)` inside a PostgreSQL transaction/RPC without duplicate key failures.
- **Case-insensitive duplicate & whitespace usernames:** Registering `Alice`, `alice`, or `  alice  ` after `Alice` fails with `409 Conflict` and matches cleanly on login.
- **Identity zero-leak guarantee:** `anon` Supabase REST `SELECT` on `board_users` fails (`42501`), and `SELECT *` on `board_threads`/`board_posts` cannot read `author_user_id`.
- **Deleted reply / `#1` delete guards:** Editing an already-deleted reply returns `409`; attempting `DELETE /api/posts/[postId]` on `#1` returns `400` directing callers to thread deletion.

---

## File Structure

- `supabase/migrations/20261116084500_create_textboard_schema.sql` — Drops legacy `public.posts`; creates `board_users`, `board_threads`, `board_posts`, `board_post_edits`, column-restricted RLS, atomic RPCs, and Realtime publication.
- `lib/server/supabase-admin.ts` — Server-only Supabase client factory using `SUPABASE_SERVICE_ROLE_KEY`.
- `lib/server/auth.ts` — `scrypt` password hashing/verification, HMAC-SHA256 cookie token signing/verification, cookie helpers.
- `lib/server/anon-tag.ts` — Deterministic per-thread `Anonymous` tag derivation (`HMAC-SHA256`).
- `lib/server/route-helpers.ts` — Cookie session extraction, JSON body parsing, error responses.
- `features/board/board.types.ts` — Shared domain, API, ownership, and hook types.
- `features/board/board-rules.ts` — Pure validation, normalization, sorting, search filtering, and merge/dedup helpers.
- `app/api/auth/{register,login,logout,me}/route.ts` — Auth HTTP handlers.
- `app/api/threads/route.ts` & `app/api/threads/[threadId]/route.ts` & `app/api/threads/[threadId]/posts/route.ts` — Thread/reply handlers + private ownership IDs.
- `app/api/posts/[postId]/route.ts` — Post edit (with history) and reply soft-delete handlers.
- `features/board/board-service.ts` — Browser client wrapper combining read-only Supabase REST/Realtime + authenticated Next.js API mutations.
- `features/board/use-textboard.ts` — Client state management, Realtime synchronization, reconnect reconciliation, auth & thread workflows.
- `components/{BoardApp,BoardHeader,AccountSidebar,ThreadIndex,ThreadView,BoardPostItem}.tsx` — Option B 2008-styled UI components.
- `app/{layout.tsx,page.tsx,globals.css}`, `.env.example`, `README.md`, `package.json`.

---

### Task 1: Supabase Textboard Schema, Column-Level RLS & Atomic RPC Migration

**Files:**
- Create: `supabase/migrations/20261116084500_create_textboard_schema.sql`
- Verify via script/MCP against live Supabase project `mqvccxbrsdzysbmedvtw`

**Interfaces:**
- Produces SQL tables: `board_users`, `board_threads`, `board_posts`, `board_post_edits`
- Produces SQL RPCs (callable via `service_role`):
  - `create_board_thread(p_user_id uuid, p_title text, p_message text, p_anon_tag text) RETURNS TABLE(thread_id uuid, post_id uuid)`
  - `create_board_reply(p_user_id uuid, p_thread_id uuid, p_message text, p_anon_tag text) RETURNS TABLE(post_id uuid, post_number integer, created_at timestamptz)`
  - `edit_board_post(p_user_id uuid, p_post_id uuid, p_new_message text) RETURNS TABLE(post_id uuid, edited_at timestamptz, edit_id uuid, previous_message text)`
  - `delete_board_reply(p_user_id uuid, p_post_id uuid) RETURNS TABLE(status text, thread_id uuid, deleted_at timestamptz)`
  - `delete_board_thread(p_user_id uuid, p_thread_id uuid) RETURNS text` (`'ok' | 'not_found' | 'forbidden'`)

- [ ] **Step 1: Write the failing live database verification script**

Create a temporary check script (run against Supabase REST with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` once migration is applied, asserting `board_threads`, `board_posts`, `board_post_edits` allow public column-scoped `SELECT`, reject `author_user_id` selection, reject all `INSERT`/`UPDATE`/`DELETE`, and reject any access to `board_users`).

- [ ] **Step 2: Author `supabase/migrations/20261116084500_create_textboard_schema.sql`**

Include:
1. `DROP TABLE IF EXISTS public.posts CASCADE;` (clean fresh start removing old guestbook test rows).
2. `board_users`, `board_threads`, `board_posts`, `board_post_edits` with all `CHECK` constraints, indexes `(bumped_at DESC, id DESC)`, `(thread_id, post_number ASC)`, `(post_id, edited_at DESC, id DESC)`.
3. `ENABLE ROW LEVEL SECURITY` on all 4 tables; `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated;`.
4. Explicit column grants ONLY on public non-identifying columns:
   - `GRANT SELECT (id, title, reply_count, created_at, bumped_at) ON public.board_threads TO anon, authenticated;`
   - `GRANT SELECT (id, thread_id, post_number, anon_tag, message, created_at, edited_at, deleted_at) ON public.board_posts TO anon, authenticated;`
   - `GRANT SELECT (id, post_id, previous_message, edited_at) ON public.board_post_edits TO anon, authenticated;`
   - Permissive `FOR SELECT TO anon, authenticated USING (true)` policies on those 3 public tables; zero grants/policies for `anon, authenticated` on `board_users`.
5. `SECURITY DEFINER SET search_path = public, pg_temp` RPC functions using `SELECT ... FOR UPDATE` on `board_threads` inside `create_board_reply` so concurrent replies get gap-free monotonic `post_number` values cleanly and bump `bumped_at` + `reply_count` atomically; `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ... TO service_role;`.
6. `ALTER PUBLICATION supabase_realtime ADD TABLE public.board_threads, public.board_posts, public.board_post_edits;`

- [ ] **Step 3: Apply migration to `wall08` (`mqvccxbrsdzysbmedvtw`) and verify**

Note: Because Supabase MCP `execute_sql` cancels `DROP TABLE` confirmation in non-interactive mode, apply the DDL via `supabase` CLI (`supabase db push` or `psql`) or safe `supabase/migrations` setup — if dropping `public.posts`, run via Supabase CLI `npx supabase db push` or `supabase` connection, then run:
- `supabase:get_advisors` (`security`) -> expect `lints: []`
- Live `anon` publishable-key REST check -> `board_users` = `401/403`, selecting `author_user_id` from `board_posts` = `401/403`, public column `SELECT` = `200`, `POST/PATCH/DELETE` = `401/403`.

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/20261116084500_create_textboard_schema.sql
git commit -m "feat: add textboard schema, column RLS, and atomic RPC migration"
```

---

### Task 2: Server Auth Crypto, Session Cookies, Per-Thread Anon Tags & Admin Client

**Files:**
- Create: `lib/server/supabase-admin.ts`
- Create: `lib/server/auth.ts`
- Create: `lib/server/anon-tag.ts`
- Modify: `.env.example`, `.gitignore` (ensure `.superpowers/` ignored if ever recreated), `package.json` (`test` script updated as test files are added)
- Test: `lib/server/auth.test.ts`

**Interfaces:**
- Produces in `lib/server/auth.ts`:
  - `SESSION_COOKIE_NAME = 'fb08_session'`
  - `hashPassword(password: string): string`
  - `verifyPassword(password: string, storedHash: string): boolean`
  - `signSessionToken(payload: { userId: string; username: string }, secret?: string, nowMs?: number): string`
  - `verifySessionToken(token: string, secret?: string, nowMs?: number): { userId: string; username: string; exp: number } | null`
  - `buildSessionCookieHeader(token: string, isProd: boolean): string` & `buildClearSessionCookieHeader(isProd: boolean): string`
- Produces in `lib/server/anon-tag.ts`:
  - `deriveThreadAnonTag(userId: string, threadId: string, secret?: string): string` (returns 6 lowercase hex chars)
- Produces in `lib/server/supabase-admin.ts`:
  - `getSupabaseAdminClient(): SupabaseClient` (throws explicit actionable error if `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing)

- [ ] **Step 1: Write failing unit tests in `lib/server/auth.test.ts`**

Test assertions:
- `hashPassword('a')` and `verifyPassword('a', hash)` succeed for 1-character passwords, whitespace passwords if passed directly? (Wait: non-empty `password.length >= 1` works; verify `'a'`, `'x'`, wrong password `'b'` returns `false`, malformed hash returns `false`).
- `signSessionToken` + `verifySessionToken` round-trips `{ userId, username }`; tampered token returns `null`; expired token (`nowMs` past 30 days) returns `null`.
- `deriveThreadAnonTag(userA, thread1, secret)` is deterministic (equal across calls), differs across different threads `thread1 !== thread2` (`tag1 !== tag2`), differs across `userA !== userB`, and matches `/^[0-9a-f]{6}$/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/server/auth.test.ts`
Expected: FAIL (`Cannot find module './auth'` / `'./anon-tag'`).

- [ ] **Step 3: Implement `lib/server/auth.ts`, `lib/server/anon-tag.ts`, `lib/server/supabase-admin.ts`, and update `.env.example`**

- Use `crypto.scryptSync(password, salt, 64)` + `crypto.timingSafeEqual` in `auth.ts` (`AUTH_SESSION_SECRET` required outside explicit test secret parameter, min 16 chars in prod/runtime).
- Use `crypto.createHmac('sha256', secret).update(`${threadId}:${userId}`).digest('hex').slice(0, 6)` in `anon-tag.ts`.
- Ensure `.env.example` documents `SUPABASE_SERVICE_ROLE_KEY=` and `AUTH_SESSION_SECRET=` alongside existing `NEXT_PUBLIC_*` vars, and configure `.env.local` locally with real `wall08` `service_role` key + generated random `AUTH_SESSION_SECRET`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/server/auth.test.ts`
Expected: PASS (all auth/tag assertions pass).

- [ ] **Step 5: Commit**

```bash
git add lib/server/auth.ts lib/server/anon-tag.ts lib/server/supabase-admin.ts lib/server/auth.test.ts .env.example
git commit -m "feat: add server auth crypto, session signing, and per-thread anon tags"
```

---

### Task 3: Board Types & Pure Domain Rules

**Files:**
- Create: `features/board/board.types.ts`
- Create: `features/board/board-rules.ts`
- Reuse: `lib/format-date.ts`, `lib/safe-storage.ts`
- Test: `features/board/board-rules.test.ts`

**Interfaces:**
- Produces in `features/board/board.types.ts`:
  - `BoardUser = { id: string; username: string }`
  - `BoardThreadSummary = { id: string; title: string; reply_count: number; created_at: string; bumped_at: string; op_anon_tag?: string; op_preview?: string; is_mine?: boolean }`
  - `BoardPostEdit = { id: string; post_id: string; previous_message: string; edited_at: string }`
  - `BoardPost = { id: string; thread_id: string; post_number: number; anon_tag: string; message: string; created_at: string; edited_at: string | null; deleted_at: string | null; edits?: BoardPostEdit[]; is_mine?: boolean }`
  - `BoardConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error'`
- Produces in `features/board/board-rules.ts`:
  - Constants: `MAX_USERNAME_LENGTH = 24`, `MAX_PASSWORD_LENGTH = 256`, `MAX_THREAD_TITLE_LENGTH = 120`, `MAX_POST_LENGTH = 2000`, `MAX_VISIBLE_THREADS = 50`, `MAX_POSTS_PER_THREAD = 200`
  - `validateUsername(raw: string): { valid: boolean; value: string; error?: string }`
  - `validatePassword(raw: string): { valid: boolean; error?: string }` (allows any non-empty string `1..256` chars; no special chars or >=6 length rule!)
  - `validateThreadTitle(raw: string): { valid: boolean; value: string; error?: string }`
  - `validateBoardMessage(raw: string): { valid: boolean; value: string; error?: string }`
  - `sortThreadsByBump(threads: BoardThreadSummary[]): BoardThreadSummary[]`
  - `mergeThreadList(existing: BoardThreadSummary[], incoming: BoardThreadSummary[], ownedIds?: ReadonlySet<string>): BoardThreadSummary[]`
  - `sortAndMergeThreadPosts(existing: BoardPost[], incoming: BoardPost[], ownedPostIds?: ReadonlySet<string>): BoardPost[]`
  - `filterThreads(threads: BoardThreadSummary[], query: string): BoardThreadSummary[]`
  - `filterPostsInThread(posts: BoardPost[], query: string): BoardPost[]`

- [ ] **Step 1: Write failing tests in `features/board/board-rules.test.ts`**

Test assertions:
- `validateUsername('  Alice  ')` -> `{ valid: true, value: 'Alice' }`; `''` / `'   '` invalid; 25 chars invalid; `'A'` (1 char) valid.
- `validatePassword('a')` and `validatePassword('1')` -> `{ valid: true }`; `''` invalid; `'a'.repeat(257)` invalid.
- `validateThreadTitle('  Question?  ')` -> `{ valid: true, value: 'Question?' }`; 121 chars invalid.
- `validateBoardMessage('  hello  ')` -> `{ valid: true, value: 'hello' }`; whitespace-only invalid; 2001 chars invalid.
- `sortThreadsByBump` orders descending by `bumped_at` then `id`; `mergeThreadList` preserves `is_mine` flags & deduplicates by `id`.
- `sortAndMergeThreadPosts` orders ascending by `post_number` (`#1, #2, #3`), preserves edits sorted descending by `edited_at`, and attaches `is_mine`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test features/board/board-rules.test.ts`
Expected: FAIL (`Cannot find module './board-rules'`).

- [ ] **Step 3: Implement `features/board/board.types.ts` and `features/board/board-rules.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test features/board/board-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/board/board.types.ts features/board/board-rules.ts features/board/board-rules.test.ts
git commit -m "feat: add textboard domain types and validation/merge rules"
```

---

### Task 4: Auth & Textboard Route Handlers

**Files:**
- Create: `lib/server/route-helpers.ts`
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/me/route.ts`
- Create: `app/api/threads/route.ts`
- Create: `app/api/threads/[threadId]/route.ts`
- Create: `app/api/threads/[threadId]/posts/route.ts`
- Create: `app/api/posts/[postId]/route.ts`
- Test: `lib/server/board-routes.test.ts`

**Interfaces:**
- Route handlers delegate pure request-handling logic to testable handler factories (injecting fake/mock admin store in unit tests, defaulting to `getSupabaseAdminClient()` in HTTP handlers):
  - `POST /api/auth/register`: `{ username, password }` -> `201 { user: { id, username } }` + sets `HttpOnly` session cookie; `409` if `username_lower` exists; `400` if invalid.
  - `POST /api/auth/login`: `{ username, password }` -> `200 { user: { id, username } }` + sets cookie; `401` on bad credentials.
  - `POST /api/auth/logout`: clears session cookie (`200 { ok: true }`).
  - `GET /api/auth/me`: returns `200 { user: { id, username } | null }`.
  - `GET /api/threads`: returns public thread summaries (`op_anon_tag`, `op_preview`) + `ownedThreadIds: string[]` (empty array when unauthenticated, never `author_user_id`).
  - `POST /api/threads`: requires auth (`401` otherwise); creates thread + OP `#1` via `create_board_thread` RPC with HMAC `anon_tag`; returns `201 { thread, post }`.
  - `GET /api/threads/[threadId]`: returns `{ thread, posts, editsByPostId, ownedPostIds, isThreadOwner }` (`isThreadOwner: false`, `ownedPostIds: []` when unauthenticated).
  - `DELETE /api/threads/[threadId]`: requires auth (`401`); returns `403` if caller is not `thread.author_user_id`; `404` if missing; deletes thread atomically via `delete_board_thread` RPC (`200 { ok: true }`).
  - `POST /api/threads/[threadId]/posts`: requires auth (`401`); calls `create_board_reply` RPC; returns `201 { post }`.
  - `PATCH /api/posts/[postId]`: requires auth (`401`), checks ownership (`403`), rejects deleted post (`409`), calls `edit_board_post` RPC (atomic edit history insert + post update); returns `200 { post, edit }`.
  - `DELETE /api/posts/[postId]`: requires auth (`401`), checks ownership (`403`), rejects `post_number === 1` with `400` (`"Use Delete Thread to remove the entire thread."`), calls `delete_board_reply` RPC; returns `200 { ok: true, deleted_at }`.

- [ ] **Step 1: Write failing route logic tests in `lib/server/board-routes.test.ts`**

Test assertions covering every Review Focus risk:
- Registering `'Alice'` with 1-char password `'x'` succeeds (`201`) and sets `HttpOnly` cookie; registering `'  alice  '` fails (`409`).
- `POST /api/threads` without valid session returns `401`; with session creates thread + `#1` with `anon_tag` (no `username` or `author_user_id` leaked in response).
- `PATCH /api/posts/[id]` by non-owner returns `403`; by owner updates post and returns new `edit` entry; `PATCH` on deleted reply returns `409`.
- `DELETE /api/posts/[id]` on `#1` returns `400`; on `#2` by non-owner returns `403`; on `#2` by owner soft-deletes (`message: '[deleted]'`, clears edits).
- `DELETE /api/threads/[id]` by non-owner returns `403`; by creator returns `200`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/server/board-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/server/route-helpers.ts` and all `app/api/**` route handlers**

- Ensure `board_users` lookups confirm `userId` still exists when validating cookies.
- Never include `author_user_id` or `password_hash` in JSON outputs.
- Enforce UUID validation on `[threadId]` / `[postId]` path params (`400` on malformed UUID).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/server/board-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/route-helpers.ts app/api/ lib/server/board-routes.test.ts
git commit -m "feat: add auth, thread, post, edit-history, and delete API routes"
```

---

### Task 5: Browser Read + Supabase Realtime Board Service & Hook

**Files:**
- Create: `features/board/board-service.ts`
- Create: `features/board/use-textboard.ts`
- Test: `features/board/board-service.test.ts`

**Interfaces:**
- Produces in `features/board/board-service.ts`:
  - `BoardService` interface & `SupabaseBoardService` implementation:
    - `fetchSession(): Promise<BoardUser | null>`
    - `register(username: string, password: string): Promise<BoardUser>`
    - `login(username: string, password: string): Promise<BoardUser>`
    - `logout(): Promise<void>`
    - `listThreads(limit?: number): Promise<{ threads: BoardThreadSummary[]; ownedThreadIds: string[] }>`
    - `getThreadDetail(threadId: string): Promise<{ thread: BoardThreadSummary; posts: BoardPost[]; isThreadOwner: boolean; ownedPostIds: string[] }>`
    - `createThread(title: string, message: string): Promise<{ thread: BoardThreadSummary; post: BoardPost }>`
    - `createReply(threadId: string, message: string): Promise<BoardPost>`
    - `editPost(postId: string, message: string): Promise<{ postId: string; message: string; edited_at: string; edit: BoardPostEdit }>`
    - `deleteReply(postId: string): Promise<{ postId: string; deleted_at: string }>`
    - `deleteThread(threadId: string): Promise<void>`
    - `subscribeToBoard(callbacks, onStatus): () => void` — subscribes cleanly with unique channel IDs (`StrictMode`-safe) to `board_threads` (`*`), `board_posts` (`*`), and `board_post_edits` (`INSERT`/`DELETE`) + browser `online`/`offline` listeners.
- Produces in `features/board/use-textboard.ts`:
  - `useTextboard()` hook managing `user`, `threads`, `selectedThreadId`, `threadPosts`, `isThreadOwner`, `searchQuery`, `connectionStatus`, `isLoading`, `isSubmitting`, `errorMessage`, `retryLoad`, auth actions, thread/reply CRUD, edit history hydration, and live reconnect reconciliation.

- [ ] **Step 1: Write failing unit tests in `features/board/board-service.test.ts`**

Test assertions:
- `SupabaseBoardService.subscribeToBoard` invokes `channel` with unique incrementing name, unsubscribes via `removeChannel` on cleanup without double-subscribing in StrictMode, dispatches thread/post/edit changes safely (ignoring malformed payloads without throwing), and transitions `connecting` -> `live` -> `reconnecting` / `offline`.
- Mutation methods (`createThread`, `editPost`, `deleteReply`, `deleteThread`) parse API errors cleanly and throw user-readable messages on `401`/`403`/`409`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test features/board/board-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `features/board/board-service.ts` and `features/board/use-textboard.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test features/board/board-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/board/board-service.ts features/board/use-textboard.ts features/board/board-service.test.ts
git commit -m "feat: add Supabase Realtime board service and useTextboard hook"
```

---

### Task 6: Option B 2008-Facebook-Styled Textboard UI, Docs & Production Verification

**Files:**
- Create: `components/BoardApp.tsx`, `components/BoardHeader.tsx`, `components/AccountSidebar.tsx`, `components/ThreadIndex.tsx`, `components/ThreadView.tsx`, `components/BoardPostItem.tsx`
- Modify: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/Toast.tsx`, `package.json`, `README.md`
- Remove unused legacy single-wall preview/wall UI components once replaced (`components/WallApp.tsx`, `components/WallHeader.tsx`, `components/ProfileSidebar.tsx`, `components/RetroAdsSidebar.tsx`, `components/StaticTabContent.tsx`, `components/WallTabs.tsx`, `components/WallPost.tsx`, `components/PostComposer.tsx`, `components/PostFeed.tsx`, `components/RetroArtwork.tsx`, `features/wall/*`) — verify no remaining imports first!

**Interfaces:**
- `<BoardApp />` renders Option B:
  - Top bar (`BoardHeader`): `fb/08` wordmark + `"textboard"`, `All Threads` button, live `"Search threads & posts"` input, signed-in username / `"Visitor (read-only)"`.
  - Left column (`AccountSidebar`):
    - **Account** box: `Username` + `Password` form with **Sign in** and **Register** buttons (no password minimum length or special character restriction beyond non-empty `1+` char); or signed-in badge (`Signed in as <username>`, anonymous explanation, **Log out** button).
    - **Active Threads** box: clickable list of bumped threads with post count badges (`Title (count)`).
  - Right column (`ThreadIndex` or `ThreadView`):
    - **ThreadIndex:** Live status indicator, **+ New Thread** form (`Title` + `Opening Message` + **Post Thread as Anonymous**) when signed in or prompt when signed out, clickable bumped thread list matching search filter.
    - **ThreadView:** **← Back to all threads**, thread title, post count, Live indicator, dedicated **Delete Thread** button with two-step inline confirmation (shown *only* if `isThreadOwner`), ordered posts `#1 (OP), #2, ...` via `BoardPostItem`, and bottom reply composer (or signed-out prompt).
    - **BoardPostItem:** `#N`, `Anonymous #<anon_tag>`, relative timestamp + hover full timestamp, `(edited)` indicator, expandable `View edit history (N)` drawer, inline **Edit** form (`#1+`, only `is_mine && !deleted_at`), and **Delete** button (`#2+` replies only when `is_mine && !deleted_at`, with inline confirmation).

- [ ] **Step 1: Update CSS tokens/layout in `app/globals.css` and metadata in `app/layout.tsx` + `app/page.tsx`**

- Convert `.layout` to Option B's focused 2-column grid (`grid-template-columns: 240px minmax(0, 1fr)` on desktop, single-column stack on mobile `<= 760px`), preserving `#3b5998` header, `#d8dfea` borders, `#eceff5` box headings, `#f1f3f7` page backdrop, `#5b74a8` buttons, `#f2f4f8` edit-history callout, and `0` horizontal overflow at `390px` and `375px`.

- [ ] **Step 2: Implement UI components (`BoardHeader`, `AccountSidebar`, `ThreadIndex`, `ThreadView`, `BoardPostItem`, `BoardApp`) and clean up obsolete guestbook files**

- [ ] **Step 3: Update `package.json` `test` script & `README.md`**

Update `"test"` script in `package.json` to run `npx tsx --test lib/server/auth.test.ts lib/server/board-routes.test.ts features/board/board-rules.test.ts features/board/board-service.test.ts`. Update `README.md` with env vars (`SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_*`), schema, auth model, and setup instructions.

- [ ] **Step 4: Run full local verification gates**

Run:
- `npm test` -> all tests pass, `0` failures
- `npx tsc --noEmit` -> exit `0`
- `npm run lint` -> exit `0`
- `npm run build` -> exit `0`
- Start local server + run multi-browser Playwright E2E covering: unauthenticated read-only browsing, registering 1-char password user `Alice` + `Bob`, duplicate case-insensitive `alice` rejected (`409`), creating thread + `#1`, replying in Browser B -> Realtime update in Browser A without refresh, same-user consistent `anon_tag` within thread & different `anon_tag` across two threads, editing post with expandable edit history in Browser B live, deleting `#2` reply preserves numbering and wipes edit history, dedicated **Delete Thread** removes thread live in Browser B, `390px`/`375px` layout + zero console errors.

- [ ] **Step 5: Deploy to Vercel & verify production**

- Ensure `SUPABASE_SERVICE_ROLE_KEY` and `AUTH_SESSION_SECRET` are added to Vercel (`Production, Preview, Development`) via `vercel env add` (marked `--sensitive`).
- Commit & push to `origin main`, run `vercel deploy --prod --yes --non-interactive`, and run the full two-browser Playwright E2E against `https://fb08.vercel.app`.

```bash
git add -A
git commit -m "feat: implement 2008-styled anonymous textboard UI and account gating"
```
