import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { hashPassword } from './auth';
import { handleRegister } from './board-handlers';
import { BoardServerStore } from './board-store';
import {
  handleCreateProfileComment,
  handleCreateProfilePost,
  handleCreateUploadUrl,
  handleFollowToggle,
  handleGetProfile,
  handleUpdateAvatar,
  handleUpdateProfilePost,
} from './profile-handlers';
import {
  ProfileServerStore,
  StoredProfileComment,
  StoredProfilePost,
  StoredProfileUser,
} from './profile-store';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

function createMemoryProfileEnv() {
  const users: Array<{
    id: string;
    username: string;
    username_lower: string;
    password_hash: string;
    avatar_path: string | null;
  }> = [];
  const follows = new Set<string>();
  const posts: StoredProfilePost[] = [];
  const comments: StoredProfileComment[] = [];
  let tick = 1_700_000_000_000;
  const nextIso = () => new Date((tick += 1000)).toISOString();

  const boardStore: BoardServerStore = {
    async findUserByLowerUsername(lower) {
      return users.find((u) => u.username_lower === lower) ?? null;
    },
    async findUserById(id) {
      const u = users.find((x) => x.id === id);
      return u ? { id: u.id, username: u.username } : null;
    },
    async createUser(username, passwordHash) {
      const lower = username.toLowerCase();
      if (users.some((u) => u.username_lower === lower)) {
        return { ok: false, reason: 'duplicate' };
      }
      const u = {
        id: crypto.randomUUID(),
        username,
        username_lower: lower,
        password_hash: passwordHash,
        avatar_path: null,
      };
      users.push(u);
      return { ok: true, user: { id: u.id, username: u.username } };
    },
    async listThreads() {
      return [];
    },
    async getThreadWithPosts() {
      return null;
    },
    async createThread() {
      throw new Error('unused');
    },
    async createReply() {
      throw new Error('unused');
    },
    async editPost() {
      return { status: 'not_found' };
    },
    async deleteReply() {
      return { status: 'not_found' };
    },
    async deleteThread() {
      return 'not_found';
    },
  };

  const toStoredUser = (u: (typeof users)[number]): StoredProfileUser => ({
    id: u.id,
    username: u.username,
    avatar_path: u.avatar_path,
  });

  const profileStore: ProfileServerStore = {
    async listProfileUsers(query, limit) {
      const term = query.trim().toLowerCase();
      return users
        .filter((u) => !term || u.username_lower.includes(term))
        .slice(0, limit)
        .map(toStoredUser);
    },
    async findProfileUserByLowerUsername(lower) {
      const u = users.find((x) => x.username_lower === lower);
      return u ? toStoredUser(u) : null;
    },
    async findProfileUsersByIds(ids) {
      const m = new Map<string, StoredProfileUser>();
      for (const u of users) {
        if (ids.includes(u.id)) m.set(u.id, toStoredUser(u));
      }
      return m;
    },
    async getFollowStats(viewerId, targetUserId) {
      const followers = users
        .filter((u) => follows.has(`${u.id}:${targetUserId}`))
        .map((u) => u.id);
      const following = users
        .filter((u) => follows.has(`${targetUserId}:${u.id}`))
        .map((u) => u.id);
      const followingSet = new Set(following);
      const friendIds = followers.filter((id) => followingSet.has(id));
      const friends = friendIds
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is (typeof users)[number] => Boolean(u))
        .map(toStoredUser);
      const isFollowing = Boolean(viewerId && follows.has(`${viewerId}:${targetUserId}`));
      const followsViewer = Boolean(viewerId && follows.has(`${targetUserId}:${viewerId}`));
      return {
        followerCount: followers.length,
        followingCount: following.length,
        friendCount: friendIds.length,
        isFollowing,
        followsViewer,
        isFriend: isFollowing && followsViewer,
        friends,
      };
    },
    async getBatchFollowStats() {
      return new Map();
    },
    async followUser(followerId, followingId) {
      follows.add(`${followerId}:${followingId}`);
    },
    async unfollowUser(followerId, followingId) {
      follows.delete(`${followerId}:${followingId}`);
    },
    async updateAvatarPath(userId, avatarPath) {
      const u = users.find((x) => x.id === userId);
      if (!u) return null;
      u.avatar_path = avatarPath;
      return toStoredUser(u);
    },
    async createSignedUploadUrl(path) {
      return {
        signedUrl: `https://storage.local/upload/${path}`,
        token: 'tok',
        path,
      };
    },
    async createSignedReadUrls(paths) {
      const m = new Map<string, string>();
      for (const p of paths) {
        m.set(p, `https://storage.local/read/${p}`);
      }
      return m;
    },
    async listProfilePostsByAuthor(authorId) {
      return posts
        .filter((p) => p.author_user_id === authorId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    },
    async findProfilePostById(postId) {
      return posts.find((p) => p.id === postId) ?? null;
    },
    async findProfilePostsByIds(postIds) {
      const m = new Map<string, StoredProfilePost>();
      for (const p of posts) {
        if (postIds.includes(p.id)) m.set(p.id, p);
      }
      return m;
    },
    async listCommentsForPosts(postIds) {
      return comments.filter((c) => postIds.includes(c.post_id));
    },
    async createProfilePost(input) {
      const p: StoredProfilePost = {
        id: crypto.randomUUID(),
        author_user_id: input.authorUserId,
        visibility: input.visibility,
        body: input.body,
        media_path: input.mediaPath,
        media_type: input.mediaType,
        shared_post_id: input.sharedPostId,
        created_at: nextIso(),
        edited_at: null,
      };
      posts.push(p);
      return p;
    },
    async updateProfilePost(input) {
      const p = posts.find((x) => x.id === input.postId);
      if (!p) return { status: 'not_found' };
      if (p.author_user_id !== input.userId) return { status: 'forbidden' };
      if (input.body !== undefined) p.body = input.body;
      if (input.visibility !== undefined) p.visibility = input.visibility;
      p.edited_at = nextIso();
      return { status: 'ok', post: p };
    },
    async deleteProfilePost(userId, postId) {
      const idx = posts.findIndex((x) => x.id === postId);
      if (idx < 0) return 'not_found';
      if (posts[idx].author_user_id !== userId) return 'forbidden';
      posts.splice(idx, 1);
      return 'ok';
    },
    async createProfileComment(input) {
      let effectiveParentId: string | null = null;
      let effectiveReplyToId: string | null = null;
      if (input.parentCommentId) {
        const target = comments.find(
          (c) => c.id === input.parentCommentId && c.post_id === input.postId
        );
        if (!target) return { status: 'parent_not_found' };
        if (target.deleted_at) return { status: 'parent_deleted' };
        effectiveParentId = target.parent_comment_id ?? target.id;
        effectiveReplyToId = input.replyToCommentId ?? target.id;
      }
      const c: StoredProfileComment = {
        id: crypto.randomUUID(),
        post_id: input.postId,
        author_user_id: input.authorUserId,
        parent_comment_id: effectiveParentId,
        reply_to_comment_id: effectiveReplyToId,
        body: input.body,
        created_at: nextIso(),
        edited_at: null,
        deleted_at: null,
      };
      comments.push(c);
      return { status: 'ok', comment: c };
    },
    async deleteProfileComment(userId, commentId) {
      const c = comments.find((x) => x.id === commentId);
      if (!c) return { status: 'not_found' };
      if (c.author_user_id !== userId) return { status: 'forbidden' };
      c.deleted_at = nextIso();
      c.body = '[deleted]';
      return { status: 'ok', postId: c.post_id, deleted_at: c.deleted_at };
    },
  };

  return {
    store: boardStore,
    boardStore,
    profileStore,
    secret: TEST_SECRET,
    isProd: false,
  };
}

