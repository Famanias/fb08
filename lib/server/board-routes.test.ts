import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  handleCreateReply,
  handleCreateThread,
  handleDeleteReply,
  handleDeleteThread,
  handleEditPost,
  handleGetMe,
  handleGetThreadDetail,
  handleListThreads,
  handleLogin,
  handleLogout,
  handleRegister,
} from './board-handlers';
import { BoardServerStore } from './board-store';
import { deriveThreadAnonTag } from './anon-tag';
import { hashPassword, signSessionToken } from './auth';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

function createMemoryStore(): BoardServerStore {
  const users: Array<{ id: string; username: string; username_lower: string; password_hash: string }> = [];
  const threads: Array<{
    id: string;
    title: string;
    author_user_id: string;
    reply_count: number;
    created_at: string;
    bumped_at: string;
  }> = [];
  const posts: Array<{
    id: string;
    thread_id: string;
    post_number: number;
    author_user_id: string;
    anon_tag: string;
    message: string;
    created_at: string;
    edited_at: string | null;
    deleted_at: string | null;
  }> = [];
  let edits: Array<{
    id: string;
    post_id: string;
    previous_message: string;
    edited_at: string;
  }> = [];
  let tick = 1_700_000_000_000;
  const nextIso = () => new Date((tick += 1000)).toISOString();

  return {
    async findUserByLowerUsername(lowerUsername) {
      return users.find((u) => u.username_lower === lowerUsername) ?? null;
    },
    async findUserById(id) {
      const user = users.find((u) => u.id === id);
      return user ? { id: user.id, username: user.username } : null;
    },
    async createUser(username, passwordHash) {
      const lower = username.toLowerCase();
      if (users.some((u) => u.username_lower === lower)) {
        return { ok: false, reason: 'duplicate' };
      }
      const user = {
        id: crypto.randomUUID(),
        username,
        username_lower: lower,
        password_hash: passwordHash,
      };
      users.push(user);
      return { ok: true, user: { id: user.id, username: user.username } };
    },
    async listThreads(limit) {
      const sorted = [...threads]
        .sort((a, b) => Date.parse(b.bumped_at) - Date.parse(a.bumped_at))
        .slice(0, limit);
      return sorted.map((t) => {
        const op = posts.find((p) => p.thread_id === t.id && p.post_number === 1);
        return {
          ...t,
          op_anon_tag: op?.anon_tag,
          op_preview: op?.message,
        };
      });
    },
    async getThreadWithPosts(threadId) {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return null;
      const threadPosts = posts
        .filter((p) => p.thread_id === threadId)
        .sort((a, b) => a.post_number - b.post_number);
      const postIds = new Set(threadPosts.map((p) => p.id));
      const threadEdits = edits
        .filter((e) => postIds.has(e.post_id))
        .sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at));
      return { thread, posts: threadPosts, edits: threadEdits };
    },
    async createThread(input) {
      const now = nextIso();
      const thread = {
        id: input.threadId,
        title: input.title,
        author_user_id: input.userId,
        reply_count: 1,
        created_at: now,
        bumped_at: now,
      };
      const post = {
        id: crypto.randomUUID(),
        thread_id: input.threadId,
        post_number: 1,
        author_user_id: input.userId,
        anon_tag: input.anonTag,
        message: input.message,
        created_at: now,
        edited_at: null,
        deleted_at: null,
      };
      threads.push(thread);
      posts.push(post);
      return { thread, post };
    },
    async createReply(input) {
      const thread = threads.find((t) => t.id === input.threadId);
      if (!thread) return null;
      const now = nextIso();
      const nextNum =
        posts
          .filter((p) => p.thread_id === input.threadId)
          .reduce((max, p) => Math.max(max, p.post_number), 0) + 1;
      const post = {
        id: crypto.randomUUID(),
        thread_id: input.threadId,
        post_number: nextNum,
        author_user_id: input.userId,
        anon_tag: input.anonTag,
        message: input.message,
        created_at: now,
        edited_at: null,
        deleted_at: null,
      };
      posts.push(post);
      thread.reply_count = nextNum;
      thread.bumped_at = now;
      return post;
    },
    async editPost(input) {
      const post = posts.find((p) => p.id === input.postId);
      if (!post) return { status: 'not_found' };
      if (post.author_user_id !== input.userId) return { status: 'forbidden' };
      if (post.deleted_at) return { status: 'deleted' };
      const now = nextIso();
      const edit = {
        id: crypto.randomUUID(),
        post_id: post.id,
        previous_message: post.message,
        edited_at: now,
      };
      edits.push(edit);
      post.message = input.message;
      post.edited_at = now;
      return { status: 'ok', post, edit };
    },
    async deleteReply(input) {
      const post = posts.find((p) => p.id === input.postId);
      if (!post) return { status: 'not_found' };
      if (post.author_user_id !== input.userId) return { status: 'forbidden' };
      if (post.post_number === 1) return { status: 'cannot_delete_op' };
      if (post.deleted_at) return { status: 'already_deleted', deleted_at: post.deleted_at };
      const now = nextIso();
      edits = edits.filter((e) => e.post_id !== post.id);
      post.message = '[deleted]';
      post.deleted_at = now;
      return { status: 'ok', deleted_at: now };
    },
    async deleteThread(input) {
      const idx = threads.findIndex((t) => t.id === input.threadId);
      if (idx === -1) return 'not_found';
      if (threads[idx].author_user_id !== input.userId) return 'forbidden';
      threads.splice(idx, 1);
      const removedPostIds = new Set(
        posts.filter((p) => p.thread_id === input.threadId).map((p) => p.id)
      );
      for (let i = posts.length - 1; i >= 0; i--) {
        if (posts[i].thread_id === input.threadId) posts.splice(i, 1);
      }
      edits = edits.filter((e) => !removedPostIds.has(e.post_id));
      return 'ok';
    },
  };
}

