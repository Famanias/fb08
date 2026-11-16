import crypto from 'node:crypto';
import {
  MAX_PROFILE_POST_BODY_LENGTH,
  canShareProfilePost,
  canViewProfilePost,
  isValidVisibility,
  validateMediaUpload,
  validateProfilePostInput,
} from '@/features/profile/profile-rules';
import {
  ProfileDirectoryEntry,
  ProfilePost,
  ProfilePostComment,
  ProfileSummary,
  SharedPostPreview,
} from '@/features/profile/profile.types';
import { BoardServerStore, createSupabaseBoardStore } from './board-store';
import {
  ProfileServerStore,
  StoredProfilePost,
  StoredProfileUser,
  createSupabaseProfileStore,
} from './profile-store';
import {
  getAuthenticatedUser,
  isValidUuid,
  jsonResponse,
  parseJsonBody,
} from './route-helpers';

export interface ProfileHandlerDeps {
  boardStore?: BoardServerStore;
  profileStore?: ProfileServerStore;
  secret?: string;
}

function getDeps(deps: ProfileHandlerDeps = {}) {
  return {
    boardStore: deps.boardStore ?? createSupabaseBoardStore(),
    profileStore: deps.profileStore ?? createSupabaseProfileStore(),
    secret: deps.secret,
  };
}

function resolveSignedUrl(
  path: string | null | undefined,
  urlMap: Map<string, string>
): string | null {
  if (!path) return null;
  return urlMap.get(path) ?? null;
}

async function hydrateProfilePosts(
  rawPosts: StoredProfilePost[],
  owner: StoredProfileUser,
  viewerId: string | null,
  profileStore: ProfileServerStore
): Promise<ProfilePost[]> {
  if (rawPosts.length === 0) return [];

  const postIds = rawPosts.map((p) => p.id);
  const sharedIds = rawPosts
    .map((p) => p.shared_post_id)
    .filter((id): id is string => Boolean(id));

  const [sharedMap, rawComments] = await Promise.all([
    profileStore.findProfilePostsByIds(sharedIds),
    profileStore.listCommentsForPosts(postIds),
  ]);

  const userIds = new Set<string>([owner.id]);
  for (const shared of sharedMap.values()) {
    if (canShareProfilePost(shared.visibility)) {
      userIds.add(shared.author_user_id);
    }
  }
  for (const comment of rawComments) {
    userIds.add(comment.author_user_id);
  }

  const usersById = await profileStore.findProfileUsersByIds(Array.from(userIds));
  const pathsToSign: string[] = [];
  if (owner.avatar_path) pathsToSign.push(owner.avatar_path);

  for (const p of rawPosts) {
    if (p.media_path) pathsToSign.push(p.media_path);
  }
  for (const shared of sharedMap.values()) {
    if (!canShareProfilePost(shared.visibility)) continue;
    if (shared.media_path) pathsToSign.push(shared.media_path);
    const sharedAuthor = usersById.get(shared.author_user_id);
    if (sharedAuthor?.avatar_path) pathsToSign.push(sharedAuthor.avatar_path);
  }
  for (const u of usersById.values()) {
    if (u.avatar_path) pathsToSign.push(u.avatar_path);
  }

  const signedUrls = await profileStore.createSignedReadUrls(pathsToSign);

  const commentsByPostId = new Map<string, ProfilePostComment[]>();
  for (const c of rawComments) {
    const author = usersById.get(c.author_user_id);
    const hydratedComment: ProfilePostComment = {
      id: c.id,
      post_id: c.post_id,
      author_username: author?.username ?? 'Member',
      author_avatar_url: resolveSignedUrl(author?.avatar_path, signedUrls),
      parent_comment_id: c.parent_comment_id,
      reply_to_comment_id: c.reply_to_comment_id,
      body: c.deleted_at ? '[deleted]' : c.body,
      created_at: c.created_at,
      edited_at: c.edited_at,
      deleted_at: c.deleted_at,
      is_mine: Boolean(viewerId && c.author_user_id === viewerId),
    };
    const arr = commentsByPostId.get(c.post_id) ?? [];
    arr.push(hydratedComment);
    commentsByPostId.set(c.post_id, arr);
  }

  const ownerAvatarUrl = resolveSignedUrl(owner.avatar_path, signedUrls);

  return rawPosts.map((p): ProfilePost => {
    let sharedPreview: SharedPostPreview | null = null;
    if (p.shared_post_id) {
      const orig = sharedMap.get(p.shared_post_id);
      if (!orig || !canShareProfilePost(orig.visibility)) {
        sharedPreview = {
          id: p.shared_post_id,
          available: false,
          reason: 'Original post was deleted or is no longer public.',
        };
      } else {
        const origAuthor = usersById.get(orig.author_user_id);
        sharedPreview = {
          id: orig.id,
          available: true,
          author_username: origAuthor?.username ?? 'Member',
          author_avatar_url: resolveSignedUrl(origAuthor?.avatar_path, signedUrls),
          body: orig.body,
          media_url: resolveSignedUrl(orig.media_path, signedUrls),
          media_type: orig.media_type,
          created_at: orig.created_at,
        };
      }
    }

    return {
      id: p.id,
      author_username: owner.username,
      author_avatar_url: ownerAvatarUrl,
      visibility: p.visibility,
      body: p.body,
      media_url: resolveSignedUrl(p.media_path, signedUrls),
      media_type: p.media_type,
      shared_post: sharedPreview,
      can_share: canShareProfilePost(p.visibility),
      created_at: p.created_at,
      edited_at: p.edited_at,
      is_mine: Boolean(viewerId && p.author_user_id === viewerId),
      comments: commentsByPostId.get(p.id) ?? [],
    };
  });
}