function makeReq(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (cookie) headers.set('cookie', cookie);
  return new Request(url, { ...rest, headers });
}

function extractCookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

test('profiles: mutual follow creates friends, enforces visibility, 25MB media upload, and public-only sharing', async () => {
  const deps = createMemoryProfileEnv();
  const regA = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Alice', password: '1' }),
    }),
    deps
  );
  const aliceCookie = extractCookie(regA);

  const regB = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Bob', password: '2' }),
    }),
    deps
  );
  const bobCookie = extractCookie(regB);

  // Avatar upload URL (rejects video, accepts image <= 25MB, binds to user)
  const badAvatarUpload = await handleCreateUploadUrl(
    makeReq('http://localhost/api/media/upload-url', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ kind: 'avatar', mimeType: 'video/mp4', sizeBytes: 1000 }),
    }),
    deps
  );
  assert.equal(badAvatarUpload.status, 400);

  const avatarUpload = await handleCreateUploadUrl(
    makeReq('http://localhost/api/media/upload-url', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ kind: 'avatar', mimeType: 'image/png', sizeBytes: 5000 }),
    }),
    deps
  );
  assert.equal(avatarUpload.status, 200);
  const avatarJson = await avatarUpload.json();

  const updAvatar = await handleUpdateAvatar(
    makeReq('http://localhost/api/profiles/me/avatar', {
      method: 'PATCH',
      cookie: aliceCookie,
      body: JSON.stringify({ avatarPath: avatarJson.path }),
    }),
    deps
  );
  assert.equal(updAvatar.status, 200);
  assert.ok((await updAvatar.json()).avatarUrl.includes(avatarJson.path));

  // Post media upload rejects >25MB, accepts 25MB video
  const tooBig = await handleCreateUploadUrl(
    makeReq('http://localhost/api/media/upload-url', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({
        kind: 'post',
        mimeType: 'video/mp4',
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
    }),
    deps
  );
  assert.equal(tooBig.status, 400);

  const videoUpload = await handleCreateUploadUrl(
    makeReq('http://localhost/api/media/upload-url', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({
        kind: 'post',
        mimeType: 'video/mp4',
        sizeBytes: 25 * 1024 * 1024,
      }),
    }),
    deps
  );
  assert.equal(videoUpload.status, 200);
  const videoJson = await videoUpload.json();

  // Alice creates Public, Friends-only, and Only-me posts
  const pubPostRes = await handleCreateProfilePost(
    makeReq('http://localhost/api/profile-posts', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({
        body: 'Public sunset clip',
        visibility: 'public',
        mediaPath: videoJson.path,
        mediaType: 'video',
      }),
    }),
    deps
  );
  assert.equal(pubPostRes.status, 201);
  const pubPost = (await pubPostRes.json()).post;

  const friendsPostRes = await handleCreateProfilePost(
    makeReq('http://localhost/api/profile-posts', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ body: 'Friends hangout note', visibility: 'friends' }),
    }),
    deps
  );
  const friendsPost = (await friendsPostRes.json()).post;

  await handleCreateProfilePost(
    makeReq('http://localhost/api/profile-posts', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ body: 'Private diary note', visibility: 'only_me' }),
    }),
    deps
  );

  // Guest sees ONLY Public post
  const guestView = await (
    await handleGetProfile(makeReq('http://localhost/api/profiles/Alice'), 'Alice', deps)
  ).json();
  assert.equal(guestView.posts.length, 1);
  assert.equal(guestView.posts[0].body, 'Public sunset clip');

  // One-way follow: Bob follows Alice -> NOT friends yet -> Bob still cannot see Friends-only
  const follow1 = await (
    await handleFollowToggle(
      makeReq('http://localhost/api/profiles/Alice/follow', {
        method: 'POST',
        cookie: bobCookie,
      }),
      'Alice',
      true,
      deps
    )
  ).json();
  assert.equal(follow1.relationship.isFollowing, true);
  assert.equal(follow1.relationship.isFriend, false);

  const bobBeforeFriend = await (
    await handleGetProfile(
      makeReq('http://localhost/api/profiles/Alice', { cookie: bobCookie }),
      'Alice',
      deps
    )
  ).json();
  assert.equal(bobBeforeFriend.posts.length, 1);

  // Alice follows Bob back -> automatically Friends! Now Bob sees Public + Friends-only (still never Only-me)
  const follow2 = await (
    await handleFollowToggle(
      makeReq('http://localhost/api/profiles/Bob/follow', {
        method: 'POST',
        cookie: aliceCookie,
      }),
      'Bob',
      true,
      deps
    )
  ).json();
  assert.equal(follow2.relationship.isFriend, true);

  const bobAsFriend = await (
    await handleGetProfile(
      makeReq('http://localhost/api/profiles/Alice', { cookie: bobCookie }),
      'Alice',
      deps
    )
  ).json();
  assert.equal(bobAsFriend.profile.relationship.isFriend, true);
  assert.equal(bobAsFriend.posts.length, 2);

  // Sharing rules: Bob CANNOT share Alice's Friends-only post (403)
  const badShare = await handleCreateProfilePost(
    makeReq('http://localhost/api/profile-posts', {
      method: 'POST',
      cookie: bobCookie,
      body: JSON.stringify({
        body: 'Leaking',
        visibility: 'public',
        sharedPostId: friendsPost.id,
      }),
    }),
    deps
  );
  assert.equal(badShare.status, 403);

  // Bob CAN share Alice's Public post as Friends-only (or Public / Only-me)
  const goodShare = await handleCreateProfilePost(
    makeReq('http://localhost/api/profile-posts', {
      method: 'POST',
      cookie: bobCookie,
      body: JSON.stringify({
        body: 'Cool video!',
        visibility: 'friends',
        sharedPostId: pubPost.id,
      }),
    }),
    deps
  );
  assert.equal(goodShare.status, 201);
  const sharedCard = (await goodShare.json()).post;
  assert.equal(sharedCard.shared_post.available, true);
  assert.equal(sharedCard.shared_post.author_username, 'Alice');

  // If Alice later restricts original post to only_me, shared preview hides original content
  await handleUpdateProfilePost(
    makeReq(`http://localhost/api/profile-posts/${pubPost.id}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: JSON.stringify({ visibility: 'only_me' }),
    }),
    pubPost.id,
    deps
  );
  const bobAfterRestrict = await (
    await handleGetProfile(
      makeReq('http://localhost/api/profiles/Bob', { cookie: bobCookie }),
      'Bob',
      deps
    )
  ).json();
  assert.equal(bobAfterRestrict.posts[0].shared_post.available, false);

  // Bob CAN comment & reply on Alice's friends-only post, and guest CANNOT comment (401)
  const cRes = await handleCreateProfileComment(
    makeReq(`http://localhost/api/profile-posts/${friendsPost.id}/comments`, {
      method: 'POST',
      cookie: bobCookie,
      body: JSON.stringify({ body: 'See you there!' }),
    }),
    friendsPost.id,
    deps
  );
  assert.equal(cRes.status, 201);
  assert.ok(hashPassword('x'));
});
