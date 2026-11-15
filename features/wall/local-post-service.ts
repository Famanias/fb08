import {
  NewWallPost,
  PostService,
  WallConnectionStatus,
  WallPost,
} from './post.types';
import { createSamplePosts } from './sample-posts';
import {
  MAX_VISIBLE_POSTS,
  sanitizeNewPostInput,
  sortAndLimitPosts,
} from './wall-rules';
import {
  StorageAdapter,
  getBrowserStorage,
  safeReadRaw,
  safeWriteJSON,
} from '@/lib/safe-storage';

export const WALL_POSTS_STORAGE_KEY = 'wall08.posts.v2';

function createPostId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isWallPostLike(value: unknown): value is WallPost {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.author === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.created_at === 'string'
  );
}

export class LocalPostService implements PostService {
  private readonly storageKey: string;
  private readonly resolveStorage: () => StorageAdapter | null;
  private readonly listeners = new Set<(post: WallPost) => void>();

  constructor(
    storageKey: string = WALL_POSTS_STORAGE_KEY,
    resolveStorage: () => StorageAdapter | null = getBrowserStorage
  ) {
    this.storageKey = storageKey;
    this.resolveStorage = resolveStorage;
  }

  private readOrSeedPosts(): WallPost[] {
    const storage = this.resolveStorage();
    const raw = safeReadRaw(this.storageKey, storage);
    if (!raw.ok) {
      return createSamplePosts();
    }
    if (raw.value === null) {
      const seeded = createSamplePosts();
      safeWriteJSON(this.storageKey, seeded, storage);
      return seeded;
    }
    try {
      const parsed = JSON.parse(raw.value);
      if (!Array.isArray(parsed)) {
        const seeded = createSamplePosts();
        safeWriteJSON(this.storageKey, seeded, storage);
        return seeded;
      }
      return parsed.filter(isWallPostLike).map((post) => ({
        id: post.id,
        author: post.author,
        message: post.message,
        created_at: post.created_at,
      }));
    } catch {
      return createSamplePosts();
    }
  }

  async listLatest(limit: number = MAX_VISIBLE_POSTS): Promise<WallPost[]> {
    const posts = this.readOrSeedPosts();
    return sortAndLimitPosts(posts, limit);
  }

  async create(input: NewWallPost): Promise<WallPost> {
    const sanitized = sanitizeNewPostInput(input);
    const created: WallPost = {
      id: createPostId(),
      author: sanitized.author,
      message: sanitized.message,
      created_at: new Date().toISOString(),
    };

    const storage = this.resolveStorage();
    const existing = this.readOrSeedPosts();
    const updated = sortAndLimitPosts([created, ...existing], 200);
    const writeResult = safeWriteJSON(this.storageKey, updated, storage);
    if (!writeResult.ok) {
      throw new Error(
        writeResult.error ??
          'Unable to save post locally because browser storage is unavailable.'
      );
    }

    for (const listener of this.listeners) {
      listener(created);
    }

    return created;
  }

  subscribeToNewPosts(
    onInsert: (post: WallPost) => void,
    onStatus?: (status: WallConnectionStatus) => void
  ): () => void {
    onStatus?.('preview');
    this.listeners.add(onInsert);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== this.storageKey || !event.newValue) {
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed) && parsed.length > 0 && isWallPostLike(parsed[0])) {
          onInsert({
            id: parsed[0].id,
            author: parsed[0].author,
            message: parsed[0].message,
            created_at: parsed[0].created_at,
          });
        }
      } catch {
        // Ignore malformed cross-tab payload
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorage);
    }

    return () => {
      this.listeners.delete(onInsert);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorage);
      }
    };
  }
}
