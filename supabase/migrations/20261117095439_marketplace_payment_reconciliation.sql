begin;
-- Private investigation flag. Never reclassify inventory or hide a later paid sale.
alter table public.marketplace_payment_inventory add column review_required boolean not null default false;

create or replace function public.marketplace_reserve_order(p_tenant text,p_listing_id uuid,p_buyer_hash text,p_key uuid,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.marketplace_listings; o public.marketplace_orders; s public.marketplace_payment_sellers; a public.marketplace_connected_accounts; oid uuid; gross bigint;
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
  select ps.* into s from public.marketplace_payment_sellers ps join public.marketplace_listing_contacts c on lower(btrim(c.seller_email))=ps.email_normalized where c.listing_id=l.id and ps.tenant=p_tenant;
  if not found then raise exception 'seller_unavailable'; end if;
  select * into a from public.marketplace_connected_accounts where tenant=p_tenant and seller_id=s.id for share;
  if not found or not a.ready or a.connection<>'ready' or a.account_id is null then raise exception 'seller_unavailable'; end if;
  gross:=(l.price*100)::bigint;
  if gross not between 10000 and 99999999 then raise exception 'amount_ineligible'; end if;
  oid:=gen_random_uuid();
  insert into public.marketplace_orders(id,tenant,listing_id,seller_id,account_id,buyer_access_hash,read_expires_at,submission_key,title,gross_minor,fee_minor,create_key,checkout_expires_at,prepared_at)
  values(oid,p_tenant,l.id,s.id,a.account_id,p_buyer_hash,p_now+interval '7 days',p_key,l.title,gross,(gross+5)/10,p_tenant||':checkout:'||oid::text||':v1',floor(extract(epoch from p_now+interval '31 minutes'))::bigint,p_now) returning * into o;
  return to_jsonb(o);
end $$;

-- The listing/order lock order matches reservation. No provider HTTP runs inside this RPC.
create or replace function public.marketplace_apply_checkout(p_tenant text,p_order_id uuid,p_event_id text,p_event_type text,p_checkout jsonb,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare o public.marketplace_orders; l public.marketplace_listings; prior public.marketplace_stripe_events;
  outcome text; receipt_outcome text; source_kind text; matches boolean; canonical_paid boolean;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 255 or p_now is null
    or p_event_type not in ('checkout.session.completed','checkout.session.expired','operator.reconcile')
    or (p_event_type='operator.reconcile' and p_event_id not like 'operator:%')
    or (p_event_type<>'operator.reconcile' and p_event_id not like 'evt_%') then raise exception 'invalid_event'; end if;
  select ml.* into l from public.marketplace_listings ml join public.marketplace_orders mo on mo.listing_id=ml.id where mo.id=p_order_id and mo.tenant=p_tenant for update of ml;
  if not found then raise exception 'order_unavailable'; end if;
  select * into o from public.marketplace_orders where id=p_order_id and tenant=p_tenant for update;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant||':event:'||p_event_id,0));
  select * into prior from public.marketplace_stripe_events where tenant=p_tenant and event_id=p_event_id;
  if found then
    if prior.order_id<>o.id or prior.event_type<>p_event_type then return 'review'; end if;
    if prior.outcome='paid' then return 'duplicate'; end if;
    -- Nonterminal observations are evidence, not a permanent fulfillment veto.
  end if;
  source_kind:=case when p_event_type='operator.reconcile' then 'operator' else 'webhook' end;
  matches:=public.marketplace_checkout_matches(o,p_checkout);
  canonical_paid:=coalesce(matches and p_checkout->>'status'='complete' and p_checkout->>'paymentStatus'='paid'
    and p_checkout->>'intentStatus'='succeeded' and p_checkout->>'paymentIntentId' is not null
    and (p_checkout->>'intentAmountReceivedMinor')::bigint=o.gross_minor and p_checkout->>'intentCurrency'=o.currency,false);
  if o.state='paid' then
    outcome:=case when matches then 'duplicate' else 'review' end;
  elsif o.state='expired' then
    if canonical_paid then
      outcome:='review';
      -- Keep the expired order terminal and any newer hold/paid order intact.
      update public.marketplace_payment_inventory set review_required=true where listing_id=o.listing_id and tenant=o.tenant;
    elsif not matches or p_checkout->>'paymentStatus'='paid' then outcome:='review';
    else outcome:='expired'; end if;
  elsif l.inventory_kind<>'sandbox' or l.status<>'active' or not matches then outcome:='review';
  elsif canonical_paid then outcome:='paid';
  elsif p_checkout->>'paymentStatus'='paid' then outcome:='review';
  elsif p_checkout->>'status'='expired' and p_checkout->>'paymentStatus'='unpaid'
    and (p_checkout->>'paymentIntentId' is null or p_checkout->>'intentStatus'='canceled') then outcome:='expired';
  else outcome:='held'; end if;
  -- A real authenticated completed event may establish paid webhook evidence after
  -- an operator or different event already fulfilled, without a second sale.
  receipt_outcome:=case when o.state='paid' and canonical_paid and p_event_type='checkout.session.completed' then 'paid' else outcome end;
  insert into public.marketplace_stripe_events(tenant,event_id,order_id,event_type,outcome,source,created_at)
    values(p_tenant,p_event_id,o.id,p_event_type,receipt_outcome,source_kind,p_now)
    on conflict(tenant,event_id) do update set outcome=excluded.outcome;
  if o.state not in ('paid','expired') then
    if outcome='paid' then update public.marketplace_listings set status='sold' where id=l.id; end if;
    update public.marketplace_orders set state=case when outcome='held' then state else outcome end,
      session_id=case when outcome='review' then session_id else p_checkout->>'sessionId' end,
      payment_intent_id=case when outcome='review' then payment_intent_id else coalesce(payment_intent_id,p_checkout->>'paymentIntentId') end,
      updated_at=p_now where id=o.id;
  end if;
  return outcome;
end $$;
-- CREATE OR REPLACE retains grants; make the intended service-only boundary explicit.
revoke all on function public.marketplace_reserve_order(text,uuid,text,uuid,timestamptz),public.marketplace_apply_checkout(text,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_reserve_order(text,uuid,text,uuid,timestamptz),public.marketplace_apply_checkout(text,uuid,text,text,jsonb,timestamptz) to service_role;

create or replace function public.marketplace_attach_checkout(p_tenant text,p_order_id uuid,p_checkout jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.marketplace_orders;
begin
  select * into o from public.marketplace_orders where id=p_order_id and tenant=p_tenant for update;
  if not found then raise exception 'order_unavailable'; end if;
  if o.state='paid' then
    if not public.marketplace_checkout_matches(o,p_checkout) then
      insert into public.marketplace_stripe_events(tenant,event_id,order_id,event_type,outcome,source)
        values(o.tenant,'operator:attach:'||o.id::text||':'||gen_random_uuid()::text,o.id,'operator.reconcile','review','operator');
    end if;
    return to_jsonb(o);
  end if;
  if not public.marketplace_checkout_matches(o,p_checkout) then
    if o.state<>'expired' then update public.marketplace_orders set state='review',updated_at=now() where id=o.id returning * into o; end if;
    return to_jsonb(o);
  end if;
  update public.marketplace_orders set session_id=p_checkout->>'sessionId',payment_intent_id=coalesce(payment_intent_id,p_checkout->>'paymentIntentId'),
    state=case when state='preparing' then 'open' else state end,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

commit;
