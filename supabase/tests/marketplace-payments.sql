-- Run with an explicit disposable local --db-url. Every fixture rolls back.
begin;
create function pg_temp.expect_error(command text, expected text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if strpos(sqlerrm, expected) = 0 then raise; end if;
    return;
  end;
  raise exception 'Expected error: %', expected;
end $$;
do $$
declare t text; r text; f record;
begin
  foreach t in array array['marketplace_payment_inventory','marketplace_payment_sellers','marketplace_seller_challenges','marketplace_seller_sessions','marketplace_connected_accounts','marketplace_orders','marketplace_stripe_events'] loop
    foreach r in array array['anon','authenticated'] loop
      assert not has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE'), 'private table grant';
    end loop;
    assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass), 'RLS required';
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('marketplace_reserve_order','marketplace_prepare_checkout','marketplace_attach_checkout','marketplace_apply_checkout','marketplace_classify_demo_inventory') loop
    foreach r in array array['anon','authenticated'] loop
      assert not has_function_privilege(r,f.oid,'EXECUTE'), 'private RPC grant';
    end loop;
  end loop;
end $$;
insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind)
select ('10000000-0000-4000-8000-00000000000'||n)::uuid,'Test '||n,'Fictional local test',1234.50,'Other','Test','listings/10000000-0000-4000-8000-00000000000'||n||'.webp',
  case n when 1 then 'ordinary' when 2 then 'demo' else 'sandbox' end from generate_series(1,5) n;
