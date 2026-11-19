begin;

-- Retain legacy sellers and orders. New listings bind to a seller scoped to a
-- Board user and payment tenant within the publication transaction.
alter table public.marketplace_payment_sellers
  alter column email_normalized drop not null,
  add column user_id uuid references public.board_users(id) on delete restrict,
  add constraint marketplace_seller_identity_check check ((email_normalized is null) <> (user_id is null)),
  add constraint marketplace_seller_user_unique unique(tenant,user_id);

alter table public.marketplace_payment_inventory
  add column seller_id uuid,
  add constraint marketplace_inventory_seller_fk
    foreign key(seller_id,tenant) references public.marketplace_payment_sellers(id,tenant) on delete restrict;

create function public.marketplace_publish_owned_sandbox(
  p_key uuid,p_fingerprint text,p_id uuid,p_image_path text,p_input jsonb,p_tenant text,p_user_id uuid
)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing_id uuid; listing_id uuid; owner_id uuid;
begin
  if p_user_id is null or p_tenant is null or p_tenant !~ '^[a-zA-Z0-9_-]{1,100}$'
    or (p_input->>'inventoryKind') is distinct from 'sandbox' then raise exception 'invalid_inventory'; end if;
  -- Share the original publication lock so a retry can never claim a legacy row.
  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select r.result_id into existing_id from public.marketplace_requests r where r.request_key=p_key;
  if found then
    if not exists(select 1 from public.marketplace_payment_inventory i
      join public.marketplace_payment_sellers s on s.id=i.seller_id and s.tenant=i.tenant
      where i.listing_id=existing_id and i.tenant=p_tenant and s.user_id=p_user_id)
    then raise exception 'request_conflict'; end if;
    return public.marketplace_publish(p_key,p_fingerprint,p_id,p_image_path,p_input||jsonb_build_object('paymentTenant',p_tenant));
  end if;

  listing_id:=public.marketplace_publish(p_key,p_fingerprint,p_id,p_image_path,p_input||jsonb_build_object('paymentTenant',p_tenant));
  insert into public.marketplace_payment_sellers(tenant,user_id,verified_at)
    values(p_tenant,p_user_id,now())
    on conflict(tenant,user_id) do update set user_id=excluded.user_id
    returning id into owner_id;
  update public.marketplace_payment_inventory i set seller_id=owner_id where i.listing_id=p_id and i.tenant=p_tenant;
  if not found then raise exception 'invalid_inventory'; end if;
  return listing_id;
end $$;
revoke all on function public.marketplace_publish_owned_sandbox(uuid,text,uuid,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_publish_owned_sandbox(uuid,text,uuid,text,jsonb,text,uuid) to service_role;

create or replace function public.marketplace_reserve_order(p_tenant text,p_listing_id uuid,p_buyer_hash text,p_key uuid,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.marketplace_listings; o public.marketplace_orders; a public.marketplace_connected_accounts; oid uuid; gross bigint;
begin
  if p_tenant is null or p_now is null or p_key is null or nullif(p_buyer_hash,'') is null then raise exception 'invalid_order'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant||':'||p_buyer_hash||':'||p_key::text,0));
  select * into o from public.marketplace_orders where tenant=p_tenant and buyer_access_hash=p_buyer_hash and submission_key=p_key;
  if found then
    if o.listing_id<>p_listing_id then raise exception 'request_conflict'; end if;
    return to_jsonb(o);
  end if;
  select * into l from public.marketplace_listings where id=p_listing_id for update;
  if not found or l.status<>'active' or l.inventory_kind<>'sandbox' or not exists(select 1 from public.marketplace_payment_inventory where listing_id=l.id and tenant=p_tenant and not review_required)
  then raise exception 'listing_unavailable'; end if;
  if exists(select 1 from public.marketplace_orders where listing_id=l.id and state in ('preparing','open','review','paid')) then raise exception 'reservation_conflict'; end if;
  select account.* into a from public.marketplace_payment_inventory i
    join public.marketplace_connected_accounts account on account.seller_id=i.seller_id and account.tenant=i.tenant
    where i.listing_id=l.id and i.tenant=p_tenant for share of account;
  if not found or not a.ready or a.connection<>'ready' or a.account_id is null then raise exception 'seller_unavailable'; end if;
  gross:=(l.price*100)::bigint;
  if gross not between 10000 and 99999999 then raise exception 'amount_ineligible'; end if;
  oid:=gen_random_uuid();
  insert into public.marketplace_orders(id,tenant,listing_id,seller_id,account_id,buyer_access_hash,read_expires_at,submission_key,title,gross_minor,fee_minor,create_key,checkout_expires_at,prepared_at)
  values(oid,p_tenant,l.id,a.seller_id,a.account_id,p_buyer_hash,p_now+interval '7 days',p_key,l.title,gross,(gross+5)/10,p_tenant||':checkout:'||oid::text||':v1',floor(extract(epoch from p_now+interval '31 minutes'))::bigint,p_now) returning * into o;
  return to_jsonb(o);
end $$;

create or replace function public.marketplace_payment_display(p_listing_ids uuid[],p_tenant text,p_enabled boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('listing_id',l.id,'sandbox',l.inventory_kind='sandbox',
    'availability',case
      when l.status='sold' then 'sold'
      when l.status<>'active' or l.inventory_kind<>'sandbox' or not coalesce(p_enabled,false) or i.listing_id is null or i.review_required then 'unavailable'
      when exists(select 1 from public.marketplace_orders o where o.listing_id=l.id and o.state in ('preparing','open','review','paid')) then 'reserved'
      when a.ready and a.connection='ready' and a.checked_at between now()-interval '60 seconds' and now() and l.price between 100 and 999999.99 then 'ready'
      else 'unavailable' end,
    'refreshable', l.status='active' and l.inventory_kind='sandbox' and coalesce(p_enabled,false) and i.seller_id is not null and not i.review_required
      and l.price between 100 and 999999.99 and not exists(select 1 from public.marketplace_orders o where o.listing_id=l.id and o.state in ('preparing','open','review','paid')),
    'seller_id',a.seller_id,'account_id',a.account_id,'ready',a.ready,'connection',a.connection,'checked_at',a.checked_at,'account_create_key',a.account_create_key)), '[]'::jsonb)
  from public.marketplace_listings l
  left join public.marketplace_payment_inventory i on i.listing_id=l.id and i.tenant=p_tenant
  left join public.marketplace_connected_accounts a on a.seller_id=i.seller_id and a.tenant=i.tenant
  where l.id=any(p_listing_ids) and l.status in ('active','sold');
$$;

commit;
