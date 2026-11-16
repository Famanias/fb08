ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS display_name text NULL
  CONSTRAINT board_posts_display_name_valid CHECK (
    display_name IS NULL
    OR (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 24)
  );

GRANT SELECT (id, thread_id, post_number, anon_tag, display_name, message, created_at, edited_at, deleted_at)
  ON public.board_posts TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_board_thread(
  p_thread_id uuid,
  p_user_id uuid,
  p_title text,
  p_message text,
  p_anon_tag text,
  p_display_name text
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

  INSERT INTO public.board_posts (thread_id, post_number, author_user_id, anon_tag, display_name, message, created_at)
  VALUES (p_thread_id, 1, p_user_id, p_anon_tag, p_display_name, p_message, v_now)
  RETURNING id INTO v_post_id;

  RETURN QUERY SELECT p_thread_id, v_post_id, v_now, v_now;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_board_reply(
  p_user_id uuid,
  p_thread_id uuid,
  p_message text,
  p_anon_tag text,
  p_display_name text
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

  INSERT INTO public.board_posts (thread_id, post_number, author_user_id, anon_tag, display_name, message, created_at)
  VALUES (p_thread_id, v_next_num, p_user_id, p_anon_tag, p_display_name, p_message, v_now)
  RETURNING id INTO v_post_id;

  UPDATE public.board_threads
  SET reply_count = v_next_num, bumped_at = v_now
  WHERE id = p_thread_id;

  RETURN QUERY SELECT v_post_id, v_next_num, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.create_board_thread(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_board_thread(uuid, uuid, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_board_reply(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_board_reply(uuid, uuid, text, text, text) TO service_role;
