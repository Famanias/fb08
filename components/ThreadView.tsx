'use client';

import { FormEvent, KeyboardEvent, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  MAX_POST_LENGTH,
  getBoardStatusLabel,
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
  onCreateReply: (message: string) => Promise<boolean>;
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
  const [confirmThreadDelete, setConfirmThreadDelete] = useState(false);
  const [isDeletingThread, setIsDeletingThread] = useState(false);

  const msgCheck = validateBoardMessage(replyText);
  const remaining = MAX_POST_LENGTH - replyText.length;

  async function submitReply() {
    if (!msgCheck.valid || isSubmitting) return;
    const ok = await onCreateReply(msgCheck.value);
    if (ok) {
      setReplyText('');
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitReply();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submitReply();
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
              {getBoardStatusLabel(connectionStatus)} · {thread?.reply_count ?? posts.length}{' '}
              {(thread?.reply_count ?? posts.length) === 1 ? 'post' : 'posts'} · Per-thread IDs active
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
        ) : posts.length === 0 ? (
          <div className="empty">
            <strong>{searchQuery.trim() ? 'No matching posts' : 'No posts found'}</strong>
            {searchQuery.trim()
              ? 'Try clearing your search filter.'
              : 'This thread may have been deleted.'}
          </div>
        ) : (
          posts.map((post) => (
            <BoardPostItem
              key={post.id}
              post={post}
              onEditPost={onEditPost}
              onDeleteReply={onDeleteReply}
            />
          ))
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        {user ? (
          <form className="composer" onSubmit={handleFormSubmit}>
            <textarea
              id="reply-message"
              rows={3}
              maxLength={MAX_POST_LENGTH}
              placeholder="Write an anonymous reply in this thread..."
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value);
                if (errorMessage) onClearError();
              }}
              onKeyDown={handleKeyDown}
            />
            <div className="composer-tools">
              <div className="tool-left">
                <span className="privacy">
                  <Lock className="svg-icon" strokeWidth={2.2} />
                  Same thread ID for your replies here
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
                  {isSubmitting ? 'Posting...' : 'Post Reply as Anonymous'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="gate-banner" id="guest-reply-banner">
            <Lock className="svg-icon" style={{ marginRight: 5 }} />
            Sign in or register in the Account box to post an anonymous reply in this thread.
          </div>
        )}
      </div>
    </section>
  );
}
