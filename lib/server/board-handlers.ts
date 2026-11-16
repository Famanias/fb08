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
  const opDisplayName = thread.op_display_name ?? null;
  return {
    id: thread.id,
    title: thread.title,
    reply_count: thread.reply_count,
    created_at: thread.created_at,
    bumped_at: thread.bumped_at,
    op_anon_tag: opDisplayName ? undefined : thread.op_anon_tag,
    op_display_name: opDisplayName,
    op_preview: thread.op_preview,
    is_mine: viewerUserId ? thread.author_user_id === viewerUserId : false,
  };
}

function toPublicPost(
  post: StoredPostRecord,
  viewerUserId: string | null,
  edits?: BoardPostEdit[]
): BoardPost {
  const displayName = post.display_name ?? null;
  return {
    id: post.id,
    thread_id: post.thread_id,
    post_number: post.post_number,
    // Never expose anon_tag on named posts so readers cannot link named and anonymous posts.
    anon_tag: displayName ? '' : post.anon_tag,
    display_name: displayName,
    parent_post_id: post.parent_post_id ?? null,
    reply_to_post_id: post.reply_to_post_id ?? null,
    message: post.message,
    created_at: post.created_at,
    edited_at: post.edited_at,
    deleted_at: post.deleted_at,
    ...(edits ? { edits } : {}),
    is_mine: viewerUserId ? post.author_user_id === viewerUserId : false,
  };
}

function resolvePostIdentity(
  user: { id: string; username: string },
  threadId: string,
  anonymousFlag: unknown,
  secret?: string
): { anonTag: string; displayName: string | null } {
  const isAnonymous = anonymousFlag === true;
  if (isAnonymous) {
    return {
      anonTag: deriveThreadAnonTag(user.id, threadId, secret),
      displayName: null,
    };
  }
  return {
    // Use an unlinkable random hex tag in storage when posting with username.
    anonTag: crypto.randomBytes(3).toString('hex'),
    displayName: user.username,
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
  if (body.anonymous !== undefined && typeof body.anonymous !== 'boolean') {
    return jsonResponse({ error: 'anonymous must be a boolean.' }, 400);
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
  const { anonTag, displayName } = resolvePostIdentity(
    user,
    threadId,
    body.anonymous,
    secret
  );
  const created = await store.createThread({
    threadId,
    userId: user.id,
    title: titleCheck.value,
    message: msgCheck.value,
    anonTag,
    displayName,
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
  if (body.anonymous !== undefined && typeof body.anonymous !== 'boolean') {
    return jsonResponse({ error: 'anonymous must be a boolean.' }, 400);
  }

  let parentPostId: string | null = null;
  if (body.parentPostId !== undefined && body.parentPostId !== null) {
    if (typeof body.parentPostId !== 'string' || !isValidUuid(body.parentPostId)) {
      return jsonResponse({ error: 'Invalid parent comment ID.' }, 400);
    }
    parentPostId = body.parentPostId;
  }

  let replyToPostId: string | null = null;
  if (body.replyToPostId !== undefined && body.replyToPostId !== null) {
    if (typeof body.replyToPostId !== 'string' || !isValidUuid(body.replyToPostId)) {
      return jsonResponse({ error: 'Invalid reply target ID.' }, 400);
    }
    if (!parentPostId) {
      return jsonResponse(
        { error: 'parentPostId is required when replying to a specific post.' },
        400
      );
    }
    replyToPostId = body.replyToPostId;
  }

  const msgCheck = validateBoardMessage(body.message);
  if (!msgCheck.valid) {
    return jsonResponse({ error: msgCheck.error }, 400);
  }

  const { anonTag, displayName } = resolvePostIdentity(
    user,
    threadId,
    body.anonymous,
    secret
  );
  const res = await store.createReply({
    userId: user.id,
    threadId,
    message: msgCheck.value,
    anonTag,
    displayName,
    parentPostId,
    replyToPostId,
  });

  if (res.status === 'ok') {
    return jsonResponse({ post: toPublicPost(res.post, user.id, []) }, 201);
  }
  if (res.status === 'cannot_reply_to_op') {
    return jsonResponse(
      { error: 'Post a top-level comment instead of a nested reply to #1.' },
      400
    );
  }
  if (res.status === 'parent_deleted') {
    return jsonResponse({ error: 'Cannot reply to a deleted post.' }, 409);
  }
  if (res.status === 'parent_not_found') {
    return jsonResponse({ error: 'Target comment or reply was not found.' }, 404);
  }
  return jsonResponse({ error: 'Thread not found or was deleted.' }, 404);
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

  if (res.status === 'ok') {
    return jsonResponse(
      {
        post: toPublicPost(res.post, user.id),
        edit: res.edit,
      },
      200
    );
  }
  if (res.status === 'not_found') {
    return jsonResponse({ error: 'Post not found.' }, 404);
  }
  if (res.status === 'forbidden') {
    return jsonResponse({ error: 'You can only edit your own posts.' }, 403);
  }
  return jsonResponse({ error: 'Deleted posts cannot be edited.' }, 409);
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
  if (res.status === 'ok' || res.status === 'already_deleted') {
    return jsonResponse({ ok: true, deleted_at: res.deleted_at }, 200);
  }
  if (res.status === 'not_found') {
    return jsonResponse({ error: 'Post not found.' }, 404);
  }
  if (res.status === 'forbidden') {
    return jsonResponse({ error: 'You can only delete your own replies.' }, 403);
  }
  return jsonResponse(
    { error: 'Use Delete Thread to remove the entire thread.' },
    400
  );
}
