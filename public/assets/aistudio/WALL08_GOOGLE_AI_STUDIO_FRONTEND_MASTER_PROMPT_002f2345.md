# WALL/08 — Google AI Studio Frontend Implementation Master Prompt

**Project:** WALL/08 — Your Little Corner of the Internet  
**Stage:** 1 of 2 — Next.js frontend and working local prototype  
**Target stack:** Next.js App Router + React + TypeScript + CSS  
**Approved visual source:** `WALL08_2008_FACEBOOK_WALL_UI.html` (attach/import this exact file with the prompt)  
**Stage 2 handoff:** `WALL08_CLI_BACKEND_DEPLOYMENT_MASTER_PROMPT.md`  
**Primary instruction:** **RECREATE AND COMPONENTIZE THE APPROVED HTML, NOT A NEW DESIGN.**

---

## YOUR ASSIGNMENT

You are creating the production-quality **frontend shell** of a deliberately nostalgic public guestbook called **WALL/08**. It is a 2008-era social profile Wall, NOT modern Facebook. The attached self-contained HTML prototype is the **source of truth** for visuals, layout, labels, SVG illustrations, microinteractions, and responsive behavior.

Build a complete, executable Next.js + React + TypeScript project that recreates that interface as closely as practical, using reusable components and a typed post-data abstraction. The result must be playable in the Google AI Studio preview **without a backend** and ready for the engineering agent to connect to Supabase later.

### Non-negotiable visual constraints

- Preserve the exact **wall/08** identity, compact old-web look, Facebook-2008-inspired blue header, square corners, thin grey dividers, small Tahoma/Arial typography, and lightly beveled buttons.
- **Do not redesign** as glassmorphism, modern card dashboard, masonry feed, oversized hero, floating sidebar, gradients everywhere, or Tailwind-inspired SaaS.
- No use of Facebook's official logo, real Mark Zuckerberg photographs, or third-party copyrighted graphics. Use the original illustrations/SVGs in the attached HTML.
- Preserve the reference's principal proportions at desktop: 1142px overall page max width; 37px sticky top bar; grid of approximately `219px | flexible center | 193px` with ~20px gaps; central Wall remains dominant. Adapt as necessary on narrower viewports.
- Preserve the **three-column desktop layout**: left profile/Info, center Wall/feed, right fictional retro ads and Wall Activity.
- Preserve the reference palette: `#3b5998` primary blue, `#2c4477` dark blue, `#d8dfea` secondary blue-grey, `#d7dce6` lines, predominantly white canvas, charcoal text.
- Preserve the illustrated monochrome profile portrait and the three **inline SVG** fake advertisements: Scuba Diving Vacations, Free Desktop Wallpapers!, and Make Your Own Mixtape. Do not replace with broken external image URLs.
- Preserve little details that make the reference believable: navigation Inbox `2` badge, `Wall / Info / Photos / Notes / Boxes` tabs, mutual friends initials, old-school privacy label `Everyone`, Attach/Feeling tool, wall activity count, footer.
- Keep animations subtle and period-appropriate: tiny slide/expand effects, focus outlines, lightweight new-post insert, gentle notification toast. Do NOT add motion-heavy GSAP, parallax, magnetic buttons, or glossy effects.

### Exact visual source usage

1. **Read the entire attached `WALL08_2008_FACEBOOK_WALL_UI.html` first**, including styles, markup, and JavaScript.
2. Replicate its composition and behavior instead of drawing inspiration and inventing something new.
3. Port its inline SVG illustrations and retro ad graphics into React-safe SVG components, preserving appearance and accessibility.
4. Convert CSS into a maintainable stylesheet or CSS modules, retaining CSS variables and faithful responsive breakpoints.
5. Recreate the actual reference wording wherever possible; do not replace content with generic lorem ipsum.
6. If any visual change is necessary for accessibility or responsive correctness, preserve the original visual language and document the reason.

---

## USER STORIES / WHAT MUST WORK IN STAGE 1

### Essential Wall experience

