import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase-config';
import {
  BoardConnectionStatus,
  BoardPost,
  BoardPostEdit,
  BoardThreadSummary,
  BoardUser,
} from './board.types';
import { MAX_VISIBLE_THREADS } from './board-rules';

export type RealtimeBoardCallbacks = {
  onThreadUpsert?: (thread: BoardThreadSummary) => void;
  onThreadDelete?: (threadId: string) => void;
  onPostUpsert?: (post: BoardPost) => void;
  onEditInsert?: (edit: BoardPostEdit) => void;
  onEditDelete?: (editId: string) => void;
};

export interface BoardService {
  fetchSession(): Promise<BoardUser | null>;
  register(username: string, password: string): Promise<BoardUser>;
  login(username: string, password: string): Promise<BoardUser>;
  logout(): Promise<void>;
  listThreads(limit?: number): Promise<{
    threads: BoardThreadSummary[];
    ownedThreadIds: string[];
  }>;
  getThreadDetail(threadId: string): Promise<{
    thread: BoardThreadSummary;
    posts: BoardPost[];
    isThreadOwner: boolean;
    ownedPostIds: string[];
  }>;
  createThread(
    title: string,
    message: string,
    anonymous?: boolean
  ): Promise<{ thread: BoardThreadSummary; post: BoardPost }>;
  createReply(
    threadId: string,
    message: string,
    anonymous?: boolean,
    options?: { parentPostId?: string | null; replyToPostId?: string | null }
  ): Promise<BoardPost>;
  editPost(
    postId: string,
    message: string
  ): Promise<{
    postId: string;
    message: string;
    edited_at: string;
    edit: BoardPostEdit;
  }>;
  deleteReply(postId: string): Promise<{ postId: string; deleted_at: string }>;
  deleteThread(threadId: string): Promise<void>;
  subscribeToBoard(
    callbacks: RealtimeBoardCallbacks,
    onStatus?: (status: BoardConnectionStatus) => void
  ): () => void;
}

export type SupabaseRealtimeClient = Pick<
  SupabaseClient,
  'channel' | 'removeChannel'
>;

export interface SupabaseBoardServiceOptions {
  client?: SupabaseRealtimeClient | null;
  configError?: string;
  fetchImpl?: typeof fetch;
}

let boardChannelSeq = 0;

function isThreadRow(value: unknown): value is BoardThreadSummary {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.title === 'string' &&
    typeof r.reply_count === 'number' &&
    typeof r.created_at === 'string' &&
    typeof r.bumped_at === 'string'
  );
}

function isPostRow(value: unknown): value is BoardPost {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.thread_id === 'string' &&
    typeof r.post_number === 'number' &&
    typeof r.anon_tag === 'string' &&
    typeof r.message === 'string' &&
    typeof r.created_at === 'string'
  );
}

function isPostEditRow(value: unknown): value is BoardPostEdit {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.post_id === 'string' &&
    typeof r.previous_message === 'string' &&
    typeof r.edited_at === 'string'
  );
}

