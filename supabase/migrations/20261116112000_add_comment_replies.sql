ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS parent_post_id uuid NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reply_to_post_id uuid NULL REFERENCES public.board_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS board_posts_parent_idx
  ON public.board_posts (thread_id, parent_post_id, post_number);

GRANT SELECT (
  id,
  thread_id,
  post_number,
  anon_tag,
  display_name,
  parent_post_id,
  reply_to_post_id,
  message,
  created_at,
  edited_at,
  deleted_at
) ON public.board_posts TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_board_reply(
  p_user_id uuid,
  p_thread_id uuid,
  p_message text,
  p_anon_tag text,
  p_display_name text,
  p_parent_post_id uuid,
  p_reply_to_post_id uuid
)
RETURNS TABLE(
  post_id uuid,
  post_number integer,
  created_at timestamptz,
  parent_post_id uuid,
  reply_to_post_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_next_num integer;
  v_post_id uuid;
  v_target public.board_posts%ROWTYPE;
  v_parent public.board_posts%ROWTYPE;
  v_effective_parent_id uuid := NULL;
  v_effective_reply_to_id uuid := NULL;
BEGIN
  -- Serialize reply numbering per thread.
  PERFORM 1 FROM public.board_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THREAD_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_parent_post_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.board_posts
    WHERE id = p_parent_post_id AND thread_id = p_thread_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PARENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_target.post_number = 1 THEN
      RAISE EXCEPTION 'CANNOT_REPLY_TO_OP' USING ERRCODE = '22023';
    END IF;

    IF v_target.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'PARENT_DELETED' USING ERRCODE = 'P0001';
    END IF;

    IF v_target.parent_post_id IS NOT NULL THEN
      SELECT * INTO v_parent
      FROM public.board_posts
      WHERE id = v_target.parent_post_id AND thread_id = p_thread_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'PARENT_NOT_FOUND' USING ERRCODE = 'P0002';
      END IF;

      v_effective_parent_id := v_parent.id;
      v_effective_reply_to_id := COALESCE(p_reply_to_post_id, v_target.id);
    ELSE
      v_effective_parent_id := v_target.id;
      v_effective_reply_to_id := COALESCE(p_reply_to_post_id, v_target.id);
    END IF;

    IF v_effective_reply_to_id IS NOT NULL THEN
      PERFORM 1
      FROM public.board_posts
      WHERE id = v_effective_reply_to_id
        AND thread_id = p_thread_id
        AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'REPLY_TARGET_INVALID' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(MAX(bp.post_number), 0) + 1
  INTO v_next_num
  FROM public.board_posts bp
  WHERE bp.thread_id = p_thread_id;

  INSERT INTO public.board_posts (
    thread_id,
    post_number,
    author_user_id,
    anon_tag,
    display_name,
    parent_post_id,
    reply_to_post_id,
    message,
    created_at
  )
  VALUES (
    p_thread_id,
    v_next_num,
    p_user_id,
    p_anon_tag,
    p_display_name,
    v_effective_parent_id,
    v_effective_reply_to_id,
    p_message,
    v_now
  )
  RETURNING id INTO v_post_id;

  UPDATE public.board_threads
  SET reply_count = v_next_num, bumped_at = v_now
  WHERE id = p_thread_id;

  RETURN QUERY SELECT v_post_id, v_next_num, v_now, v_effective_parent_id, v_effective_reply_to_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_board_reply(uuid, uuid, text, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_board_reply(uuid, uuid, text, text, text, uuid, uuid)
  TO service_role;
