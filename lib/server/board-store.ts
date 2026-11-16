import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from './supabase-admin';

export interface StoredUserRecord {
  id: string;
  username: string;
  username_lower: string;
  password_hash: string;
}

export interface StoredThreadRecord {
  id: string;
  title: string;
  author_user_id: string;
  reply_count: number;
  created_at: string;
  bumped_at: string;
  op_anon_tag?: string;
  op_display_name?: string | null;
  op_preview?: string;
}

export interface StoredPostRecord {
  id: string;
  thread_id: string;
  post_number: number;
  author_user_id: string;
  anon_tag: string;
  display_name: string | null;
  parent_post_id: string | null;
  reply_to_post_id: string | null;
  message: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export type CreateReplyStoreResult =
  | { status: 'ok'; post: StoredPostRecord }
  | { status: 'thread_not_found' | 'parent_not_found' | 'cannot_reply_to_op' | 'parent_deleted' };

export interface StoredPostEditRecord {
  id: string;
  post_id: string;
  previous_message: string;
  edited_at: string;
}

export interface BoardServerStore {
  findUserByLowerUsername(lowerUsername: string): Promise<StoredUserRecord | null>;
  findUserById(id: string): Promise<{ id: string; username: string } | null>;
  createUser(
    username: string,
    passwordHash: string
  ): Promise<{ ok: true; user: { id: string; username: string } } | { ok: false; reason: 'duplicate' }>;
  listThreads(limit: number): Promise<StoredThreadRecord[]>;
  getThreadWithPosts(threadId: string): Promise<{
    thread: StoredThreadRecord;
    posts: StoredPostRecord[];
    edits: StoredPostEditRecord[];
  } | null>;
  createThread(input: {
    threadId: string;
    userId: string;
    title: string;
    message: string;
    anonTag: string;
    displayName: string | null;
  }): Promise<{ thread: StoredThreadRecord; post: StoredPostRecord }>;
  createReply(input: {
    userId: string;
    threadId: string;
    message: string;
    anonTag: string;
    displayName: string | null;
    parentPostId?: string | null;
    replyToPostId?: string | null;
  }): Promise<CreateReplyStoreResult>;
  editPost(input: {
    userId: string;
    postId: string;
    message: string;
  }): Promise<
    | { status: 'ok'; post: StoredPostRecord; edit: StoredPostEditRecord }
    | { status: 'not_found' | 'forbidden' | 'deleted' }
  >;
  deleteReply(input: {
    userId: string;
    postId: string;
  }): Promise<
    | { status: 'ok'; deleted_at: string }
    | { status: 'already_deleted'; deleted_at: string }
    | { status: 'not_found' | 'forbidden' | 'cannot_delete_op' }
  >;
  deleteThread(input: {
    userId: string;
    threadId: string;
  }): Promise<'ok' | 'not_found' | 'forbidden'>;
}

function assertNoDbError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export function createSupabaseBoardStore(
  adminClient: SupabaseClient = getSupabaseAdminClient()
): BoardServerStore {
  return {
    async findUserByLowerUsername(lowerUsername) {
      const { data, error } = await adminClient
        .from('board_users')
        .select('id, username, username_lower, password_hash')
        .eq('username_lower', lowerUsername)
        .maybeSingle();
      assertNoDbError(error, 'Failed to query user');
      return (data as StoredUserRecord | null) ?? null;
    },

    async findUserById(id) {
      const { data, error } = await adminClient
        .from('board_users')
        .select('id, username')
        .eq('id', id)
        .maybeSingle();
      assertNoDbError(error, 'Failed to verify user session');
      return (data as { id: string; username: string } | null) ?? null;
    },

    async createUser(username, passwordHash) {
      const { data, error } = await adminClient
        .from('board_users')
        .insert({ username, password_hash: passwordHash })
        .select('id, username')
        .single();

      if (error) {
        if (error.code === '23505') {
          return { ok: false, reason: 'duplicate' };
        }
        throw new Error(`Failed to create user: ${error.message}`);
      }

      return { ok: true, user: data as { id: string; username: string } };
    },

    async listThreads(limit) {
      const { data: threadRows, error } = await adminClient
        .from('board_threads')
        .select('id, title, author_user_id, reply_count, created_at, bumped_at')
        .order('bumped_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      assertNoDbError(error, 'Failed to load threads');

      const threads = (threadRows ?? []) as StoredThreadRecord[];
      if (threads.length === 0) {
        return [];
      }

      const ids = threads.map((t) => t.id);
      const { data: opRows, error: opErr } = await adminClient
        .from('board_posts')
        .select('thread_id, anon_tag, display_name, message')
        .in('thread_id', ids)
        .eq('post_number', 1);
      assertNoDbError(opErr, 'Failed to load opening posts');

      const opByThreadId = new Map<
        string,
        { anon_tag: string; display_name: string | null; message: string }
      >();
      for (const op of (opRows ?? []) as Array<{
        thread_id: string;
        anon_tag: string;
        display_name: string | null;
        message: string;
      }>) {
        opByThreadId.set(op.thread_id, op);
      }

      return threads.map((thread) => {
        const op = opByThreadId.get(thread.id);
        const opDisplayName = op?.display_name ?? null;
        return {
          ...thread,
          op_anon_tag: opDisplayName ? undefined : op?.anon_tag,
          op_display_name: opDisplayName,
          op_preview: op?.message,
        };
      });
    },

    async getThreadWithPosts(threadId) {
      const { data: thread, error: threadErr } = await adminClient
        .from('board_threads')
        .select('id, title, author_user_id, reply_count, created_at, bumped_at')
        .eq('id', threadId)
        .maybeSingle();
      assertNoDbError(threadErr, 'Failed to load thread');
      if (!thread) {
        return null;
      }

      const { data: postRows, error: postsErr } = await adminClient
        .from('board_posts')
        .select(
          'id, thread_id, post_number, author_user_id, anon_tag, display_name, parent_post_id, reply_to_post_id, message, created_at, edited_at, deleted_at'
        )
        .eq('thread_id', threadId)
        .order('post_number', { ascending: true });
      assertNoDbError(postsErr, 'Failed to load thread posts');

      const posts = (postRows ?? []) as StoredPostRecord[];
      const postIds = posts.map((p) => p.id);
      let edits: StoredPostEditRecord[] = [];
      if (postIds.length > 0) {
        const { data: editRows, error: editsErr } = await adminClient
          .from('board_post_edits')
          .select('id, post_id, previous_message, edited_at')
          .in('post_id', postIds)
          .order('edited_at', { ascending: false })
          .order('id', { ascending: false });
        assertNoDbError(editsErr, 'Failed to load post edit history');
        edits = (editRows ?? []) as StoredPostEditRecord[];
      }

      return {
        thread: thread as StoredThreadRecord,
        posts,
        edits,
      };
    },

    async createThread(input) {
      const { data, error } = await adminClient.rpc('create_board_thread', {
        p_thread_id: input.threadId,
        p_user_id: input.userId,
        p_title: input.title,
        p_message: input.message,
        p_anon_tag: input.anonTag,
        p_display_name: input.displayName,
      });
      assertNoDbError(error, 'Failed to create thread');

      const row = Array.isArray(data) ? data[0] : data;
      const typed = row as {
        thread_id: string;
        post_id: string;
        created_at: string;
        bumped_at: string;
      };

      return {
        thread: {
          id: typed.thread_id,
          title: input.title,
          author_user_id: input.userId,
          reply_count: 1,
          created_at: typed.created_at,
          bumped_at: typed.bumped_at,
          op_anon_tag: input.displayName ? undefined : input.anonTag,
          op_display_name: input.displayName,
          op_preview: input.message,
        },
        post: {
          id: typed.post_id,
          thread_id: typed.thread_id,
          post_number: 1,
          author_user_id: input.userId,
          anon_tag: input.anonTag,
          display_name: input.displayName,
          parent_post_id: null,
          reply_to_post_id: null,
          message: input.message,
          created_at: typed.created_at,
          edited_at: null,
          deleted_at: null,
        },
      };
    },

    async createReply(input) {
      const { data, error } = await adminClient.rpc('create_board_reply', {
        p_user_id: input.userId,
        p_thread_id: input.threadId,
        p_message: input.message,
        p_anon_tag: input.anonTag,
        p_display_name: input.displayName,
        p_parent_post_id: input.parentPostId ?? null,
        p_reply_to_post_id: input.replyToPostId ?? null,
      });

      if (error) {
        if (error.message.includes('CANNOT_REPLY_TO_OP')) {
          return { status: 'cannot_reply_to_op' };
        }
        if (error.message.includes('PARENT_DELETED')) {
          return { status: 'parent_deleted' };
        }
        if (
          error.message.includes('PARENT_NOT_FOUND') ||
          error.message.includes('REPLY_TARGET_INVALID')
        ) {
          return { status: 'parent_not_found' };
        }
        if (error.code === 'P0002' || error.message.includes('THREAD_NOT_FOUND')) {
          return { status: 'thread_not_found' };
        }
        throw new Error(`Failed to create reply: ${error.message}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      const typed = row as {
        post_id: string;
        post_number: number;
        created_at: string;
        parent_post_id: string | null;
        reply_to_post_id: string | null;
      };
      return {
        status: 'ok',
        post: {
          id: typed.post_id,
          thread_id: input.threadId,
          post_number: typed.post_number,
          author_user_id: input.userId,
          anon_tag: input.anonTag,
          display_name: input.displayName,
          parent_post_id: typed.parent_post_id ?? null,
          reply_to_post_id: typed.reply_to_post_id ?? null,
          message: input.message,
          created_at: typed.created_at,
          edited_at: null,
          deleted_at: null,
        },
      };
    },

    async editPost(input) {
      const { data, error } = await adminClient.rpc('edit_board_post', {
        p_user_id: input.userId,
        p_post_id: input.postId,
        p_new_message: input.message,
      });
      assertNoDbError(error, 'Failed to edit post');

      const row = Array.isArray(data) ? data[0] : data;
      const typed = row as {
        status: string;
        post_id: string | null;
        edited_at: string | null;
        edit_id: string | null;
        previous_message: string | null;
      };

      if (typed.status === 'not_found' || typed.status === 'forbidden' || typed.status === 'deleted') {
        return { status: typed.status };
      }

      const { data: updatedPost, error: fetchErr } = await adminClient
        .from('board_posts')
        .select(
          'id, thread_id, post_number, author_user_id, anon_tag, display_name, parent_post_id, reply_to_post_id, message, created_at, edited_at, deleted_at'
        )
        .eq('id', input.postId)
        .single();
      assertNoDbError(fetchErr, 'Failed to load updated post');

      return {
        status: 'ok',
        post: updatedPost as StoredPostRecord,
        edit: {
          id: typed.edit_id!,
          post_id: input.postId,
          previous_message: typed.previous_message!,
          edited_at: typed.edited_at!,
        },
      };
    },

    async deleteReply(input) {
      const { data: existing, error: fetchErr } = await adminClient
        .from('board_posts')
        .select('id, thread_id, post_number, author_user_id, deleted_at')
        .eq('id', input.postId)
        .maybeSingle();
      assertNoDbError(fetchErr, 'Failed to load post for deletion');

      if (!existing) {
        return { status: 'not_found' };
      }
      if (existing.author_user_id !== input.userId) {
        return { status: 'forbidden' };
      }
      if (existing.post_number === 1) {
        return { status: 'cannot_delete_op' };
      }
      if (existing.deleted_at) {
        return { status: 'already_deleted', deleted_at: existing.deleted_at as string };
      }

      const deletedAt = new Date().toISOString();
      const { data: updated, error: updateErr } = await adminClient
        .from('board_posts')
        .update({ message: '[deleted]', deleted_at: deletedAt })
        .eq('id', input.postId)
        .eq('author_user_id', input.userId)
        .neq('post_number', 1)
        .is('deleted_at', null)
        .select('deleted_at')
        .maybeSingle();
      assertNoDbError(updateErr, 'Failed to delete reply');

      const { error: editDelErr } = await adminClient
        .from('board_post_edits')
        .delete()
        .eq('post_id', input.postId);
      assertNoDbError(editDelErr, 'Failed to clear reply edit history');

      return {
        status: 'ok',
        deleted_at: (updated?.deleted_at as string | undefined) ?? deletedAt,
      };
    },

    async deleteThread(input) {
      const { data: existing, error: fetchErr } = await adminClient
        .from('board_threads')
        .select('id, author_user_id')
        .eq('id', input.threadId)
        .maybeSingle();
      assertNoDbError(fetchErr, 'Failed to load thread for deletion');

      if (!existing) {
        return 'not_found';
      }
      if (existing.author_user_id !== input.userId) {
        return 'forbidden';
      }

      const { error: deleteErr } = await adminClient
        .from('board_threads')
        .delete()
        .eq('id', input.threadId)
        .eq('author_user_id', input.userId);
      assertNoDbError(deleteErr, 'Failed to delete thread');

      return 'ok';
    },
  };
}
