'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBoardService } from './board-service';
import {
  BoardConnectionStatus,
  BoardPost,
  BoardThreadSummary,
  BoardUser,
} from './board.types';
import {
  MAX_VISIBLE_THREADS,
  filterPostsInThread,
  filterThreads,
  mergeThreadList,
  runSingleFlight,
  sortAndMergeThreadPosts,
} from './board-rules';

export interface UseTextboardResult {
  user: BoardUser | null;
  isAuthLoading: boolean;
  isAuthSubmitting: boolean;
  authError: string | null;
  clearAuthError: () => void;
  threads: BoardThreadSummary[];
  visibleThreads: BoardThreadSummary[];
  selectedThread: BoardThreadSummary | null;
  selectedThreadId: string | null;
  threadPosts: BoardPost[];
  visiblePosts: BoardPost[];
  isThreadOwner: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  connectionStatus: BoardConnectionStatus;
  isLoading: boolean;
  isLoadingThread: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  clearError: () => void;
  registerAccount: (username: string, password: string) => Promise<boolean>;
  loginAccount: (username: string, password: string) => Promise<boolean>;
  logoutAccount: () => Promise<void>;
  selectThread: (threadId: string | null) => void;
  createThread: (title: string, message: string, anonymous?: boolean) => Promise<string | null>;
  createReply: (
    message: string,
    anonymous?: boolean,
    options?: { parentPostId?: string | null; replyToPostId?: string | null }
  ) => Promise<boolean>;
  editPost: (postId: string, message: string) => Promise<boolean>;
  deleteReply: (postId: string) => Promise<boolean>;
  deleteSelectedThread: () => Promise<boolean>;
  retryLoad: () => Promise<void>;
}

