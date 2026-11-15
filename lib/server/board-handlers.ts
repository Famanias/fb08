import crypto from 'node:crypto';
import {
  MAX_VISIBLE_THREADS,
  validateBoardMessage,
  validatePassword,
  validateThreadTitle,
  validateUsername,
} from '@/features/board/board-rules';
import {
  BoardPost,
  BoardPostEdit,
  BoardThreadSummary,
} from '@/features/board/board.types';
import { deriveThreadAnonTag } from './anon-tag';
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  hashPassword,
  signSessionToken,
  verifyPassword,
} from './auth';
import {
  BoardServerStore,
  StoredPostRecord,
  StoredThreadRecord,
  createSupabaseBoardStore,
} from './board-store';
import {
  getAuthenticatedUser,
  isValidUuid,
  jsonResponse,
  parseJsonBody,
} from './route-helpers';

export interface HandlerDeps {
  store?: BoardServerStore;
  secret?: string;
  isProd?: boolean;
}

function getDeps(deps: HandlerDeps = {}) {
  return {
    store: deps.store ?? createSupabaseBoardStore(),
    secret: deps.secret,
    isProd: deps.isProd ?? process.env.NODE_ENV === 'production',
  };
}

function toPublicThread(
  thread: StoredThreadRecord,
  viewerUserId: string | null
): BoardThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    reply_count: thread.reply_count,
    created_at: thread.created_at,
    bumped_at: thread.bumped_at,
    op_anon_tag: thread.op_anon_tag,
    op_preview: thread.op_preview,
    is_mine: viewerUserId ? thread.author_user_id === viewerUserId : false,
  };
}

function toPublicPost(
  post: StoredPostRecord,
  viewerUserId: string | null,
  edits?: BoardPostEdit[]
): BoardPost {
  return {
    id: post.id,
    thread_id: post.thread_id,
    post_number: post.post_number,
    anon_tag: post.anon_tag,
    message: post.message,
    created_at: post.created_at,
    edited_at: post.edited_at,
    deleted_at: post.deleted_at,
    ...(edits ? { edits } : {}),
    is_mine: viewerUserId ? post.author_user_id === viewerUserId : false,
  };
}

export async function handleRegister(req: Request, depsInput?: HandlerDeps): Promise<Response> {
  const { store, secret, isProd } = getDeps(depsInput);
  const body = await parseJsonBody(req);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return jsonResponse({ error: 'Username and password are required.' }, 400);
  }

  const nameCheck = validateUsername(body.username);
  if (!nameCheck.valid) {
    return jsonResponse({ error: nameCheck.error }, 400);
  }
  const passCheck = validatePassword(body.password);
  if (!passCheck.valid) {
    return jsonResponse({ error: passCheck.error }, 400);
  }

  const created = await store.createUser(nameCheck.value, hashPassword(body.password));
  if (!created.ok) {
    return jsonResponse({ error: 'That username is already taken.' }, 409);
  }

  const token = signSessionToken(
    { userId: created.user.id, username: created.user.username },
    secret
  );
  return jsonResponse({ user: created.user }, 201, {
    'Set-Cookie': buildSessionCookieHeader(token, isProd),
  });
}

export async function handleLogin(req: Request, depsInput?: HandlerDeps): Promise<Response> {
  const { store, secret, isProd } = getDeps(depsInput);
  const body = await parseJsonBody(req);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return jsonResponse({ error: 'Username and password are required.' }, 400);
  }

  const trimmedName = body.username.trim();
  if (!trimmedName || body.password.length === 0) {
    return jsonResponse({ error: 'Invalid username or password.' }, 400);
  }

  const user = await store.findUserByLowerUsername(trimmedName.toLowerCase());
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return jsonResponse({ error: 'Invalid username or password.' }, 401);
  }

  const publicUser = { id: user.id, username: user.username };
  const token = signSessionToken(
    { userId: user.id, username: user.username },
    secret
  );
  return jsonResponse({ user: publicUser }, 200, {
    'Set-Cookie': buildSessionCookieHeader(token, isProd),
  });
}

export async function handleLogout(depsInput?: HandlerDeps): Promise<Response> {
  const { isProd } = getDeps(depsInput);
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': buildClearSessionCookieHeader(isProd),
  });
}

export async function handleGetMe(req: Request, depsInput?: HandlerDeps): Promise<Response> {
  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  return jsonResponse({ user }, 200);
}

export async function handleListThreads(req: Request, depsInput?: HandlerDeps): Promise<Response> {
  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  const rows = await store.listThreads(MAX_VISIBLE_THREADS);

  const ownedThreadIds = user
    ? rows.filter((t) => t.author_user_id === user.id).map((t) => t.id)
    : [];

  return jsonResponse(
    {
      threads: rows.map((t) => toPublicThread(t, user?.id ?? null)),
      ownedThreadIds,
    },
    200
  );
}

export async function handleCreateThread(req: Request, depsInput?: HandlerDeps): Promise<Response> {
  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in to start a new thread.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body.title !== 'string' || typeof body.message !== 'string') {
    return jsonResponse({ error: 'Thread subject and opening message are required.' }, 400);
  }

  const titleCheck = validateThreadTitle(body.title);
  if (!titleCheck.valid) {
    return jsonResponse({ error: titleCheck.error }, 400);
  }

  const msgCheck = validateBoardMessage(body.message);
  if (!msgCheck.valid) {
    return jsonResponse({ error: msgCheck.error }, 400);
  }

  const threadId = crypto.randomUUID();
  const anonTag = deriveThreadAnonTag(user.id, threadId, secret);
  const created = await store.createThread({
    threadId,
    userId: user.id,
    title: titleCheck.value,
    message: msgCheck.value,
    anonTag,
  });

  return jsonResponse(
    {
      thread: toPublicThread(created.thread, user.id),
      post: toPublicPost(created.post, user.id, []),
    },
    201
  );
}

