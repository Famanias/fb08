# WALL/08 (`fb/08`) — Simple Account Auth & 2008-Styled Anonymous Textboard Design

**Date:** 2026-11-16  
**Status:** Draft (pending builder check and user approval)  
**Target Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase PostgreSQL + Realtime, Vercel  

---

## 1. Intent & Why

WALL/08 (`fb/08`) currently operates as an open, anonymous single-stream guestbook where any browser visitor picks a local nickname and posts to one global wall. The goal of this change is to turn it into a community **textboard** gated by lightweight accounts:

- **Anyone can browse and read** all threads, replies, and edit histories without logging in.
- **Only signed-in members can post** (create threads, reply, edit, or delete their own contributions), preventing anonymous unauthenticated spam while preserving **textboard anonymity**.
- **2008 Facebook visual identity** (`#3b5998` header, `#d8dfea` borders, `#eceff5` headers, `#f7f7f7` surfaces, crisp boxy cards and typography) stays intact in a focused 2-column layout (**Option B**).

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Simple Username + Password Auth:** Users register and log in with only a `username` and `password`. Passwords have **no minimum length** (any non-empty string `>= 1` character is valid), **no special-character requirement**, and **no email requirement**.
2. **Public Read, Account-Gated Write:** Unauthenticated guests see the full thread directory, individual threads, replies, and edit histories, plus a clear prompt/sidebar form to sign in or register in order to post.
3. **Textboard Thread Structure:** Users can search existing threads, browse threads sorted by most recently active (new replies bump a thread to the top), create a new thread (`title` + opening post `#1`), and open any thread to read or post numbered replies (`#1`, `#2`, `#3`, ...).
4. **Per-Thread Anonymous Poster IDs:** Account usernames never appear publicly on threads or replies. Each post displays `Anonymous #<tag>` (e.g., `Anonymous #a4f2`), computed deterministically per `(user_id, thread_id)` using a server-side secret so readers can follow speakers within one thread without correlating users across different threads.
5. **Own-Post Editing with Public Edit History:** Signed-in authors can edit their own opening post (`#1`) or replies (`#2+`). Every edit atomically appends the previous text and edit timestamp to an immutable public edit history expandable on that post (`Edited · View history (N)`).
6. **Separated Post Deletion vs. Thread Deletion:**
   - Authors can delete their own **replies (`#2+`)** individually. Deleted replies keep their sequence slot (`#2`) marked `[deleted]` with body text cleared so reply numbers never shift unexpectedly.
   - Thread creators get a dedicated **Delete Thread** button (with confirmation) to delete the entire thread and its replies/edit history. Opening post `#1` offers **Edit** (with edit history) rather than individual post delete so thread deletion is never ambiguous.
7. **Live Updates:** New threads, new replies, edits, reply deletions, and thread deletions propagate across connected browsers via Supabase Realtime without requiring manual refresh.
8. **Clean Fresh Start:** Retire/replace the earlier guestbook `public.posts` test rows with the new textboard schema.

### Non-Goals & Anti-Goals
- **Do not use Supabase Auth email/password:** Hosted Supabase Auth requires email identifiers and enforces a 6-character minimum password, violating the user's explicit requirement.
- **No user profile pages or cross-thread identity leaks:** Never expose `username`, `author_user_id`, `password_hash`, or session identifiers on public thread/post queries or Realtime payloads.
- **Out of scope:** Friend lists, Likes, direct messaging, file/image uploads, rich-text/Markdown formatting, CAPTCHA, password reset emails, and admin moderation roles.

---

## 3. Architecture & Technical Choices ("How It Gets Made")

### Auth & Mutation Boundary (Builder Call)
Because Supabase Auth cannot accept arbitrary `>= 1` char username-only passwords without an email, **authentication and all write mutations execute in Next.js App Router Route Handlers (`app/api/**`)** backed by the existing Supabase PostgreSQL database (`wall08`), using a **server-only** `SUPABASE_SERVICE_ROLE_KEY` and `AUTH_SESSION_SECRET` (never prefixed with `NEXT_PUBLIC_`).

