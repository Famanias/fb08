-- WALL/08 public guestbook posts table, least-privilege grants, RLS, index, and Realtime publication.

CREATE TABLE IF NOT EXISTS public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_author_trimmed_len
    CHECK (author = btrim(author) AND char_length(author) BETWEEN 1 AND 24),
  CONSTRAINT posts_message_trimmed_len
    CHECK (message = btrim(message) AND char_length(message) BETWEEN 1 AND 280)
);

CREATE INDEX IF NOT EXISTS posts_created_at_id_desc_idx
  ON public.posts (created_at DESC, id DESC);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Reset default schema grants so anonymous/authenticated callers only get explicit column privileges.
REVOKE ALL ON TABLE public.posts FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.posts TO anon, authenticated;
GRANT INSERT (author, message) ON TABLE public.posts TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'posts'
      AND policyname = 'posts_select_public'
  ) THEN
    CREATE POLICY "posts_select_public"
      ON public.posts
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'posts'
      AND policyname = 'posts_insert_public'
  ) THEN
    CREATE POLICY "posts_insert_public"
      ON public.posts
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (
        author = btrim(author)
        AND char_length(author) BETWEEN 1 AND 24
        AND message = btrim(message)
        AND char_length(message) BETWEEN 1 AND 280
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  END IF;
END
$$;
