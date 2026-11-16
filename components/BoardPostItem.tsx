'use client';

import { useState } from 'react';
import {
  MAX_POST_LENGTH,
  formatPostAuthorLabel,
  validateBoardMessage,
} from '@/features/board/board-rules';
import { BoardPost } from '@/features/board/board.types';
import { formatFullTimestamp, formatWallTimestamp } from '@/lib/format-date';
import { getAvatarColors } from '@/lib/initials';

interface BoardPostItemProps {
  post: BoardPost;
  onEditPost: (postId: string, message: string) => Promise<boolean>;
  onDeleteReply: (postId: string) => Promise<boolean>;
}

export function BoardPostItem({
  post,
  onEditPost,
  onDeleteReply,
}: BoardPostItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftMessage, setDraftMessage] = useState(post.message);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isDeleted = Boolean(post.deleted_at);
  const authorLabel = formatPostAuthorLabel(post);
  const [bg, fg] = getAvatarColors(post.display_name || post.anon_tag);
  const edits = post.edits ?? [];
  const check = validateBoardMessage(draftMessage);

  async function handleSaveEdit() {
    if (!check.valid || isSavingEdit) {
      setEditError(check.error ?? 'Invalid message.');
      return;
    }
    if (check.value === post.message) {
      setIsEditing(false);
      setEditError(null);
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    const ok = await onEditPost(post.id, check.value);
    setIsSavingEdit(false);
    if (ok) {
      setIsEditing(false);
    }
  }

  async function handleConfirmDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    const ok = await onDeleteReply(post.id);
    setIsDeleting(false);
    if (ok) {
      setConfirmDelete(false);
    }
  }

  return (
    <article
      className="post"
      data-post-id={post.id}
      data-post-number={post.post_number}
    >
      <div
        className="post-avatar"
        style={{ background: bg, color: fg }}
        aria-hidden="true"
      >
        #{post.post_number}
      </div>

      <div className="post-content">
        <div className="post-line">
          <span className="post-num">
            #{post.post_number}
            {post.post_number === 1 ? ' (OP)' : ''}
          </span>
          <span className="post-author">{authorLabel}</span>
          {post.is_mine ? <span className="mine-badge">You</span> : null}
          {post.edited_at && !isDeleted ? (
            <span className="post-pinned" title={formatFullTimestamp(post.edited_at)}>
              edited
            </span>
          ) : null}
        </div>

        {isEditing ? (
          <div className="edit-box">
            <textarea
              aria-label={`Edit post #${post.post_number}`}
              maxLength={MAX_POST_LENGTH}
              value={draftMessage}
              onChange={(e) => {
                setDraftMessage(e.target.value);
                if (editError) setEditError(null);
              }}
            />
            {editError ? (
              <div className="inline-alert" style={{ marginTop: 6 }}>
                <span>{editError}</span>
              </div>
            ) : null}
            <div className="composer-tools" style={{ marginTop: 6 }}>
              <span className="counter">
                {MAX_POST_LENGTH - draftMessage.length} left
              </span>
              <div className="tool-right">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isSavingEdit}
                  onClick={() => {
                    setIsEditing(false);
                    setDraftMessage(post.message);
                    setEditError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-share"
                  disabled={!check.valid || isSavingEdit}
                  onClick={() => void handleSaveEdit()}
                >
                  {isSavingEdit ? 'Saving...' : 'Save Edit'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={`post-message${isDeleted ? ' post-deleted' : ''}`}>
            {isDeleted ? '[deleted by author]' : post.message}
          </div>
        )}

        <div className="post-meta">
          <span title={formatFullTimestamp(post.created_at)}>
            {formatWallTimestamp(post.created_at)}
          </span>

          {post.is_mine && !isDeleted && !isEditing ? (
            <>
              <span className="dot">·</span>
              <button
                type="button"
                data-edit-post={post.id}
                onClick={() => {
                  setDraftMessage(post.message);
                  setEditError(null);
                  setIsEditing(true);
                }}
              >
                Edit
              </button>
            </>
          ) : null}

          {post.is_mine && post.post_number > 1 && !isDeleted ? (
            <>
              <span className="dot">·</span>
              {confirmDelete ? (
                <span className="inline-confirm">
                  <span>Delete reply?</span>
                  <button
                    type="button"
                    className="btn-danger"
                    data-confirm-delete-post={post.id}
                    disabled={isDeleting}
                    onClick={() => void handleConfirmDelete()}
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className="small-btn"
                    disabled={isDeleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  data-delete-post={post.id}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
            </>
          ) : null}

          {!isDeleted && edits.length > 0 ? (
            <>
              <span className="dot">·</span>
              <button
                type="button"
                data-history-post={post.id}
                aria-expanded={showHistory}
                onClick={() => setShowHistory((prev) => !prev)}
              >
                {showHistory
                  ? `Hide edit history (${edits.length})`
                  : `View edit history (${edits.length})`}
              </button>
            </>
          ) : null}
        </div>

        {showHistory && !isDeleted && edits.length > 0 ? (
          <div className="edit-history-drawer" data-history-drawer={post.id}>
            {edits.map((entry) => (
              <div key={entry.id} className="edit-history-entry">
                <div className="edit-history-time" title={formatFullTimestamp(entry.edited_at)}>
                  Previous version before {formatWallTimestamp(entry.edited_at)}
                </div>
                <div className="edit-history-text">{entry.previous_message}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