export class SupabaseBoardService implements BoardService {
  private readonly injectedClient?: SupabaseRealtimeClient | null;
  private readonly injectedConfigError?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: SupabaseBoardServiceOptions = {}) {
    this.injectedClient = options.client;
    this.injectedConfigError = options.configError;
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  private resolveRealtimeClient(): SupabaseRealtimeClient | null {
    if (this.injectedClient !== undefined) {
      return this.injectedClient;
    }
    const { client } = getSupabaseBrowserClient();
    return client;
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(url, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!res.ok) {
      const msg =
        body &&
        typeof body === 'object' &&
        'error' in body &&
        typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Request failed (${res.status}).`;
      throw new Error(msg);
    }

    return body as T;
  }

  async fetchSession(): Promise<BoardUser | null> {
    const data = await this.requestJson<{ user: BoardUser | null }>('/api/auth/me');
    return data.user ?? null;
  }

  async register(username: string, password: string): Promise<BoardUser> {
    const data = await this.requestJson<{ user: BoardUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return data.user;
  }

  async login(username: string, password: string): Promise<BoardUser> {
    const data = await this.requestJson<{ user: BoardUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return data.user;
  }

  async logout(): Promise<void> {
    await this.requestJson<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  }

  async listThreads(limit: number = MAX_VISIBLE_THREADS): Promise<{
    threads: BoardThreadSummary[];
    ownedThreadIds: string[];
  }> {
    const safeLimit = Math.max(1, Math.min(limit, MAX_VISIBLE_THREADS));
    return this.requestJson<{
      threads: BoardThreadSummary[];
      ownedThreadIds: string[];
    }>(`/api/threads?limit=${safeLimit}`);
  }

  async getThreadDetail(threadId: string): Promise<{
    thread: BoardThreadSummary;
    posts: BoardPost[];
    isThreadOwner: boolean;
    ownedPostIds: string[];
  }> {
    const data = await this.requestJson<{
      thread: BoardThreadSummary;
      posts: BoardPost[];
      editsByPostId?: Record<string, BoardPostEdit[]>;
      isThreadOwner: boolean;
      ownedPostIds: string[];
    }>(`/api/threads/${encodeURIComponent(threadId)}`);

    const editsByPostId = data.editsByPostId ?? {};
    const posts = data.posts.map((post) => ({
      ...post,
      edits: post.edits ?? editsByPostId[post.id] ?? [],
    }));

    return {
      thread: data.thread,
      posts,
      isThreadOwner: Boolean(data.isThreadOwner),
      ownedPostIds: data.ownedPostIds ?? [],
    };
  }

  async createThread(
    title: string,
    message: string,
    anonymous: boolean = false
  ): Promise<{ thread: BoardThreadSummary; post: BoardPost }> {
    return this.requestJson<{ thread: BoardThreadSummary; post: BoardPost }>(
      '/api/threads',
      {
        method: 'POST',
        body: JSON.stringify({ title, message, anonymous }),
      }
    );
  }

  async createReply(
    threadId: string,
    message: string,
    anonymous: boolean = false,
    options?: { parentPostId?: string | null; replyToPostId?: string | null }
  ): Promise<BoardPost> {
    const data = await this.requestJson<{ post: BoardPost }>(
      `/api/threads/${encodeURIComponent(threadId)}/posts`,
      {
        method: 'POST',
        body: JSON.stringify({
          message,
          anonymous,
          ...(options?.parentPostId ? { parentPostId: options.parentPostId } : {}),
          ...(options?.replyToPostId ? { replyToPostId: options.replyToPostId } : {}),
        }),
      }
    );
    return data.post;
  }

  async editPost(
    postId: string,
    message: string
  ): Promise<{
    postId: string;
    message: string;
    edited_at: string;
    edit: BoardPostEdit;
  }> {
    const data = await this.requestJson<{ post: BoardPost; edit: BoardPostEdit }>(
      `/api/posts/${encodeURIComponent(postId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ message }),
      }
    );
    return {
      postId: data.post.id,
      message: data.post.message,
      edited_at: data.post.edited_at ?? data.edit.edited_at,
      edit: data.edit,
    };
  }

  async deleteReply(
    postId: string
  ): Promise<{ postId: string; deleted_at: string }> {
    const data = await this.requestJson<{ ok: boolean; deleted_at: string }>(
      `/api/posts/${encodeURIComponent(postId)}`,
      { method: 'DELETE' }
    );
    return { postId, deleted_at: data.deleted_at };
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.requestJson<{ ok: boolean }>(
      `/api/threads/${encodeURIComponent(threadId)}`,
      { method: 'DELETE' }
    );
  }

  subscribeToBoard(
    callbacks: RealtimeBoardCallbacks,
    onStatus?: (status: BoardConnectionStatus) => void
  ): () => void {
    const client = this.resolveRealtimeClient();
    if (!client) {
      onStatus?.('error');
      return () => {};
    }

    const isBrowser = typeof window !== 'undefined';
    const initiallyOffline =
      isBrowser && typeof navigator !== 'undefined' && navigator.onLine === false;
    onStatus?.(initiallyOffline ? 'offline' : 'connecting');

    let isCleanedUp = false;
    boardChannelSeq += 1;
    const channelName = `board-realtime-${boardChannelSeq}`;

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_threads' },
        (payload) => {
          if (isCleanedUp || !payload || typeof payload !== 'object') return;
          const p = payload as { eventType?: string; new?: unknown; old?: unknown };
          if (p.eventType === 'DELETE') {
            const oldId = (p.old as { id?: unknown } | undefined)?.id;
            if (typeof oldId === 'string' && oldId) {
              callbacks.onThreadDelete?.(oldId);
            }
            return;
          }
          if (isThreadRow(p.new)) {
            callbacks.onThreadUpsert?.(p.new);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_posts' },
        (payload) => {
          if (isCleanedUp || !payload || typeof payload !== 'object') return;
          const p = payload as { eventType?: string; new?: unknown };
          if ((p.eventType === 'INSERT' || p.eventType === 'UPDATE') && isPostRow(p.new)) {
            const sanitizedPost: BoardPost = p.new.display_name
              ? { ...p.new, anon_tag: '' }
              : p.new;
            callbacks.onPostUpsert?.(sanitizedPost);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_post_edits' },
        (payload) => {
          if (isCleanedUp || !payload || typeof payload !== 'object') return;
          const p = payload as { eventType?: string; new?: unknown; old?: unknown };
          if (p.eventType === 'INSERT' && isPostEditRow(p.new)) {
            callbacks.onEditInsert?.(p.new);
          } else if (p.eventType === 'DELETE') {
            const oldId = (p.old as { id?: unknown } | undefined)?.id;
            if (typeof oldId === 'string' && oldId) {
              callbacks.onEditDelete?.(oldId);
            }
          }
        }
      )
      .subscribe((status) => {
        if (isCleanedUp) return;
        if (
          isBrowser &&
          typeof navigator !== 'undefined' &&
          navigator.onLine === false
        ) {
          onStatus?.('offline');
          return;
        }
        switch (status) {
          case 'SUBSCRIBED':
            onStatus?.('live');
            break;
          case 'CHANNEL_ERROR':
          case 'TIMED_OUT':
          case 'CLOSED':
            onStatus?.('reconnecting');
            break;
        }
      });

    const handleOffline = () => {
      if (!isCleanedUp) onStatus?.('offline');
    };
    const handleOnline = () => {
      if (!isCleanedUp) onStatus?.('reconnecting');
    };

    if (isBrowser) {
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isCleanedUp = true;
      if (isBrowser) {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
      }
      void client.removeChannel(channel);
    };
  }
}

let cachedService: BoardService | null = null;

export function getBoardService(): BoardService {
  if (!cachedService) {
    cachedService = new SupabaseBoardService();
  }
  return cachedService;
}
