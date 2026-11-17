begin;
-- Service-only ownership proofs. These functions never accept plaintext codes.
create function public.marketplace_proof_hashes_equal(p_left text,p_right text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare a bytea; b bytea; difference integer:=0; i integer;
begin
  if p_left is null or p_right is null or p_left !~ '^[a-f0-9]{64}$' or p_right !~ '^[a-f0-9]{64}$' then return false; end if;
  a:=decode(p_left,'hex'); b:=decode(p_right,'hex');
  -- Fixed-size HMAC values: inspect every byte without early exit.
  for i in 0..31 loop difference:=difference | (get_byte(a,i) # get_byte(b,i)); end loop;
  return difference=0;
end $$;
create function public.marketplace_issue_seller_challenge(p_id uuid,p_email text,p_tenant text,p_browser_hash text,p_code_hash text,p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_id is null or p_email is null or p_email<>lower(btrim(p_email)) or char_length(p_email) not between 3 and 254
    or p_tenant is null or char_length(p_tenant) not between 1 and 100 or p_browser_hash is null or p_browser_hash !~ '^[a-f0-9]{64}$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_expires_at is null then raise exception 'invalid_challenge'; end if;
  -- Serialize replacement even when no earlier row exists.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_tenant,p_email,p_browser_hash)::text,0));
  update public.marketplace_seller_challenges set consumed_at=clock_timestamp()
    where tenant=p_tenant and email_normalized=p_email and browser_nonce_hash=p_browser_hash and consumed_at is null;
  insert into public.marketplace_seller_challenges(id,tenant,email_normalized,browser_nonce_hash,code_hash,expires_at)
    values(p_id,p_tenant,p_email,p_browser_hash,p_code_hash,p_expires_at);
