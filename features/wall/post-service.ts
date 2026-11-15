import { PostService } from './post.types';
import { SupabasePostService } from './supabase-post-service';

let cachedService: PostService | null = null;

/**
 * Single swap point for Stage 2 (Supabase backend integration).
 */
export function getPostService(): PostService {
  if (!cachedService) {
    cachedService = new SupabasePostService();
  }
  return cachedService;
}
