import { LocalPostService } from './local-post-service';
import { PostService } from './post.types';

let cachedService: PostService | null = null;

/**
 * Single swap point for Stage 2 (Supabase backend integration).
 * Replace LocalPostService with SupabasePostService here when connecting to Postgres + Realtime.
 */
export function getPostService(): PostService {
  if (!cachedService) {
    cachedService = new LocalPostService();
  }
  return cachedService;
}