insert into public.marketplace_listing_contacts select id,'Test@Example.invalid' from public.marketplace_listings where id::text like '10000000-0000-4000-8000-00000000000%';
insert into public.marketplace_payment_inventory(listing_id,tenant) select id,'local-test' from public.marketplace_listings
where id in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005');
insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values('20000000-0000-4000-8000-000000000001','local-test','test@example.invalid',now());
insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
values('local-test','20000000-0000-4000-8000-000000000001','acct_local',true,'ready',now(),'local-create');
set local role service_role;
select pg_temp.expect_error($q$select public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000001','buyer','30000000-0000-4000-8000-000000000001',now())$q$,'listing_unavailable');
select pg_temp.expect_error($q$select public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000002','buyer','30000000-0000-4000-8000-000000000001',now())$q$,'listing_unavailable');
select pg_temp.expect_error($q$select public.marketplace_reserve_order('wrong','10000000-0000-4000-8000-000000000003','buyer','30000000-0000-4000-8000-000000000001',now())$q$,'listing_unavailable');
do $$
declare a jsonb; b jsonb; c jsonb; params jsonb; result text; changed jsonb;
begin
  a:=public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000003','buyer','30000000-0000-4000-8000-000000000001',now());
  b:=public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000003','buyer','30000000-0000-4000-8000-000000000001',now());
  assert a->>'id'=b->>'id', 'retry must return same order';
  assert (a->>'gross_minor')::bigint=123450 and (a->>'fee_minor')::bigint=12345;
  perform pg_temp.expect_error($q$select public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000004','buyer','30000000-0000-4000-8000-000000000001',now())$q$,'request_conflict');
  params:=jsonb_build_object('mode','payment','payment_method_types',jsonb_build_array('card'),'expires_at',(a->>'checkout_expires_at')::bigint,'client_reference_id',a->>'id',
    'metadata',jsonb_build_object('fb08_app','marketplace-payments-v1','tenant','local-test','order_id',a->>'id','listing_id',a->>'listing_id'),
    'line_items',jsonb_build_array(jsonb_build_object('quantity',1,'price_data',jsonb_build_object('currency','php','unit_amount',123450))),
    'payment_intent_data',jsonb_build_object('application_fee_amount',12345,'metadata',jsonb_build_object('fb08_app','marketplace-payments-v1','tenant','local-test','order_id',a->>'id','listing_id',a->>'listing_id')));
  perform pg_temp.expect_error(format('select public.marketplace_prepare_checkout(%L,%L,%L,%L)','local-test',a->>'id',jsonb_set(params,'{line_items,0,price_data,unit_amount}','10000'),'test-version'),'invalid_checkout');
  -- The initial quantity alone is insufficient: hosted Checkout must not change it or the amount.
  for changed in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_set(params,'{line_items,0,adjustable_quantity}','{"enabled":true,"minimum":1,"maximum":2}'),
    jsonb_set(params,'{line_items,0,tax_rates}','["txr_test"]'),
    jsonb_set(params,'{line_items,0,dynamic_tax_rates}','["txr_test"]'),
    jsonb_set(params,'{line_items,0,discounts}','[{"coupon":"coupon_test"}]'),
    jsonb_set(params,'{line_items,0,price_data,recurring}','{"interval":"month"}'),
    params||'{"automatic_tax":{"enabled":true}}'::jsonb,
    params||'{"adaptive_pricing":{"enabled":true}}'::jsonb,
    params||'{"allow_promotion_codes":true}'::jsonb,
    params||'{"discounts":[{"coupon":"coupon_test"}]}'::jsonb,
    params||'{"optional_items":[{"price":"price_test","quantity":1}]}'::jsonb,
    params||'{"after_expiration":{"recovery":{"enabled":true}}}'::jsonb
  )) loop
    perform pg_temp.expect_error(format('select public.marketplace_prepare_checkout(%L,%L,%L,%L)','local-test',a->>'id',changed,'test-version'),'invalid_checkout');
  end loop;
  assert (select create_params is null from public.marketplace_orders where id=(a->>'id')::uuid), 'rejected params must never be persisted';
  params:=jsonb_set(params,'{line_items,0}',params#>'{line_items,0}'||'{"adjustable_quantity":{"enabled":false},"tax_rates":[],"dynamic_tax_rates":[],"discounts":[]}'::jsonb)
    ||'{"automatic_tax":{"enabled":false},"adaptive_pricing":{"enabled":false},"allow_promotion_codes":false,"discounts":[],"shipping_options":[],"after_expiration":{"recovery":{"enabled":false}}}'::jsonb;
  b:=public.marketplace_prepare_checkout('local-test',(a->>'id')::uuid,params,'test-version');
  b:=public.marketplace_prepare_checkout('local-test',(a->>'id')::uuid,'{}','different-version');
  assert b->'create_params'=params and b->>'stripe_api_version'='test-version', 'first prepared request must be immutable';
  c:=jsonb_build_object('sessionId','cs_local','accountId','acct_local','paymentIntentId','pi_local','status','complete','paymentStatus','paid','intentStatus','succeeded','livemode',false,'currency','php','grossMinor',123450,'feeMinor',12345,'quantity',1,'intentAmountReceivedMinor',123450,'intentCurrency','php','expiresAt',(a->>'checkout_expires_at')::bigint,'clientReferenceId',a->>'id','metadata',params->'metadata','intentMetadata',params->'metadata');
  result:=public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_paid','checkout.session.completed',c,now());
  assert result='paid', 'canonical webhook may bind before create response';
  assert (select status='sold' from public.marketplace_listings where id=(a->>'listing_id')::uuid);
  assert public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_paid','checkout.session.completed',c,now())='duplicate';
  perform public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_expired','checkout.session.expired',jsonb_set(c,'{status}','"expired"'),now());
  assert (select state='paid' from public.marketplace_orders where id=(a->>'id')::uuid), 'paid cannot demote';
  b:=public.marketplace_attach_checkout('local-test',(a->>'id')::uuid,c);
  assert b->>'state'='paid';
end $$;
reset role;
-- Publication retains its original signature, with private server tenant in input.
insert into storage.objects(bucket_id,name) values('marketplace-images','listings/40000000-0000-4000-8000-000000000001.webp');
set local role service_role;
do $$
declare input jsonb; result uuid;
begin
  input:='{"title":"Sandbox publication","description":"Fictional","price":"100","category":"Other","sellerDisplayName":"Test","sellerEmail":"test@example.invalid","inventoryKind":"sandbox","paymentTenant":"local-test"}';
  result:=public.marketplace_publish('40000000-0000-4000-8000-000000000002','fingerprint','40000000-0000-4000-8000-000000000001','listings/40000000-0000-4000-8000-000000000001.webp',input);
  assert result='40000000-0000-4000-8000-000000000001'::uuid;
  assert public.marketplace_publish('40000000-0000-4000-8000-000000000002','fingerprint',result,'listings/'||result||'.webp',input)=result;
  perform pg_temp.expect_error(format('select public.marketplace_publish(%L,%L,%L,%L,%L)','40000000-0000-4000-8000-000000000002','fingerprint',result,'listings/'||result||'.webp',jsonb_set(input,'{paymentTenant}','"foreign"')),'request_conflict');
  perform pg_temp.expect_error(format('select public.marketplace_publish(%L,%L,%L,%L,%L)',gen_random_uuid(),'other',result,'listings/'||result||'.webp',input-'paymentTenant'),'invalid_inventory');
  perform pg_temp.expect_error(format('select public.marketplace_publish(%L,%L,%L,%L,%L)',gen_random_uuid(),'other',result,'listings/'||result||'.webp',jsonb_set(input,'{inventoryKind}','"ordinary"')),'invalid_inventory');
end $$;
-- Full expected fields and private contact are checked atomically.
do $$
declare expected jsonb; result jsonb;
begin
  select jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'price',price,'category',category,'sellerDisplayName',seller_display_name,'imagePath',image_path,'sellerEmail','Test@Example.invalid') order by id)
  into expected from public.marketplace_listings where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
  perform pg_temp.expect_error(format('select public.marketplace_classify_demo_inventory(%L)',jsonb_set(expected,'{1,description}','"changed"')),'demo_manifest_mismatch');
  assert (select inventory_kind='ordinary' from public.marketplace_listings where id='10000000-0000-4000-8000-000000000001'), 'mismatch must roll back earlier updates';
  expected:=expected||jsonb_build_array(jsonb_build_object('id','10000000-0000-4000-8000-000000000099'));
  result:=public.marketplace_classify_demo_inventory(expected);
  assert result->'missing'='["10000000-0000-4000-8000-000000000099"]'::jsonb;
  assert public.marketplace_classify_demo_inventory(expected)=result;
  assert (select seller_email='Test@Example.invalid' from public.marketplace_listing_contacts where listing_id='10000000-0000-4000-8000-000000000001');
  assert (select status='active' from public.marketplace_listings where id='10000000-0000-4000-8000-000000000001');
