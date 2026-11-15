import { WallPost, NewWallPost, WallConnectionStatus } from './post.types';

export const MAX_POST_LENGTH = 280;
export const MAX_NAME_LENGTH = 24;
export const MAX_VISIBLE_POSTS = 50;
export const MAX_COMMENT_LENGTH = 140;
export const DEFAULT_DISPLAY_NAME = 'Visitor';

export interface MessageValidationResult {
  valid: boolean;
  trimmed: string;
  error?: string;
}

export function validatePostMessage(raw: string): MessageValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      trimmed: '',
      error: 'Please write a message before sharing.',
    };
  }
  if (raw.length > MAX_POST_LENGTH) {
    return {
      valid: false,
      trimmed,
      error: `Messages must be ${MAX_POST_LENGTH} characters or fewer.`,
    };
  }
  return { valid: true, trimmed };
}

export function normalizeDisplayName(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export function sanitizeNewPostInput(input: NewWallPost): NewWallPost {
  const author = normalizeDisplayName(input.author) ?? DEFAULT_DISPLAY_NAME;
  const validation = validatePostMessage(input.message);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid post message.');
  }
  return {
    author,
    message: validation.trimmed,
  };
}

export function comparePostsNewestFirst(a: WallPost, b: WallPost): number {
  const timeA = Date.parse(a.created_at);
  const timeB = Date.parse(b.created_at);
  const safeA = Number.isFinite(timeA) ? timeA : 0;
  const safeB = Number.isFinite(timeB) ? timeB : 0;
  if (safeB !== safeA) {
    return safeB - safeA;
  }
  return b.id.localeCompare(a.id);
}

export function sortAndLimitPosts(
  posts: WallPost[],
  limit: number = MAX_VISIBLE_POSTS
): WallPost[] {
  const byId = new Map<string, WallPost>();
  for (const post of posts) {
    if (post && typeof post.id === 'string' && post.id) {
      byId.set(post.id, post);
    }
  }
  return Array.from(byId.values())
    .sort(comparePostsNewestFirst)
    .slice(0, Math.max(1, limit));
}

export function prependUniquePost(
  posts: WallPost[],
  incoming: WallPost,
  limit: number = MAX_VISIBLE_POSTS
): WallPost[] {
  return sortAndLimitPosts([incoming, ...posts], limit);
}

export function mergeWallPosts(
  existing: WallPost[],
  incoming: WallPost[],
  limit: number = MAX_VISIBLE_POSTS
): WallPost[] {
  return sortAndLimitPosts([...incoming, ...existing], limit);
}

export function filterPosts(posts: WallPost[], query: string): WallPost[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return posts;
  }
  return posts.filter((post) => {
    const haystack = `${post.author} ${post.message}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export function appendFeeling(
  current: string,
  smiley: string = ':)'
): { next: string; added: boolean } {
  const addition = current.length > 0 && !/\s$/.test(current) ? ` ${smiley}` : smiley;
  if (current.length + addition.length > MAX_POST_LENGTH) {
    return { next: current, added: false };
  }
  return { next: `${current}${addition}`, added: true };
}

export function getStatusLabel(status: WallConnectionStatus): string {
  switch (status) {
    case 'preview':
      return 'Local preview';
    case 'connecting':
      return 'Connecting';
    case 'live':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Connection error';
  }
}
