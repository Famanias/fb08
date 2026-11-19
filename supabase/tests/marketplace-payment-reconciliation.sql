-- Owned disposable PostgreSQL only. All fixtures and fault triggers roll back.
begin;
create function pg_temp.payment_fixture() returns jsonb language plpgsql as $$
declare listing uuid:=gen_random_uuid(); o jsonb; m jsonb; c jsonb;
begin
  insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind) values(listing,'Fictional event fixture','Local test',1234.50,'Other','Test','listings/'||listing||'.webp','sandbox');
  insert into public.marketplace_listing_contacts values(listing,'events@example.invalid');
  insert into public.marketplace_payment_inventory(listing_id,tenant,seller_id) values(listing,'event-tests','a0000000-0000-4000-8000-000000000001');
  o:=public.marketplace_reserve_order('event-tests',listing,'buyer',gen_random_uuid(),now());
  m:=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant','event-tests','order_id',o->>'id','listing_id',listing::text);
  perform public.marketplace_prepare_checkout('event-tests',(o->>'id')::uuid,jsonb_build_object('mode','payment','payment_method_types',jsonb_build_array('card'),'expires_at',(o->>'checkout_expires_at')::bigint,'client_reference_id',o->>'id','metadata',m,'line_items',jsonb_build_array(jsonb_build_object('quantity',1,'price_data',jsonb_build_object('currency','php','unit_amount',123450))),'payment_intent_data',jsonb_build_object('application_fee_amount',12345,'metadata',m)),'test-version');
  c:=jsonb_build_object('sessionId','cs_'||replace(o->>'id','-',''),'accountId','acct_eventtests','paymentIntentId','pi_'||replace(o->>'id','-',''),'status','complete','paymentStatus','paid','intentStatus','succeeded','livemode',false,'currency','php','grossMinor',123450,'feeMinor',12345,'quantity',1,'intentAmountReceivedMinor',123450,'intentCurrency','php','expiresAt',(o->>'checkout_expires_at')::bigint,'clientReferenceId',o->>'id','metadata',m,'intentMetadata',m);
  return jsonb_build_object('o',o,'c',c);
end $$;
insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values('a0000000-0000-4000-8000-000000000001','event-tests','events@example.invalid',now());
insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key) values('event-tests','a0000000-0000-4000-8000-000000000001','acct_eventtests',true,'ready',now(),'event-tests-create');
set local role service_role;
do $$
declare f jsonb; c jsonb; oid uuid; result text;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_delayed','checkout.session.completed',c||'{"paymentStatus":"unpaid","intentStatus":"processing"}',now())='held';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_delayed','checkout.session.completed',c,now())='paid','held receipt must advance on authenticated redelivery';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_delayed','checkout.session.completed',c,now())='duplicate';
  assert (select count(*)=1 from public.marketplace_stripe_events where tenant='event-tests' and event_id='evt_delayed');
  assert public.marketplace_attach_checkout('event-tests',oid,c)->>'state'='paid';
  perform public.marketplace_apply_checkout('event-tests',oid,'evt_late_expired','checkout.session.expired',c||'{"status":"expired","paymentStatus":"unpaid","intentStatus":"canceled"}',now());
  assert (select state='paid' from public.marketplace_orders where marketplace_orders.id=oid);
  raise notice 'PASS delayed paid redelivery, preattach binding and monotonic paid';
end $$;
do $$
declare f jsonb; c jsonb; oid uuid;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'operator:test:paid','operator.reconcile',c,now())='paid';
  assert not exists(select 1 from public.marketplace_stripe_events where order_id=oid and outcome='paid' and source='webhook');
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_real_completed','checkout.session.completed',c,now())='duplicate';
  assert exists(select 1 from public.marketplace_stripe_events where order_id=oid and event_id='evt_real_completed' and outcome='paid' and source='webhook'),'real webhook evidence must remain distinct after operator sale';
  raise notice 'PASS operator provenance and later real completed receipt';
