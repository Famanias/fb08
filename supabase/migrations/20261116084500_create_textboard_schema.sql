-- WALL/08 anonymous community textboard schema, column-restricted RLS, atomic RPCs, and Realtime publication.

-- Retire legacy guestbook table from public roles without destructive DROP.
DO $$
BEGIN
  IF to_regclass('public.posts') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.posts FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.board_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  username_lower text GENERATED ALWAYS AS (lower(username)) STORED UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT board_users_username_trimmed_len
    CHECK (username = btrim(username) AND char_length(username) BETWEEN 1 AND 24)
);

CREATE TABLE IF NOT EXISTS public.board_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE RESTRICT,
  reply_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  bumped_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT board_threads_title_trimmed_len
    CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT board_threads_reply_count_positive
    CHECK (reply_count >= 1)
);

CREATE INDEX IF NOT EXISTS board_threads_bumped_idx
  ON public.board_threads (bumped_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.board_threads(id) ON DELETE CASCADE,
  post_number integer NOT NULL,
  author_user_id uuid NOT NULL REFERENCES public.board_users(id) ON DELETE RESTRICT,
  anon_tag text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,
  CONSTRAINT board_posts_thread_number_unique UNIQUE (thread_id, post_number),
  CONSTRAINT board_posts_post_number_positive CHECK (post_number >= 1),
  CONSTRAINT board_posts_anon_tag_hex CHECK (anon_tag ~ '^[0-9a-f]{4,8}$'),
  CONSTRAINT board_posts_message_trimmed_len
    CHECK (message = btrim(message) AND char_length(message) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS board_posts_thread_number_idx
  ON public.board_posts (thread_id, post_number ASC);

CREATE TABLE IF NOT EXISTS public.board_post_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  previous_message text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_post_edits_post_edited_idx
  ON public.board_post_edits (post_id, edited_at DESC, id DESC);

-- Enable RLS on all textboard tables.
ALTER TABLE public.board_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_post_edits ENABLE ROW LEVEL SECURITY;

-- Strip default privileges so private fields (username, password_hash, author_user_id) are never exposed.
REVOKE ALL ON TABLE public.board_users FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.board_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.board_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.board_post_edits FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, title, reply_count, created_at, bumped_at)
  ON TABLE public.board_threads TO anon, authenticated;
GRANT SELECT (id, thread_id, post_number, anon_tag, message, created_at, edited_at, deleted_at)
  ON TABLE public.board_posts TO anon, authenticated;
GRANT SELECT (id, post_id, previous_message, edited_at)
  ON TABLE public.board_post_edits TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'board_users' AND policyname = 'board_users_deny_all'
  ) THEN
    CREATE POLICY "board_users_deny_all"
      ON public.board_users FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'board_threads' AND policyname = 'board_threads_select_public'
  ) THEN
    CREATE POLICY "board_threads_select_public"
      ON public.board_threads FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'board_posts' AND policyname = 'board_posts_select_public'
  ) THEN
    CREATE POLICY "board_posts_select_public"
      ON public.board_posts FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'board_post_edits' AND policyname = 'board_post_edits_select_public'
  ) THEN
    CREATE POLICY "board_post_edits_select_public"
      ON public.board_post_edits FOR SELECT TO anon, authenticated USING (true);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.create_board_thread(
  p_thread_id uuid,
  p_user_id uuid,
  p_title text,
  p_message text,
  p_anon_tag text
)
RETURNS TABLE(thread_id uuid, post_id uuid, created_at timestamptz, bumped_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_post_id uuid;
BEGIN
  INSERT INTO public.board_threads (id, title, author_user_id, reply_count, created_at, bumped_at)
  VALUES (p_thread_id, p_title, p_user_id, 1, v_now, v_now);

  INSERT INTO public.board_posts (thread_id, post_number, author_user_id, anon_tag, message, created_at)
  VALUES (p_thread_id, 1, p_user_id, p_anon_tag, p_message, v_now)
  RETURNING id INTO v_post_id;

  RETURN QUERY SELECT p_thread_id, v_post_id, v_now, v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_board_reply(
  p_user_id uuid,
  p_thread_id uuid,
  p_message text,
  p_anon_tag text
)
RETURNS TABLE(post_id uuid, post_number integer, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_next_num integer;
  v_post_id uuid;
BEGIN
  -- Serialize reply numbering per thread.
  PERFORM 1 FROM public.board_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(MAX(bp.post_number), 0) + 1
  INTO v_next_num
  FROM public.board_posts bp
  WHERE bp.thread_id = p_thread_id;

  INSERT INTO public.board_posts (thread_id, post_number, author_user_id, anon_tag, message, created_at)
  VALUES (p_thread_id, v_next_num, p_user_id, p_anon_tag, p_message, v_now)
  RETURNING id INTO v_post_id;

  UPDATE public.board_threads
  SET reply_count = v_next_num, bumped_at = v_now
  WHERE id = p_thread_id;

  RETURN QUERY SELECT v_post_id, v_next_num, v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.edit_board_post(
  p_user_id uuid,
  p_post_id uuid,
  p_new_message text
)
RETURNS TABLE(status text, post_id uuid, edited_at timestamptz, edit_id uuid, previous_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.board_posts%ROWTYPE;
  v_now timestamptz := now();
  v_edit_id uuid;
BEGIN
  SELECT * INTO v_row
  FROM public.board_posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_row.author_user_id <> p_user_id THEN
    RETURN QUERY SELECT 'forbidden'::text, v_row.id, NULL::timestamptz, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'deleted'::text, v_row.id, NULL::timestamptz, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.board_post_edits (post_id, previous_message, edited_at)
  VALUES (v_row.id, v_row.message, v_now)
  RETURNING id INTO v_edit_id;

  UPDATE public.board_posts
  SET message = p_new_message, edited_at = v_now
  WHERE id = v_row.id;

  RETURN QUERY SELECT 'ok'::text, v_row.id, v_now, v_edit_id, v_row.message;
END;
$$;

REVOKE ALL ON FUNCTION public.create_board_thread(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_board_reply(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_board_post(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_board_thread(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_board_reply(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.edit_board_post(uuid, uuid, text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_threads;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_posts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_post_edits'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_post_edits;
  END IF;
END
$$;
