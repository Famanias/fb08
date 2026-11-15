'use client';

import { FormEvent, useState } from 'react';
import { DemoComment, WallPost as WallPostRecord } from '@/features/wall/post.types';
import { MAX_COMMENT_LENGTH } from '@/features/wall/wall-rules';
import { formatFullTimestamp, formatWallTimestamp } from '@/lib/format-date';
import { getAvatarColors, getInitials } from '@/lib/initials';

interface WallPostProps {
  post: WallPostRecord;
  demoInteractionsEnabled: boolean;
  likesCount: number;
  isLiked: boolean;
  comments: DemoComment[];
  commentsExpanded: boolean;
  onToggleLike: (postId: string) => void;
  onToggleComments: (postId: string) => void;
  onAddComment: (postId: string, text: string) => boolean;
}

export function WallPost({
  post,
  demoInteractionsEnabled,
  likesCount,
  isLiked,
  comments,
  commentsExpanded,
  onToggleLike,
  onToggleComments,
  onAddComment,
}: WallPostProps) {
  const [commentText, setCommentText] = useState('');
  const [bgColor, textColor] = getAvatarColors(post.author);
  const initials = getInitials(post.author);
  const isSamplePost = post.id.startsWith('sample-');

  function handleCommentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const added = onAddComment(post.id, commentText);
    if (added) {
      setCommentText('');
    }
  }

  return (
    <article className="post" data-post-id={post.id}>
      <div
        className="post-avatar"
        style={{ background: bgColor, color: textColor }}
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="post-content">
        <div className="post-line">
          <span className="post-author">{post.author}</span>
          {isSamplePost ? <span className="post-pinned">Community</span> : null}
        </div>
        <div className="post-message">{post.message}</div>
        <div className="post-meta">
          <span title={formatFullTimestamp(post.created_at)}>
            {formatWallTimestamp(post.created_at)}
          </span>
          {demoInteractionsEnabled ? (
            <>
              <span className="dot">·</span>
              <button
                type="button"
                data-like={post.id}
                className={isLiked ? 'is-liked' : undefined}
                aria-label={`${isLiked ? 'Unlike' : 'Like'} post by ${post.author}`}
                onClick={() => onToggleLike(post.id)}
              >
                {isLiked ? 'Unlike' : 'Like'}
                {likesCount > 0 ? ` (${likesCount})` : ''}
              </button>
              <span className="dot">·</span>
              <button
                type="button"
                data-comments={post.id}
                aria-expanded={commentsExpanded}
                onClick={() => onToggleComments(post.id)}
              >
                Comment{comments.length > 0 ? ` (${comments.length})` : ''}
              </button>
            </>
          ) : null}
        </div>

        {demoInteractionsEnabled && commentsExpanded ? (
          <div className="comment-box">
            {comments.length > 0 ? (
              comments.map((comment, idx) => (
                <div className="comment-row" key={`${post.id}-c-${idx}`}>
                  <strong>{comment.author}</strong>
                  <span>{comment.text}</span>
                </div>
              ))
            ) : (
              <div style={{ color: '#8693a6', fontSize: '10px' }}>
                No comments yet. Start the conversation.
              </div>
            )}
            <form className="comment-entry" onSubmit={handleCommentSubmit}>
              <input
                name="comment"
                aria-label={`Write a comment on ${post.author}'s post`}
                maxLength={MAX_COMMENT_LENGTH}
                placeholder="Write a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                required
              />
              <button className="small-btn" type="submit">
                Post
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </article>
  );
}