- A visitor sees the Wall landing screen and a message textarea with placeholder **“What's on your mind?”**.
- Visitor can set or change a **display name up to 24 characters**; default `Visitor` (no account/login). Display name is saved in localStorage and shown in top greeting and composer.
- Visitor enters a message of **1–280 non-whitespace characters**, presses **Share**, and sees the post appear at the top of a newest-first feed.
- The character counter begins at `280 left`; it responds as typing occurs, warns near the limit, and prevents empty/over-limit submissions.
- Support **Ctrl+Enter / Cmd+Enter** as a submit shortcut, and proper Enter behavior inside the textarea.
- New post displays initials-based avatar, escaped/plain-text author/message, timestamp, and subtle entrance animation.
- Posts survive refresh **locally** via localStorage during the frontend stage. This is preview-only, not Supabase persistence.
- Searching filters the posts currently loaded into the local feed by author or message, case-insensitively.
- Show the latest **50 posts**, descending by `created_at` with `id` as a stable tie-breaker.
- Keep the approved prototype's sample posts only for **demo mode**; never present them as real database content in production.
- The status text must clearly say **“Local preview”** while using localStorage, never **“Live”** or **“Saved to Supabase”**.

### Reference UI interactions

- Tabs `Wall`, `Info`, `Photos`, `Notes`, `Boxes` display their matching sections (reference content preserved).
- Header navigation links route to the analogous local tab without a page reload.
- Left links for View Info, Photos, Write on this Wall, Poke the Wall, and Share this Page should work as in the reference.
- Clicking **Write on this Wall** activates the Wall tab and focuses the composer.
- **Feeling** inserts `:)` only if it fits inside the character limit.
- **Poke the Wall** shows the playful toast from the reference.
- Share This Page copies the current URL when clipboard permissions allow, with a graceful fallback message.
- Name editor toggles, validates, persists, and closes without blocking ordinary posting.
- Display appropriate empty/search-empty states and toast messages for successful submissions.
- Preserve the compact mobile behavior of left sidebar moving below the main feed, right ad column hidden at tablet sizes, and compact navigation on phones.

### Likes and comments: important scope rule

The approved prototype includes **local-only Like and Comment buttons**. Those are NOT part of the hiring assignment or the specified four-column Supabase `posts` table. Do not accidentally design the backend to persist them without agreement.

- It is acceptable to preserve them in **frontend demo mode** exactly as the reference, storing demo likes/comments locally.
- Structure these features behind a `demoInteractionsEnabled` capability/feature flag.
- When the later Supabase-backed live mode is enabled, **hide or disable the Like/Comment actions** rather than implying they're synchronized to all visitors. Keep existing post metadata/timestamps intact. Do not add tables in Stage 1.
- Do not block the essential Wall/Share flow on optional interactions.

---

## COMPONENT / DATA ARCHITECTURE

Use maintainable components rather than inserting the whole 41 KB HTML as `dangerouslySetInnerHTML` or wrapping it in an iframe.

Suggested organization (adapt to the project scaffold if needed):

```
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  components/
    WallHeader.tsx
    ProfileSidebar.tsx
    WallTabs.tsx
    PostComposer.tsx
    PostFeed.tsx
    WallPost.tsx
    RetroAdsSidebar.tsx
    StaticTabContent.tsx
    Toast.tsx
    RetroArtwork.tsx
  features/wall/
    post.types.ts
    post-service.ts
    local-post-service.ts
    sample-posts.ts
    use-wall-posts.ts
    capabilities.ts
  lib/
    format-date.ts
    initials.ts
    safe-storage.ts
```

**Type contracts (important):**

```ts
export type WallPost = {
  id: string;
  author: string;
  message: string;
  created_at: string; // ISO 8601, Supabase timestamptz-compatible
};

export type NewWallPost = Pick<WallPost, 'author' | 'message'>;

export type WallConnectionStatus =
  | 'preview' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error';

export interface PostService {
  listLatest(limit?: number): Promise<WallPost[]>;
  create(input: NewWallPost): Promise<WallPost>;
  subscribeToNewPosts(
    onInsert: (post: WallPost) => void,
    onStatus?: (status: WallConnectionStatus) => void
  ): () => void;
}
```

Implement `LocalPostService` with localStorage as the Stage 1 service; keep the domain model independent from React components and the eventual Supabase client. Use `Promise`-based methods for parity with network operations.

Additional engineering notes:

