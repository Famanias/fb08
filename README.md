# WALL/08 (`fb/08`) — 2008 Anonymous Textboard

A 2008-Facebook-styled community textboard built with Next.js 15 App Router, Supabase PostgreSQL + Realtime, and TypeScript.

## Features

- **Public read-only browsing:** Visitors without an account can browse, read, and search all threads, replies, and edit histories.
- **Simple account gating:** Register or log in with just a username (`1–24` chars, case-insensitive unique) and password (`1–256` chars, no special characters, minimum length beyond 1 char, or email required).
- **Two chat types (Comment & Reply):** Post top-level **Comments** directly on a thread, or click **Reply** on a specific comment to post an indented **Reply** underneath it (replying to a nested reply attaches to the parent comment and auto-mentions the target speaker).
- **Textboard threads & bumping:** Create threads (`title` + `#1` OP), comment or reply sequentially (`#2`, `#3`, ...), and bump threads to the top on activity.
- **Optional per-post anonymity:** Posts default to showing your account username (`Post anonymously` unchecked). Checking **Post anonymously** on any thread or reply publishes it as `Anonymous #<tag>` scoped deterministically to `(user, thread)`, without linking it to your named posts or other threads.
- **Own-post editing with public edit history:** Authors can edit their own posts (`#1+`), automatically recording previous versions in public expandable edit histories.
- **Separated reply vs. thread deletion:** Authors can soft-delete their own replies (`#2+`, preserving reply numbering as `[deleted by author]` while clearing edit history) and thread creators have a dedicated **Delete Thread** button with confirmation.
- **User Profiles, Follow -> Auto-Friends & Visibility:** Visit any member's profile (`?profile=<username>`), upload a profile picture (`<= 25 MB` image), follow one-way (mutual follows automatically become **Friends ✓**), and publish profile posts set to **Public**, **Friends only**, or **Only me** with image/video uploads up to **25 MB**, nested collapsible comments & replies, and **Public**-only post sharing.
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

Apply [20261116084500_create_textboard_schema.sql](supabase/migrations/20261116084500_create_textboard_schema.sql), [20261116104500_add_post_display_name.sql](supabase/migrations/20261116104500_add_post_display_name.sql), [20261116112000_add_comment_replies.sql](supabase/migrations/20261116112000_add_comment_replies.sql), and [20261116120000_create_profiles_and_media.sql](supabase/migrations/20261116120000_create_profiles_and_media.sql) to provision `board_users` (with `avatar_path`), `board_threads`, `board_posts`, `board_post_edits`, `user_follows`, `profile_posts`, `profile_post_comments`, the private `board-media` Storage bucket (`25 MB` limit), column-restricted RLS policies, atomic RPCs, and `supabase_realtime` entries.

## Local Development & Verification

```bash
npm install
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run dev
```

## Marketplace

The integrated Marketplace is available at `/marketplace`. See [Marketplace implementation and operations](docs/MARKETPLACE_IMPLEMENTATION.md) for schema, privacy, upload limits, verification, deployment and rollback instructions.
