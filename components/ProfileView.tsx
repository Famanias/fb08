'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Users } from 'lucide-react';
import { MAX_POST_LENGTH } from '@/features/board/board-rules';
import { BoardUser } from '@/features/board/board.types';
import { validateMediaUpload } from '@/features/profile/profile-rules';
import {
  PostVisibility,
  ProfilePost,
  ProfileSummary,
} from '@/features/profile/profile.types';
import { getAvatarColors, getInitials } from '@/lib/initials';
import { ProfilePostItem } from './ProfilePostItem';

interface ProfileViewProps {
  username: string;
  viewer: BoardUser | null;
  profile: ProfileSummary | null;
  posts: ProfilePost[];
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBackToBoard: () => void;
  onOpenProfile: (username: string) => void;
  onClearError: () => void;
  onUploadAvatar: (file: File) => Promise<boolean>;
  onRemoveAvatar: () => Promise<boolean>;
  onToggleFollow: (username: string, follow: boolean) => Promise<boolean>;
  onPublishPost: (input: {
    body: string;
    visibility: PostVisibility;
    file?: File | null;
    sharedPostId?: string | null;
  }) => Promise<boolean>;
  onUpdatePost: (
    postId: string,
    patch: { body?: string; visibility?: PostVisibility }
  ) => Promise<boolean>;
  onDeletePost: (postId: string) => Promise<boolean>;
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

export function ProfileView({
  username,
  viewer,
  profile,
  posts,
  isLoading,
  isSubmitting,
  errorMessage,
  onBackToBoard,
  onOpenProfile,
  onClearError,
  onUploadAvatar,
  onRemoveAvatar,
  onToggleFollow,
  onPublishPost,
  onUpdatePost,
  onDeletePost,
  onAddComment,
  onDeleteComment,
}: ProfileViewProps) {
  const [postBody, setPostBody] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewKind, setPreviewKind] = useState<'image' | 'video' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const avatarColors = useMemo(
    () => getAvatarColors(profile?.username ?? username),
    [profile?.username, username]
  );

