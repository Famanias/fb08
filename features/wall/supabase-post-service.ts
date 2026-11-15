import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-config';
import {
  NewWallPost,
  PostService,
  WallConnectionStatus,
  WallPost,
} from './post.types';
import {
  MAX_VISIBLE_POSTS,
  sanitizeNewPostInput,
  sortAndLimitPosts,
} from './wall-rules';

export type SupabaseLikeClient = Pick<
  SupabaseClient,
  'from' | 'channel' | 'removeChannel'
>;

export interface SupabasePostServiceOptions {
  client?: SupabaseLikeClient | null;
  configError?: string;
}

const POST_COLUMNS = 'id,author,message,created_at';
let channelSequence = 0;

function isWallPostRow(value: unknown): value is WallPost {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.author === 'string' &&
    typeof row.message === 'string' &&
    typeof row.created_at === 'string' &&
    row.created_at.length > 0
  );
}

function formatSupabaseError(err: { message?: string; code?: string }, fallback: string): string {
  if (err.code === '42501') {
    return 'Post rejected by database security rules. Please verify your name (1-24 chars) and message (1-280 chars).';
  }
  if (err.code === '23514') {
    return 'Message or display name failed database validation rules.';
  }
  return err.message ? `${fallback}: ${err.message}` : fallback;
}

export class SupabasePostService implements PostService {
  private readonly injectedClient?: SupabaseLikeClient | null;
  private readonly injectedConfigError?: string;

  constructor(options: SupabasePostServiceOptions = {}) {
    this.injectedClient = options.client;
    this.injectedConfigError = options.configError;
  }

  private resolveClient(): SupabaseLikeClient {
    if (this.injectedClient !== undefined) {
      if (!this.injectedClient) {
        throw new Error(
          this.injectedConfigError ??
            'Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
        );
      }
      return this.injectedClient;
    }

    const { client, error } = getSupabaseBrowserClient();
    if (!client) {
      throw new Error(
        error ??
          'Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
      );
    }
    return client;
  }

  async listLatest(limit: number = MAX_VISIBLE_POSTS): Promise<WallPost[]> {
    const client = this.resolveClient();
    const safeLimit = Math.max(1, Math.min(limit, MAX_VISIBLE_POSTS));

    const { data, error } = await client
      .from('posts')
      .select(POST_COLUMNS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(safeLimit);

    if (error) {
      throw new Error(formatSupabaseError(error, 'Could not load wall posts'));
    }

    const rows = Array.isArray(data) ? data.filter(isWallPostRow) : [];
    return sortAndLimitPosts(rows, safeLimit);
  }

  async create(input: NewWallPost): Promise<WallPost> {
    const sanitized = sanitizeNewPostInput(input);
    const client = this.resolveClient();

    const { data, error } = await client
      .from('posts')
      .insert({
        author: sanitized.author,
        message: sanitized.message,
      })
      .select(POST_COLUMNS)
      .single();

    if (error) {
      throw new Error(formatSupabaseError(error, 'Unable to publish post'));
    }

    if (!isWallPostRow(data)) {
      throw new Error('Supabase returned an unexpected response after saving your post.');
    }

    return {
      id: data.id,
      author: data.author,
      message: data.message,
      created_at: data.created_at,
    };
  }

  subscribeToNewPosts(
    onInsert: (post: WallPost) => void,
    onStatus?: (status: WallConnectionStatus) => void
  ): () => void {
    let client: SupabaseLikeClient;
    try {
      client = this.resolveClient();
    } catch {
      onStatus?.('error');
      return () => {};
    }

    let unsubscribed = false;
    channelSequence += 1;
    const channelName = `wall-posts-insert-${channelSequence}`;

    onStatus?.('connecting');

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        (payload: { new: unknown }) => {
          if (unsubscribed) return;
          if (isWallPostRow(payload.new)) {
            onInsert({
              id: payload.new.id,
              author: payload.new.author,
              message: payload.new.message,
              created_at: payload.new.created_at,
            });
          }
        }
      )
      .subscribe((status: string) => {
        if (unsubscribed) return;
        switch (status) {
          case 'SUBSCRIBED':
            onStatus?.('live');
            break;
          case 'TIMED_OUT':
            onStatus?.('reconnecting');
            break;
          case 'CHANNEL_ERROR':
            onStatus?.('error');
            break;
          case 'CLOSED':
            onStatus?.('offline');
            break;
          default:
            break;
        }
      });

    const handleOffline = () => {
      if (!unsubscribed) {
        onStatus?.('offline');
      }
    };
    const handleOnline = () => {
      if (!unsubscribed) {
        onStatus?.('reconnecting');
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      unsubscribed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
      }
      void client.removeChannel(channel);
    };
  }
}
