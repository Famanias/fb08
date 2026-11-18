begin;
-- Public listing data remains column-allowlisted; contacts and all payment records stay private.
drop policy marketplace_public_active on public.marketplace_listings;
create policy marketplace_public_visible on public.marketplace_listings for select to anon, authenticated using (status in ('active','sold'));
revoke select on public.marketplace_listings from anon, authenticated;
grant select(id,title,description,price,currency,category,seller_display_name,image_path,status,created_at,inventory_kind) on public.marketplace_listings to anon, authenticated;

-- Private batched database display snapshot. Account fields are for the server-only refresh service.
create function public.marketplace_payment_display(p_listing_ids uuid[],p_tenant text,p_enabled boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('listing_id',l.id,'sandbox',l.inventory_kind='sandbox',
    'availability',case
      when l.status='sold' then 'sold'
      when l.status<>'active' or l.inventory_kind<>'sandbox' or not coalesce(p_enabled,false) or i.listing_id is null or i.review_required then 'unavailable'
      when exists(select 1 from public.marketplace_orders o where o.listing_id=l.id and o.state in ('preparing','open','review','paid')) then 'reserved'
      when a.ready and a.connection='ready' and a.checked_at between now()-interval '60 seconds' and now() and l.price between 100 and 999999.99 then 'ready'
      else 'unavailable' end,
    'refreshable', l.status='active' and l.inventory_kind='sandbox' and coalesce(p_enabled,false) and i.listing_id is not null and not i.review_required
      and l.price between 100 and 999999.99 and not exists(select 1 from public.marketplace_orders o where o.listing_id=l.id and o.state in ('preparing','open','review','paid')),
    'seller_id',a.seller_id,'account_id',a.account_id,'ready',a.ready,'connection',a.connection,'checked_at',a.checked_at,'account_create_key',a.account_create_key)), '[]'::jsonb)
  from public.marketplace_listings l
  left join public.marketplace_payment_inventory i on i.listing_id=l.id and i.tenant=p_tenant
  left join public.marketplace_listing_contacts c on c.listing_id=i.listing_id
  left join public.marketplace_payment_sellers s on s.email_normalized=lower(btrim(c.seller_email)) and s.tenant=p_tenant
  left join public.marketplace_connected_accounts a on a.seller_id=s.id and a.tenant=p_tenant
  where l.id=any(p_listing_ids) and l.status in ('active','sold');
$$;
create function public.marketplace_order_confirmation(p_order_id uuid,p_buyer_hash text,p_tenant text,p_now timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('orderId',o.id,'listingId',o.listing_id,'title',o.title,
    'status',case when o.state='paid' then 'paid' when o.state='review' or exists(select 1 from public.marketplace_stripe_events e where e.order_id=o.id and e.tenant=o.tenant and e.outcome='review') then 'review' when o.state='expired' then 'expired' else 'pending' end,
    'currency','PHP','grossMinor',o.gross_minor,'applicationFeeMinor',o.fee_minor,'sellerBeforeProcessingMinor',o.gross_minor-o.fee_minor,'sandbox',true)
  from public.marketplace_orders o where o.id=p_order_id and o.tenant=p_tenant
    and public.marketplace_proof_hashes_equal(o.buyer_access_hash,p_buyer_hash) and o.read_expires_at>p_now;
$$;
revoke all on function public.marketplace_payment_display(uuid[],text,boolean),public.marketplace_order_confirmation(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_payment_display(uuid[],text,boolean),public.marketplace_order_confirmation(uuid,text,text,timestamptz) to service_role;
commit;