export async function handleGetThreadDetail(
  req: Request,
  threadId: string,
  depsInput?: HandlerDeps
): Promise<Response> {
  if (!isValidUuid(threadId)) {
    return jsonResponse({ error: 'Invalid thread ID.' }, 400);
  }

  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  const result = await store.getThreadWithPosts(threadId);
  if (!result) {
    return jsonResponse({ error: 'Thread not found.' }, 404);
  }

  const editsByPostId: Record<string, BoardPostEdit[]> = {};
  for (const edit of result.edits) {
    if (!editsByPostId[edit.post_id]) {
      editsByPostId[edit.post_id] = [];
    }
    editsByPostId[edit.post_id].push(edit);
  }

  const ownedPostIds = user
    ? result.posts.filter((p) => p.author_user_id === user.id).map((p) => p.id)
    : [];

  return jsonResponse(
    {
      thread: toPublicThread(result.thread, user?.id ?? null),
      posts: result.posts.map((p) =>
        toPublicPost(p, user?.id ?? null, editsByPostId[p.id] ?? [])
      ),
      editsByPostId,
      ownedPostIds,
      isThreadOwner: Boolean(user && result.thread.author_user_id === user.id),
    },
    200
  );
}

export async function handleDeleteThread(
  req: Request,
  threadId: string,
  depsInput?: HandlerDeps
): Promise<Response> {
  if (!isValidUuid(threadId)) {
    return jsonResponse({ error: 'Invalid thread ID.' }, 400);
  }

  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const status = await store.deleteThread({ userId: user.id, threadId });
  if (status === 'not_found') {
    return jsonResponse({ error: 'Thread not found.' }, 404);
  }
  if (status === 'forbidden') {
    return jsonResponse({ error: 'Only the thread creator can delete this thread.' }, 403);
  }

  return jsonResponse({ ok: true }, 200);
}

export async function handleCreateReply(
  req: Request,
  threadId: string,
  depsInput?: HandlerDeps
): Promise<Response> {
  if (!isValidUuid(threadId)) {
    return jsonResponse({ error: 'Invalid thread ID.' }, 400);
  }

  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in to post a reply.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body.message !== 'string') {
    return jsonResponse({ error: 'Reply message is required.' }, 400);
  }

  const msgCheck = validateBoardMessage(body.message);
  if (!msgCheck.valid) {
    return jsonResponse({ error: msgCheck.error }, 400);
  }

  const anonTag = deriveThreadAnonTag(user.id, threadId, secret);
  const post = await store.createReply({
    userId: user.id,
    threadId,
    message: msgCheck.value,
    anonTag,
  });

  if (!post) {
    return jsonResponse({ error: 'Thread not found or was deleted.' }, 404);
  }

  return jsonResponse({ post: toPublicPost(post, user.id, []) }, 201);
}

export async function handleEditPost(
  req: Request,
  postId: string,
  depsInput?: HandlerDeps
): Promise<Response> {
  if (!isValidUuid(postId)) {
    return jsonResponse({ error: 'Invalid post ID.' }, 400);
  }

  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const body = await parseJsonBody(req);
  if (!body || typeof body.message !== 'string') {
    return jsonResponse({ error: 'Edited message is required.' }, 400);
  }

  const msgCheck = validateBoardMessage(body.message);
  if (!msgCheck.valid) {
    return jsonResponse({ error: msgCheck.error }, 400);
  }

  const res = await store.editPost({
    userId: user.id,
    postId,
    message: msgCheck.value,
  });

  if (res.status === 'not_found') {
    return jsonResponse({ error: 'Post not found.' }, 404);
  }
  if (res.status === 'forbidden') {
    return jsonResponse({ error: 'You can only edit your own posts.' }, 403);
  }
  if (res.status === 'deleted') {
    return jsonResponse({ error: 'Deleted posts cannot be edited.' }, 409);
  }

  return jsonResponse(
    {
      post: toPublicPost(res.post, user.id),
      edit: res.edit,
    },
    200
  );
}

export async function handleDeleteReply(
  req: Request,
  postId: string,
  depsInput?: HandlerDeps
): Promise<Response> {
  if (!isValidUuid(postId)) {
    return jsonResponse({ error: 'Invalid post ID.' }, 400);
  }

  const { store, secret } = getDeps(depsInput);
  const user = await getAuthenticatedUser(req, store, secret);
  if (!user) {
    return jsonResponse({ error: 'Sign in required.' }, 401);
  }

  const res = await store.deleteReply({ userId: user.id, postId });
  if (res.status === 'not_found') {
    return jsonResponse({ error: 'Post not found.' }, 404);
  }
  if (res.status === 'forbidden') {
    return jsonResponse({ error: 'You can only delete your own replies.' }, 403);
  }
  if (res.status === 'cannot_delete_op') {
    return jsonResponse(
      { error: 'Use Delete Thread to remove the entire thread.' },
      400
    );
  }
  if (res.status === 'already_deleted') {
    return jsonResponse({ ok: true, deleted_at: res.deleted_at }, 200);
  }

  return jsonResponse({ ok: true, deleted_at: res.deleted_at }, 200);
}
