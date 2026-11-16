import {
  BoardConnectionStatus,
  BoardPost,
  BoardPostChatType,
  BoardPostEdit,
  BoardPostThreadGroup,
  BoardThreadSummary,
} from './board.types';

export const MAX_USERNAME_LENGTH = 24;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_THREAD_TITLE_LENGTH = 120;
export const MAX_POST_LENGTH = 2000;
export const MAX_VISIBLE_THREADS = 50;
export const MAX_POSTS_PER_THREAD = 200;

export function validateUsername(raw: string): {
  valid: boolean;
  value: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: '', error: 'Please enter a username.' };
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return {
      valid: false,
      value: trimmed,
      error: `Username must be ${MAX_USERNAME_LENGTH} characters or less.`,
    };
  }
  return { valid: true, value: trimmed };
}

/** Accept any non-empty password up to MAX_PASSWORD_LENGTH with no complexity floor. */
export function validatePassword(raw: string): {
  valid: boolean;
  error?: string;
} {
  if (raw.length === 0) {
    return { valid: false, error: 'Please enter a password.' };
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Password must be ${MAX_PASSWORD_LENGTH} characters or less.`,
    };
  }
  return { valid: true };
}

export function validateThreadTitle(raw: string): {
  valid: boolean;
  value: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: '', error: 'Please enter a thread subject.' };
  }
  if (trimmed.length > MAX_THREAD_TITLE_LENGTH) {
    return {
      valid: false,
      value: trimmed,
      error: `Thread subject must be ${MAX_THREAD_TITLE_LENGTH} characters or less.`,
    };
  }
  return { valid: true, value: trimmed };
}

export function validateBoardMessage(raw: string): {
  valid: boolean;
  value: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: '', error: 'Please enter a message before posting.' };
  }
  if (trimmed.length > MAX_POST_LENGTH) {
    return {
      valid: false,
      value: trimmed,
      error: `Message must be ${MAX_POST_LENGTH} characters or less.`,
    };
  }
  return { valid: true, value: trimmed };
}

function toTimestampMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortThreadsByBump(
  threads: BoardThreadSummary[],
  maxThreads: number = MAX_VISIBLE_THREADS
): BoardThreadSummary[] {
  const unique = new Map<string, BoardThreadSummary>();
  for (const thread of threads) {
    unique.set(thread.id, thread);
  }

  return Array.from(unique.values())
    .sort((a, b) => {
      const diff = toTimestampMs(b.bumped_at) - toTimestampMs(a.bumped_at);
      if (diff !== 0) {
        return diff;
      }
      return b.id.localeCompare(a.id);
    })
    .slice(0, maxThreads);
}

export function mergeThreadList(
  existing: BoardThreadSummary[],
  incoming: BoardThreadSummary[],
  ownedIds?: ReadonlySet<string>,
  maxThreads: number = MAX_VISIBLE_THREADS
): BoardThreadSummary[] {
  const merged = new Map<string, BoardThreadSummary>();

  for (const thread of existing) {
    merged.set(thread.id, thread);
  }

  for (const thread of incoming) {
    const prev = merged.get(thread.id);
    merged.set(thread.id, {
      ...prev,
      ...thread,
      op_anon_tag: thread.op_anon_tag ?? prev?.op_anon_tag,
      op_display_name:
        thread.op_display_name !== undefined ? thread.op_display_name : prev?.op_display_name,
      op_preview: thread.op_preview ?? prev?.op_preview,
      is_mine: ownedIds ? ownedIds.has(thread.id) : (thread.is_mine ?? prev?.is_mine ?? false),
    });
  }

  if (ownedIds) {
    for (const [id, thread] of merged.entries()) {
      merged.set(id, { ...thread, is_mine: ownedIds.has(id) });
    }
  }

  return sortThreadsByBump(Array.from(merged.values()), maxThreads);
}

function mergeEditHistory(
  existingEdits: BoardPostEdit[] | undefined,
  incomingEdits: BoardPostEdit[] | undefined
): BoardPostEdit[] {
  const map = new Map<string, BoardPostEdit>();
  for (const edit of existingEdits ?? []) {
    map.set(edit.id, edit);
  }
  for (const edit of incomingEdits ?? []) {
    map.set(edit.id, edit);
  }
  return Array.from(map.values()).sort((a, b) => {
    const diff = toTimestampMs(b.edited_at) - toTimestampMs(a.edited_at);
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  });
}

export function sortAndMergeThreadPosts(
  existing: BoardPost[],
  incoming: BoardPost[],
  ownedPostIds?: ReadonlySet<string>,
  maxPosts: number = MAX_POSTS_PER_THREAD
): BoardPost[] {
  const merged = new Map<string, BoardPost>();

  for (const post of existing) {
    merged.set(post.id, post);
  }

  for (const post of incoming) {
    const prev = merged.get(post.id);
    const isDeleted = Boolean(post.deleted_at);
    const edits = isDeleted ? [] : mergeEditHistory(prev?.edits, post.edits);
    merged.set(post.id, {
      ...prev,
      ...post,
      edits,
      is_mine: ownedPostIds ? ownedPostIds.has(post.id) : (post.is_mine ?? prev?.is_mine ?? false),
    });
  }

  if (ownedPostIds) {
    for (const [id, post] of merged.entries()) {
      merged.set(id, { ...post, is_mine: ownedPostIds.has(id) });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (a.post_number !== b.post_number) {
        return a.post_number - b.post_number;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, maxPosts);
}

export function filterThreads(
  threads: BoardThreadSummary[],
  query: string
): BoardThreadSummary[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return threads;
  }
  return threads.filter(
    (thread) =>
      thread.title.toLowerCase().includes(term) ||
      (thread.op_preview ?? '').toLowerCase().includes(term) ||
      (thread.op_display_name ?? '').toLowerCase().includes(term) ||
      (thread.op_anon_tag ?? '').toLowerCase().includes(term)
  );
}

export function filterPostsInThread(posts: BoardPost[], query: string): BoardPost[] {
  const term = query.trim().toLowerCase();
  if (!term) {
    return posts;
  }
  return posts.filter((post) => postMatchesTerm(post, term));
}

export function formatPostAuthorLabel(
  post: Pick<BoardPost, 'display_name' | 'anon_tag'>
): string {
  return post.display_name ? post.display_name : `Anonymous #${post.anon_tag}`;
}

export function getPostChatType(
  post: Pick<BoardPost, 'post_number' | 'parent_post_id'>
): BoardPostChatType {
  if (post.post_number === 1) return 'op';
  return post.parent_post_id ? 'reply' : 'comment';
}

export function buildReplyMentionPrefix(
  targetPost: Pick<BoardPost, 'display_name' | 'anon_tag'>
): string {
  return `@${formatPostAuthorLabel(targetPost)} `;
}

function postMatchesTerm(post: BoardPost, term: string): boolean {
  if (!term) return true;
  return (
    post.message.toLowerCase().includes(term) ||
    (post.display_name ?? '').toLowerCase().includes(term) ||
    post.anon_tag.toLowerCase().includes(term) ||
    `#${post.post_number}`.includes(term)
  );
}

export function groupThreadPosts(
  posts: BoardPost[],
  query: string
): {
  op: BoardPost | null;
  groups: BoardPostThreadGroup[];
  orphanReplies: BoardPost[];
  commentCount: number;
  replyCount: number;
} {
  const ordered = [...posts].sort((a, b) =>
    a.post_number !== b.post_number
      ? a.post_number - b.post_number
      : a.id.localeCompare(b.id)
  );
  const term = query.trim().toLowerCase();

  let opPost: BoardPost | null = null;
  const comments: BoardPost[] = [];
  const repliesByParent = new Map<string, BoardPost[]>();
  const commentIds = new Set<string>();
  let replyCount = 0;

  for (const post of ordered) {
    if (post.post_number === 1) {
      opPost = post;
    } else if (!post.parent_post_id) {
      comments.push(post);
      commentIds.add(post.id);
    } else {
      replyCount += 1;
      const list = repliesByParent.get(post.parent_post_id) ?? [];
      list.push(post);
      repliesByParent.set(post.parent_post_id, list);
    }
  }

  const groups: BoardPostThreadGroup[] = [];
  for (const comment of comments) {
    const allReplies = repliesByParent.get(comment.id) ?? [];
    if (!term) {
      groups.push({ comment, replies: allReplies });
      continue;
    }
    const commentMatches = postMatchesTerm(comment, term);
    const matchingReplies = commentMatches
      ? allReplies
      : allReplies.filter((r) => postMatchesTerm(r, term));
    if (commentMatches || matchingReplies.length > 0) {
      groups.push({ comment, replies: matchingReplies });
    }
  }

  const orphanReplies: BoardPost[] = [];
  for (const [parentId, list] of repliesByParent.entries()) {
    if (!commentIds.has(parentId)) {
      for (const r of list) {
        if (postMatchesTerm(r, term)) {
          orphanReplies.push(r);
        }
      }
    }
  }

  const visibleOp = opPost && postMatchesTerm(opPost, term) ? opPost : null;

  return {
    op: visibleOp,
    groups,
    orphanReplies,
    commentCount: comments.length,
    replyCount,
  };
}

export function getBoardStatusLabel(status: BoardConnectionStatus): string {
  switch (status) {
    case 'live':
      return 'Live';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'offline':
      return 'Offline';
    case 'error':
      return 'Connection Error';
  }
}

/**
 * Prevent double-submit races between click events and async React state updates.
 * Returns `undefined` when another invocation on `lock` is already active.
 */
export async function runSingleFlight<T>(
  lock: { current: boolean },
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (lock.current) {
    return undefined;
  }
  lock.current = true;
  try {
    return await fn();
  } finally {
    lock.current = false;
  }
}
