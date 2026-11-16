INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'board-media',
  'board-media',
  false,
  26214400,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.board_users
  ADD COLUMN IF NOT EXISTS avatar_path text NULL;

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT user_follows_no_self CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS user_follows_following_idx
  ON public.user_follows (following_id, follower_id);

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_follows FROM PUBLIC, anon, authenticated;
CREATE POLICY user_follows_deny_all ON public.user_follows
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.profile_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'public'
    CONSTRAINT profile_posts_visibility_valid CHECK (visibility IN ('public', 'friends', 'only_me')),
  body text NOT NULL DEFAULT ''
    CONSTRAINT profile_posts_body_len CHECK (char_length(body) <= 2000),
  media_path text NULL,
  media_type text NULL
    CONSTRAINT profile_posts_media_type_valid CHECK (media_type IS NULL OR media_type IN ('image', 'video')),
  shared_post_id uuid NULL REFERENCES public.profile_posts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  CONSTRAINT profile_posts_has_content CHECK (
    btrim(body) <> '' OR media_path IS NOT NULL OR shared_post_id IS NOT NULL
  ),
  CONSTRAINT profile_posts_media_pair CHECK (
    (media_path IS NULL AND media_type IS NULL)
    OR (media_path IS NOT NULL AND media_type IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS profile_posts_author_created_idx
  ON public.profile_posts (author_user_id, created_at DESC, id DESC);

ALTER TABLE public.profile_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_posts FROM PUBLIC, anon, authenticated;
CREATE POLICY profile_posts_deny_all ON public.profile_posts
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.profile_post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.profile_posts(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE CASCADE,
  parent_comment_id uuid NULL REFERENCES public.profile_post_comments(id) ON DELETE CASCADE,
  reply_to_comment_id uuid NULL REFERENCES public.profile_post_comments(id) ON DELETE SET NULL,
  body text NOT NULL
    CONSTRAINT profile_post_comments_body_len CHECK (btrim(body) <> '' AND char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS profile_post_comments_post_idx
  ON public.profile_post_comments (post_id, created_at ASC, id ASC);

ALTER TABLE public.profile_post_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_post_comments FROM PUBLIC, anon, authenticated;
CREATE POLICY profile_post_comments_deny_all ON public.profile_post_comments
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