end $$;
do $$
declare a jsonb; c jsonb; params jsonb; m jsonb;
begin
  a:=public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000004','buyer-expiry',gen_random_uuid(),now());
  m:=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant','local-test','order_id',a->>'id','listing_id',a->>'listing_id');
  params:=jsonb_build_object('mode','payment','payment_method_types',jsonb_build_array('card'),'expires_at',(a->>'checkout_expires_at')::bigint,'client_reference_id',a->>'id','metadata',m,
    'line_items',jsonb_build_array(jsonb_build_object('quantity',1,'price_data',jsonb_build_object('currency','php','unit_amount',123450))),
    'payment_intent_data',jsonb_build_object('application_fee_amount',12345,'metadata',m));
  perform public.marketplace_prepare_checkout('local-test',(a->>'id')::uuid,params,'test-version');
  c:=jsonb_build_object('sessionId','cs_expiry','accountId','acct_local','status','open','paymentStatus','unpaid','livemode',false,'currency','php','grossMinor',123450,'quantity',1,'expiresAt',(a->>'checkout_expires_at')::bigint,'clientReferenceId',a->>'id','metadata',m);
  assert public.marketplace_attach_checkout('local-test',(a->>'id')::uuid,c)->>'state'='open', 'no-PI open session may attach with persisted fee';
  assert public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_unpaid','checkout.session.completed',jsonb_set(c,'{status}','"complete"'),now())='held';
  c:=c||jsonb_build_object('status','expired','paymentIntentId','pi_processing','intentStatus','processing','feeMinor',12345,'intentMetadata',m);
  assert public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_processing','checkout.session.expired',c,now())='held';
  assert public.marketplace_apply_checkout('local-test',(a->>'id')::uuid,'evt_canceled','checkout.session.expired',jsonb_set(c,'{intentStatus}','"canceled"'),now())='expired';
  assert (select status='active' from public.marketplace_listings where id=(a->>'listing_id')::uuid);
  a:=public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000004','new-buyer',gen_random_uuid(),now());
  assert a->>'state'='preparing';
  -- A mismatched response holds for review instead of freeing/selling inventory.
  assert public.marketplace_attach_checkout('local-test',(a->>'id')::uuid,c)->>'state'='review';
  perform pg_temp.expect_error($q$select public.marketplace_reserve_order('local-test','10000000-0000-4000-8000-000000000004','third-buyer',gen_random_uuid(),now()+interval '2 days')$q$,'reservation_conflict');
end $$;
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.marketplace_orders','permission denied');
select pg_temp.expect_error($q$select public.marketplace_reserve_order('x',gen_random_uuid(),'x',gen_random_uuid(),now())$q$,'permission denied');
do $$ declare row jsonb; begin
  select value into row from jsonb_array_elements(public.marketplace_browse()->'listings') limit 1;
  assert not (row ?| array['seller_email','account_id','tenant','buyer_access_hash']);
  assert row ? 'inventory_kind';
end $$;
reset role;
set local role authenticated;
select pg_temp.expect_error('select * from public.marketplace_orders','permission denied');
select pg_temp.expect_error($q$select public.marketplace_reserve_order('x',gen_random_uuid(),'x',gen_random_uuid(),now())$q$,'permission denied');
reset role;
rollback;