  function clearSelectedMedia() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewKind(null);
    setPreviewUrl(null);
    if (mediaInputRef.current) mediaInputRef.current.value = '';
  }

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const check = validateMediaUpload('avatar', file.type, file.size);
    if (!check.valid) {
      setLocalError(check.error);
      return;
    }
    setLocalError(null);
    await onUploadAvatar(file);
  }

  function handlePostMediaChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const check = validateMediaUpload('post', file.type, file.size);
    if (!check.valid) {
      setLocalError(check.error);
      e.target.value = '';
      return;
    }
    setLocalError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewKind(check.mediaType);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handlePublishSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    const trimmed = postBody.trim();
    if (!trimmed && !selectedFile) {
      setLocalError('Write something or attach an image/video before posting.');
      return;
    }
    setLocalError(null);
    const ok = await onPublishPost({
      body: trimmed,
      visibility,
      file: selectedFile,
    });
    if (ok) {
      setPostBody('');
      clearSelectedMedia();
    }
  }

  const combinedError = localError ?? errorMessage;

  return (
    <section aria-label="User profile" data-profile-username={username}>
      <div className="thread-view-header">
        <div>
          <button
            type="button"
            id="back-to-board-from-profile"
            className="subtle-action"
            onClick={onBackToBoard}
          >
            ← Back to Board
          </button>
          <h1 className="thread-view-title" id="profile-page-username">
            {profile?.username ?? username}
          </h1>
        </div>
      </div>

      {combinedError ? (
        <div className="inline-alert" role="alert" style={{ marginBottom: 12 }}>
          <span>{combinedError}</span>
          <button
            type="button"
            className="small-btn"
            onClick={() => {
              setLocalError(null);
              onClearError();
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {isLoading && !profile ? (
        <div className="empty">
          <strong>Loading profile...</strong>
          Fetching posts and connections.
        </div>
      ) : !profile ? (
        <div className="empty">
          <strong>Profile not found</strong>
          No member with that username exists yet.
        </div>
      ) : (
        <>
          <div className="profile-hero-card">
            <div className="profile-avatar-col">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={`${profile.username} profile picture`}
                  id="profile-hero-avatar-img"
                  className="profile-hero-avatar"
                />
              ) : (
                <div
                  className="profile-hero-avatar profile-hero-initials"
                  style={{ background: avatarColors[0], color: avatarColors[1] }}
                >
                  {getInitials(profile.username)}
                </div>
              )}

              {profile.isMe ? (
                <div className="profile-avatar-actions">
                  <input
                    ref={avatarInputRef}
                    id="avatar-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => void handleAvatarChange(e)}
                  />
                  <button
                    type="button"
                    id="upload-avatar-btn"
                    className="btn-secondary"
                    disabled={isSubmitting}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    <Camera className="svg-icon" style={{ marginRight: 4 }} />
                    {isSubmitting ? 'Uploading...' : 'Upload Photo'}
                  </button>
                  {profile.avatarUrl ? (
                    <button
                      type="button"
                      className="small-btn"
                      disabled={isSubmitting}
                      onClick={() => void onRemoveAvatar()}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="profile-hero-info">
              <div className="profile-badges-row">
                {profile.isMe ? (
                  <span className="mine-badge">Your Profile</span>
                ) : (
                  <>
                    {profile.relationship.isFriend ? (
                      <span className="friend-badge" id="profile-friend-badge">
                        <Users className="svg-icon" style={{ marginRight: 4 }} />
                        Friends ✓
                      </span>
                    ) : profile.relationship.followsViewer ? (
                      <span className="follow-hint-badge">Follows you</span>
                    ) : null}
                    {profile.relationship.isFollowing && !profile.relationship.isFriend ? (
                      <span className="follow-hint-badge">Following</span>
                    ) : null}
                  </>
                )}
              </div>

              <div className="profile-stats-row">
                <span>
                  <strong>{profile.friendCount}</strong>{' '}
                  {profile.friendCount === 1 ? 'Friend' : 'Friends'}
                </span>
                <span>·</span>
                <span>
                  <strong>{profile.followingCount}</strong> Following
                </span>
                <span>·</span>
                <span>
                  <strong>{profile.followerCount}</strong>{' '}
                  {profile.followerCount === 1 ? 'Follower' : 'Followers'}
                </span>
              </div>

              {!profile.isMe && viewer ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    id="follow-toggle-btn"
                    className={
                      profile.relationship.isFollowing ? 'btn-secondary' : 'btn-share'
                    }
                    disabled={isSubmitting}
                    onClick={() =>
                      void onToggleFollow(profile.username, !profile.relationship.isFollowing)
                    }
                  >
                    {profile.relationship.isFollowing
                      ? profile.relationship.isFriend
                        ? 'Unfollow (Friends ✓)'
                        : 'Following (Unfollow)'
                      : profile.relationship.followsViewer
                        ? 'Follow Back · Become Friends'
                        : 'Follow'}
                  </button>
                </div>
              ) : !viewer ? (
                <p className="auth-note" style={{ marginTop: 8 }}>
                  Sign in to follow {profile.username}, become friends, or comment/share.
                </p>
              ) : null}

              {profile.friends.length > 0 ? (
                <div className="profile-friends-strip">
                  <div className="profile-friends-label">Mutual Friends:</div>
                  <div className="profile-friends-chips">
                    {profile.friends.map((friend) => (
                      <button
                        key={friend.id}
                        type="button"
                        className="friend-chip-btn"
                        onClick={() => onOpenProfile(friend.username)}
                      >
                        {friend.username}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {profile.isMe ? (
            <form className="composer" onSubmit={handlePublishSubmit}>
              <div className="board-box-head" style={{ margin: '-12px -13px 10px -13px' }}>
                <span>+ Post to Your Profile</span>
                <span className="privacy">Images &amp; videos up to 25 MB</span>
              </div>
              <textarea
                id="profile-post-body"
                rows={3}
                maxLength={MAX_POST_LENGTH}
                placeholder={`What's on your mind, ${profile.username}?`}
                value={postBody}
                onChange={(e) => {
                  setPostBody(e.target.value);
                  if (localError) setLocalError(null);
                }}
              />

              {previewUrl ? (
                <div className="profile-draft-preview">
                  {previewKind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="Selected upload preview"
                      className="profile-media-img"
                    />
                  ) : (
                    <video
                      src={previewUrl}
                      controls
                      preload="metadata"
                      className="profile-media-video"
                    />
                  )}
                  <div className="profile-draft-meta">
                    <span>
                      {selectedFile?.name} (
                      {((selectedFile?.size ?? 0) / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                    <button
                      type="button"
                      className="small-btn"
                      onClick={clearSelectedMedia}
                    >
                      Remove media
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="composer-tools" style={{ marginTop: 8 }}>
                <div className="tool-left">
                  <input
                    ref={mediaInputRef}
                    id="profile-media-input"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                    style={{ display: 'none' }}
                    onChange={handlePostMediaChange}
                  />
                  <button
                    type="button"
                    id="profile-media-btn"
                    className="btn-secondary"
                    disabled={isSubmitting}
                    onClick={() => mediaInputRef.current?.click()}
                  >
                    <ImagePlus className="svg-icon" style={{ marginRight: 4 }} />
                    Photo / Video
                  </button>

                  <label style={{ fontSize: 11, color: '#4f5f78', fontWeight: 'bold' }}>
                    Audience:{' '}
                    <select
                      id="profile-post-visibility"
                      className="visibility-select-mini"
                      value={visibility}
                      disabled={isSubmitting}
                      onChange={(e) => setVisibility(e.target.value as PostVisibility)}
                    >
                      <option value="public">Public</option>
                      <option value="friends">Friends only</option>
                      <option value="only_me">Only me</option>
                    </select>
                  </label>
                </div>

                <div className="tool-right">
                  <span className="counter">
                    {MAX_POST_LENGTH - postBody.length} left
                  </span>
                  <button
                    type="submit"
                    id="profile-post-submit"
                    className="btn-share"
                    disabled={isSubmitting || (!postBody.trim() && !selectedFile)}
                  >
                    {isSubmitting ? 'Posting...' : 'Post'}
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          <div className="feed-toolbar">
            <span className="feed-heading">
              {profile.username}&apos;s Profile Posts ({posts.length})
            </span>
          </div>

          <div className="feed" role="region" aria-live="polite">
            {posts.length === 0 ? (
              <div className="empty">
                <strong>No visible posts yet</strong>
                {profile.isMe
                  ? 'Share a status, photo, or video above.'
                  : profile.relationship.isFriend
                    ? `${profile.username} has not posted anything visible yet.`
                    : `Only public posts are visible unless you and ${profile.username} follow each other as Friends.`}
              </div>
            ) : (
              posts.map((post) => (
                <ProfilePostItem
                  key={post.id}
                  post={post}
                  viewer={viewer}
                  onOpenProfile={onOpenProfile}
                  onUpdatePost={onUpdatePost}
                  onDeletePost={onDeletePost}
                  onSharePost={onPublishPost}
                  onAddComment={onAddComment}
                  onDeleteComment={onDeleteComment}
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
