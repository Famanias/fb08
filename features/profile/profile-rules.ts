import {
  PostVisibility,
  ProfileCommentGroup,
  ProfileMediaType,
  ProfilePostComment,
} from './profile.types';

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_PROFILE_POST_BODY_LENGTH = 2000;

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const VIDEO_MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function isValidVisibility(value: unknown): value is PostVisibility {
  return value === 'public' || value === 'friends' || value === 'only_me';
}

export function getVisibilityLabel(visibility: PostVisibility): string {
  switch (visibility) {
    case 'public':
      return 'Public';
    case 'friends':
      return 'Friends only';
    case 'only_me':
      return 'Only me';
  }
}

export function isFriendFromFollows(
  viewerFollowsTarget: boolean,
  targetFollowsViewer: boolean
): boolean {
  return viewerFollowsTarget && targetFollowsViewer;
}

export function canViewProfilePost(
  visibility: PostVisibility,
  viewerId: string | null,
  ownerId: string,
  isFriend: boolean
): boolean {
  if (viewerId && viewerId === ownerId) {
    return true;
  }
  switch (visibility) {
    case 'public':
      return true;
    case 'friends':
      return isFriend;
    case 'only_me':
      return false;
  }
}

export function canShareProfilePost(visibility: PostVisibility): boolean {
  return visibility === 'public';
}

export type MediaValidationResult =
  | { valid: true; mediaType: ProfileMediaType; extension: string }
  | { valid: false; error: string };

export function validateMediaUpload(
  kind: 'avatar' | 'post',
  mimeType: string,
  sizeBytes: number
): MediaValidationResult {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, error: 'Please select a non-empty file.' };
  }
  if (sizeBytes > MAX_MEDIA_BYTES) {
    return { valid: false, error: 'Media upload must be 25 MB or less.' };
  }

  const normalizedMime = mimeType.trim().toLowerCase();
  const imageExt = IMAGE_MIME_TO_EXT[normalizedMime];
  if (imageExt) {
    return { valid: true, mediaType: 'image', extension: imageExt };
  }

  if (kind === 'avatar') {
    return {
      valid: false,
      error: 'Profile pictures must be a JPG, PNG, GIF, or WebP image.',
    };
  }

  const videoExt = VIDEO_MIME_TO_EXT[normalizedMime];
  if (videoExt) {
    return { valid: true, mediaType: 'video', extension: videoExt };
  }

  return {
    valid: false,
    error: 'Supported media: JPG, PNG, GIF, WebP images and MP4, WebM, MOV videos.',
  };
}

export function validateProfilePostInput(input: {
  body: string;
  visibility: unknown;
  mediaPath?: string | null;
  mediaType?: unknown;
  sharedPostId?: string | null;
}):
  | {
      valid: true;
      body: string;
      visibility: PostVisibility;
      mediaPath: string | null;
      mediaType: ProfileMediaType | null;
      sharedPostId: string | null;
    }
  | { valid: false; error: string } {
  if (!isValidVisibility(input.visibility)) {
    return { valid: false, error: 'Visibility must be public, friends, or only_me.' };
  }

  const trimmedBody = input.body.trim();
  if (trimmedBody.length > MAX_PROFILE_POST_BODY_LENGTH) {
    return {
      valid: false,
      error: `Post text must be ${MAX_PROFILE_POST_BODY_LENGTH} characters or less.`,
    };
  }

  const mediaPath = input.mediaPath ? input.mediaPath.trim() : null;
  const mediaType =
    input.mediaType === 'image' || input.mediaType === 'video' ? input.mediaType : null;
  if ((mediaPath && !mediaType) || (!mediaPath && mediaType)) {
    return { valid: false, error: 'Uploaded media requires both path and type.' };
  }

  const sharedPostId = input.sharedPostId ? input.sharedPostId.trim() : null;
  if (!trimmedBody && !mediaPath && !sharedPostId) {
    return {
      valid: false,
      error: 'Add text, upload an image/video, or share a public post.',
    };
  }

  return {
    valid: true,
    body: trimmedBody,
    visibility: input.visibility,
    mediaPath,
    mediaType,
    sharedPostId,
  };
}

export function groupProfileComments(comments: ProfilePostComment[]): {
  groups: ProfileCommentGroup[];
  commentCount: number;
  replyCount: number;
} {
  const ordered = [...comments].sort((a, b) => {
    const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const topComments: ProfilePostComment[] = [];
  const repliesByParent = new Map<string, ProfilePostComment[]>();
  let replyCount = 0;

  for (const comment of ordered) {
    if (!comment.parent_comment_id) {
      topComments.push(comment);
    } else {
      replyCount += 1;
      const list = repliesByParent.get(comment.parent_comment_id) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parent_comment_id, list);
    }
  }

  const groups = topComments.map((comment) => ({
    comment,
    replies: repliesByParent.get(comment.id) ?? [],
  }));

  return {
    groups,
    commentCount: topComments.length,
    replyCount,
  };
}
