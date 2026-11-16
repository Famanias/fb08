-- Additive extension: no Board, People, auth, or profile table is modified.
begin;

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100 and title = btrim(title)),
  description text not null check (char_length(btrim(description)) between 1 and 2000 and description = btrim(description)),
  price numeric(12,2) not null check (price >= 0 and price < 1000000000),
  currency text not null default 'PHP' check (currency = 'PHP'),
  category text not null check (category in ('Electronics','Furniture','Clothing','Books','Sports','Home','Other')),
  seller_display_name text not null default 'Guest Seller' check (char_length(btrim(seller_display_name)) between 1 and 50),
  image_path text not null unique check (image_path ~ '^listings/[0-9a-f-]{36}\.webp$'),
  status text not null default 'active' check (status in ('active','sold','removed')),
  created_at timestamptz not null default now()
);
create index marketplace_listings_newest on public.marketplace_listings (created_at desc, id desc) where status = 'active';
create index marketplace_listings_category on public.marketplace_listings (category, created_at desc, id desc) where status = 'active';
create index marketplace_listings_price on public.marketplace_listings (price, id) where status = 'active';

create table public.marketplace_listing_contacts (
  listing_id uuid primary key references public.marketplace_listings(id) on delete cascade,
  seller_email text not null check (char_length(seller_email) <= 254 and seller_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
create table public.marketplace_inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  buyer_name text check (char_length(buyer_name) <= 50),
  buyer_email text not null check (char_length(buyer_email) <= 254 and buyer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message text not null check (char_length(btrim(message)) between 1 and 1000 and message = btrim(message)),
  created_at timestamptz not null default now()
);
create index marketplace_inquiries_listing on public.marketplace_inquiries (listing_id, created_at desc);

-- Idempotency and abuse state are private and shared across serverless instances.
create table public.marketplace_requests (
  request_key uuid primary key,
  kind text not null check (kind in ('listing','inquiry')),
  fingerprint text not null,
  result_id uuid not null,
  created_at timestamptz not null default now()
);
create table public.marketplace_rate_limits (
  actor_hash text not null,
  action text not null,
  window_start timestamptz not null,
  hits integer not null check (hits > 0),
  primary key (actor_hash, action, window_start)
);
create index marketplace_rate_limits_expiry on public.marketplace_rate_limits (window_start);

alter table public.marketplace_listings enable row level security;
alter table public.marketplace_listing_contacts enable row level security;
alter table public.marketplace_inquiries enable row level security;
alter table public.marketplace_requests enable row level security;
alter table public.marketplace_rate_limits enable row level security;
revoke all on public.marketplace_listings, public.marketplace_listing_contacts, public.marketplace_inquiries, public.marketplace_requests, public.marketplace_rate_limits from public, anon, authenticated;
grant select on public.marketplace_listings to anon, authenticated;
grant all on public.marketplace_listings, public.marketplace_listing_contacts, public.marketplace_inquiries, public.marketplace_requests, public.marketplace_rate_limits to service_role;
create policy marketplace_public_active on public.marketplace_listings for select to anon, authenticated using (status = 'active');

create function public.marketplace_consume_rate(p_actor text, p_action text, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_hits integer;
begin
  delete from public.marketplace_rate_limits where window_start < date_trunc('hour', now()) - interval '2 hours';
  insert into public.marketplace_rate_limits(actor_hash,action,window_start,hits)
  values(p_actor,p_action,date_trunc('hour',now()),1)
  on conflict(actor_hash,action,window_start) do update set hits = public.marketplace_rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

create function public.marketplace_publish(p_key uuid, p_fingerprint text, p_id uuid, p_image_path text, p_input jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_existing public.marketplace_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select * into v_existing from public.marketplace_requests where request_key=p_key;
  if found then
    if v_existing.kind <> 'listing' or v_existing.fingerprint <> p_fingerprint then raise exception 'request_conflict'; end if;
    return v_existing.result_id;
  end if;
  if p_image_path <> 'listings/' || p_id::text || '.webp' then raise exception 'invalid_photo'; end if;
  if not exists(select 1 from storage.objects where bucket_id='marketplace-images' and name=p_image_path) then raise exception 'missing_photo'; end if;
  insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path)
  values(p_id,p_input->>'title',p_input->>'description',(p_input->>'price')::numeric,p_input->>'category',p_input->>'sellerDisplayName',p_image_path);
  insert into public.marketplace_listing_contacts(listing_id,seller_email) values(p_id,p_input->>'sellerEmail');
  insert into public.marketplace_requests(request_key,kind,fingerprint,result_id) values(p_key,'listing',p_fingerprint,p_id);
  return p_id;
end;
$$;

create function public.marketplace_save_inquiry(p_key uuid, p_fingerprint text, p_input jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_existing public.marketplace_requests; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select * into v_existing from public.marketplace_requests where request_key=p_key;
  if found then
    if v_existing.kind <> 'inquiry' or v_existing.fingerprint <> p_fingerprint then raise exception 'request_conflict'; end if;
    return v_existing.result_id;
  end if;
  perform 1 from public.marketplace_listings where id=(p_input->>'listingId')::uuid and status='active' for share;
  if not found then raise exception 'listing_unavailable'; end if;
  insert into public.marketplace_inquiries(listing_id,buyer_name,buyer_email,message)
  values((p_input->>'listingId')::uuid,nullif(p_input->>'buyerName',''),p_input->>'buyerEmail',p_input->>'message') returning id into v_id;
  insert into public.marketplace_requests(request_key,kind,fingerprint,result_id) values(p_key,'inquiry',p_fingerprint,v_id);
  return v_id;
end;
$$;

revoke all on function public.marketplace_consume_rate(text,text,integer), public.marketplace_publish(uuid,text,uuid,text,jsonb), public.marketplace_save_inquiry(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.marketplace_consume_rate(text,text,integer), public.marketplace_publish(uuid,text,uuid,text,jsonb), public.marketplace_save_inquiry(uuid,text,jsonb) to service_role;

-- Only server-reencoded WebP images; no public INSERT/UPDATE/DELETE policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('marketplace-images','marketplace-images',true,3145728,array['image/webp']);

commit;