function makeReq(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(url, { ...init, headers });
}

function extractCookiePair(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

test('auth handlers register 1-char passwords, reject case-insensitive duplicates, login, and logout', async () => {
  const store = createMemoryStore();
  const deps = { store, secret: TEST_SECRET, isProd: false };

  const reg1 = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Alice', password: 'x' }),
    }),
    deps
  );
  assert.equal(reg1.status, 201);
  const regBody = await reg1.json();
  assert.equal(regBody.user.username, 'Alice');
  const aliceCookie = extractCookiePair(reg1);
  assert.match(aliceCookie, /^fb08_session=/);
  assert.match(reg1.headers.get('set-cookie') ?? '', /HttpOnly/);

  const dup = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: '  alice  ', password: 'y' }),
    }),
    deps
  );
  assert.equal(dup.status, 409);

  const emptyPwd = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Bob', password: '' }),
    }),
    deps
  );
  assert.equal(emptyPwd.status, 400);

  const badLogin = await handleLogin(
    makeReq('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    }),
    deps
  );
  assert.equal(badLogin.status, 401);

  const goodLogin = await handleLogin(
    makeReq('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'aLiCe', password: 'x' }),
    }),
    deps
  );
  assert.equal(goodLogin.status, 200);

  const meRes = await handleGetMe(
    makeReq('http://localhost/api/auth/me', { cookie: aliceCookie }),
    deps
  );
  assert.equal((await meRes.json()).user.username, 'Alice');

  const logoutRes = await handleLogout(deps);
  assert.equal(logoutRes.status, 200);
  assert.match(logoutRes.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('threads, replies, anonymity, edit history, reply deletion, and dedicated thread deletion enforce rules', async () => {
  const store = createMemoryStore();
  const deps = { store, secret: TEST_SECRET, isProd: false };

  const aliceReg = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Alice', password: '1' }),
    }),
    deps
  );
  const aliceCookie = extractCookiePair(aliceReg);
  const bobReg = await handleRegister(
    makeReq('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'Bob', password: '2' }),
    }),
    deps
  );
  const bobCookie = extractCookiePair(bobReg);

  // Unauthenticated post fails 401
  const unauthCreate = await handleCreateThread(
    makeReq('http://localhost/api/threads', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', message: 'Hello' }),
    }),
    deps
  );
  assert.equal(unauthCreate.status, 401);

  // Alice creates thread 1 & thread 2
  const t1Res = await handleCreateThread(
    makeReq('http://localhost/api/threads', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ title: 'Late night ramen?', message: 'Open past midnight?' }),
    }),
    deps
  );
  assert.equal(t1Res.status, 201);
  const t1Json = await t1Res.json();
  const t1Raw = JSON.stringify(t1Json);
  assert.equal(t1Raw.includes('Alice'), false);
  assert.equal(t1Raw.includes('author_user_id'), false);
  assert.match(t1Json.post.anon_tag, /^[0-9a-f]{6}$/);

  const t2Res = await handleCreateThread(
    makeReq('http://localhost/api/threads', {
      method: 'POST',
      cookie: aliceCookie,
      body: JSON.stringify({ title: 'Second thread', message: 'Hi again' }),
    }),
    deps
  );
  const t2Json = await t2Res.json();
  assert.notEqual(
    t1Json.post.anon_tag,
    t2Json.post.anon_tag,
    'Same user must receive distinct anon_tag across threads'
  );

  // Bob replies in thread 1
  const replyRes = await handleCreateReply(
    makeReq(`http://localhost/api/threads/${t1Json.thread.id}/posts`, {
      method: 'POST',
      cookie: bobCookie,
      body: JSON.stringify({ message: 'Try 4th Ave' }),
    }),
    t1Json.thread.id,
    deps
  );
  assert.equal(replyRes.status, 201);
  const replyJson = await replyRes.json();
  assert.equal(replyJson.post.post_number, 2);
  assert.notEqual(replyJson.post.anon_tag, t1Json.post.anon_tag);

  // Alice cannot edit Bob's reply
  const forbiddenEdit = await handleEditPost(
    makeReq(`http://localhost/api/posts/${replyJson.post.id}`, {
      method: 'PATCH',
      cookie: aliceCookie,
      body: JSON.stringify({ message: 'Hijacked' }),
    }),
    replyJson.post.id,
    deps
  );
  assert.equal(forbiddenEdit.status, 403);

  // Bob edits his reply -> edit history stored & visible publicly
  const okEdit = await handleEditPost(
    makeReq(`http://localhost/api/posts/${replyJson.post.id}`, {
      method: 'PATCH',
      cookie: bobCookie,
      body: JSON.stringify({ message: 'Try 4th Ave (open till 3am)' }),
    }),
    replyJson.post.id,
    deps
  );
  assert.equal(okEdit.status, 200);
  const okEditJson = await okEdit.json();
  assert.equal(okEditJson.edit.previous_message, 'Try 4th Ave');

  // Public guest can read thread & edit history, sees empty ownership
  const publicDetail = await handleGetThreadDetail(
    makeReq(`http://localhost/api/threads/${t1Json.thread.id}`),
    t1Json.thread.id,
    deps
  );
  assert.equal(publicDetail.status, 200);
  const detailJson = await publicDetail.json();
  assert.equal(detailJson.isThreadOwner, false);
  assert.deepEqual(detailJson.ownedPostIds, []);
  assert.equal(detailJson.editsByPostId[replyJson.post.id].length, 1);

  // Cannot delete OP #1 via post delete endpoint
  const deleteOpRes = await handleDeleteReply(
    makeReq(`http://localhost/api/posts/${t1Json.post.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    }),
    t1Json.post.id,
    deps
  );
  assert.equal(deleteOpRes.status, 400);

  // Alice cannot delete Bob's reply #2
  const forbiddenDelReply = await handleDeleteReply(
    makeReq(`http://localhost/api/posts/${replyJson.post.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    }),
    replyJson.post.id,
    deps
  );
  assert.equal(forbiddenDelReply.status, 403);

  // Bob deletes reply #2 -> [deleted], clears history, subsequent edit returns 409
  const delReply = await handleDeleteReply(
    makeReq(`http://localhost/api/posts/${replyJson.post.id}`, {
      method: 'DELETE',
      cookie: bobCookie,
    }),
    replyJson.post.id,
    deps
  );
  assert.equal(delReply.status, 200);

  const editAfterDelete = await handleEditPost(
    makeReq(`http://localhost/api/posts/${replyJson.post.id}`, {
      method: 'PATCH',
      cookie: bobCookie,
      body: JSON.stringify({ message: 'Revive?' }),
    }),
    replyJson.post.id,
    deps
  );
  assert.equal(editAfterDelete.status, 409);

  // Bob cannot delete Alice's thread; Alice can via dedicated thread delete
  const forbiddenDelThread = await handleDeleteThread(
    makeReq(`http://localhost/api/threads/${t1Json.thread.id}`, {
      method: 'DELETE',
      cookie: bobCookie,
    }),
    t1Json.thread.id,
    deps
  );
  assert.equal(forbiddenDelThread.status, 403);

  const delThread = await handleDeleteThread(
    makeReq(`http://localhost/api/threads/${t1Json.thread.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    }),
    t1Json.thread.id,
    deps
  );
  assert.equal(delThread.status, 200);

  const afterDelDetail = await handleGetThreadDetail(
    makeReq(`http://localhost/api/threads/${t1Json.thread.id}`),
    t1Json.thread.id,
    deps
  );
  assert.equal(afterDelDetail.status, 404);

  // Malformed UUID returns 400
  const badUuid = await handleGetThreadDetail(
    makeReq('http://localhost/api/threads/not-a-uuid'),
    'not-a-uuid',
    deps
  );
  assert.equal(badUuid.status, 400);

  // List threads exposes only public summaries + ownedThreadIds for creator
  const listForAlice = await handleListThreads(
    makeReq('http://localhost/api/threads', { cookie: aliceCookie }),
    deps
  );
  const listJson = await listForAlice.json();
  assert.equal(listJson.threads.length, 1);
  assert.deepEqual(listJson.ownedThreadIds, [t2Json.thread.id]);

  // Signed token for non-existent user does not grant access
  const ghostToken = signSessionToken(
    { userId: crypto.randomUUID(), username: 'Ghost' },
    TEST_SECRET
  );
  const ghostCreate = await handleCreateThread(
    makeReq('http://localhost/api/threads', {
      method: 'POST',
      cookie: `fb08_session=${ghostToken}`,
      body: JSON.stringify({ title: 'Ghost', message: 'Boo' }),
    }),
    deps
  );
  assert.equal(ghostCreate.status, 401);

  // Unused imports check guard
  assert.ok(deriveThreadAnonTag('u1', 't1', TEST_SECRET));
  assert.ok(hashPassword('x'));
});