end $$;
create function public.marketplace_consume_seller_challenge(p_id uuid,p_tenant text,p_browser_hash text,p_candidate_hash text,p_session_hash text,p_now timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.marketplace_seller_challenges; s public.marketplace_payment_sellers;
begin
  if p_id is null or p_tenant is null or p_now is null or p_browser_hash is null or p_browser_hash !~ '^[a-f0-9]{64}$'
    or p_candidate_hash is null or p_candidate_hash !~ '^[a-f0-9]{64}$' or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into c from public.marketplace_seller_challenges where id=p_id and tenant=p_tenant and browser_nonce_hash=p_browser_hash for update;
  if not found or c.consumed_at is not null or c.expires_at<=p_now or c.attempts>=5 then return null; end if;
  if not public.marketplace_proof_hashes_equal(c.code_hash,p_candidate_hash) then
    update public.marketplace_seller_challenges set attempts=attempts+1 where id=c.id;
    return null;
  end if;
  update public.marketplace_seller_challenges set consumed_at=p_now where id=c.id;
  insert into public.marketplace_payment_sellers(tenant,email_normalized,verified_at) values(p_tenant,c.email_normalized,p_now)
    on conflict(tenant,email_normalized) do update set verified_at=excluded.verified_at returning * into s;
  insert into public.marketplace_seller_sessions(token_hash,tenant,seller_id,expires_at) values(p_session_hash,p_tenant,s.id,p_now+interval '1 hour');
  return jsonb_build_object('id',s.id,'tenant',s.tenant,'email_normalized',s.email_normalized);
end $$;
revoke all on function public.marketplace_proof_hashes_equal(text,text),public.marketplace_issue_seller_challenge(uuid,text,text,text,text,timestamptz),public.marketplace_consume_seller_challenge(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketplace_proof_hashes_equal(text,text),public.marketplace_issue_seller_challenge(uuid,text,text,text,text,timestamptz),public.marketplace_consume_seller_challenge(uuid,text,text,text,text,timestamptz) to service_role;

create function public.marketplace_reserve_order(p_tenant text,p_listing_id uuid,p_buyer_hash text,p_key uuid,p_now timestamptz)
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
  if not found or l.status<>'active' or l.inventory_kind<>'sandbox' or not exists(select 1 from public.marketplace_payment_inventory where listing_id=l.id and tenant=p_tenant)
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

create function public.marketplace_prepare_checkout(p_tenant text,p_order_id uuid,p_params jsonb,p_api_version text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.marketplace_orders; m jsonb; item jsonb; price jsonb;
begin
  select * into o from public.marketplace_orders where id=p_order_id and tenant=p_tenant for update;
  if not found then raise exception 'order_unavailable'; end if;
  if o.create_params is not null then return to_jsonb(o); end if;
  m:=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant',o.tenant,'order_id',o.id::text,'listing_id',o.listing_id::text);
  item:=p_params#>'{line_items,0}';
  price:=item->'price_data';
  if o.state<>'preparing' or nullif(p_api_version,'') is null or (
    -- An explicit supported shape prevents new provider options from changing the fixed amount.
    jsonb_typeof(p_params)='object'
    and p_params-array['mode','payment_method_types','client_reference_id','expires_at','metadata','line_items','payment_intent_data','success_url','cancel_url','automatic_tax','adaptive_pricing','allow_promotion_codes','discounts','shipping_options','after_expiration']='{}'::jsonb
    and jsonb_typeof(item)='object'
    and item-array['quantity','price_data','adjustable_quantity','tax_rates','dynamic_tax_rates','discounts']='{}'::jsonb
    and (not item ? 'adjustable_quantity' or item->'adjustable_quantity'='{"enabled":false}'::jsonb)
    and (not item ? 'tax_rates' or item->'tax_rates'='[]'::jsonb)
    and (not item ? 'dynamic_tax_rates' or item->'dynamic_tax_rates'='[]'::jsonb)
    and (not item ? 'discounts' or item->'discounts'='[]'::jsonb)
    and jsonb_typeof(price)='object'
    and price-array['currency','unit_amount','product_data']='{}'::jsonb
    and (not price ? 'product_data' or (jsonb_typeof(price->'product_data')='object' and (price->'product_data')-array['name','description','images']='{}'::jsonb))
    and (p_params->'payment_intent_data')-array['application_fee_amount','metadata']='{}'::jsonb
    and (not p_params ? 'automatic_tax' or p_params->'automatic_tax'='{"enabled":false}'::jsonb)
    and (not p_params ? 'adaptive_pricing' or p_params->'adaptive_pricing'='{"enabled":false}'::jsonb)
    and (not p_params ? 'allow_promotion_codes' or p_params->'allow_promotion_codes'='false'::jsonb)
    and (not p_params ? 'discounts' or p_params->'discounts'='[]'::jsonb)
    and (not p_params ? 'shipping_options' or p_params->'shipping_options'='[]'::jsonb)
    and (not p_params ? 'after_expiration' or p_params->'after_expiration'='{"recovery":{"enabled":false}}'::jsonb)
    and
    p_params->>'mode'='payment' and p_params->'payment_method_types'='["card"]'::jsonb
    and p_params->>'client_reference_id'=o.id::text and (p_params->>'expires_at')::bigint=o.checkout_expires_at
    and p_params->'metadata'=m and p_params#>'{payment_intent_data,metadata}'=m
    and jsonb_array_length(p_params->'line_items')=1 and (p_params#>>'{line_items,0,quantity}')::integer=1
    and p_params#>>'{line_items,0,price_data,currency}'=o.currency
    and (p_params#>>'{line_items,0,price_data,unit_amount}')::bigint=o.gross_minor
    and (p_params#>>'{payment_intent_data,application_fee_amount}')::bigint=o.fee_minor
  ) is not true then raise exception 'invalid_checkout'; end if;
  update public.marketplace_orders set create_params=p_params,stripe_api_version=p_api_version,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

-- Shared canonical binding checks; private invoker helper, never a public endpoint.
create function public.marketplace_checkout_matches(o public.marketplace_orders,c jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(
    o.create_params is not null and nullif(c->>'sessionId','') is not null
    and c->>'accountId'=o.account_id and (c->>'livemode')::boolean=false
    and c->>'currency'=o.currency and (c->>'grossMinor')::bigint=o.gross_minor
    and (c->>'quantity')::integer=1 and (c->>'expiresAt')::bigint=o.checkout_expires_at
    and c->>'clientReferenceId'=o.id::text
    and (o.session_id is null or c->>'sessionId'=o.session_id)
    and (o.payment_intent_id is null or c->>'paymentIntentId'=o.payment_intent_id)
    and c->'metadata'=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant',o.tenant,'order_id',o.id::text,'listing_id',o.listing_id::text)
    and ((c->>'paymentIntentId' is null and (c->>'feeMinor' is null or (c->>'feeMinor')::bigint=o.fee_minor))
      or (c->>'paymentIntentId' is not null and (c->>'feeMinor')::bigint=o.fee_minor and c->'intentMetadata'=c->'metadata'))
  ,false)
$$;

create function public.marketplace_attach_checkout(p_tenant text,p_order_id uuid,p_checkout jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.marketplace_orders;
begin
  select * into o from public.marketplace_orders where id=p_order_id and tenant=p_tenant for update;
  if not found then raise exception 'order_unavailable'; end if;
  if o.state='paid' then return to_jsonb(o); end if;
  if not public.marketplace_checkout_matches(o,p_checkout) then
    if o.state<>'expired' then update public.marketplace_orders set state='review',updated_at=now() where id=o.id returning * into o; end if;
    return to_jsonb(o);
  end if;
  update public.marketplace_orders set session_id=p_checkout->>'sessionId',payment_intent_id=coalesce(payment_intent_id,p_checkout->>'paymentIntentId'),
    state=case when state='preparing' then 'open' else state end,updated_at=now() where id=o.id returning * into o;
  return to_jsonb(o);
end $$;

create function public.marketplace_apply_checkout(p_tenant text,p_order_id uuid,p_event_id text,p_event_type text,p_checkout jsonb,p_now timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare o public.marketplace_orders; l public.marketplace_listings; outcome text; source_kind text;
begin
  if nullif(p_event_id,'') is null or p_event_type not in ('checkout.session.completed','checkout.session.expired','operator.reconcile') then raise exception 'invalid_event'; end if;
  -- Always acquire listing before order, matching reserve's lock order.
  select ml.* into l from public.marketplace_listings ml join public.marketplace_orders mo on mo.listing_id=ml.id where mo.id=p_order_id and mo.tenant=p_tenant for update of ml;
  if not found then raise exception 'order_unavailable'; end if;
  select * into o from public.marketplace_orders where id=p_order_id and tenant=p_tenant for update;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant||':event:'||p_event_id,0));
  if exists(select 1 from public.marketplace_stripe_events where tenant=p_tenant and event_id=p_event_id) then return 'duplicate'; end if;
  source_kind:=case when p_event_type='operator.reconcile' then 'operator' else 'webhook' end;
  if o.state='paid' then outcome:='duplicate';
  elsif o.state='expired' then outcome:='expired';
  elsif l.inventory_kind<>'sandbox' or l.status<>'active' or not public.marketplace_checkout_matches(o,p_checkout) then outcome:='review';
  elsif p_checkout->>'status'='complete' and p_checkout->>'paymentStatus'='paid'
    and p_checkout->>'intentStatus'='succeeded' and p_checkout->>'paymentIntentId' is not null
    and (p_checkout->>'intentAmountReceivedMinor')::bigint=o.gross_minor and p_checkout->>'intentCurrency'=o.currency
  then
    outcome:='paid';
    update public.marketplace_listings set status='sold' where id=l.id;
  elsif p_checkout->>'status'='expired' and p_checkout->>'paymentStatus'='unpaid'
    and (p_checkout->>'paymentIntentId' is null or p_checkout->>'intentStatus'='canceled') then outcome:='expired';
  else outcome:='held'; end if;
  if o.state not in ('paid','expired') then
    update public.marketplace_orders set state=case when outcome='held' then state else outcome end,
      session_id=case when outcome='review' then session_id else p_checkout->>'sessionId' end,
      payment_intent_id=case when outcome='review' then payment_intent_id else coalesce(payment_intent_id,p_checkout->>'paymentIntentId') end,
      updated_at=p_now where id=o.id;
  end if;
  insert into public.marketplace_stripe_events(tenant,event_id,order_id,event_type,outcome,source,created_at) values(p_tenant,p_event_id,o.id,p_event_type,outcome,source_kind,p_now);
  return outcome;
end $$;

create or replace function public.marketplace_publish(p_key uuid,p_fingerprint text,p_id uuid,p_image_path text,p_input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_existing public.marketplace_requests; kind text:=coalesce(p_input->>'inventoryKind','ordinary'); v_tenant text:=p_input->>'paymentTenant';
begin
  if kind not in ('ordinary','sandbox') or (kind='sandbox' and nullif(btrim(v_tenant),'') is null) or (kind='ordinary' and v_tenant is not null) then raise exception 'invalid_inventory'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  select * into v_existing from public.marketplace_requests where request_key=p_key;
  if found then
    if v_existing.kind<>'listing' or v_existing.fingerprint<>p_fingerprint
      or not exists(select 1 from public.marketplace_listings where id=v_existing.result_id and (inventory_kind=kind or (inventory_kind='demo' and kind='ordinary')))
      or (kind='sandbox' and not exists(select 1 from public.marketplace_payment_inventory where listing_id=v_existing.result_id and tenant=v_tenant)) then raise exception 'request_conflict'; end if;
    return v_existing.result_id;
  end if;
  if p_image_path<>'listings/'||p_id::text||'.webp' then raise exception 'invalid_photo'; end if;
  if not exists(select 1 from storage.objects where bucket_id='marketplace-images' and name=p_image_path) then raise exception 'missing_photo'; end if;
  insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind)
  values(p_id,p_input->>'title',p_input->>'description',(p_input->>'price')::numeric,p_input->>'category',p_input->>'sellerDisplayName',p_image_path,kind);
  insert into public.marketplace_listing_contacts(listing_id,seller_email) values(p_id,p_input->>'sellerEmail');
  if kind='sandbox' then insert into public.marketplace_payment_inventory(listing_id,tenant) values(p_id,v_tenant); end if;
  insert into public.marketplace_requests(request_key,kind,fingerprint,result_id) values(p_key,'listing',p_fingerprint,p_id);
  return p_id;
end $$;

create function public.marketplace_classify_demo_inventory(p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e jsonb; l public.marketplace_listings; contact text; missing jsonb:='[]'; classified jsonb:='[]';
begin
  if jsonb_typeof(p_expected)<>'array' then raise exception 'invalid_manifest'; end if;
  for e in select value from jsonb_array_elements(p_expected) order by value->>'id' loop
    select * into l from public.marketplace_listings where id=(e->>'id')::uuid for update;
    if not found then missing:=missing||jsonb_build_array(e->>'id'); continue; end if;
    select seller_email into contact from public.marketplace_listing_contacts where listing_id=l.id for share;
    if (l.title=e->>'title' and l.description=e->>'description' and l.price=(e->>'price')::numeric
      and l.category=e->>'category' and l.seller_display_name=e->>'sellerDisplayName' and l.image_path=e->>'imagePath'
      and contact=e->>'sellerEmail' and l.inventory_kind in ('ordinary','demo')
      and not exists(select 1 from public.marketplace_payment_inventory where listing_id=l.id)) is not true then raise exception 'demo_manifest_mismatch'; end if;
    update public.marketplace_listings set inventory_kind='demo' where id=l.id;
    classified:=classified||jsonb_build_array(l.id);
  end loop;
  return jsonb_build_object('classified',classified,'missing',missing);
end $$;

revoke all on function public.marketplace_reserve_order(text,uuid,text,uuid,timestamptz),public.marketplace_prepare_checkout(text,uuid,jsonb,text),public.marketplace_attach_checkout(text,uuid,jsonb),public.marketplace_apply_checkout(text,uuid,text,text,jsonb,timestamptz),public.marketplace_checkout_matches(public.marketplace_orders,jsonb),public.marketplace_classify_demo_inventory(jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_reserve_order(text,uuid,text,uuid,timestamptz),public.marketplace_prepare_checkout(text,uuid,jsonb,text),public.marketplace_attach_checkout(text,uuid,jsonb),public.marketplace_apply_checkout(text,uuid,text,text,jsonb,timestamptz),public.marketplace_checkout_matches(public.marketplace_orders,jsonb),public.marketplace_classify_demo_inventory(jsonb) to service_role;
commit;
begin;
-- Parameterized substring search avoids PostgREST wildcard/filter grammar entirely.
-- This invoker function returns only active public listing data and obeys RLS.
create or replace function public.marketplace_browse(p_q text default '', p_category text default 'All', p_sort text default 'newest', p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_q is null or char_length(p_q)>100 or p_page is null or p_page<0 or p_page>100000
     or p_sort is null or p_sort not in ('newest','price_asc','price_desc','name')
     or p_category is null or p_category not in ('All','Electronics','Furniture','Clothing','Books','Sports','Home','Other')
  then raise exception 'invalid_filters'; end if;
  with filtered as materialized (
    select id,title,description,price,currency,category,seller_display_name,image_path,status,created_at,inventory_kind
    from public.marketplace_listings
    where status='active' and (p_category='All' or category=p_category)
      and (p_q='' or strpos(lower(concat_ws(' ',title,description,category,seller_display_name)),lower(p_q))>0)
  ), page_rows as (
    select * from filtered
    order by case when p_sort='newest' then created_at end desc,
      case when p_sort='price_asc' then price end asc,
      case when p_sort='price_desc' then price end desc,
      case when p_sort='name' then title end asc,
      id desc
    limit 18 offset p_page*18
  )
  select jsonb_build_object('listings',coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows),'[]'::jsonb),
    'total',(select count(*) from filtered)) into v_result;
  return v_result;
end;
$$;
revoke all on function public.marketplace_browse(text,text,text,integer) from public;
grant execute on function public.marketplace_browse(text,text,text,integer) to anon, authenticated, service_role;
commit;