- **Password hashing:** Node built-in `crypto.scryptSync` with a random 16-byte per-user salt (`salt:hash`), verified using `crypto.timingSafeEqual`.
- **Session management:** Signed `HttpOnly; SameSite=Lax; Path=/` cookie (`Secure` in production) containing `{ userId, username, exp }` signed with HMAC-SHA256 (`AUTH_SESSION_SECRET`), validated against `board_users` on each authenticated request. Max age: 30 days.
- **Browser read & Realtime boundary:** The browser uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` strictly for **read-only `SELECT` and Supabase Realtime `postgres_changes` subscriptions** on non-sensitive columns only. All mutations (`register`, `login`, `logout`, `create thread`, `create reply`, `edit post`, `delete reply`, `delete thread`) go through Next.js API routes.

### Protecting Anonymity in RLS & Realtime
PostgreSQL column-level privileges prevent `anon`/`authenticated` clients from ever reading user identities:
- `board_users` has **zero** grants to `PUBLIC, anon, authenticated`.
- `board_threads`, `board_posts`, and `board_post_edits` store `author_user_id` internally for server ownership verification, while `REVOKE ALL` + `GRANT SELECT (only public columns)` restricts `anon, authenticated` so `author_user_id` is excluded from both REST queries and Realtime payloads.
- To let a signed-in user know which threads/posts they own (to show **Edit**, **Delete**, and **Delete Thread** controls), authenticated server responses return ownership IDs for the current session user (`GET /api/ownership` or inline on `/api/threads` API responses), kept strictly private to that user's session cookie.

---

## 4. Database Schema & Constraints (Supabase Migration)

A new SQL migration retires the legacy guestbook `public.posts` table (`DROP TABLE IF EXISTS public.posts;`) and creates:

1. **`public.board_users`**
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `username text NOT NULL` (`CHECK (username = btrim(username) AND char_length(username) BETWEEN 1 AND 24)`)
   - `username_lower text GENERATED ALWAYS AS (lower(username)) STORED UNIQUE`
   - `password_hash text NOT NULL`
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - RLS enabled, `REVOKE ALL FROM PUBLIC, anon, authenticated`.

2. **`public.board_threads`**
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `title text NOT NULL` (`CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120)`)
   - `author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE RESTRICT`
   - `reply_count integer NOT NULL DEFAULT 1` (includes OP `#1`, incremented when replies are inserted; or computed from `post_number`)
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `bumped_at timestamptz NOT NULL DEFAULT now()` (updated to `now()` on every new reply; edited/deleted replies do not bump)
   - Index: `(bumped_at DESC, id DESC)`
   - RLS: `SELECT` public (`anon, authenticated`) on `(id, title, reply_count, created_at, bumped_at)` only. Zero direct `INSERT`/`UPDATE`/`DELETE` grants for `anon, authenticated`.

3. **`public.board_posts`**
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `thread_id uuid NOT NULL REFERENCES public.board_threads(id) ON DELETE CASCADE`
   - `post_number integer NOT NULL` (`1` for thread OP, monotonically assigned per thread `2, 3, ...`, `UNIQUE (thread_id, post_number)`)
   - `author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE RESTRICT`
   - `anon_tag text NOT NULL` (`CHECK (anon_tag ~ '^[0-9a-f]{4,8}$')`, e.g. 6 hex chars from `HMAC-SHA256(AUTH_SESSION_SECRET, thread_id + ':' + author_user_id).slice(0, 6)`)
   - `message text NOT NULL` (`CHECK (message = btrim(message) AND char_length(message) BETWEEN 1 AND 2000)` — when soft-deleted, `deleted_at` is set and `message` becomes `'[deleted]'` or empty/nullable; keep `deleted_at timestamptz NULL` and set `message = '[deleted]'` when `deleted_at IS NOT NULL` to satisfy non-empty check cleanly)
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - `edited_at timestamptz NULL`
   - `deleted_at timestamptz NULL`
   - Index: `(thread_id, post_number ASC)`
   - RLS: `SELECT` public (`anon, authenticated`) on `(id, thread_id, post_number, anon_tag, message, created_at, edited_at, deleted_at)` only (`author_user_id` excluded).

4. **`public.board_post_edits`**
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `post_id uuid NOT NULL REFERENCES public.board_posts(id) ON DELETE CASCADE`
   - `previous_message text NOT NULL`
   - `edited_at timestamptz NOT NULL DEFAULT now()`
   - Index: `(post_id, edited_at DESC, id DESC)`
   - RLS: `SELECT` public (`anon, authenticated`) on `(id, post_id, previous_message, edited_at)`.

5. **Atomic Server RPC (`SECURITY DEFINER`) or Transaction Handling:**
   - Assign `post_number = MAX(post_number) + 1` inside a Postgres transaction / `SECURITY DEFINER` function (`create_board_thread`, `create_board_reply`, `edit_board_post`) invoked by `service_role` from Next.js API routes so concurrent replies in the same thread never collide on `(thread_id, post_number)` and edits atomically insert into `board_post_edits` + update `board_posts`.
   - `ALTER PUBLICATION supabase_realtime ADD TABLE public.board_threads, public.board_posts, public.board_post_edits;`

---

## 5. UI Design (Option B — Focused 2-Column 2008 Facebook Textboard)