end $$;
do $$
declare f jsonb; c jsonb; changed jsonb; oid uuid;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  perform public.marketplace_attach_checkout('event-tests',oid,c||'{"status":"open","paymentStatus":"unpaid"}');
  for changed in select value from jsonb_array_elements(jsonb_build_array(c||'{"accountId":"acct_foreign"}',c||'{"sessionId":"cs_wrong"}',jsonb_set(c,'{metadata,listing_id}','"other"'),c||'{"grossMinor":123451}',c||'{"quantity":2}',c||'{"currency":"usd"}',c||'{"feeMinor":12346}',jsonb_set(c,'{intentMetadata,order_id}','"other"'),c||'{"intentAmountReceivedMinor":123449}',c||'{"intentCurrency":"usd"}')) loop
    assert public.marketplace_apply_checkout('event-tests',oid,'evt_mismatch_'||gen_random_uuid(),'checkout.session.completed',changed,now())='review','known mismatch must review';
    assert (select status='active' from public.marketplace_listings where marketplace_listings.id=(f#>>'{o,listing_id}')::uuid);
  end loop;
  assert public.marketplace_attach_checkout('event-tests',oid,c||'{"sessionId":"cs_different"}')->>'state'='review';
  raise notice 'PASS exact bindings and mismatches never sell';
end $$;
-- Inject failure after receipt insertion but before listing sale; the entire RPC must roll back.
reset role;
create function pg_temp.fail_sale() returns trigger language plpgsql as $$ begin
  if old.status='sold' and new.status='sold' then raise exception 'duplicate_sale_update'; end if;
  if current_setting('test.fail_sale',true)='on' and new.status='sold' then raise exception 'injected_sale_failure'; end if; return new;
end $$;
create trigger event_test_fail_sale before update on public.marketplace_listings for each row execute function pg_temp.fail_sale();
set local role service_role;
do $$
declare f jsonb; c jsonb; oid uuid;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  perform set_config('test.fail_sale','on',true);
  begin
    perform public.marketplace_apply_checkout('event-tests',oid,'evt_rollback','checkout.session.completed',c,now());
    raise exception 'expected injected failure';
  exception when others then if sqlerrm<>'injected_sale_failure' then raise; end if; end;
  assert not exists(select 1 from public.marketplace_stripe_events where event_id='evt_rollback');
  assert (select state='preparing' from public.marketplace_orders where marketplace_orders.id=oid);
  perform set_config('test.fail_sale','off',true);
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_rollback','checkout.session.completed',c,now())='paid';
  raise notice 'PASS receipt/order/listing rollback and retry';
end $$;
do $$
declare f jsonb; c jsonb; oid uuid; later jsonb; m jsonb; status text;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  foreach status in array array['processing','requires_action','unknown'] loop
    assert public.marketplace_apply_checkout('event-tests',oid,'evt_hold_'||status,'checkout.session.expired',c||jsonb_build_object('status','expired','paymentStatus','unpaid','intentStatus',status),now())='held';
  end loop;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_terminal','checkout.session.expired',c||'{"status":"expired","paymentStatus":"unpaid","intentStatus":"canceled"}',now())='expired';
  later:=public.marketplace_reserve_order('event-tests',(f#>>'{o,listing_id}')::uuid,'later-buyer',gen_random_uuid(),now());
  -- A previously terminal expiry must never become a second sale or steal the newer hold.
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_anomaly','checkout.session.completed',c,now())='review','late paid after definitive expiry requires investigation';
  assert (select state='expired' from public.marketplace_orders where marketplace_orders.id=oid);
  assert (select state='preparing' from public.marketplace_orders where marketplace_orders.id=(later->>'id')::uuid);
  assert (select review_required from public.marketplace_payment_inventory where listing_id=(f#>>'{o,listing_id}')::uuid);
  -- Remove the newer unused hold to prove the anomaly itself blocks future reservations.
  delete from public.marketplace_orders where marketplace_orders.id=(later->>'id')::uuid;
  begin
    perform public.marketplace_reserve_order('event-tests',(f#>>'{o,listing_id}')::uuid,'third',gen_random_uuid(),now());
    raise exception 'expected listing_unavailable';
  exception when others then if sqlerrm<>'listing_unavailable' then raise; end if; end;
  raise notice 'PASS terminal Intent expiry and late-paid anomaly freeze';
end $$;
do $$
declare f jsonb; c jsonb; oid uuid; newer jsonb; m jsonb;
begin
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_attach_paid','checkout.session.completed',c,now())='paid';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_semantic_duplicate','checkout.session.completed',c,now())='duplicate';
  assert public.marketplace_attach_checkout('event-tests',oid,c||'{"sessionId":"cs_conflicting_late_attach"}')->>'state'='paid';
  assert exists(select 1 from public.marketplace_stripe_events where order_id=oid and source='operator' and outcome='review'),'paid attach conflict keeps minimal private review evidence';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_paid_mismatch','checkout.session.completed',c||'{"currency":"usd"}',now())='review';
  assert (select state='paid' from public.marketplace_orders where id=oid);
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_no_pi_expiry','checkout.session.expired',c||'{"status":"expired","paymentStatus":"unpaid","paymentIntentId":null,"intentStatus":null,"feeMinor":null}',now())='expired';
  -- A later paid order must survive an anomalous payment on the old terminal expiry.
  newer:=public.marketplace_reserve_order('event-tests',(f#>>'{o,listing_id}')::uuid,'new-buyer',gen_random_uuid(),now());
  m:=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant','event-tests','order_id',newer->>'id','listing_id',newer->>'listing_id');
  perform public.marketplace_prepare_checkout('event-tests',(newer->>'id')::uuid,jsonb_build_object('mode','payment','payment_method_types',jsonb_build_array('card'),'expires_at',(newer->>'checkout_expires_at')::bigint,'client_reference_id',newer->>'id','metadata',m,'line_items',jsonb_build_array(jsonb_build_object('quantity',1,'price_data',jsonb_build_object('currency','php','unit_amount',123450))),'payment_intent_data',jsonb_build_object('application_fee_amount',12345,'metadata',m)),'test-version');
  assert public.marketplace_apply_checkout('event-tests',(newer->>'id')::uuid,'evt_new_sale','checkout.session.completed',c||jsonb_build_object('sessionId','cs_new_sale','paymentIntentId','pi_new_sale','clientReferenceId',newer->>'id','metadata',m,'intentMetadata',m,'expiresAt',(newer->>'checkout_expires_at')::bigint),now())='paid';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_old_paid_anomaly','checkout.session.completed',c,now())='review';
  assert (select count(*)=1 from public.marketplace_orders where listing_id=(f#>>'{o,listing_id}')::uuid and state='paid');
  assert (select state='paid' from public.marketplace_orders where id=(newer->>'id')::uuid);
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  update public.marketplace_listings set inventory_kind='ordinary' where id=(f#>>'{o,listing_id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_ordinary_guard','checkout.session.completed',c,now())='review';
  assert (select status='active' from public.marketplace_listings where id=(f#>>'{o,listing_id}')::uuid);
  f:=pg_temp.payment_fixture(); c:=f->'c'; oid:=(f#>>'{o,id}')::uuid;
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_expired_before_mismatch','checkout.session.expired',c||'{"status":"expired","paymentStatus":"unpaid","intentStatus":"canceled"}',now())='expired';
  assert public.marketplace_apply_checkout('event-tests',oid,'evt_expired_mismatch','checkout.session.completed',c||'{"grossMinor":123451}',now())='review','expired known mismatch retains review evidence';
  raise notice 'PASS late attach review evidence, no-PI expiry, newer paid preserved, sandbox-only Sold';
end $$;
reset role;
rollback;
