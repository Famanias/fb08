# WALL/08 (FB/08) — Public Community Wall

A faithful 2008-era social profile Wall and public guestbook built with **Next.js App Router**, **React**, **TypeScript**, **Supabase Postgres**, and **Supabase Realtime**.

## Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, CSS (`app/globals.css`)
- **Database & Realtime:** Supabase PostgreSQL (`public.posts`), Row Level Security (RLS), least-privilege column grants, Supabase Realtime (`postgres_changes` on `INSERT`)
- **Testing:** Node test runner (`tsx --test`) + Playwright two-browser verification
- **Deployment:** Vercel + GitHub

## Architecture

```text
Browser / React Next.js (Vercel)
  ├── Supabase publishable key / Data API
  │     ├── SELECT id, author, message, created_at FROM public.posts ORDER BY created_at DESC, id DESC LIMIT 50
  │     └── INSERT (author, message) INTO public.posts
  └── Supabase Realtime (postgres_changes: INSERT on public.posts)

Supabase PostgreSQL
  └── public.posts (id UUID, author TEXT, message TEXT, created_at TIMESTAMPTZ)
      ├── RLS enabled + SELECT USING (true) + INSERT WITH CHECK (...)
      ├── Column-level GRANT INSERT (author, message) — id/created_at cannot be overridden
      └── CHECK constraints: trimmed author (1..24), trimmed message (1..280)
```

### Key Files

- `supabase/migrations/20261115114000_create_posts.sql` — `public.posts` schema, CHECK constraints, `(created_at DESC, id DESC)` index, `REVOKE ALL` + least-privilege `GRANT SELECT` / `GRANT INSERT (author, message)`, RLS policies, and `supabase_realtime` publication entry.
- `lib/supabase-config.ts` — Validates `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (with optional `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback) and blocks accidental `sb_secret_` / `service_role` keys in client code.
- `features/wall/supabase-post-service.ts` — Implements `PostService` (`listLatest`, `create`, `subscribeToNewPosts`) with StrictMode-safe channel lifecycle and truthful connection status mapping.
- `features/wall/post-service.ts` — Single service provider returning `SupabasePostService` (no silent fallback to local demo seeds).
- `features/wall/use-wall-posts.ts` — Subscribes before initial fetch, deduplicates optimistic/returned inserts against Realtime echoes, and reconciles with `listLatest(50)` on reconnect or tab visibility restore.
- `features/wall/capabilities.ts` — Live mode flags (`isLocalPreview: false`, `demoInteractionsEnabled: false`).

## Environment Variables

Copy `.env.example` to `.env.local` for local development (never commit `.env.local` or secret keys):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_publishable_key
```

> Note: If an older Supabase project only provides a legacy `anon` key, `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported as a fallback. Never expose `service_role` or `sb_secret_*` keys in browser code. If environment variables are missing, the UI shows an explicit configuration error rather than falling back to local demo posts.

## Setup & SQL Migration

1. Install dependencies:
   ```bash
   npm install
   ```
2. Apply `supabase/migrations/20261115114000_create_posts.sql` to your Supabase project (via `supabase db push` or the Supabase SQL Editor).
3. Configure `.env.local` with your project's public URL and publishable key.
4. Start locally:
   ```bash
   npm run dev
   ```

## Commands

- `npm run dev` — Start local development server
- `npm run build` — Production build + TypeScript verification
- `npm run start` — Serve production build
- `npm run lint` — Run ESLint across the repo
- `npm test` — Run unit tests (`features/wall/wall-rules.test.ts` and `features/wall/supabase-post-service.test.ts`)
- `npx tsc --noEmit` — Standalone TypeScript typecheck

## Design Reference

- Visual layout, colors (`#3b5998`, `#2c4477`, `#d8dfea`), typography, inline SVG portrait and retro ads, tabs (`Wall`, `Info`, `Photos`, `Notes`, `Boxes`), and responsive breakpoints are preserved from `public/assets/aistudio/WALL08_2008_FACEBOOK_WALL_UI_5ab6d653.html`.

## Known Limitations & Security Tradeoffs

- **Anonymous public posting & spam risk:** By design for this public guestbook, `anon` has direct `INSERT (author, message)` access protected by RLS and CHECK constraints. While RLS and column privileges prevent `UPDATE`, `DELETE`, invalid lengths, whitespace-only posts, and `id`/`created_at` spoofing, **RLS alone does not prevent automated spam or flooding**. A browser-side cooldown is not real security. If promoted publicly at scale, move inserts behind a Next.js API route with durable IP/device rate limiting and Cloudflare Turnstile verification, and revoke direct `anon` `INSERT`.
- **Unverified display names:** Visitor display names are stored locally in `localStorage` (`wall08.name.v1`), capped at 24 characters, and are not authenticated.
- **Demo extras disabled in live mode:** The Stage 1 local-only `Like` and `Comment` controls are disabled via `WALL_CAPABILITIES.demoInteractionsEnabled = false` so the live app never implies cross-visitor persistence for those non-database actions.
- **Feed & search scope:** The feed queries and displays the latest **50** posts (`created_at DESC, id DESC`). Client-side search filters within those 50 loaded posts, and activity counts are labeled as loaded posts.

## Two-Browser Realtime Demo Steps

1. Open the deployed URL in **Browser Window A** and **Browser Window B** (desktop and/or mobile width).
2. Confirm both show **Live · Newest first · latest 50** in the feed toolbar.
3. Optionally click **Change display name** in Window A and save a name.
4. Type a message (1–280 characters) and click **Share** in Window A.
5. Verify the post appears immediately at the top of Window A (no duplicate) **and** appears in Window B **without refreshing**.
6. Refresh Window B and confirm the post persists from Supabase Postgres.
