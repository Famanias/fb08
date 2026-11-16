'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Globe, Lock, Share2, Users } from 'lucide-react';
import { MAX_POST_LENGTH } from '@/features/board/board-rules';
import { BoardUser } from '@/features/board/board.types';
import {
  getVisibilityLabel,
  groupProfileComments,
} from '@/features/profile/profile-rules';
import {
  PostVisibility,
  ProfilePost,
  ProfilePostComment,
} from '@/features/profile/profile.types';
import { formatFullTimestamp, formatWallTimestamp } from '@/lib/format-date';
import { getAvatarColors, getInitials } from '@/lib/initials';

interface ProfilePostItemProps {
  post: ProfilePost;
  viewer: BoardUser | null;
  onOpenProfile: (username: string) => void;
  onUpdatePost: (
    postId: string,
    patch: { body?: string; visibility?: PostVisibility }
  ) => Promise<boolean>;
  onDeletePost: (postId: string) => Promise<boolean>;
  onSharePost: (input: {
    body: string;
    visibility: PostVisibility;
    sharedPostId: string;
  }) => Promise<boolean>;
  onAddComment: (
    postId: string,
    input: {
      body: string;
      parentCommentId?: string | null;
      replyToCommentId?: string | null;
    }
  ) => Promise<boolean>;
  onDeleteComment: (commentId: string) => Promise<boolean>;
}

function VisibilityIcon({ visibility }: { visibility: PostVisibility }) {
  switch (visibility) {
    case 'public':
      return <Globe className="svg-icon" strokeWidth={2.2} />;
    case 'friends':
      return <Users className="svg-icon" strokeWidth={2.2} />;
    case 'only_me':
      return <Lock className="svg-icon" strokeWidth={2.2} />;
  }
}

function SmallAvatar({
  username,
  avatarUrl,
  size = 36,
}: {
  username: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const [bg, fg] = getAvatarColors(username);
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={`${username} avatar`}
        className="profile-thumb"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="post-avatar"
      style={{ background: bg, color: fg, width: size, height: size }}
      aria-hidden="true"
    >
      {getInitials(username)}
    </div>
  );
}

