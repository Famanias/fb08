'use client';

import { FormEvent, KeyboardEvent, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  MAX_POST_LENGTH,
  MAX_THREAD_TITLE_LENGTH,
  getBoardStatusLabel,
  validateBoardMessage,
  validateThreadTitle,
} from '@/features/board/board-rules';
import {
  BoardConnectionStatus,
  BoardThreadSummary,
  BoardUser,
} from '@/features/board/board.types';
import { formatFullTimestamp, formatWallTimestamp } from '@/lib/format-date';

interface ThreadIndexProps {
  user: BoardUser | null;
  threads: BoardThreadSummary[];
  totalCount: number;
  searchQuery: string;
  connectionStatus: BoardConnectionStatus;
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onSelectThread: (threadId: string) => void;
  onOpenProfile?: (username: string) => void;
  onCreateThread: (
    title: string,
    message: string,
    anonymous: boolean
  ) => Promise<string | null>;
  onRetry: () => Promise<void>;
  onClearError: () => void;
}

export function ThreadIndex({
  user,
  threads,
  totalCount,
  searchQuery,
  connectionStatus,
  isLoading,
  isSubmitting,
  errorMessage,
  onSelectThread,
  onOpenProfile,
  onCreateThread,
  onRetry,
  onClearError,
}: ThreadIndexProps) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const titleCheck = validateThreadTitle(title);
  const msgCheck = validateBoardMessage(message);
  const canSubmit = titleCheck.valid && msgCheck.valid && !isSubmitting;
  const remaining = MAX_POST_LENGTH - message.length;

  async function submitThread() {
    if (!canSubmit) return;
    const threadId = await onCreateThread(titleCheck.value, msgCheck.value, isAnonymous);
    if (threadId) {
      setTitle('');
      setMessage('');
      setIsAnonymous(false);
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitThread();
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submitThread();
    }
  }

  const trimmedSearch = searchQuery.trim();

  return (
    <section aria-label="Textboard thread index">
      {user ? (
        <form className="composer" onSubmit={handleFormSubmit}>
          <div className="board-box-head" style={{ margin: '-12px -13px 10px -13px' }}>
            <span>+ Start a New Thread</span>
            <span className="privacy">
              <Lock className="svg-icon" strokeWidth={2.2} />
              {isAnonymous ? 'Posted anonymously' : `Posting as ${user.username}`}
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              id="thread-title"
              type="text"
              className="thread-title-input"
              maxLength={MAX_THREAD_TITLE_LENGTH}
              placeholder="Thread subject (1-120 chars)"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMessage) onClearError();
              }}
            />
          </div>
          <textarea
            id="thread-message"
            rows={3}
            maxLength={MAX_POST_LENGTH}
            placeholder="Write opening post #1..."
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (errorMessage) onClearError();
            }}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="composer-tools">
            <div className="tool-left">
              <label className="anon-toggle-label" htmlFor="thread-anonymous-toggle">
                <input
                  id="thread-anonymous-toggle"
                  type="checkbox"
                  checked={isAnonymous}
                  disabled={isSubmitting}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                />
                <span>Post anonymously</span>
              </label>
              <span className="anon-toggle-hint">
                {isAnonymous
                  ? 'Per-thread anonymous ID assigned on post'
                  : `Showing username: ${user.username}`}
              </span>
            </div>
            <div className="tool-right">
              <span className={`counter${remaining <= 40 ? ' low' : ''}`}>
                {remaining} left
              </span>
              <button
                type="submit"
                id="create-thread-btn"
                className="btn-share"
                disabled={!canSubmit}
              >
                {isSubmitting
                  ? 'Posting...'
                  : isAnonymous
                    ? 'Post Thread Anonymously'
                    : 'Post Thread'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="gate-banner" id="guest-thread-banner">
          <Lock className="svg-icon" style={{ marginRight: 5 }} />
          You are browsing as a read-only visitor. <strong>Sign in or register</strong>{' '}
          in the Account box to start a thread or reply.
        </div>
      )}

      {errorMessage ? (
        <div className="inline-alert" role="alert" style={{ marginBottom: 12 }}>
          <span>{errorMessage}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="small-btn"
              onClick={() => void onRetry()}
            >
              Retry
            </button>
            <button type="button" className="small-btn" onClick={onClearError}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="feed-toolbar">
        <span className="feed-heading">
          {trimmedSearch
            ? `Matching Threads (${threads.length})`
            : `Board Index · ${totalCount} ${totalCount === 1 ? 'Thread' : 'Threads'}`}
        </span>
        <span className="feed-order">
          <span
            className={`status-dot${
              connectionStatus === 'live' ? '' : ` ${connectionStatus}`
            }`}
            aria-hidden="true"
          />
          {getBoardStatusLabel(connectionStatus)} · Bumped first
        </span>
      </div>

      <div className="feed" role="region" aria-live="polite">
        {isLoading && totalCount === 0 ? (
          <div className="empty">
            <strong>Loading threads...</strong>
            Fetching the latest discussions.
          </div>
        ) : threads.length === 0 ? (
          <div className="empty">
            <strong>
              {trimmedSearch ? 'No matching threads' : 'No threads started yet'}
            </strong>
            {trimmedSearch
              ? 'Try another search keyword or clear the filter.'
              : 'Sign in and start the first discussion above.'}
          </div>
        ) : (
          threads.map((thread) => (
            <article key={thread.id} className="thread-row" data-thread-id={thread.id}>
              <div className="thread-row-top">
                <button
                  type="button"
                  className="thread-link-btn"
                  onClick={() => onSelectThread(thread.id)}
                >
                  {thread.title}
                </button>
                <span className="tag-badge">
                  {thread.reply_count} {thread.reply_count === 1 ? 'post' : 'posts'}
                </span>
              </div>
              {thread.op_preview ? (
                <p className="thread-snippet">{thread.op_preview}</p>
              ) : null}
              <div className="thread-meta">
                {thread.op_display_name ? (
                  <span>
                    OP{' '}
                    {onOpenProfile ? (
                      <button
                        type="button"
                        className="author-profile-link"
                        onClick={() => onOpenProfile(thread.op_display_name!)}
                      >
                        {thread.op_display_name}
                      </button>
                    ) : (
                      thread.op_display_name
                    )}
                  </span>
                ) : thread.op_anon_tag ? (
                  <span>OP Anonymous #{thread.op_anon_tag}</span>
                ) : null}
                <span title={formatFullTimestamp(thread.bumped_at)}>
                  Last bump {formatWallTimestamp(thread.bumped_at)}
                </span>
                {thread.is_mine ? <span className="mine-badge">Your thread</span> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
