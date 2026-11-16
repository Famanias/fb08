import { getSupabaseBrowserClient } from '@/lib/supabase-config';
import { validateMediaUpload } from './profile-rules';
import {
  FollowRelationship,
  PostVisibility,
  ProfileDirectoryEntry,
  ProfileMediaType,
  ProfilePost,
  ProfilePostComment,
  ProfileSummary,
} from './profile.types';

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const msg =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new Error(msg);
  }

  return body as T;
}

export async function listProfiles(query: string = ''): Promise<ProfileDirectoryEntry[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const data = await requestJson<{ profiles: ProfileDirectoryEntry[] }>(`/api/profiles${qs}`);
  return data.profiles;
}

export async function fetchProfile(username: string): Promise<{
  profile: ProfileSummary;
  posts: ProfilePost[];
}> {
  return requestJson<{ profile: ProfileSummary; posts: ProfilePost[] }>(
    `/api/profiles/${encodeURIComponent(username)}`
  );
}

export async function uploadProfileMedia(
  kind: 'avatar' | 'post',
  file: File
): Promise<{ path: string; mediaType: ProfileMediaType }> {
  const localCheck = validateMediaUpload(kind, file.type, file.size);
  if (!localCheck.valid) {
    throw new Error(localCheck.error);
  }

  const signed = await requestJson<{
    path: string;
    signedUrl: string;
    token: string;
    mediaType: ProfileMediaType;
  }>('/api/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });

  const { client } = getSupabaseBrowserClient();
  if (client) {
    const { error } = await client.storage
      .from('board-media')
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type,
      });
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  } else {
    const putRes = await fetch(signed.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`Upload failed (${putRes.status}).`);
    }
  }

  return { path: signed.path, mediaType: signed.mediaType };
}

export async function updateMyAvatar(
  avatarPath: string | null
): Promise<{ avatarUrl: string | null }> {
  return requestJson<{ avatarUrl: string | null }>('/api/profiles/me/avatar', {
    method: 'PATCH',
    body: JSON.stringify({ avatarPath }),
  });
}

export async function setFollowState(
  username: string,
  follow: boolean
): Promise<{
  followerCount: number;
  followingCount: number;
  friendCount: number;
  relationship: FollowRelationship;
  friends: Array<{ id: string; username: string; avatarUrl: string | null }>;
}> {
  return requestJson(`/api/profiles/${encodeURIComponent(username)}/follow`, {
    method: follow ? 'POST' : 'DELETE',
  });
}

export async function createProfilePost(input: {
  body: string;
  visibility: PostVisibility;
  mediaPath?: string | null;
  mediaType?: ProfileMediaType | null;
  sharedPostId?: string | null;
}): Promise<ProfilePost> {
  const data = await requestJson<{ post: ProfilePost }>('/api/profile-posts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.post;
}

export async function updateProfilePost(
  postId: string,
  patch: { body?: string; visibility?: PostVisibility }
): Promise<ProfilePost> {
  const data = await requestJson<{ post: ProfilePost }>(
    `/api/profile-posts/${encodeURIComponent(postId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }
  );
  return data.post;
}

export async function deleteProfilePost(postId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/profile-posts/${encodeURIComponent(postId)}`,
    { method: 'DELETE' }
  );
}

export async function createProfileComment(
  postId: string,
  input: {
    body: string;
    parentCommentId?: string | null;
    replyToCommentId?: string | null;
  }
): Promise<ProfilePostComment> {
  const data = await requestJson<{ comment: ProfilePostComment }>(
    `/api/profile-posts/${encodeURIComponent(postId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return data.comment;
}

export async function deleteProfileComment(
  commentId: string
): Promise<{ postId: string; deleted_at: string }> {
  return requestJson<{ ok: boolean; postId: string; deleted_at: string }>(
    `/api/profile-comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' }
  );
}

export function subscribeProfileSignal(
  onRefreshSignal: (targetUsername: string) => void
): {
  notifyProfileChanged: (targetUsername: string) => void;
  unsubscribe: () => void;
} {
  const { client } = getSupabaseBrowserClient();
  if (!client) {
    return {
      notifyProfileChanged: () => {},
      unsubscribe: () => {},
    };
  }

  let closed = false;
  const channel = client
    .channel(`profile-signals-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    .on('broadcast', { event: 'profile-refresh' }, (msg) => {
      if (closed) return;
      const username = (msg?.payload as { username?: unknown } | undefined)?.username;
      if (typeof username === 'string' && username) {
        onRefreshSignal(username);
      }
    })
    .subscribe();

  return {
    notifyProfileChanged: (targetUsername: string) => {
      if (closed) return;
      void channel.send({
        type: 'broadcast',
        event: 'profile-refresh',
        payload: { username: targetUsername },
      });
    },
    unsubscribe: () => {
      closed = true;
      void client.removeChannel(channel);
    },
  };
}