export function ProfilePostItem({
  post,
  viewer,
  onOpenProfile,
  onUpdatePost,
  onDeletePost,
  onSharePost,
  onAddComment,
  onDeleteComment,
}: ProfilePostItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [isSharing, setIsSharing] = useState(false);
  const [shareCaption, setShareCaption] = useState('');
  const [shareVisibility, setShareVisibility] = useState<PostVisibility>('public');
  const [isSubmittingShare, setIsSubmittingShare] = useState(false);

  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ProfilePostComment | null>(null);
  const [replyText, setReplyText] = useState('');
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});

  const groupedComments = useMemo(
    () => groupProfileComments(post.comments),
    [post.comments]
  );
  const commentsById = useMemo(
    () => new Map(post.comments.map((c) => [c.id, c])),
    [post.comments]
  );

  async function handleSaveEdit() {
    if (isSaving) return;
    setIsSaving(true);
    const ok = await onUpdatePost(post.id, { body: editBody.trim() });
    setIsSaving(false);
    if (ok) setIsEditing(false);
  }

  async function handleVisibilityChange(nextVisibility: PostVisibility) {
    await onUpdatePost(post.id, { visibility: nextVisibility });
  }

  async function handleConfirmShare(e: FormEvent) {
    e.preventDefault();
    if (isSubmittingShare || !post.can_share) return;
    setIsSubmittingShare(true);
    const ok = await onSharePost({
      body: shareCaption.trim(),
      visibility: shareVisibility,
      sharedPostId: post.id,
    });
    setIsSubmittingShare(false);
    if (ok) {
      setIsSharing(false);
      setShareCaption('');
      setShareVisibility('public');
    }
  }

  async function handleCommentSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || isSubmittingComment) return;
    setIsSubmittingComment(true);
    const ok = await onAddComment(post.id, { body: trimmed });
    setIsSubmittingComment(false);
    if (ok) setCommentText('');
  }

  async function handleInlineReplySubmit(e: FormEvent) {
    e.preventDefault();
    if (!replyTarget || isSubmittingComment) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;
    const parentId = replyTarget.parent_comment_id ?? replyTarget.id;
    setIsSubmittingComment(true);
    const ok = await onAddComment(post.id, {
      body: trimmed,
      parentCommentId: parentId,
      replyToCommentId: replyTarget.id,
    });
    setIsSubmittingComment(false);
    if (ok) {
      setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
      setReplyTarget(null);
      setReplyText('');
    }
  }

  function startReply(target: ProfilePostComment) {
    const parentId = target.parent_comment_id ?? target.id;
    setReplyTarget(target);
    setReplyText(target.parent_comment_id ? `@${target.author_username} ` : '');
    setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
  }

  return (
    <article
      className="profile-post-card"
      data-profile-post-id={post.id}
      data-visibility={post.visibility}
    >
      <div className="profile-post-head">
        <SmallAvatar
          username={post.author_username}
          avatarUrl={post.author_avatar_url}
          size={40}
        />
        <div className="profile-post-head-meta">
          <div className="post-line">
            <button
              type="button"
              className="author-profile-link"
              onClick={() => onOpenProfile(post.author_username)}
            >
              {post.author_username}
            </button>
            <span className={`visibility-pill visibility-${post.visibility}`}>
              <VisibilityIcon visibility={post.visibility} />
              {getVisibilityLabel(post.visibility)}
            </span>
            {post.edited_at ? (
              <span className="post-pinned" title={formatFullTimestamp(post.edited_at)}>
                edited
              </span>
            ) : null}
          </div>
          <div className="profile-post-time" title={formatFullTimestamp(post.created_at)}>
            {formatWallTimestamp(post.created_at)}
          </div>
        </div>

        {post.is_mine ? (
          <div className="profile-post-owner-controls">
            <select
              aria-label="Change post visibility"
              className="visibility-select-mini"
              data-edit-visibility={post.id}
              value={post.visibility}
              onChange={(e) => void handleVisibilityChange(e.target.value as PostVisibility)}
            >
              <option value="public">Public</option>
              <option value="friends">Friends only</option>
              <option value="only_me">Only me</option>
            </select>
          </div>
        ) : null}
      </div>

      {isEditing ? (
        <div className="edit-box">
          <textarea
            aria-label="Edit profile post"
            maxLength={MAX_POST_LENGTH}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <div className="composer-tools" style={{ marginTop: 6 }}>
            <span className="counter">{MAX_POST_LENGTH - editBody.length} left</span>
            <div className="tool-right">
              <button
                type="button"
                className="btn-secondary"
                disabled={isSaving}
                onClick={() => {
                  setIsEditing(false);
                  setEditBody(post.body);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-share"
                disabled={isSaving || (!editBody.trim() && !post.media_url && !post.shared_post)}
                onClick={() => void handleSaveEdit()}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : post.body ? (
        <div className="post-message" style={{ marginTop: 8 }}>
          {post.body}
        </div>
      ) : null}

      {post.media_url && post.media_type === 'image' ? (
        <div className="profile-media-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.media_url}
            alt="Uploaded post media"
            className="profile-media-img"
          />
        </div>
      ) : null}

      {post.media_url && post.media_type === 'video' ? (
        <div className="profile-media-wrap">
          <video
            src={post.media_url}
            controls
            preload="metadata"
            className="profile-media-video"
          />
        </div>
      ) : null}

      {post.shared_post ? (
        <div className="shared-post-embed" data-shared-post-id={post.shared_post.id}>
          {post.shared_post.available ? (
            <>
              <div className="shared-post-head">
                <SmallAvatar
                  username={post.shared_post.author_username ?? 'Member'}
                  avatarUrl={post.shared_post.author_avatar_url ?? null}
                  size={24}
                />
                <button
                  type="button"
                  className="author-profile-link"
                  onClick={() =>
                    post.shared_post?.author_username &&
                    onOpenProfile(post.shared_post.author_username)
                  }
                >
                  {post.shared_post.author_username}
                </button>
                {post.shared_post.created_at ? (
                  <span className="profile-post-time">
                    · {formatWallTimestamp(post.shared_post.created_at)}
                  </span>
                ) : null}
              </div>
              {post.shared_post.body ? (
                <div className="post-message" style={{ marginTop: 6 }}>
                  {post.shared_post.body}
                </div>
              ) : null}
              {post.shared_post.media_url && post.shared_post.media_type === 'image' ? (
                <div className="profile-media-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.shared_post.media_url}
                    alt="Shared post media"
                    className="profile-media-img"
                  />
                </div>
              ) : null}
              {post.shared_post.media_url && post.shared_post.media_type === 'video' ? (
                <div className="profile-media-wrap">
                  <video
                    src={post.shared_post.media_url}
                    controls
                    preload="metadata"
                    className="profile-media-video"
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div className="post-deleted">
              {post.shared_post.reason ?? 'Original post is no longer available.'}
            </div>
          )}
        </div>
      ) : null}

      <div className="post-meta" style={{ marginTop: 8 }}>
        <span>
          {groupedComments.commentCount}{' '}
          {groupedComments.commentCount === 1 ? 'comment' : 'comments'} ·{' '}
          {groupedComments.replyCount}{' '}
          {groupedComments.replyCount === 1 ? 'reply' : 'replies'}
        </span>

        {viewer && post.can_share ? (
          <>
            <span className="dot">·</span>
            <button
              type="button"
              data-share-post={post.id}
              onClick={() => setIsSharing((prev) => !prev)}
            >
              <Share2 className="svg-icon" style={{ marginRight: 3 }} />
              Share
            </button>
          </>
        ) : null}

        {post.is_mine && !isEditing ? (
          <>
            <span className="dot">·</span>
            <button
              type="button"
              data-edit-profile-post={post.id}
              onClick={() => {
                setEditBody(post.body);
                setIsEditing(true);
              }}
            >
              Edit
            </button>
            <span className="dot">·</span>
            {confirmDelete ? (
              <span className="inline-confirm">
                <span>Delete post?</span>
                <button
                  type="button"
                  className="btn-danger"
                  data-confirm-delete-profile-post={post.id}
                  onClick={() => void onDeletePost(post.id)}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="small-btn"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                data-delete-profile-post={post.id}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            )}
          </>
        ) : null}
      </div>

      {isSharing && viewer && post.can_share ? (
        <form className="inline-reply-composer" onSubmit={handleConfirmShare}>
          <div className="inline-reply-header">
            <span>Share this public post to your profile</span>
            <button
              type="button"
              className="small-btn"
              onClick={() => setIsSharing(false)}
            >
              Cancel
            </button>
          </div>
          <textarea
            rows={2}
            maxLength={MAX_POST_LENGTH}
            data-share-caption={post.id}
            placeholder="Say something about this (optional)..."
            value={shareCaption}
            onChange={(e) => setShareCaption(e.target.value)}
          />
          <div className="composer-tools" style={{ marginTop: 6 }}>
            <div className="tool-left">
              <label style={{ fontSize: 11, color: '#4f5f78', fontWeight: 'bold' }}>
                Share as:{' '}
                <select
                  data-share-visibility={post.id}
                  className="visibility-select-mini"
                  value={shareVisibility}
                  onChange={(e) => setShareVisibility(e.target.value as PostVisibility)}
                >
                  <option value="public">Public</option>
                  <option value="friends">Friends only</option>
                  <option value="only_me">Only me</option>
                </select>
              </label>
            </div>
            <div className="tool-right">
              <button
                type="submit"
                className="btn-share"
                data-confirm-share={post.id}
                disabled={isSubmittingShare}
              >
                {isSubmittingShare ? 'Sharing...' : 'Share Post'}
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <div className="profile-comments-box">
        {groupedComments.groups.map(({ comment, replies }) => {
          const isExpanded = Boolean(expandedReplies[comment.id]);
          const isInlineOpen =
            Boolean(viewer) &&
            Boolean(replyTarget) &&
            (replyTarget!.parent_comment_id ?? replyTarget!.id) === comment.id;

          return (
            <div key={comment.id} className="profile-comment-group">
              <div
                className="profile-comment-item"
                data-profile-comment-id={comment.id}
              >
                <SmallAvatar
                  username={comment.author_username}
                  avatarUrl={comment.author_avatar_url}
                  size={28}
                />
                <div className="post-content">
                  <div className="post-line">
                    <span className="chat-type-badge chat-type-comment">Comment</span>
                    <button
                      type="button"
                      className="author-profile-link"
                      onClick={() => onOpenProfile(comment.author_username)}
                    >
                      {comment.author_username}
                    </button>
                  </div>
                  <div
                    className={`post-message${comment.deleted_at ? ' post-deleted' : ''}`}
                  >
                    {comment.deleted_at ? '[deleted by author]' : comment.body}
                  </div>
                  <div className="post-meta">
                    <span>{formatWallTimestamp(comment.created_at)}</span>
                    {viewer && !comment.deleted_at ? (
                      <>
                        <span className="dot">·</span>
                        <button
                          type="button"
                          data-reply-profile-comment={comment.id}
                          onClick={() => startReply(comment)}
                        >
                          Reply
                        </button>
                      </>
                    ) : null}
                    {comment.is_mine && !comment.deleted_at ? (
                      <>
                        <span className="dot">·</span>
                        <button
                          type="button"
                          onClick={() => void onDeleteComment(comment.id)}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {replies.length > 0 ? (
                <div className="reply-toggle-row">
                  <button
                    type="button"
                    className="reply-toggle-btn"
                    data-toggle-profile-replies={comment.id}
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedReplies((prev) => ({
                        ...prev,
                        [comment.id]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded
                      ? `Hide replies (${replies.length})`
                      : `View replies (${replies.length})`}
                  </button>
                </div>
              ) : null}

              {(replies.length > 0 && isExpanded) || isInlineOpen ? (
                <div className="reply-thread">
                  {replies.length > 0 && isExpanded ? (
                    <div className="reply-thread-scroll">
                      {replies.map((reply) => {
                        const target = reply.reply_to_comment_id
                          ? commentsById.get(reply.reply_to_comment_id)
                          : null;
                        return (
                          <div
                            key={reply.id}
                            className="post post-reply"
                            data-profile-comment-id={reply.id}
                          >
                            <SmallAvatar
                              username={reply.author_username}
                              avatarUrl={reply.author_avatar_url}
                              size={24}
                            />
                            <div className="post-content">
                              <div className="post-line">
                                <span className="chat-type-badge chat-type-reply">
                                  Reply
                                </span>
                                <button
                                  type="button"
                                  className="author-profile-link"
                                  onClick={() => onOpenProfile(reply.author_username)}
                                >
                                  {reply.author_username}
                                </button>
                                {target ? (
                                  <span className="reply-target-chip">
                                    to {target.author_username}
                                  </span>
                                ) : null}
                              </div>
                              <div
                                className={`post-message${
                                  reply.deleted_at ? ' post-deleted' : ''
                                }`}
                              >
                                {reply.deleted_at ? '[deleted by author]' : reply.body}
                              </div>
                              <div className="post-meta">
                                <span>{formatWallTimestamp(reply.created_at)}</span>
                                {viewer && !reply.deleted_at ? (
                                  <>
                                    <span className="dot">·</span>
                                    <button
                                      type="button"
                                      data-reply-profile-comment={reply.id}
                                      onClick={() => startReply(reply)}
                                    >
                                      Reply
                                    </button>
                                  </>
                                ) : null}
                                {reply.is_mine && !reply.deleted_at ? (
                                  <>
                                    <span className="dot">·</span>
                                    <button
                                      type="button"
                                      onClick={() => void onDeleteComment(reply.id)}
                                    >
                                      Delete
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {isInlineOpen && replyTarget ? (
                    <form
                      className="composer inline-reply-composer"
                      onSubmit={handleInlineReplySubmit}
                    >
                      <div className="inline-reply-header">
                        <span>Replying to {replyTarget.author_username}</span>
                        <button
                          type="button"
                          className="small-btn"
                          onClick={() => setReplyTarget(null)}
                        >
                          Cancel
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        maxLength={MAX_POST_LENGTH}
                        autoFocus
                        data-profile-inline-reply={comment.id}
                        placeholder={`Reply to ${replyTarget.author_username}...`}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <div className="composer-tools" style={{ marginTop: 6 }}>
                        <div />
                        <button
                          type="submit"
                          className="btn-share"
                          disabled={!replyText.trim() || isSubmittingComment}
                        >
                          {isSubmittingComment ? 'Replying...' : 'Post Reply'}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {viewer ? (
          <form className="profile-comment-form" onSubmit={handleCommentSubmit}>
            <input
              type="text"
              className="thread-title-input"
              maxLength={MAX_POST_LENGTH}
              data-profile-comment-input={post.id}
              placeholder="Write a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              type="submit"
              className="btn-secondary"
              data-profile-comment-submit={post.id}
              disabled={!commentText.trim() || isSubmittingComment}
            >
              Comment
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}
