'use client';

import { FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  MAX_POST_LENGTH,
  buildReplyMentionPrefix,
  formatPostAuthorLabel,
  getBoardStatusLabel,
  groupThreadPosts,
  validateBoardMessage,
} from '@/features/board/board-rules';
import {
  BoardConnectionStatus,
  BoardPost,
  BoardThreadSummary,
  BoardUser,
} from '@/features/board/board.types';
import { BoardPostItem } from './BoardPostItem';

interface ThreadViewProps {
  user: BoardUser | null;
  thread: BoardThreadSummary | null;
  threadId: string;
  posts: BoardPost[];
  isThreadOwner: boolean;
  searchQuery: string;
  connectionStatus: BoardConnectionStatus;
  isLoadingThread: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onCreateReply: (
    message: string,
    anonymous: boolean,
    options?: { parentPostId?: string | null; replyToPostId?: string | null }
  ) => Promise<boolean>;
  onEditPost: (postId: string, message: string) => Promise<boolean>;
  onDeleteReply: (postId: string) => Promise<boolean>;
  onDeleteThread: () => Promise<boolean>;
  onRetry: () => Promise<void>;
  onClearError: () => void;
}

export function ThreadView({
  user,
  thread,
  threadId,
  posts,
  isThreadOwner,
  searchQuery,
  connectionStatus,
  isLoadingThread,
  isSubmitting,
  errorMessage,
  onBack,
  onCreateReply,
  onEditPost,
  onDeleteReply,
  onDeleteThread,
  onRetry,
  onClearError,
}: ThreadViewProps) {
  const [replyText, setReplyText] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [replyTarget, setReplyTarget] = useState<BoardPost | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [inlineAnonymous, setInlineAnonymous] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [confirmThreadDelete, setConfirmThreadDelete] = useState(false);
  const [isDeletingThread, setIsDeletingThread] = useState(false);

  const postsById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const grouped = useMemo(
    () => groupThreadPosts(posts, searchQuery),
    [posts, searchQuery]
  );
  const hasVisibleItems =
    Boolean(grouped.op) || grouped.groups.length > 0 || grouped.orphanReplies.length > 0;

  const msgCheck = validateBoardMessage(replyText);
  const remaining = MAX_POST_LENGTH - replyText.length;
  const inlineCheck = validateBoardMessage(inlineReplyText);
  const inlineRemaining = MAX_POST_LENGTH - inlineReplyText.length;

  async function submitComment() {
    if (!msgCheck.valid || isSubmitting) return;
    const ok = await onCreateReply(msgCheck.value, isAnonymous);
    if (ok) {
      setReplyText('');
      setIsAnonymous(false);
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitComment();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submitComment();
    }
  }

  function handleStartReply(target: BoardPost) {
    const parentId = target.parent_post_id ?? target.id;
    setReplyTarget(target);
    setInlineAnonymous(false);
    setInlineReplyText(target.parent_post_id ? buildReplyMentionPrefix(target) : '');
    setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
    if (errorMessage) onClearError();
  }

  async function submitInlineReply() {
    if (!replyTarget || !inlineCheck.valid || isSubmitting) return;
    const parentId = replyTarget.parent_post_id ?? replyTarget.id;
    const ok = await onCreateReply(inlineCheck.value, inlineAnonymous, {
      parentPostId: parentId,
      replyToPostId: replyTarget.id,
    });
    if (ok) {
      setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
      setReplyTarget(null);
      setInlineReplyText('');
      setInlineAnonymous(false);
    }
  }

  function handleInlineSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitInlineReply();
  }

  function handleInlineKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submitInlineReply();
    }
  }

  async function handleConfirmDeleteThread() {
    if (isDeletingThread) return;
    setIsDeletingThread(true);
    const ok = await onDeleteThread();
    setIsDeletingThread(false);
    if (ok) {
      setConfirmThreadDelete(false);
    }
  }

  return (
    <section aria-label="Thread discussion" data-active-thread-id={threadId}>
      <div className="thread-view-header">
        <div>
          <button
            type="button"
            id="back-to-threads"
            className="subtle-action"
            onClick={onBack}
          >
            ← Back to all threads
          </button>
          <h1 className="thread-view-title">{thread?.title ?? 'Thread'}</h1>
          <div className="thread-meta">
            <span className="feed-order">
              <span
                className={`status-dot${
                  connectionStatus === 'live' ? '' : ` ${connectionStatus}`
                }`}
                aria-hidden="true"
              />
              {getBoardStatusLabel(connectionStatus)} · {grouped.commentCount}{' '}
              {grouped.commentCount === 1 ? 'comment' : 'comments'} · {grouped.replyCount}{' '}
              {grouped.replyCount === 1 ? 'reply' : 'replies'} · {thread?.reply_count ?? posts.length}{' '}
              {(thread?.reply_count ?? posts.length) === 1 ? 'post' : 'posts'}
            </span>
          </div>
        </div>

        {isThreadOwner ? (
          <div>
            {confirmThreadDelete ? (
              <div className="inline-confirm">
                <span>Delete this entire thread?</span>
                <button
                  type="button"
                  id="confirm-delete-thread-btn"
                  className="btn-danger"
                  disabled={isDeletingThread}
                  onClick={() => void handleConfirmDeleteThread()}
                >
                  {isDeletingThread ? 'Deleting...' : 'Confirm Delete Thread'}
                </button>
                <button
                  type="button"
                  className="small-btn"
                  disabled={isDeletingThread}
                  onClick={() => setConfirmThreadDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="delete-thread-btn"
                className="btn-danger"
                onClick={() => setConfirmThreadDelete(true)}
              >
                Delete Thread
              </button>
            )}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="inline-alert" role="alert" style={{ marginBottom: 12 }}>
          <span>{errorMessage}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="small-btn" onClick={() => void onRetry()}>
              Retry
            </button>
            <button type="button" className="small-btn" onClick={onClearError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="feed" role="region" aria-live="polite">
        {isLoadingThread && posts.length === 0 ? (
          <div className="empty">
            <strong>Loading thread...</strong>
            Fetching posts and edit history.
          </div>
        ) : !hasVisibleItems ? (
          <div className="empty">
            <strong>{searchQuery.trim() ? 'No matching posts' : 'No posts found'}</strong>
            {searchQuery.trim()
              ? 'Try clearing your search filter.'
              : 'This thread may have been deleted.'}
          </div>
        ) : (
          <>
            {grouped.op ? (
              <BoardPostItem
                key={grouped.op.id}
                post={grouped.op}
                onEditPost={onEditPost}
                onDeleteReply={onDeleteReply}
              />
            ) : null}

            {grouped.groups.map(({ comment, replies }) => {
              const isInlineOpen =
                Boolean(user) &&
                Boolean(replyTarget) &&
                (replyTarget!.parent_post_id ?? replyTarget!.id) === comment.id;
              const isRepliesExpanded =
                Boolean(expandedReplies[comment.id]) ||
                (Boolean(searchQuery.trim()) && replies.length > 0);
              const showReplyThread =
                (replies.length > 0 && isRepliesExpanded) || isInlineOpen;

              return (
                <div key={comment.id} className="comment-group" data-comment-id={comment.id}>
                  <BoardPostItem
                    post={comment}
                    canReply={Boolean(user)}
                    onStartReply={handleStartReply}
                    onEditPost={onEditPost}
                    onDeleteReply={onDeleteReply}
                  />

                  {replies.length > 0 ? (
                    <div className="reply-toggle-row">
                      <button
                        type="button"
                        className="reply-toggle-btn"
                        data-toggle-replies={comment.id}
                        aria-expanded={isRepliesExpanded}
                        onClick={() =>
                          setExpandedReplies((prev) => ({
                            ...prev,
                            [comment.id]: !isRepliesExpanded,
                          }))
                        }
                      >
                        {isRepliesExpanded
                          ? `Hide replies (${replies.length})`
                          : `View replies (${replies.length})`}
                      </button>
                    </div>
                  ) : null}

                  {showReplyThread ? (
                    <div className="reply-thread">
                      {replies.length > 0 && isRepliesExpanded ? (
                        <div className="reply-thread-scroll" data-replies-scroll={comment.id}>
                          {replies.map((reply) => (
                            <BoardPostItem
                              key={reply.id}
                              post={reply}
                              replyToPost={
                                reply.reply_to_post_id
                                  ? (postsById.get(reply.reply_to_post_id) ?? null)
                                  : null
                              }
                              canReply={Boolean(user)}
                              onStartReply={handleStartReply}
                              onEditPost={onEditPost}
                              onDeleteReply={onDeleteReply}
                            />
                          ))}
                        </div>
                      ) : null}

                      {isInlineOpen && replyTarget ? (
                        <form
                          className="composer inline-reply-composer"
                          data-inline-reply-parent={comment.id}
                          onSubmit={handleInlineSubmit}
                        >
                          <div className="inline-reply-header">
                            <span>
                              Replying to <strong>#{replyTarget.post_number}</strong> (
                              {formatPostAuthorLabel(replyTarget)})
                            </span>
                            <button
                              type="button"
                              className="small-btn"
                              disabled={isSubmitting}
                              onClick={() => setReplyTarget(null)}
                            >
                              Cancel
                            </button>
                          </div>
                          <textarea
                            id="inline-reply-message"
                            rows={2}
                            maxLength={MAX_POST_LENGTH}
                            autoFocus
                            placeholder={
                              inlineAnonymous
                                ? `Write an anonymous reply to #${replyTarget.post_number}...`
                                : `Reply to #${replyTarget.post_number} as ${user!.username}...`
                            }
                            value={inlineReplyText}
                            onChange={(e) => {
                              setInlineReplyText(e.target.value);
                              if (errorMessage) onClearError();
                            }}
                            onKeyDown={handleInlineKeyDown}
                          />
                          <div className="composer-tools">
                            <div className="tool-left">
                              <label
                                className="anon-toggle-label"
                                htmlFor="inline-reply-anonymous-toggle"
                              >
                                <input
                                  id="inline-reply-anonymous-toggle"
                                  type="checkbox"
                                  checked={inlineAnonymous}
                                  disabled={isSubmitting}
                                  onChange={(e) => setInlineAnonymous(e.target.checked)}
                                />
                                <span>Post anonymously</span>
                              </label>
                            </div>
                            <div className="tool-right">
                              <span
                                className={`counter${inlineRemaining <= 40 ? ' low' : ''}`}
                              >
                                {inlineRemaining} left
                              </span>
                              <button
                                type="submit"
                                id="inline-reply-submit"
                                className="btn-share"
                                disabled={!inlineCheck.valid || isSubmitting}
                              >
                                {isSubmitting
                                  ? 'Replying...'
                                  : inlineAnonymous
                                    ? 'Reply Anonymously'
                                    : 'Post Reply'}
                              </button>
                            </div>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {grouped.orphanReplies.map((reply) => (
              <BoardPostItem
                key={reply.id}
                post={reply}
                replyToPost={
                  reply.reply_to_post_id
                    ? (postsById.get(reply.reply_to_post_id) ?? null)
                    : null
                }
                canReply={Boolean(user)}
                onStartReply={handleStartReply}
                onEditPost={onEditPost}
                onDeleteReply={onDeleteReply}
              />
            ))}
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {user ? (
          <form className="composer" onSubmit={handleFormSubmit}>
            <textarea
              id="reply-message"
              rows={3}
              maxLength={MAX_POST_LENGTH}
              placeholder={
                isAnonymous
                  ? 'Write an anonymous comment in this thread...'
                  : `Add a comment as ${user.username}...`
              }
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value);
                if (errorMessage) onClearError();
              }}
              onKeyDown={handleKeyDown}
            />
            <div className="composer-tools">
              <div className="tool-left">
                <label className="anon-toggle-label" htmlFor="reply-anonymous-toggle">
                  <input
                    id="reply-anonymous-toggle"
                    type="checkbox"
                    checked={isAnonymous}
                    disabled={isSubmitting}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                  />
                  <span>Post anonymously</span>
                </label>
                <span className="anon-toggle-hint">
                  <Lock className="svg-icon" strokeWidth={2.2} style={{ marginRight: 4 }} />
                  {isAnonymous
                    ? 'Same anonymous thread ID for your anon posts here'
                    : `Commenting as ${user.username}`}
                </span>
              </div>
              <div className="tool-right">
                <span className={`counter${remaining <= 40 ? ' low' : ''}`}>
                  {remaining} left
                </span>
                <button
                  type="submit"
                  id="reply-submit"
                  className="btn-share"
                  disabled={!msgCheck.valid || isSubmitting}
                >
                  {isSubmitting
                    ? 'Posting...'
                    : isAnonymous
                      ? 'Comment Anonymously'
                      : 'Post Comment'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="gate-banner" id="guest-reply-banner">
            <Lock className="svg-icon" style={{ marginRight: 5 }} />
            Sign in or register in the Account box to comment or reply in this thread.
          </div>
        )}
      </div>
    </section>
  );
}