### Visual Style Preservation
Retains WALL/08's 2008 Facebook styling from `app/globals.css`:
- Top `#3b5998` header bar (`fb/08` wordmark + `"textboard"` subtitle, `All Threads` link, top search input `"Search threads & posts"`, account greeting or quick `Sign in / Register` status).
- 2-column grid (`#f7f7f7` page background, `#ffffff` cards, `#d8dfea` borders, `#eceff5` box headers with `#3b5998` titles, `#5b74a8` primary blue buttons, `#eceff5` secondary buttons).
- Responsive mobile collapse (`<= 720px`) with zero horizontal overflow down to `375px`.

### Left Column (`220px–250px`): Account + Active Threads
1. **Account Box:**
   - When signed out: compact **Username** + **Password** inputs (`1+` chars, plain `text` + `password` inputs) with **Sign in** and **Register** buttons, inline validation/error box, and note: `"Guests can read everything. Sign in to start threads or post anonymously."`
   - When signed in: displays `Signed in as <username>`, explanation `"Posts show an anonymous per-thread ID (your username stays hidden)"`, and a **Log out** button.
2. **Active Threads Box:**
   - Compact clickable list of the most recently bumped threads (`Title (count)`) for quick switching between discussions.

### Right Column (`1fr`): Thread Index / Open Thread
1. **Thread Index View (default):**
   - Header bar with Live/Reconnecting/Offline connection pill, search filter indicator, and **+ New Thread** composer (when signed in: `Thread Title` input up to 120 chars + `Opening Message` textarea up to 2000 chars + **Post Thread as Anonymous** button; when signed out: compact banner `"Sign in on the left to start a new thread"`).
   - Thread list sorted by `bumped_at DESC`: shows thread title, OP preview snippet, reply count, `Anonymous #<tag>` of OP, and last activity timestamp. Clicking a thread opens it.
2. **Open Thread View (selected thread):**
   - Header bar: **← Back to all threads**, thread title, post count, Live status indicator, and a dedicated **Delete Thread** button visible *only* to the thread creator (triggers an inline/confirm step before deleting the entire thread).
   - Ordered post list (`#1 (OP)`, `#2`, `#3`, ...):
     - Header line: `#N`, `Anonymous #<tag>`, relative timestamp (with full date tooltip), `(edited)` indicator if `edited_at` is set, and **Edit** (or **Edit** · **Delete** on replies `#2+`) *only* on posts owned by the signed-in user when not deleted.
     - Body: plain-text whitespace-preserving output (`[deleted by author]` muted styling if `deleted_at` is set).
     - Edit controls: clicking **Edit** swaps the post into an inline textarea + **Save Edit** / **Cancel** buttons. Saving records the prior version in `board_post_edits`.
     - Edit History: if a post has prior versions (`board_post_edits`), a subtle toggle `View edit history (N)` expands a recessed `#f2f4f8` history list showing each prior text and timestamp. (Deleted replies clear their edit history or mark deleted; decision: `DELETE /api/posts/[postId]` deletes associated `board_post_edits` rows alongside clearing `message` to `'[deleted]'` so deleted content is truly gone.)
   - Reply Composer at the bottom of the thread:
     - Signed in: textarea + **Post Reply as Anonymous** button (`Ctrl/Cmd+Enter` submit).
     - Signed out: prompt `"Sign in on the left to post an anonymous reply in this thread."`

---

## 6. Security & Edge-Case Rules
- **Username validation:** Trimmed non-empty `1..24` chars; case-insensitive uniqueness check (`409 Conflict` on duplicate registration); safe plain-text rendering in React (no `dangerouslySetInnerHTML`).
- **Password validation:** Any non-empty string (`password.length >= 1`, reasonable upper safety cap like `256` chars so `scrypt` cannot be DoS'd by megabyte payloads). No complexity/special-character/minimum-length rejection.
- **Authorization checks:** Every `PATCH /api/posts/[postId]`, `DELETE /api/posts/[postId]`, and `DELETE /api/threads/[threadId]` verifies session cookie authentication (`401` if absent) and `author_user_id === session.userId` (`403` if another user). Deleted replies cannot be edited (`409` or `404`). Opening post `#1` cannot be deleted via `DELETE /api/posts/[postId]` (`400`, direct callers to `DELETE /api/threads/[threadId]`).
- **Environment variables:**
  - Public browser: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SESSION_SECRET`.

---

## 7. What's Left to the Builder
- Internal module/file layout under `app/api/`, `lib/`, `features/board/`, and `components/`.
- Exact copy/micro-copy for inline validation and confirmation prompts within the 2008 Facebook tone.
- Exact pagination/cap limits (e.g., latest 50 threads on index, latest 200 posts per thread) and search matching mechanics (`title` + post text or `title` + loaded previews).
- Test structure (unit tests for auth/hashing/anon-tag/validation rules, API route tests, live Supabase RLS + two-browser Playwright E2E).
