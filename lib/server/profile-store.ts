import type { SupabaseClient } from '@supabase/supabase-js';
import { PostVisibility, ProfileMediaType } from '@/features/profile/profile.types';
import { getSupabaseAdminClient } from './supabase-admin';

export interface StoredProfileUser {
  id: string;
  username: string;
  avatar_path: string | null;
}

export interface StoredProfilePost {
  id: string;
  author_user_id: string;
  visibility: PostVisibility;
  body: string;
  media_path: string | null;
  media_type: ProfileMediaType | null;
  shared_post_id: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface StoredProfileComment {
  id: string;
  post_id: string;
  author_user_id: string;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface StoredFollowStats {
  followerCount: number;
  followingCount: number;
  friendCount: number;
  isFollowing: boolean;
  followsViewer: boolean;
  isFriend: boolean;
  friends: StoredProfileUser[];
}

export interface ProfileServerStore {
  listProfileUsers(query: string, limit: number): Promise<StoredProfileUser[]>;
  findProfileUserByLowerUsername(lowerUsername: string): Promise<StoredProfileUser | null>;
  findProfileUsersByIds(ids: string[]): Promise<Map<string, StoredProfileUser>>;
  getFollowStats(viewerId: string | null, targetUserId: string): Promise<StoredFollowStats>;
  getBatchFollowStats(
    viewerId: string | null,
    targetUserIds: string[]
  ): Promise<
    Map<
      string,
      {
        followerCount: number;
        friendCount: number;
        isFollowing: boolean;
        followsViewer: boolean;
        isFriend: boolean;
      }
    >
  >;
  followUser(followerId: string, followingId: string): Promise<void>;
  unfollowUser(followerId: string, followingId: string): Promise<void>;
  updateAvatarPath(userId: string, avatarPath: string | null): Promise<StoredProfileUser | null>;
  createSignedUploadUrl(
    path: string
  ): Promise<{ signedUrl: string; token: string; path: string }>;
  createSignedReadUrls(paths: string[]): Promise<Map<string, string>>;
  listProfilePostsByAuthor(authorUserId: string): Promise<StoredProfilePost[]>;
  findProfilePostById(postId: string): Promise<StoredProfilePost | null>;
  findProfilePostsByIds(postIds: string[]): Promise<Map<string, StoredProfilePost>>;
  listCommentsForPosts(postIds: string[]): Promise<StoredProfileComment[]>;
  createProfilePost(input: {
    authorUserId: string;
    visibility: PostVisibility;
    body: string;
    mediaPath: string | null;
    mediaType: ProfileMediaType | null;
    sharedPostId: string | null;
  }): Promise<StoredProfilePost>;
  updateProfilePost(input: {
    userId: string;
    postId: string;
    body?: string;
    visibility?: PostVisibility;
  }): Promise<{ status: 'ok'; post: StoredProfilePost } | { status: 'not_found' | 'forbidden' }>;
  deleteProfilePost(
    userId: string,
    postId: string
  ): Promise<'ok' | 'not_found' | 'forbidden'>;
  createProfileComment(input: {
    postId: string;
    authorUserId: string;
    body: string;
    parentCommentId?: string | null;
    replyToCommentId?: string | null;
  }): Promise<
    | { status: 'ok'; comment: StoredProfileComment }
    | { status: 'parent_not_found' | 'parent_deleted' }
  >;
  deleteProfileComment(
    userId: string,
    commentId: string
  ): Promise<
    | { status: 'ok'; postId: string; deleted_at: string }
    | { status: 'not_found' | 'forbidden' }
  >;
}

const MEDIA_BUCKET = 'board-media';

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export function createSupabaseProfileStore(
  adminClient: SupabaseClient = getSupabaseAdminClient()
): ProfileServerStore {
  return {
    async listProfileUsers(query, limit) {
      let builder = adminClient
        .from('board_users')
        .select('id, username, avatar_path')
        .order('username', { ascending: true })
        .limit(limit);

      const trimmed = query.trim();
      if (trimmed) {
        builder = builder.ilike('username', `%${trimmed}%`);
      }

      const { data, error } = await builder;
      assertNoError(error, 'Failed to list profiles');
      return (data ?? []) as StoredProfileUser[];
    },

    async findProfileUserByLowerUsername(lowerUsername) {
      const { data, error } = await adminClient
        .from('board_users')
        .select('id, username, avatar_path')
        .eq('username_lower', lowerUsername)
        .maybeSingle();
      assertNoError(error, 'Failed to load user profile');
      return (data as StoredProfileUser | null) ?? null;
    },

    async findProfileUsersByIds(ids) {
      const unique = Array.from(new Set(ids.filter(Boolean)));
      const map = new Map<string, StoredProfileUser>();
      if (unique.length === 0) return map;

      const { data, error } = await adminClient
        .from('board_users')
        .select('id, username, avatar_path')
        .in('id', unique);
      assertNoError(error, 'Failed to load user summaries');
      for (const row of (data ?? []) as StoredProfileUser[]) {
        map.set(row.id, row);
      }
      return map;
    },

    async getFollowStats(viewerId, targetUserId) {
      const [{ data: followersRows, error: err1 }, { data: followingRows, error: err2 }] =
        await Promise.all([
          adminClient
            .from('user_follows')
            .select('follower_id')
            .eq('following_id', targetUserId),
          adminClient
            .from('user_follows')
            .select('following_id')
            .eq('follower_id', targetUserId),
        ]);
      assertNoError(err1, 'Failed to load followers');
      assertNoError(err2, 'Failed to load following list');

      const followerSet = new Set(
        ((followersRows ?? []) as Array<{ follower_id: string }>).map((r) => r.follower_id)
      );
      const followingSet = new Set(
        ((followingRows ?? []) as Array<{ following_id: string }>).map((r) => r.following_id)
      );

      const friendIds: string[] = [];
      for (const id of followerSet) {
        if (followingSet.has(id)) {
          friendIds.push(id);
        }
      }

      const friendsMap = await this.findProfileUsersByIds(friendIds);
      const friends = friendIds
        .map((id) => friendsMap.get(id))
        .filter((u): u is StoredProfileUser => Boolean(u))
        .sort((a, b) => a.username.localeCompare(b.username));

      const isFollowing = Boolean(viewerId && followerSet.has(viewerId));
      const followsViewer = Boolean(viewerId && followingSet.has(viewerId));

      return {
        followerCount: followerSet.size,
        followingCount: followingSet.size,
        friendCount: friendIds.length,
        isFollowing,
        followsViewer,
        isFriend: isFollowing && followsViewer,
        friends,
      };
    },

    async getBatchFollowStats(viewerId, targetUserIds) {
      const unique = Array.from(new Set(targetUserIds.filter(Boolean)));
      const result = new Map<
        string,
        {
          followerCount: number;
          friendCount: number;
          isFollowing: boolean;
          followsViewer: boolean;
          isFriend: boolean;
        }
      >();
      if (unique.length === 0) return result;

      const [{ data: inboundRows, error: err1 }, { data: outboundRows, error: err2 }] =
        await Promise.all([
          adminClient
            .from('user_follows')
            .select('follower_id, following_id')
            .in('following_id', unique),
          adminClient
            .from('user_follows')
            .select('follower_id, following_id')
            .in('follower_id', unique),
        ]);
      assertNoError(err1, 'Failed to load inbound follows');
      assertNoError(err2, 'Failed to load outbound follows');

      const followersByUser = new Map<string, Set<string>>();
      const followingByUser = new Map<string, Set<string>>();

      for (const row of (inboundRows ?? []) as Array<{
        follower_id: string;
        following_id: string;
      }>) {
        const set = followersByUser.get(row.following_id) ?? new Set<string>();
        set.add(row.follower_id);
        followersByUser.set(row.following_id, set);
      }

      for (const row of (outboundRows ?? []) as Array<{
        follower_id: string;
        following_id: string;
      }>) {
        const set = followingByUser.get(row.follower_id) ?? new Set<string>();
        set.add(row.following_id);
        followingByUser.set(row.follower_id, set);
      }

      for (const id of unique) {
        const followers = followersByUser.get(id) ?? new Set<string>();
        const following = followingByUser.get(id) ?? new Set<string>();
        let friendCount = 0;
        for (const f of followers) {
          if (following.has(f)) friendCount += 1;
        }
        const isFollowing = Boolean(viewerId && followers.has(viewerId));
        const followsViewer = Boolean(viewerId && following.has(viewerId));
        result.set(id, {
          followerCount: followers.size,
          friendCount,
          isFollowing,
          followsViewer,
          isFriend: isFollowing && followsViewer,
        });
      }

      return result;
    },

    async followUser(followerId, followingId) {
      const { error } = await adminClient
        .from('user_follows')
        .upsert(
          { follower_id: followerId, following_id: followingId },
          { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
        );
      assertNoError(error, 'Failed to follow user');
    },

    async unfollowUser(followerId, followingId) {
      const { error } = await adminClient
        .from('user_follows')
        .delete()
        .eq('follower_id', followerId)
        .eq('following_id', followingId);
      assertNoError(error, 'Failed to unfollow user');
    },

    async updateAvatarPath(userId, avatarPath) {
      const { data, error } = await adminClient
        .from('board_users')
        .update({ avatar_path: avatarPath })
        .eq('id', userId)
        .select('id, username, avatar_path')
        .maybeSingle();
      assertNoError(error, 'Failed to update profile picture');
      return (data as StoredProfileUser | null) ?? null;
    },

    async createSignedUploadUrl(path) {
      const { data, error } = await adminClient.storage
        .from(MEDIA_BUCKET)
        .createSignedUploadUrl(path);
      assertNoError(error, 'Failed to prepare upload URL');
      if (!data) {
        throw new Error('Failed to prepare upload URL: empty response.');
      }
      return {
        signedUrl: data.signedUrl,
        token: data.token,
        path: data.path,
      };
    },

    async createSignedReadUrls(paths) {
      const unique = Array.from(new Set(paths.filter(Boolean)));
      const map = new Map<string, string>();
      if (unique.length === 0) return map;

      const { data, error } = await adminClient.storage
        .from(MEDIA_BUCKET)
        .createSignedUrls(unique, 3600);
      assertNoError(error, 'Failed to sign media URLs');
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) {
          map.set(item.path, item.signedUrl);
        }
      }
      return map;
    },

    async listProfilePostsByAuthor(authorUserId) {
      const { data, error } = await adminClient
        .from('profile_posts')
        .select(
          'id, author_user_id, visibility, body, media_path, media_type, shared_post_id, created_at, edited_at'
        )
        .eq('author_user_id', authorUserId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);
      assertNoError(error, 'Failed to load profile posts');
      return (data ?? []) as StoredProfilePost[];
    },

    async findProfilePostById(postId) {
      const { data, error } = await adminClient
        .from('profile_posts')
        .select(
          'id, author_user_id, visibility, body, media_path, media_type, shared_post_id, created_at, edited_at'
        )
        .eq('id', postId)
        .maybeSingle();
      assertNoError(error, 'Failed to load profile post');
      return (data as StoredProfilePost | null) ?? null;
    },

    async findProfilePostsByIds(postIds) {
      const unique = Array.from(new Set(postIds.filter(Boolean)));
      const map = new Map<string, StoredProfilePost>();
      if (unique.length === 0) return map;

      const { data, error } = await adminClient
        .from('profile_posts')
        .select(
          'id, author_user_id, visibility, body, media_path, media_type, shared_post_id, created_at, edited_at'
        )
        .in('id', unique);
      assertNoError(error, 'Failed to load referenced shared posts');
      for (const row of (data ?? []) as StoredProfilePost[]) {
        map.set(row.id, row);
      }
      return map;
    },

    async listCommentsForPosts(postIds) {
      const unique = Array.from(new Set(postIds.filter(Boolean)));
      if (unique.length === 0) return [];

      const { data, error } = await adminClient
        .from('profile_post_comments')
        .select(
          'id, post_id, author_user_id, parent_comment_id, reply_to_comment_id, body, created_at, edited_at, deleted_at'
        )
        .in('post_id', unique)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      assertNoError(error, 'Failed to load profile post comments');
      return (data ?? []) as StoredProfileComment[];
    },

    async createProfilePost(input) {
      const { data, error } = await adminClient
        .from('profile_posts')
        .insert({
          author_user_id: input.authorUserId,
          visibility: input.visibility,
          body: input.body,
          media_path: input.mediaPath,
          media_type: input.mediaType,
          shared_post_id: input.sharedPostId,
        })
        .select(
          'id, author_user_id, visibility, body, media_path, media_type, shared_post_id, created_at, edited_at'
        )
        .single();
      assertNoError(error, 'Failed to create profile post');
      return data as StoredProfilePost;
    },

    async updateProfilePost(input) {
      const existing = await this.findProfilePostById(input.postId);
      if (!existing) return { status: 'not_found' };
      if (existing.author_user_id !== input.userId) return { status: 'forbidden' };

      const patch: Record<string, unknown> = {
        edited_at: new Date().toISOString(),
      };
      if (input.body !== undefined) patch.body = input.body;
      if (input.visibility !== undefined) patch.visibility = input.visibility;

      const { data, error } = await adminClient
        .from('profile_posts')
        .update(patch)
        .eq('id', input.postId)
        .eq('author_user_id', input.userId)
        .select(
          'id, author_user_id, visibility, body, media_path, media_type, shared_post_id, created_at, edited_at'
        )
        .single();
      assertNoError(error, 'Failed to update profile post');
      return { status: 'ok', post: data as StoredProfilePost };
    },

    async deleteProfilePost(userId, postId) {
      const existing = await this.findProfilePostById(postId);
      if (!existing) return 'not_found';
      if (existing.author_user_id !== userId) return 'forbidden';

      const { error } = await adminClient
        .from('profile_posts')
        .delete()
        .eq('id', postId)
        .eq('author_user_id', userId);
      assertNoError(error, 'Failed to delete profile post');
      return 'ok';
    },

    async createProfileComment(input) {
      let effectiveParentId: string | null = null;
      let effectiveReplyToId: string | null = null;

      if (input.parentCommentId) {
        const { data: target, error } = await adminClient
          .from('profile_post_comments')
          .select('id, post_id, parent_comment_id, deleted_at')
          .eq('id', input.parentCommentId)
          .eq('post_id', input.postId)
          .maybeSingle();
        assertNoError(error, 'Failed to verify parent comment');
        if (!target) {
          return { status: 'parent_not_found' };
        }
        if (target.deleted_at) {
          return { status: 'parent_deleted' };
        }
        effectiveParentId = (target.parent_comment_id as string | null) ?? (target.id as string);
        effectiveReplyToId = input.replyToCommentId ?? (target.id as string);

        if (effectiveReplyToId !== target.id) {
          const { data: replyTarget, error: rtErr } = await adminClient
            .from('profile_post_comments')
            .select('id, deleted_at')
            .eq('id', effectiveReplyToId)
            .eq('post_id', input.postId)
            .maybeSingle();
          assertNoError(rtErr, 'Failed to verify reply target');
          if (!replyTarget || replyTarget.deleted_at) {
            return { status: 'parent_not_found' };
          }
        }
      }

      const { data, error } = await adminClient
        .from('profile_post_comments')
        .insert({
          post_id: input.postId,
          author_user_id: input.authorUserId,
          parent_comment_id: effectiveParentId,
          reply_to_comment_id: effectiveReplyToId,
          body: input.body,
        })
        .select(
          'id, post_id, author_user_id, parent_comment_id, reply_to_comment_id, body, created_at, edited_at, deleted_at'
        )
        .single();
      assertNoError(error, 'Failed to post comment');
      return { status: 'ok', comment: data as StoredProfileComment };
    },

    async deleteProfileComment(userId, commentId) {
      const { data: existing, error: fetchErr } = await adminClient
        .from('profile_post_comments')
        .select('id, post_id, author_user_id, deleted_at')
        .eq('id', commentId)
        .maybeSingle();
      assertNoError(fetchErr, 'Failed to load comment');

      if (!existing) return { status: 'not_found' };
      if (existing.author_user_id !== userId) return { status: 'forbidden' };

      const deletedAt = (existing.deleted_at as string | null) ?? new Date().toISOString();
      if (!existing.deleted_at) {
        const { error: updErr } = await adminClient
          .from('profile_post_comments')
          .update({ body: '[deleted]', deleted_at: deletedAt })
          .eq('id', commentId)
          .eq('author_user_id', userId);
        assertNoError(updErr, 'Failed to delete comment');
      }

      return { status: 'ok', postId: existing.post_id as string, deleted_at: deletedAt };
    },
  };
}