export function useTextboard(
  onNotify?: (message: string) => void
): UseTextboardResult {
  const service = useMemo(() => getBoardService(), []);

  const [user, setUser] = useState<BoardUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [threads, setThreads] = useState<BoardThreadSummary[]>([]);
  const [ownedThreadIds, setOwnedThreadIds] = useState<Set<string>>(() => new Set());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadPosts, setThreadPosts] = useState<BoardPost[]>([]);
  const [ownedPostIds, setOwnedPostIds] = useState<Set<string>>(() => new Set());
  const [isThreadOwner, setIsThreadOwner] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [connectionStatus, setConnectionStatus] =
    useState<BoardConnectionStatus>('connecting');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingThread, setIsLoadingThread] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef<boolean>(true);
  const submittingRef = useRef<boolean>(false);
  const authSubmittingRef = useRef<boolean>(false);
  const selectedThreadIdRef = useRef<string | null>(null);
  const detailSeqRef = useRef<number>(0);

  const loadThreads = useCallback(async () => {
    try {
      const res = await service.listThreads(MAX_VISIBLE_THREADS);
      if (!mountedRef.current) return;
      const owned = new Set(res.ownedThreadIds);
      setOwnedThreadIds(owned);
      setThreads((prev) => mergeThreadList(prev, res.threads, owned, MAX_VISIBLE_THREADS));
      setErrorMessage(null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Could not load threads.');
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [service]);

  const loadThreadDetail = useCallback(
    async (threadId: string) => {
      detailSeqRef.current += 1;
      const reqId = detailSeqRef.current;
      setIsLoadingThread(true);
      try {
        const detail = await service.getThreadDetail(threadId);
        if (!mountedRef.current || detailSeqRef.current !== reqId) return;
        const ownedPosts = new Set(detail.ownedPostIds);
        setOwnedPostIds(ownedPosts);
        setIsThreadOwner(detail.isThreadOwner);
        setThreads((prev) =>
          mergeThreadList(
            prev,
            [detail.thread],
            undefined,
            MAX_VISIBLE_THREADS
          )
        );
        setThreadPosts((prev) => sortAndMergeThreadPosts(prev, detail.posts, ownedPosts));
        setErrorMessage(null);
      } catch (err: unknown) {
        if (!mountedRef.current || detailSeqRef.current !== reqId) return;
        const msg = err instanceof Error ? err.message : 'Could not load thread.';
        if (msg.toLowerCase().includes('not found')) {
          setSelectedThreadId(null);
          selectedThreadIdRef.current = null;
          setThreadPosts([]);
        }
        setErrorMessage(msg);
      } finally {
        if (mountedRef.current && detailSeqRef.current === reqId) {
          setIsLoadingThread(false);
        }
      }
    },
    [service]
  );

  const reconcileAll = useCallback(async () => {
    await loadThreads();
    const activeId = selectedThreadIdRef.current;
    if (activeId) {
      await loadThreadDetail(activeId);
    }
  }, [loadThreadDetail, loadThreads]);

  useEffect(() => {
    mountedRef.current = true;
    let hadConnectedBefore = false;

    const unsubscribe = service.subscribeToBoard(
      {
        onThreadUpsert: (incomingThread) => {
          setThreads((prev) =>
            mergeThreadList(prev, [incomingThread], undefined, MAX_VISIBLE_THREADS)
          );
        },
        onThreadDelete: (deletedId) => {
          setThreads((prev) => prev.filter((t) => t.id !== deletedId));
          if (selectedThreadIdRef.current === deletedId) {
            selectedThreadIdRef.current = null;
            setSelectedThreadId(null);
            setThreadPosts([]);
            setIsThreadOwner(false);
            onNotify?.('This thread was deleted by its creator.');
          }
        },
        onPostUpsert: (incomingPost) => {
          if (incomingPost.post_number === 1) {
            setThreads((prev) =>
              prev.map((t) =>
                t.id === incomingPost.thread_id
                  ? {
                      ...t,
                      op_display_name: incomingPost.display_name ?? null,
                      op_anon_tag: incomingPost.display_name
                        ? undefined
                        : (t.op_anon_tag ?? incomingPost.anon_tag),
                      op_preview: incomingPost.message,
                    }
                  : t
              )
            );
          }
          if (selectedThreadIdRef.current === incomingPost.thread_id) {
            setThreadPosts((prev) => sortAndMergeThreadPosts(prev, [incomingPost]));
          }
        },
        onEditInsert: (incomingEdit) => {
          setThreadPosts((prev) =>
            prev.map((post) => {
              if (post.id !== incomingEdit.post_id || post.deleted_at) {
                return post;
              }
              return sortAndMergeThreadPosts([post], [
                { ...post, edits: [incomingEdit] },
              ])[0];
            })
          );
        },
        onEditDelete: (deletedEditId) => {
          setThreadPosts((prev) =>
            prev.map((post) =>
              post.edits?.some((e) => e.id === deletedEditId)
                ? {
                    ...post,
                    edits: post.edits.filter((e) => e.id !== deletedEditId),
                  }
                : post
            )
          );
        },
      },
      (status) => {
        if (!mountedRef.current) return;
        setConnectionStatus(status);
        if (status === 'live') {
          if (hadConnectedBefore) {
            void reconcileAll();
          }
          hadConnectedBefore = true;
        }
      }
    );

    void (async () => {
      try {
        const sessionUser = await service.fetchSession();
        if (mountedRef.current) {
          setUser(sessionUser);
        }
      } catch {
        // Unauthenticated or temporary network issue handled by thread load
      } finally {
        if (mountedRef.current) {
          setIsAuthLoading(false);
        }
      }
      await loadThreads();
    })();

    const handleOnline = () => void reconcileAll();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void reconcileAll();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe();
    };
  }, [loadThreads, onNotify, reconcileAll, service]);

  const selectThread = useCallback(
    (threadId: string | null) => {
      selectedThreadIdRef.current = threadId;
      setSelectedThreadId(threadId);
      setErrorMessage(null);
      if (!threadId) {
        detailSeqRef.current += 1;
        setThreadPosts([]);
        setIsThreadOwner(false);
        setOwnedPostIds(new Set());
        setIsLoadingThread(false);
        return;
      }
      setThreadPosts([]);
      void loadThreadDetail(threadId);
    },
    [loadThreadDetail]
  );

  const registerAccount = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      const result = await runSingleFlight(authSubmittingRef, async () => {
        setIsAuthSubmitting(true);
        setAuthError(null);
        try {
          const nextUser = await service.register(username, password);
          if (!mountedRef.current) return false;
          setUser(nextUser);
          await reconcileAll();
          onNotify?.(`Registered and signed in as ${nextUser.username}.`);
          return true;
        } catch (err: unknown) {
          if (!mountedRef.current) return false;
          setAuthError(err instanceof Error ? err.message : 'Registration failed.');
          return false;
        } finally {
          if (mountedRef.current) setIsAuthSubmitting(false);
        }
      });
      return result ?? false;
    },
    [onNotify, reconcileAll, service]
  );

  const loginAccount = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      const result = await runSingleFlight(authSubmittingRef, async () => {
        setIsAuthSubmitting(true);
        setAuthError(null);
        try {
          const nextUser = await service.login(username, password);
          if (!mountedRef.current) return false;
          setUser(nextUser);
          await reconcileAll();
          onNotify?.(`Signed in as ${nextUser.username}.`);
          return true;
        } catch (err: unknown) {
          if (!mountedRef.current) return false;
          setAuthError(err instanceof Error ? err.message : 'Sign in failed.');
          return false;
        } finally {
          if (mountedRef.current) setIsAuthSubmitting(false);
        }
      });
      return result ?? false;
    },
    [onNotify, reconcileAll, service]
  );

  const logoutAccount = useCallback(async () => {
    await runSingleFlight(authSubmittingRef, async () => {
      setIsAuthSubmitting(true);
      try {
        await service.logout();
        if (!mountedRef.current) return;
        setUser(null);
        setOwnedThreadIds(new Set());
        setOwnedPostIds(new Set());
        setIsThreadOwner(false);
        setThreads((prev) => prev.map((t) => ({ ...t, is_mine: false })));
        setThreadPosts((prev) => prev.map((p) => ({ ...p, is_mine: false })));
        onNotify?.('Signed out.');
      } catch (err: unknown) {
        if (mountedRef.current) {
          setAuthError(err instanceof Error ? err.message : 'Could not sign out.');
        }
      } finally {
        if (mountedRef.current) setIsAuthSubmitting(false);
      }
    });
  }, [onNotify, service]);

  const createThread = useCallback(
    async (
      title: string,
      message: string,
      anonymous: boolean = false
    ): Promise<string | null> => {
      if (submittingRef.current) return null;
      submittingRef.current = true;
      setIsSubmitting(true);
      setErrorMessage(null);
      try {
        const { thread, post } = await service.createThread(title, message, anonymous);
        if (!mountedRef.current) return null;
        const nextOwned = new Set(ownedThreadIds);
        nextOwned.add(thread.id);
        setOwnedThreadIds(nextOwned);
        setThreads((prev) => mergeThreadList(prev, [thread], nextOwned, MAX_VISIBLE_THREADS));
        selectedThreadIdRef.current = thread.id;
        setSelectedThreadId(thread.id);
        setOwnedPostIds(new Set([post.id]));
        setIsThreadOwner(true);
        setThreadPosts([{ ...post, edits: [], is_mine: true }]);
        onNotify?.(anonymous ? 'Thread created anonymously.' : 'Thread created.');
        return thread.id;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Could not create thread.'
          );
        }
        return null;
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setIsSubmitting(false);
      }
    },
    [onNotify, ownedThreadIds, service]
  );

  const createReply = useCallback(
    async (
      message: string,
      anonymous: boolean = false,
      options?: { parentPostId?: string | null; replyToPostId?: string | null }
    ): Promise<boolean> => {
      const threadId = selectedThreadIdRef.current;
      if (!threadId || submittingRef.current) return false;
      submittingRef.current = true;
      setIsSubmitting(true);
      setErrorMessage(null);
      try {
        const post = await service.createReply(threadId, message, anonymous, options);
        if (!mountedRef.current) return false;
        const nextOwned = new Set(ownedPostIds);
        nextOwned.add(post.id);
        setOwnedPostIds(nextOwned);
        setThreadPosts((prev) =>
          sortAndMergeThreadPosts(prev, [{ ...post, is_mine: true }], nextOwned)
        );
        setThreads((prev) =>
          mergeThreadList(
            prev,
            prev
              .filter((t) => t.id === threadId)
              .map((t) => ({
                ...t,
                reply_count: Math.max(t.reply_count, post.post_number),
                bumped_at: post.created_at,
              })),
            undefined,
            MAX_VISIBLE_THREADS
          )
        );
        const kindLabel = post.parent_post_id ? 'Reply' : 'Comment';
        onNotify?.(
          anonymous
            ? `${kindLabel} #${post.post_number} posted anonymously.`
            : `${kindLabel} #${post.post_number} posted.`
        );
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not post reply.');
        }
        return false;
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setIsSubmitting(false);
      }
    },
    [onNotify, ownedPostIds, service]
  );

  const editPost = useCallback(
    async (postId: string, message: string): Promise<boolean> => {
      setErrorMessage(null);
      try {
        const res = await service.editPost(postId, message);
        if (!mountedRef.current) return false;
        setThreadPosts((prev) =>
          prev.map((p) => {
            if (p.id !== postId) return p;
            return sortAndMergeThreadPosts([p], [
              {
                ...p,
                message: res.message,
                edited_at: res.edited_at,
                edits: [res.edit],
              },
            ])[0];
          })
        );
        if (selectedThreadIdRef.current) {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === selectedThreadIdRef.current &&
              threadPosts.find((p) => p.id === postId)?.post_number === 1
                ? { ...t, op_preview: res.message }
                : t
            )
          );
        }
        onNotify?.('Post updated.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not edit post.');
        }
        return false;
      }
    },
    [onNotify, service, threadPosts]
  );

  const deleteReply = useCallback(
    async (postId: string): Promise<boolean> => {
      setErrorMessage(null);
      try {
        const res = await service.deleteReply(postId);
        if (!mountedRef.current) return false;
        setThreadPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  message: '[deleted]',
                  deleted_at: res.deleted_at,
                  edits: [],
                }
              : p
          )
        );
        onNotify?.('Reply deleted.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not delete reply.');
        }
        return false;
      }
    },
    [onNotify, service]
  );

  const deleteSelectedThread = useCallback(async (): Promise<boolean> => {
    const threadId = selectedThreadIdRef.current;
    if (!threadId) return false;
    setErrorMessage(null);
    try {
      await service.deleteThread(threadId);
      if (!mountedRef.current) return false;
      selectedThreadIdRef.current = null;
      setSelectedThreadId(null);
      setThreadPosts([]);
      setIsThreadOwner(false);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      onNotify?.('Thread deleted.');
      return true;
    } catch (err: unknown) {
      if (mountedRef.current) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not delete thread.');
      }
      return false;
    }
  }, [onNotify, service]);

  const retryLoad = useCallback(async () => {
    setIsLoading(true);
    await reconcileAll();
  }, [reconcileAll]);

  const visibleThreads = useMemo(
    () => filterThreads(threads, searchQuery),
    [searchQuery, threads]
  );

  const visiblePosts = useMemo(
    () => filterPostsInThread(threadPosts, searchQuery),
    [searchQuery, threadPosts]
  );

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  return {
    user,
    isAuthLoading,
    isAuthSubmitting,
    authError,
    clearAuthError: () => setAuthError(null),
    threads,
    visibleThreads,
    selectedThread,
    selectedThreadId,
    threadPosts,
    visiblePosts,
    isThreadOwner,
    searchQuery,
    setSearchQuery,
    connectionStatus,
    isLoading,
    isLoadingThread,
    isSubmitting,
    errorMessage,
    clearError: () => setErrorMessage(null),
    registerAccount,
    loginAccount,
    logoutAccount,
    selectThread,
    createThread,
    createReply,
    editPost,
    deleteReply,
    deleteSelectedThread,
    retryLoad,
  };
}