- localStorage must be accessed **client-side only**, safely after hydration. Avoid Next.js server/client hydration mismatches.
- Components with hooks or browser APIs should start with `'use client';`.
- Maintain a deterministic sample-post seed only when the preview localStorage key is uninitialized; subsequent refreshes must use saved state. Seeded demo content must never leak to production live feed.
- Keep any demo likes/comments in a separate local-only store/map, not in the 4-field `WallPost` contract.
- Do not allow `Date.now()` timestamp drift to randomly reorder on every render; keep stable ids/timestamps.
- Manage a max 50 visible-post window (using a stable `created_at DESC, id DESC` ordering).
- Deduplicate by `id` on new-insert events so the later backend can merge the post returned from Share with its Realtime event safely.
- Include loading, empty, posting, failed-post, and reconnecting states. If create fails, leave the textarea content intact and allow retry.
- No mock requests, artificial timers that claim a real server connection, fake global count, Firebase, auth, or Supabase credentials in Stage 1.
- Use React state and accessible native controls; user-provided post text is displayed as text (never injected as HTML).
- Keep dependencies light. No need for GSAP, Tailwind, UI kits, chart libraries, photo APIs, or external images.

### Interaction semantics

- Share button disabled for invalid/empty message and during an active save.
- Prevent double-submit; do not clear composer until `create()` resolves successfully.
- Display an error toast/inline alert on localStorage failures rather than silently losing posts.
- Clearly distinguish demo/local storage from future public persistence.
- Support keyboard focus indicators, semantic landmark/navigation labels, and readable mobile tap targets while preserving the period visual style.
- Honors `prefers-reduced-motion`.

---

## RESPONSIVE DESIGN CRITERIA

Use the reference's breakpoints as a foundation:

- **Wide desktop (>980px):** all 3 columns, center panel flexible, content max-width 1142px.
- **Tablet (681–980px):** 2 columns (left + center), hide right ads.
- **Mobile (≤680px):** center Wall first, compact profile section below, responsive tabs, horizontal overflow prevented.
- **Small phones (≤430px):** compact header/search behavior matching reference; preserve usable composer and Share control.

Test at **375, 390, 768, 1024, and 1440 CSS px**. Avoid text clipping, horizontal page scroll, invisible Share buttons, and broken SVG proportions.

---

## STEP-BY-STEP IMPLEMENTATION TASKS

### F0 — Reference audit
- Inspect attached HTML completely, inventory its sections and scripts.
- Describe the exact visual/token system and list all features that are already functional.
- State the project framework selected. Use **Next.js App Router and TypeScript**; in Google AI Studio choose Next.js in Settings before implementation.

### F1 — Layout fidelity
- Build navbar, sidebars, tabs, content shell, artwork, and footer.
- Check side-by-side against attached HTML at desktop and mobile viewport sizes.

### F2 — Local post service and composer
- Add typed `PostService` and local implementation.
- Add nickname, composer, character counter, submit, local persistence, latest 50, and empty states.
- Ensure posts are visible after refresh in this browser.

### F3 — Extras and polish
- Implement search, secondary tabs, copy link, poke, Feeling, demo-only likes/comments, timestamps, toast, responsive UI.
- Clearly label preview-only behavior; no fake live data.

### F4 — Handoff readiness
- Run TypeScript checks, lint (if configured), build, and browser preview tests.
- Write README with start commands, known limitations, migration plan, and exactly where the Supabase service will be plugged in.
- Keep frontend visually stable for the CLI coding-agent handoff.

---

## FRONTEND ACCEPTANCE TESTS

1. Launch at 1440px: three columns and header visually match approved reference.
2. Launch at 390px: Wall composer/feed work with no horizontal overflow.
3. Type 280 characters: counter says `0 left`, Share succeeds; a 281st character cannot be added.
4. Whitespace-only input: Share disabled and submission rejected.
5. Create a post: the post appears first without reload, correct author and timestamp.
6. Refresh: the post remains in the local demo feed.
7. Change nickname; new posts use it, old posts retain their original author names.
8. Search matches both author and message; empty results work.
9. Switch all tabs; no hydration errors or console errors.
10. Preview is correctly labeled as local; no claims of a Supabase connection.
11. No unhandled exceptions if storage is blocked, and no TypeScript or build errors.
12. Approved SVG artwork and retro ads render without external asset dependencies.

## STOP CONDITIONS

Do not configure Supabase, Firebase, an API server, login, hosting, or external databases in this stage. If Google AI Studio tries to provide these features, refuse and use `LocalPostService`. This is a deliberate two-stage workflow.

**When done, report:** files created, observed frontend behaviors, responsive sizes checked, commands executed with actual results, deviations from reference, and what the CLI backend agent should change next. Do not claim tasks were tested if they were not actually run.

**Final requirement:** preserve the nostalgic WALL/08 experience faithfully, while making its React architecture easy to connect to a real Postgres-backed public wall.
