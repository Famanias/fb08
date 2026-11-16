export type PostVisibility = 'public' | 'friends' | 'only_me';

export type ProfileMediaType = 'image' | 'video';

export interface FollowRelationship {
  isFollowing: boolean;
  followsViewer: boolean;
  isFriend: boolean;
}

export interface ProfileDirectoryEntry {
  id: string;
  username: string;
  avatarUrl: string | null;
  friendCount: number;
  followerCount: number;
  relationship: FollowRelationship;
}

export interface ProfileSummary {
  id: string;
  username: string;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  friendCount: number;
  relationship: FollowRelationship;
  isMe: boolean;
  friends: Array<{ id: string; username: string; avatarUrl: string | null }>;
}

export interface ProfilePostComment {
  id: string;
  post_id: string;
  author_username: string;
  author_avatar_url: string | null;
  parent_comment_id: string | null;
  reply_to_comment_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  is_mine: boolean;
}

export interface ProfileCommentGroup {
  comment: ProfilePostComment;
  replies: ProfilePostComment[];
}

export interface SharedPostPreview {
  id: string;
  available: boolean;
  author_username?: string;
  author_avatar_url?: string | null;
  body?: string;
  media_url?: string | null;
  media_type?: ProfileMediaType | null;
  created_at?: string;
  reason?: string;
}

export interface ProfilePost {
  id: string;
  author_username: string;
  author_avatar_url: string | null;
  visibility: PostVisibility;
  body: string;
  media_url: string | null;
  media_type: ProfileMediaType | null;
  shared_post: SharedPostPreview | null;
  can_share: boolean;
  created_at: string;
  edited_at: string | null;
  is_mine: boolean;
  comments: ProfilePostComment[];
}
