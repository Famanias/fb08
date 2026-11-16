'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardUser } from '@/features/board/board.types';
import {
  createProfileComment,
  createProfilePost,
  deleteProfileComment,
  deleteProfilePost,
  fetchProfile,
  listProfiles,
  setFollowState,
  subscribeProfileSignal,
  updateMyAvatar,
  updateProfilePost,
  uploadProfileMedia,
} from './profile-service';
import {
  PostVisibility,
  ProfileDirectoryEntry,
  ProfileMediaType,
  ProfilePost,
  ProfileSummary,
} from './profile.types';

export interface UseProfileResult {
  directory: ProfileDirectoryEntry[];
  profile: ProfileSummary | null;
  posts: ProfilePost[];
  isLoadingDirectory: boolean;
  isLoadingProfile: boolean;
  isSubmittingProfile: boolean;
  profileError: string | null;
  clearProfileError: () => void;
  loadDirectory: (query?: string) => Promise<void>;
  loadProfile: (username: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<boolean>;
  removeAvatar: () => Promise<boolean>;
  toggleFollow: (username: string, follow: boolean) => Promise<boolean>;
  publishPost: (input: {
    body: string;
    visibility: PostVisibility;
    file?: File | null;
    sharedPostId?: string | null;
  }) => Promise<boolean>;
  updatePost: (
    postId: string,
    patch: { body?: string; visibility?: PostVisibility }
  ) => Promise<boolean>;
  deletePost: (postId: string) => Promise<boolean>;
  addComment: (
    postId: string,
    input: {
      body: string;
      parentCommentId?: string | null;
      replyToCommentId?: string | null;
    }
  ) => Promise<boolean>;
  removeComment: (commentId: string) => Promise<boolean>;
}

export function useProfile(
  user: BoardUser | null,
  activeProfileUsername: string | null,
  onNotify?: (message: string) => void
): UseProfileResult {
  const [directory, setDirectory] = useState<ProfileDirectoryEntry[]>([]);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const activeUsernameRef = useRef<string | null>(activeProfileUsername);
  const signalRef = useRef<ReturnType<typeof subscribeProfileSignal> | null>(null);

  useEffect(() => {
    activeUsernameRef.current = activeProfileUsername;
  }, [activeProfileUsername]);

  const loadDirectory = useCallback(async (query: string = '') => {
    setIsLoadingDirectory(true);
    try {
      const list = await listProfiles(query);
      if (mountedRef.current) {
        setDirectory(list);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setProfileError(
          err instanceof Error ? err.message : 'Could not load member directory.'
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsLoadingDirectory(false);
      }
    }
  }, []);

  const loadProfile = useCallback(async (username: string) => {
    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      const data = await fetchProfile(username);
      if (!mountedRef.current) return;
      if (
        activeUsernameRef.current &&
        activeUsernameRef.current.toLowerCase() !== username.toLowerCase()
      ) {
        return;
      }
      setProfile(data.profile);
      setPosts(data.posts);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setProfile(null);
      setPosts([]);
      setProfileError(err instanceof Error ? err.message : 'Could not load profile.');
    } finally {
      if (mountedRef.current) {
        setIsLoadingProfile(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const signal = subscribeProfileSignal((changedUsername) => {
      if (
        activeUsernameRef.current &&
        activeUsernameRef.current.toLowerCase() === changedUsername.toLowerCase()
      ) {
        void loadProfile(changedUsername);
      }
    });
    signalRef.current = signal;
    return () => {
      mountedRef.current = false;
      signal.unsubscribe();
      signalRef.current = null;
    };
  }, [loadProfile]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await listProfiles('');
        if (active && mountedRef.current) {
          setDirectory(list);
        }
      } catch {
        // Explicit directory open handles error surfacing
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeProfileUsername) return;
    let active = true;
    void (async () => {
      try {
        const data = await fetchProfile(activeProfileUsername);
        if (!active || !mountedRef.current) return;
        setProfile(data.profile);
        setPosts(data.posts);
        setProfileError(null);
      } catch (err: unknown) {
        if (!active || !mountedRef.current) return;
        setProfile(null);
        setPosts([]);
        setProfileError(err instanceof Error ? err.message : 'Could not load profile.');
      }
    })();
    return () => {
      active = false;
    };
  }, [activeProfileUsername, user?.id]);

  const uploadAvatar = useCallback(
    async (file: File): Promise<boolean> => {
      setIsSubmittingProfile(true);
      setProfileError(null);
      try {
        const uploaded = await uploadProfileMedia('avatar', file);
        const res = await updateMyAvatar(uploaded.path);
        if (!mountedRef.current) return false;
        setProfile((prev) => (prev ? { ...prev, avatarUrl: res.avatarUrl } : prev));
        setPosts((prev) =>
          prev.map((p) => (p.is_mine ? { ...p, author_avatar_url: res.avatarUrl } : p))
        );
        if (user) {
          signalRef.current?.notifyProfileChanged(user.username);
        }
        await loadDirectory('');
        onNotify?.('Profile picture updated.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not update profile picture.'
          );
        }
        return false;
      } finally {
        if (mountedRef.current) setIsSubmittingProfile(false);
      }
    },
    [loadDirectory, onNotify, user]
  );

  const removeAvatar = useCallback(async (): Promise<boolean> => {
    setIsSubmittingProfile(true);
    setProfileError(null);
    try {
      await updateMyAvatar(null);
      if (!mountedRef.current) return false;
      setProfile((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
      setPosts((prev) =>
        prev.map((p) => (p.is_mine ? { ...p, author_avatar_url: null } : p))
      );
      if (user) {
        signalRef.current?.notifyProfileChanged(user.username);
      }
      await loadDirectory('');
      onNotify?.('Profile picture removed.');
      return true;
    } catch (err: unknown) {
      if (mountedRef.current) {
        setProfileError(
          err instanceof Error ? err.message : 'Could not remove profile picture.'
        );
      }
      return false;
    } finally {
      if (mountedRef.current) setIsSubmittingProfile(false);
    }
  }, [loadDirectory, onNotify, user]);

  const toggleFollow = useCallback(
    async (username: string, follow: boolean): Promise<boolean> => {
      setIsSubmittingProfile(true);
      setProfileError(null);
      try {
        const updated = await setFollowState(username, follow);
        if (!mountedRef.current) return false;
        if (activeUsernameRef.current?.toLowerCase() === username.toLowerCase()) {
          await loadProfile(username);
        }
        await loadDirectory('');
        signalRef.current?.notifyProfileChanged(username);
        if (updated.relationship.isFriend) {
          onNotify?.(`You and ${username} follow each other — you are now Friends!`);
        } else {
          onNotify?.(follow ? `Following ${username}.` : `Unfollowed ${username}.`);
        }
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not update follow status.'
          );
        }
        return false;
      } finally {
        if (mountedRef.current) setIsSubmittingProfile(false);
      }
    },
    [loadDirectory, loadProfile, onNotify]
  );

  const publishPost = useCallback(
    async (input: {
      body: string;
      visibility: PostVisibility;
      file?: File | null;
      sharedPostId?: string | null;
    }): Promise<boolean> => {
      setIsSubmittingProfile(true);
      setProfileError(null);
      try {
        let mediaPath: string | null = null;
        let mediaType: ProfileMediaType | null = null;
        if (input.file) {
          const uploaded = await uploadProfileMedia('post', input.file);
          mediaPath = uploaded.path;
          mediaType = uploaded.mediaType;
        }
        const post = await createProfilePost({
          body: input.body,
          visibility: input.visibility,
          mediaPath,
          mediaType,
          sharedPostId: input.sharedPostId ?? null,
        });
        if (!mountedRef.current) return false;
        if (
          user &&
          activeUsernameRef.current?.toLowerCase() === user.username.toLowerCase()
        ) {
          setPosts((prev) => [post, ...prev]);
        }
        if (user) {
          signalRef.current?.notifyProfileChanged(user.username);
        }
        onNotify?.(
          input.sharedPostId ? 'Shared post to your profile.' : 'Posted to your profile.'
        );
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not publish profile post.'
          );
        }
        return false;
      } finally {
        if (mountedRef.current) setIsSubmittingProfile(false);
      }
    },
    [onNotify, user]
  );

  const updatePost = useCallback(
    async (
      postId: string,
      patch: { body?: string; visibility?: PostVisibility }
    ): Promise<boolean> => {
      setProfileError(null);
      try {
        const updated = await updateProfilePost(postId, patch);
        if (!mountedRef.current) return false;
        setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
        if (user) {
          signalRef.current?.notifyProfileChanged(user.username);
        }
        onNotify?.('Profile post updated.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not update profile post.'
          );
        }
        return false;
      }
    },
    [onNotify, user]
  );

  const deletePost = useCallback(
    async (postId: string): Promise<boolean> => {
      setProfileError(null);
      try {
        await deleteProfilePost(postId);
        if (!mountedRef.current) return false;
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        if (user) {
          signalRef.current?.notifyProfileChanged(user.username);
        }
        onNotify?.('Profile post deleted.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not delete profile post.'
          );
        }
        return false;
      }
    },
    [onNotify, user]
  );

  const addComment = useCallback(
    async (
      postId: string,
      input: {
        body: string;
        parentCommentId?: string | null;
        replyToCommentId?: string | null;
      }
    ): Promise<boolean> => {
      setProfileError(null);
      try {
        const comment = await createProfileComment(postId, input);
        if (!mountedRef.current) return false;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, comments: [...p.comments, comment] } : p
          )
        );
        if (activeUsernameRef.current) {
          signalRef.current?.notifyProfileChanged(activeUsernameRef.current);
        }
        onNotify?.(input.parentCommentId ? 'Reply posted.' : 'Comment posted.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not post comment.'
          );
        }
        return false;
      }
    },
    [onNotify]
  );

  const removeComment = useCallback(
    async (commentId: string): Promise<boolean> => {
      setProfileError(null);
      try {
        const res = await deleteProfileComment(commentId);
        if (!mountedRef.current) return false;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === res.postId
              ? {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.id === commentId
                      ? { ...c, body: '[deleted]', deleted_at: res.deleted_at }
                      : c
                  ),
                }
              : p
          )
        );
        if (activeUsernameRef.current) {
          signalRef.current?.notifyProfileChanged(activeUsernameRef.current);
        }
        onNotify?.('Comment deleted.');
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setProfileError(
            err instanceof Error ? err.message : 'Could not delete comment.'
          );
        }
        return false;
      }
    },
    [onNotify]
  );

  const matchesActiveProfile = Boolean(
    activeProfileUsername &&
      profile &&
      profile.username.toLowerCase() === activeProfileUsername.toLowerCase()
  );

  return {
    directory,
    profile: matchesActiveProfile ? profile : null,
    posts: matchesActiveProfile ? posts : [],
    isLoadingDirectory,
    isLoadingProfile: isLoadingProfile || (Boolean(activeProfileUsername) && !matchesActiveProfile && !profileError),
    isSubmittingProfile,
    profileError,
    clearProfileError: () => setProfileError(null),
    loadDirectory,
    loadProfile,
    uploadAvatar,
    removeAvatar,
    toggleFollow,
    publishPost,
    updatePost,
    deletePost,
    addComment,
    removeComment,
  };
}
