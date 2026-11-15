# FB/08 — Your Little Corner of the Internet (Stage 1 Frontend)

A faithful 2008-era social profile Wall and public guestbook built with **Next.js App Router**, **React**, **TypeScript**, and **CSS**.

Stage 1 delivers the complete frontend shell and an offline-capable **Local Preview** backed by `localStorage`, cleanly decoupled behind a `PostService` abstraction so Stage 2 can connect **Supabase Postgres + Realtime** with minimal UI changes.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Scripts

- `npm run dev` — Start the Next.js development server
- `npm run build` — Production build + TypeScript verification
- `npm run start` — Start the production server
- `npm run lint` — Run ESLint across the codebase
- `npx tsx --test features/wall/wall-rules.test.ts` — Run unit tests for validation, sorting, filtering, and `LocalPostService`

## Architecture

```text
app/
  globals.css          # Reference 2008 styles, palette tokens, and responsive breakpoints
  layout.tsx           # Root metadata and viewport
  page.tsx             # Home page entry
components/
  WallApp.tsx          # Top-level client orchestrator
  WallHeader.tsx       # Sticky #3b5998 topbar, nav links, greeting, search
  ProfileSidebar.tsx   # Left monochrome portrait, links, info, mutual friends
  WallTabs.tsx         # Wall / Info / Photos / Notes / Boxes tablist
  PostComposer.tsx     # Display name editor, 280-char textarea, Feeling chip, Share
  PostFeed.tsx         # Status indicator, mobile search, feed list, empty states
  WallPost.tsx         # Individual post row + gated demo likes/comments
  RetroAdsSidebar.tsx  # Right-column retro SVG advertisements & Wall Activity
  StaticTabContent.tsx # Info, Photos, Notes, and Boxes panels
  RetroArtwork.tsx     # React-safe inline SVG portrait and 3 retro ad illustrations
  Toast.tsx            # Accessible toast notification
features/wall/
  post.types.ts        # WallPost (4-field contract), NewWallPost, PostService
  post-service.ts      # Single swap point for Stage 2 backend integration
  local-post-service.ts# Stage 1 localStorage implementation of PostService
  sample-posts.ts      # Demo-only sample posts (never ship to production live feed)
  capabilities.ts      # Feature flags (demoInteractionsEnabled, isLocalPreview)
  demo-interactions.ts # Separate local-only store for demo Like/Comment buttons
  wall-rules.ts        # Pure validation, sorting, filtering, and status labels
  use-wall-posts.ts    # Client hook for posts, display name, search, and error states
lib/
  format-date.ts       # Period-accurate relative/absolute timestamps
  initials.ts          # Initials and deterministic pastel avatar palette
  safe-storage.ts      # Safe localStorage wrappers handling blocked/full storage
```

## Stage 1 Limitations

- **Local preview only:** Posts, display names, and demo likes/comments are saved in the visitor's browser `localStorage` (`wall08.posts.v2`, `wall08.name.v1`, `wall08.demo_interactions.v1`) and are not shared across users or devices.
- **Demo-only likes & comments:** The `Like` and `Comment` controls in the reference prototype are isolated in `features/wall/demo-interactions.ts` behind `WALL_CAPABILITIES.demoInteractionsEnabled`. They are intentionally excluded from the 4-field `WallPost` contract.

## Stage 2 Migration Plan (Supabase Integration)

1. **Implement `SupabasePostService`** (`features/wall/supabase-post-service.ts`) implementing `PostService` from `features/wall/post.types.ts`:
   - `listLatest(limit = 50)`: query `posts` (`id, author, message, created_at`) ordered by `created_at desc, id desc` with limit `50`.
   - `create({ author, message })`: insert into `posts` and return the inserted 4-field `WallPost` row.
   - `subscribeToNewPosts(onInsert, onStatus)`: subscribe to Postgres `INSERT` events on `posts` via Supabase Realtime and emit `'connecting' | 'live' | 'reconnecting' | 'offline' | 'error'`.
2. **Swap the service in `features/wall/post-service.ts`:**
   - Return `SupabasePostService` from `getPostService()` instead of `LocalPostService`.
3. **Update `features/wall/capabilities.ts`:**
   - Set `isLocalPreview: false` and `demoInteractionsEnabled: false` so demo-only Like/Comment buttons and sample seeds are hidden/disabled in live multi-user mode.
4. **Update preview labels in `PostFeed.tsx` / `WallApp.tsx`** once `isLocalPreview` is `false` (the `Local preview` dot automatically switches to `Live` via `getStatusLabel(connectionStatus)`).
