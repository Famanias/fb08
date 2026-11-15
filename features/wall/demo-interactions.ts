import { DemoComment, DemoInteractionsState } from './post.types';
import { createInitialDemoInteractions } from './sample-posts';
import { MAX_COMMENT_LENGTH } from './wall-rules';
import {
  StorageAdapter,
  getBrowserStorage,
  safeReadRaw,
  safeWriteJSON,
} from '@/lib/safe-storage';

export const DEMO_INTERACTIONS_KEY = 'wall08.demo_interactions.v1';

export function loadDemoInteractions(
  storage: StorageAdapter | null = getBrowserStorage()
): DemoInteractionsState {
  const raw = safeReadRaw(DEMO_INTERACTIONS_KEY, storage);
  if (!raw.ok || raw.value === null) {
    const initial = createInitialDemoInteractions();
    if (raw.ok) {
      safeWriteJSON(DEMO_INTERACTIONS_KEY, initial, storage);
    }
    return initial;
  }
  try {
    const parsed = JSON.parse(raw.value) as Partial<DemoInteractionsState>;
    return {
      likesByPostId:
        parsed.likesByPostId && typeof parsed.likesByPostId === 'object'
          ? parsed.likesByPostId
          : {},
      likedPostIds: Array.isArray(parsed.likedPostIds) ? parsed.likedPostIds : [],
      commentsByPostId:
        parsed.commentsByPostId && typeof parsed.commentsByPostId === 'object'
          ? parsed.commentsByPostId
          : {},
    };
  } catch {
    return createInitialDemoInteractions();
  }
}

export function toggleDemoLike(
  state: DemoInteractionsState,
  postId: string,
  storage: StorageAdapter | null = getBrowserStorage()
): { next: DemoInteractionsState; saved: boolean } {
  const alreadyLiked = state.likedPostIds.includes(postId);
  const currentLikes = Math.max(0, Number(state.likesByPostId[postId] ?? 0));
  const nextLikes = Math.max(0, currentLikes + (alreadyLiked ? -1 : 1));
  const next: DemoInteractionsState = {
    ...state,
    likesByPostId: {
      ...state.likesByPostId,
      [postId]: nextLikes,
    },
    likedPostIds: alreadyLiked
      ? state.likedPostIds.filter((id) => id !== postId)
      : [...state.likedPostIds, postId],
  };
  const write = safeWriteJSON(DEMO_INTERACTIONS_KEY, next, storage);
  return { next, saved: write.ok };
}

export function addDemoComment(
  state: DemoInteractionsState,
  postId: string,
  author: string,
  rawText: string,
  storage: StorageAdapter | null = getBrowserStorage()
): { next: DemoInteractionsState; added: boolean; saved: boolean } {
  const text = rawText.trim();
  if (!text || text.length > MAX_COMMENT_LENGTH) {
    return { next: state, added: false, saved: true };
  }
  const existingComments: DemoComment[] = Array.isArray(
    state.commentsByPostId[postId]
  )
    ? state.commentsByPostId[postId]
    : [];
  const next: DemoInteractionsState = {
    ...state,
    commentsByPostId: {
      ...state.commentsByPostId,
      [postId]: [...existingComments, { author, text }],
    },
  };
  const write = safeWriteJSON(DEMO_INTERACTIONS_KEY, next, storage);
  return { next, added: true, saved: write.ok };
}
