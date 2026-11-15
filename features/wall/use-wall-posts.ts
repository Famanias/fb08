'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WALL_CAPABILITIES } from './capabilities';
import {
  addDemoComment,
  loadDemoInteractions,
  toggleDemoLike,
} from './demo-interactions';
import { getPostService } from './post-service';
import {
  DemoInteractionsState,
  WallConnectionStatus,
  WallPost,
} from './post.types';
import {
  DEFAULT_DISPLAY_NAME,
  MAX_VISIBLE_POSTS,
  filterPosts,
  mergeWallPosts,
  normalizeDisplayName,
  prependUniquePost,
  sortAndLimitPosts,
} from './wall-rules';
import { safeReadJSON, safeWriteJSON } from '@/lib/safe-storage';

export const DISPLAY_NAME_STORAGE_KEY = 'wall08.name.v1';

const EMPTY_DEMO_INTERACTIONS: DemoInteractionsState = {
  likesByPostId: {},
  likedPostIds: [],
  commentsByPostId: {},
};

export interface UseWallPostsResult {
  posts: WallPost[];
  visiblePosts: WallPost[];
  totalCount: number;
  displayName: string;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  isLoading: boolean;
  isPosting: boolean;
  errorMessage: string | null;
  clearError: () => void;
  connectionStatus: WallConnectionStatus;
  hydrated: boolean;
  demoInteractions: DemoInteractionsState;
  createPost: (message: string) => Promise<boolean>;
  retryLoad: () => Promise<void>;
  updateDisplayName: (nextName: string) => { ok: boolean; name?: string; error?: string };
  toggleLike: (postId: string) => { ok: boolean; error?: string };
  addComment: (postId: string, text: string) => { ok: boolean; error?: string };
}

export function useWallPosts(): UseWallPostsResult {
  const postService = useMemo(() => getPostService(), []);
  const [posts, setPosts] = useState<WallPost[]>([]);
  const [displayName, setDisplayName] = useState<string>(DEFAULT_DISPLAY_NAME);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<WallConnectionStatus>(
    WALL_CAPABILITIES.isLocalPreview ? 'preview' : 'connecting'
  );
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [demoInteractions, setDemoInteractions] =
    useState<DemoInteractionsState>(EMPTY_DEMO_INTERACTIONS);

  const postingRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  const reconcileLatest = useCallback(async () => {
    try {
      const latestPosts = await postService.listLatest(MAX_VISIBLE_POSTS);
      if (!mountedRef.current) return;
      setPosts((prev) => mergeWallPosts(prev, latestPosts, MAX_VISIBLE_POSTS));
      setErrorMessage(null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not load wall posts.'
      );
    } finally {
      if (!mountedRef.current) return;
      setHydrated(true);
      setIsLoading(false);
    }
  }, [postService]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let needsReconnectReconcile = false;
    let initialLoadDone = false;

    void Promise.resolve().then(() => {
      if (!active) return;
      const storedName = safeReadJSON<string>(
        DISPLAY_NAME_STORAGE_KEY,
        DEFAULT_DISPLAY_NAME
      );
      const normalized =
        typeof storedName.value === 'string'
          ? normalizeDisplayName(storedName.value)
          : null;
      setDisplayName(normalized ?? DEFAULT_DISPLAY_NAME);

      if (WALL_CAPABILITIES.demoInteractionsEnabled) {
        setDemoInteractions(loadDemoInteractions());
      }
    });

    // Subscribe before the initial fetch so events arriving mid-flight are captured and merged.
    const unsubscribe = postService.subscribeToNewPosts(
      (incomingPost) => {
        if (!active) return;
        setPosts((prev) =>
          prependUniquePost(prev, incomingPost, MAX_VISIBLE_POSTS)
        );
      },
      (status) => {
        if (!active) return;
        setConnectionStatus(status);
        if (
          status === 'reconnecting' ||
          status === 'offline' ||
          status === 'error'
        ) {
          needsReconnectReconcile = true;
        } else if (status === 'live' && needsReconnectReconcile) {
          needsReconnectReconcile = false;
          void reconcileLatest();
        }
      }
    );

    void Promise.resolve()
      .then(() => reconcileLatest())
      .finally(() => {
        initialLoadDone = true;
      });

    const handleVisibilityOrOnline = () => {
      if (!active || !initialLoadDone) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      void reconcileLatest();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleVisibilityOrOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    }

    return () => {
      active = false;
      mountedRef.current = false;
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleVisibilityOrOnline);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      }
    };
  }, [postService, reconcileLatest]);

  const visiblePosts = useMemo(() => {
    const ordered = sortAndLimitPosts(posts, MAX_VISIBLE_POSTS);
    return filterPosts(ordered, searchQuery);
  }, [posts, searchQuery]);

  const createPost = useCallback(
    async (message: string): Promise<boolean> => {
      if (postingRef.current) {
        return false;
      }
      postingRef.current = true;
      setIsPosting(true);
      setErrorMessage(null);

      try {
        const created = await postService.create({
          author: displayName,
          message,
        });
        setPosts((prev) => prependUniquePost(prev, created, MAX_VISIBLE_POSTS));
        return true;
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to publish post. Please try again.'
        );
        return false;
      } finally {
        postingRef.current = false;
        setIsPosting(false);
      }
    },
    [displayName, postService]
  );

  const updateDisplayName = useCallback(
    (
      nextRaw: string
    ): { ok: boolean; name?: string; error?: string } => {
      const normalized = normalizeDisplayName(nextRaw);
      if (!normalized) {
        return { ok: false, error: 'Please enter a display name.' };
      }
      setDisplayName(normalized);
      const saved = safeWriteJSON(DISPLAY_NAME_STORAGE_KEY, normalized);
      if (!saved.ok) {
        return {
          ok: true,
          name: normalized,
          error:
            saved.error ??
            'Display name updated for this session, but browser storage is unavailable.',
        };
      }
      return { ok: true, name: normalized };
    },
    []
  );

  const toggleLike = useCallback(
    (postId: string): { ok: boolean; error?: string } => {
      if (!WALL_CAPABILITIES.demoInteractionsEnabled) {
        return { ok: false };
      }
      let saved = true;
      setDemoInteractions((prev) => {
        const res = toggleDemoLike(prev, postId);
        saved = res.saved;
        return res.next;
      });
      if (!saved) {
        return {
          ok: false,
          error: 'Browser storage is unavailable. Changes may not persist.',
        };
      }
      return { ok: true };
    },
    []
  );

  const addComment = useCallback(
    (postId: string, text: string): { ok: boolean; error?: string } => {
      if (!WALL_CAPABILITIES.demoInteractionsEnabled) {
        return { ok: false };
      }
      let added = false;
      let saved = true;
      setDemoInteractions((prev) => {
        const res = addDemoComment(prev, postId, displayName, text);
        added = res.added;
        saved = res.saved;
        return res.next;
      });
      if (!added) {
        return { ok: false, error: 'Please enter a comment under 140 characters.' };
      }
      if (!saved) {
        return {
          ok: true,
          error: 'Comment shown locally, but browser storage is unavailable.',
        };
      }
      return { ok: true };
    },
    [displayName]
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return {
    posts,
    visiblePosts,
    totalCount: posts.length,
    displayName,
    searchQuery,
    setSearchQuery,
    isLoading,
    isPosting,
    errorMessage,
    clearError,
    connectionStatus,
    hydrated,
    demoInteractions,
    createPost,
    retryLoad: reconcileLatest,
    updateDisplayName,
    toggleLike,
    addComment,
  };
}