export async function handleListProfiles(
  req: Request,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const viewer = await getAuthenticatedUser(req, boardStore, secret);
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').slice(0, 40);

  const users = await profileStore.listProfileUsers(query, 30);
  const [followMap, signedUrls] = await Promise.all([
    profileStore.getBatchFollowStats(
      viewer?.id ?? null,
      users.map((u) => u.id)
    ),
    profileStore.createSignedReadUrls(
      users.map((u) => u.avatar_path).filter((p): p is string => Boolean(p))
    ),
  ]);

  const profiles: ProfileDirectoryEntry[] = users.map((u) => {
    const stats = followMap.get(u.id) ?? {
      followerCount: 0,
      friendCount: 0,
      isFollowing: false,
      followsViewer: false,
      isFriend: false,
    };
    return {
      id: u.id,
      username: u.username,
      avatarUrl: resolveSignedUrl(u.avatar_path, signedUrls),
      friendCount: stats.friendCount,
      followerCount: stats.followerCount,
      relationship: {
        isFollowing: stats.isFollowing,
        followsViewer: stats.followsViewer,
        isFriend: stats.isFriend,
      },
    };
  });

  return jsonResponse({ profiles }, 200);
}

export async function handleGetProfile(
  req: Request,
  rawUsername: string,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const username = decodeURIComponent(rawUsername).trim();
  if (!username) {
    return jsonResponse({ error: 'Username is required.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const viewer = await getAuthenticatedUser(req, boardStore, secret);
  const target = await profileStore.findProfileUserByLowerUsername(username.toLowerCase());
  if (!target) {
    return jsonResponse({ error: 'Profile not found.' }, 404);
  }

  const [followStats, allAuthorPosts] = await Promise.all([
    profileStore.getFollowStats(viewer?.id ?? null, target.id),
    profileStore.listProfilePostsByAuthor(target.id),
  ]);

  const visibleRawPosts = allAuthorPosts.filter((p) =>
    canViewProfilePost(p.visibility, viewer?.id ?? null, target.id, followStats.isFriend)
  );

  const pathsForHeader = [
    ...(target.avatar_path ? [target.avatar_path] : []),
    ...followStats.friends
      .map((f) => f.avatar_path)
      .filter((p): p is string => Boolean(p)),
  ];
  const [headerUrls, posts] = await Promise.all([
    profileStore.createSignedReadUrls(pathsForHeader),
    hydrateProfilePosts(visibleRawPosts, target, viewer?.id ?? null, profileStore),
  ]);

  const profile: ProfileSummary = {
    id: target.id,
    username: target.username,
    avatarUrl: resolveSignedUrl(target.avatar_path, headerUrls),
    followerCount: followStats.followerCount,
    followingCount: followStats.followingCount,
    friendCount: followStats.friendCount,
    relationship: {
      isFollowing: followStats.isFollowing,
      followsViewer: followStats.followsViewer,
      isFriend: followStats.isFriend,
    },
    isMe: Boolean(viewer && viewer.id === target.id),
    friends: followStats.friends.map((f) => ({
      id: f.id,
      username: f.username,
      avatarUrl: resolveSignedUrl(f.avatar_path, headerUrls),
    })),
  };

  return jsonResponse({ profile, posts }, 200);
}

export async function handleCreateUploadUrl(
  req: Request,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in to upload media.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (
    !body ||
    (body.kind !== 'avatar' && body.kind !== 'post') ||
    typeof body.mimeType !== 'string' ||
    typeof body.sizeBytes !== 'number'
  ) {
    return jsonResponse(
      { error: 'Valid upload kind, mimeType, and sizeBytes are required.' },
      400
    );
  }

  const check = validateMediaUpload(body.kind, body.mimeType, body.sizeBytes);
  if (!check.valid) {
    return jsonResponse({ error: check.error }, 400);
  }

  const objectPath = `${user.id}/${body.kind}/${crypto.randomUUID()}.${check.extension}`;
  const signed = await profileStore.createSignedUploadUrl(objectPath);

  return jsonResponse(
    {
      path: signed.path,
      signedUrl: signed.signedUrl,
      token: signed.token,
      mediaType: check.mediaType,
    },
    200
  );
}

export async function handleUpdateAvatar(
  req: Request,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body || (body.avatarPath !== null && typeof body.avatarPath !== 'string')) {
    return jsonResponse({ error: 'avatarPath must be a string or null.' }, 400);
  }

  const nextPath = body.avatarPath ? body.avatarPath.trim() : null;
  if (nextPath && !nextPath.startsWith(`${user.id}/avatar/`)) {
    return jsonResponse({ error: 'Invalid avatar storage path.' }, 403);
  }

  const updated = await profileStore.updateAvatarPath(user.id, nextPath);
  if (!updated) {
    return jsonResponse({ error: 'User not found.' }, 404);
  }

  const urls = nextPath
    ? await profileStore.createSignedReadUrls([nextPath])
    : new Map<string, string>();
  return jsonResponse(
    {
      avatarUrl: resolveSignedUrl(updated.avatar_path, urls),
    },
    200
  );
}

export async function handleFollowToggle(
  req: Request,
  rawUsername: string,
  follow: boolean,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const username = decodeURIComponent(rawUsername).trim();
  if (!username) {
    return jsonResponse({ error: 'Username is required.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const viewer = await getAuthenticatedUser(req, boardStore, secret);
  if (!viewer) {
    return jsonResponse({ error: 'Sign in to follow members.' }, 401);
  }

  const target = await profileStore.findProfileUserByLowerUsername(username.toLowerCase());
  if (!target) {
    return jsonResponse({ error: 'Profile not found.' }, 404);
  }
  if (target.id === viewer.id) {
    return jsonResponse({ error: 'You cannot follow yourself.' }, 400);
  }

  if (follow) {
    await profileStore.followUser(viewer.id, target.id);
  } else {
    await profileStore.unfollowUser(viewer.id, target.id);
  }

  const stats = await profileStore.getFollowStats(viewer.id, target.id);
  const friendIds = stats.friends
    .map((f) => f.avatar_path)
    .filter((p): p is string => Boolean(p));
  const urls = await profileStore.createSignedReadUrls(friendIds);

  return jsonResponse(
    {
      followerCount: stats.followerCount,
      followingCount: stats.followingCount,
      friendCount: stats.friendCount,
      relationship: {
        isFollowing: stats.isFollowing,
        followsViewer: stats.followsViewer,
        isFriend: stats.isFriend,
      },
      friends: stats.friends.map((f) => ({
        id: f.id,
        username: f.username,
        avatarUrl: resolveSignedUrl(f.avatar_path, urls),
      })),
    },
    200
  );
}

export async function handleCreateProfilePost(
  req: Request,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in to post on your profile.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body.body !== 'string') {
    return jsonResponse({ error: 'Post body must be a string.' }, 400);
  }

  if (body.sharedPostId !== undefined && body.sharedPostId !== null) {
    if (typeof body.sharedPostId !== 'string' || !isValidUuid(body.sharedPostId)) {
      return jsonResponse({ error: 'Invalid shared post ID.' }, 400);
    }
  }

  const validated = validateProfilePostInput({
    body: body.body,
    visibility: body.visibility ?? 'public',
    mediaPath: typeof body.mediaPath === 'string' ? body.mediaPath : null,
    mediaType: body.mediaType ?? null,
    sharedPostId: typeof body.sharedPostId === 'string' ? body.sharedPostId : null,
  });

  if (!validated.valid) {
    return jsonResponse({ error: validated.error }, 400);
  }

  if (validated.mediaPath && !validated.mediaPath.startsWith(`${user.id}/post/`)) {
    return jsonResponse({ error: 'Invalid media upload path.' }, 403);
  }

  if (validated.sharedPostId) {
    const target = await profileStore.findProfilePostById(validated.sharedPostId);
    if (!target) {
      return jsonResponse({ error: 'Post to share was not found.' }, 404);
    }
    if (!canShareProfilePost(target.visibility)) {
      return jsonResponse(
        { error: 'Only public posts can be shared.' },
        403
      );
    }
  }

  const created = await profileStore.createProfilePost({
    authorUserId: user.id,
    visibility: validated.visibility,
    body: validated.body,
    mediaPath: validated.mediaPath,
    mediaType: validated.mediaType,
    sharedPostId: validated.sharedPostId,
  });

  const owner = await profileStore.findProfileUserByLowerUsername(user.username.toLowerCase());
  const hydrated = await hydrateProfilePosts(
    [created],
    owner ?? { id: user.id, username: user.username, avatar_path: null },
    user.id,
    profileStore
  );

  return jsonResponse({ post: hydrated[0] }, 201);
}

export async function handleUpdateProfilePost(
  req: Request,
  postId: string,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  if (!isValidUuid(postId)) {
    return jsonResponse({ error: 'Invalid post ID.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  let nextVisibility: 'public' | 'friends' | 'only_me' | undefined;
  if (body.visibility !== undefined) {
    if (!isValidVisibility(body.visibility)) {
      return jsonResponse({ error: 'Invalid post visibility.' }, 400);
    }
    nextVisibility = body.visibility;
  }

  let nextBody: string | undefined;
  if (body.body !== undefined) {
    if (typeof body.body !== 'string') {
      return jsonResponse({ error: 'Post text must be a string.' }, 400);
    }
    const trimmed = body.body.trim();
    if (trimmed.length > MAX_PROFILE_POST_BODY_LENGTH) {
      return jsonResponse(
        { error: `Post text must be ${MAX_PROFILE_POST_BODY_LENGTH} characters or less.` },
        400
      );
    }
    const existing = await profileStore.findProfilePostById(postId);
    if (!existing) {
      return jsonResponse({ error: 'Profile post not found.' }, 404);
    }
    if (existing.author_user_id !== user.id) {
      return jsonResponse({ error: 'You can only edit your own profile posts.' }, 403);
    }
    if (!trimmed && !existing.media_path && !existing.shared_post_id) {
      return jsonResponse({ error: 'Post cannot be empty.' }, 400);
    }
    nextBody = trimmed;
  }

  if (nextBody === undefined && nextVisibility === undefined) {
    return jsonResponse({ error: 'Nothing to update.' }, 400);
  }

  const res = await profileStore.updateProfilePost({
    userId: user.id,
    postId,
    body: nextBody,
    visibility: nextVisibility,
  });

  if (res.status !== 'ok') {
    if (res.status === 'not_found') {
      return jsonResponse({ error: 'Profile post not found.' }, 404);
    }
    return jsonResponse({ error: 'You can only edit your own profile posts.' }, 403);
  }

  const owner = await profileStore.findProfileUserByLowerUsername(user.username.toLowerCase());
  const hydrated = await hydrateProfilePosts(
    [res.post],
    owner ?? { id: user.id, username: user.username, avatar_path: null },
    user.id,
    profileStore
  );
  return jsonResponse({ post: hydrated[0] }, 200);
}

export async function handleDeleteProfilePost(
  req: Request,
  postId: string,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  if (!isValidUuid(postId)) {
    return jsonResponse({ error: 'Invalid post ID.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const status = await profileStore.deleteProfilePost(user.id, postId);
  if (status === 'not_found') {
    return jsonResponse({ error: 'Profile post not found.' }, 404);
  }
  if (status === 'forbidden') {
    return jsonResponse({ error: 'You can only delete your own profile posts.' }, 403);
  }

  return jsonResponse({ ok: true }, 200);
}

export async function handleCreateProfileComment(
  req: Request,
  postId: string,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  if (!isValidUuid(postId)) {
    return jsonResponse({ error: 'Invalid post ID.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in to comment on profile posts.' }, 401);
  }

  const targetPost = await profileStore.findProfilePostById(postId);
  if (!targetPost) {
    return jsonResponse({ error: 'Profile post not found.' }, 404);
  }

  const followStats = await profileStore.getFollowStats(user.id, targetPost.author_user_id);
  if (
    !canViewProfilePost(
      targetPost.visibility,
      user.id,
      targetPost.author_user_id,
      followStats.isFriend
    )
  ) {
    return jsonResponse(
      { error: 'You do not have permission to comment on this post.' },
      403
    );
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body.body !== 'string') {
    return jsonResponse({ error: 'Comment text is required.' }, 400);
  }

  const trimmed = body.body.trim();
  if (!trimmed || trimmed.length > MAX_PROFILE_POST_BODY_LENGTH) {
    return jsonResponse(
      { error: `Comment must be between 1 and ${MAX_PROFILE_POST_BODY_LENGTH} characters.` },
      400
    );
  }

  let parentCommentId: string | null = null;
  if (body.parentCommentId !== undefined && body.parentCommentId !== null) {
    if (typeof body.parentCommentId !== 'string' || !isValidUuid(body.parentCommentId)) {
      return jsonResponse({ error: 'Invalid parent comment ID.' }, 400);
    }
    parentCommentId = body.parentCommentId;
  }

  let replyToCommentId: string | null = null;
  if (body.replyToCommentId !== undefined && body.replyToCommentId !== null) {
    if (typeof body.replyToCommentId !== 'string' || !isValidUuid(body.replyToCommentId)) {
      return jsonResponse({ error: 'Invalid reply target ID.' }, 400);
    }
    if (!parentCommentId) {
      return jsonResponse({ error: 'parentCommentId is required with replyToCommentId.' }, 400);
    }
    replyToCommentId = body.replyToCommentId;
  }

  const res = await profileStore.createProfileComment({
    postId,
    authorUserId: user.id,
    body: trimmed,
    parentCommentId,
    replyToCommentId,
  });

  if (res.status !== 'ok') {
    if (res.status === 'parent_not_found') {
      return jsonResponse({ error: 'Target comment was not found.' }, 404);
    }
    return jsonResponse({ error: 'Cannot reply to a deleted comment.' }, 409);
  }

  const authorMap = await profileStore.findProfileUsersByIds([user.id]);
  const author = authorMap.get(user.id);
  const urls = author?.avatar_path
    ? await profileStore.createSignedReadUrls([author.avatar_path])
    : new Map<string, string>();

  const comment: ProfilePostComment = {
    id: res.comment.id,
    post_id: res.comment.post_id,
    author_username: author?.username ?? user.username,
    author_avatar_url: resolveSignedUrl(author?.avatar_path, urls),
    parent_comment_id: res.comment.parent_comment_id,
    reply_to_comment_id: res.comment.reply_to_comment_id,
    body: res.comment.body,
    created_at: res.comment.created_at,
    edited_at: res.comment.edited_at,
    deleted_at: res.comment.deleted_at,
    is_mine: true,
  };

  return jsonResponse({ comment }, 201);
}

export async function handleDeleteProfileComment(
  req: Request,
  commentId: string,
  depsInput?: ProfileHandlerDeps
): Promise<Response> {
  if (!isValidUuid(commentId)) {
    return jsonResponse({ error: 'Invalid comment ID.' }, 400);
  }

  const { boardStore, profileStore, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, boardStore, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const res = await profileStore.deleteProfileComment(user.id, commentId);
  if (res.status !== 'ok') {
    if (res.status === 'not_found') {
      return jsonResponse({ error: 'Comment not found.' }, 404);
    }
    return jsonResponse({ error: 'You can only delete your own comments.' }, 403);
  }

  return jsonResponse({ ok: true, postId: res.postId, deleted_at: res.deleted_at }, 200);
}
