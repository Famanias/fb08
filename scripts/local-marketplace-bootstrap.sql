-- Minimal test doubles for Supabase Storage catalog only; never apply to a hosted project.
-- The runner verifies a labeled, owned disposable Docker container and empty database first.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, unique(bucket_id,name));
grant usage on schema storage to service_role;
grant all on storage.buckets, storage.objects to service_role;
