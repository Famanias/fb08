/**
 * Feature capabilities for WALL/08.
 *
 * Stage 1 (Local preview):
 *   - demoInteractionsEnabled is true so visitors can test the reference's
 *     local-only Like/Comment demo interactions.
 *
 * Stage 2 (Supabase live mode):
 *   - Set demoInteractionsEnabled to false (or hide local interactions when
 *     NEXT_PUBLIC_WALL_MODE === 'live') because the Supabase `posts` table
 *     intentionally stores only { id, author, message, created_at }.
 */
export const WALL_CAPABILITIES = {
  isLocalPreview: true,
  demoInteractionsEnabled: true,
} as const;
