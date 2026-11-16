# WALL/08 (`fb/08`) — 2008 Anonymous Textboard

A 2008-Facebook-styled community textboard built with Next.js 15 App Router, Supabase PostgreSQL + Realtime, and TypeScript.

## Features

- **Public read-only browsing:** Visitors without an account can browse, read, and search all threads, replies, and edit histories.
- **Simple account gating:** Register or log in with just a username (`1–24` chars, case-insensitive unique) and password (`1–256` chars, no special characters, minimum length beyond 1 char, or email required).
- **Textboard threads & bumping:** Create threads (`title` + `#1` OP), reply sequentially (`#2`, `#3`, ...), and bump threads to the top on new replies.
- **Per-thread anonymous IDs:** Account usernames never appear on public threads or replies. Each post displays `Anonymous #<tag>` scoped deterministically to `(user, thread)`.
- **Own-post editing with public edit history:** Authors can edit their own posts (`#1+`), automatically recording previous versions in public expandable edit histories.
- **Separated reply vs. thread deletion:** Authors can soft-delete their own replies (`#2+`, preserving reply numbering as `[deleted by author]` while clearing edit history) and thread creators have a dedicated **Delete Thread** button with confirmation.
- **Live updates:** Supabase Realtime synchronizes new threads, replies, edits, and thread deletions across connected browsers.

## Environment Variables

Copy `.env.example` to `.env.local` and provide:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
AUTH_SESSION_SECRET=at_least_16_random_characters
```

- `NEXT_PUBLIC_SUPABASE_*` variables are used in the browser strictly for read-only Realtime subscriptions (`anon` `SELECT` only).
- `SUPABASE_SERVICE_ROLE_KEY` and `AUTH_SESSION_SECRET` are **server-only** (never prefix with `NEXT_PUBLIC_`).

## Database Migration

Apply [20261116084500_create_textboard_schema.sql](supabase/migrations/20261116084500_create_textboard_schema.sql) to provision `board_users`, `board_threads`, `board_posts`, `board_post_edits`, column-restricted RLS policies, atomic RPCs (`create_board_thread`, `create_board_reply`, `edit_board_post`), and `supabase_realtime` publication entries.

## Local Development & Verification

```bash
npm install
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run dev
```
