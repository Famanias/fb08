'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { WALL_CAPABILITIES } from '@/features/wall/capabilities';
import {
  DemoInteractionsState,
  WallConnectionStatus,
  WallPost as WallPostRecord,
} from '@/features/wall/post.types';
import { getStatusLabel } from '@/features/wall/wall-rules';
import { WallPost } from './WallPost';

interface PostFeedProps {
  posts: WallPostRecord[];
  totalCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  isLoading: boolean;
  connectionStatus: WallConnectionStatus;
  demoInteractions: DemoInteractionsState;
  onToggleLike: (postId: string) => { ok: boolean; error?: string };
  onAddComment: (postId: string, text: string) => { ok: boolean; error?: string };
  onNotify: (message: string) => void;
}

export function PostFeed({
  posts,
  totalCount,
  searchQuery,
  onSearchChange,
  isLoading,
  connectionStatus,
  demoInteractions,
  onToggleLike,
  onAddComment,
  onNotify,
}: PostFeedProps) {
  const [expandedPostIds, setExpandedPostIds] = useState<string[]>([]);
  const trimmedSearch = searchQuery.trim();
  const statusLabel = getStatusLabel(connectionStatus);

  function handleToggleComments(postId: string) {
    setExpandedPostIds((prev) =>
      prev.includes(postId)
        ? prev.filter((id) => id !== postId)
        : [...prev, postId]
    );
  }

  function handleToggleLike(postId: string) {
    const res = onToggleLike(postId);
    if (!res.ok && res.error) {
      onNotify(res.error);
    }
  }

  function handleAddComment(postId: string, text: string): boolean {
    const res = onAddComment(postId, text);
    if (!res.ok) {
      if (res.error) onNotify(res.error);
      return false;
    }
    if (!expandedPostIds.includes(postId)) {
      setExpandedPostIds((prev) => [...prev, postId]);
    }
    onNotify(res.error ?? 'Comment added!');
    return true;
  }

  return (
    <>
      <div className="mobile-search-row">
        <label className="top-search" aria-label="Search wall posts on mobile">
          <input
            type="search"
            placeholder="Search the Wall"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <span className="search-icon" aria-hidden="true">
            <Search className="svg-icon" strokeWidth={2.3} />
          </span>
        </label>
      </div>

      <div className="feed-toolbar">
        <span className="feed-heading">Recent Activity</span>
        <span className="feed-order">
          <span
            className={`status-dot ${connectionStatus}`}
            aria-hidden="true"
          />
          <span>
            {statusLabel} · Newest first · latest 50
          </span>
        </span>
      </div>

      <div className="feed" id="feed" aria-live="polite" data-testid="wall-feed">
        {isLoading ? (
          <div className="empty">
            <strong>Loading the Wall…</strong>
            Checking local browser notes.
          </div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <WallPost
              key={post.id}
              post={post}
              demoInteractionsEnabled={WALL_CAPABILITIES.demoInteractionsEnabled}
              likesCount={demoInteractions.likesByPostId[post.id] ?? 0}
              isLiked={demoInteractions.likedPostIds.includes(post.id)}
              comments={demoInteractions.commentsByPostId[post.id] ?? []}
              commentsExpanded={expandedPostIds.includes(post.id)}
              onToggleLike={handleToggleLike}
              onToggleComments={handleToggleComments}
              onAddComment={handleAddComment}
            />
          ))
        ) : (
          <div className="empty">
            <strong>
              {trimmedSearch ? 'No matching posts' : 'No posts yet'}
            </strong>
            {trimmedSearch
              ? 'Try another search.'
              : 'Be the first to write on the Wall!'}
          </div>
        )}
      </div>

      <div className="showing" id="showing">
        {trimmedSearch
          ? `Showing ${posts.length} matching ${
              posts.length === 1 ? 'post' : 'posts'
            }`
          : `Showing ${posts.length} of ${totalCount} wall posts · Local preview stored in this browser`}
      </div>
    </>
  );
}
