-- Owned disposable local DB only. All fixtures roll back.
begin;
insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind)
values('60000000-0000-4000-8000-000000000001','Task6 local fixture','Fictional',1234.50,'Other','Fixture','listings/60000000-0000-4000-8000-000000000001.webp','sandbox');
insert into public.marketplace_listing_contacts values('60000000-0000-4000-8000-000000000001','Fixture@Example.invalid');
insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values('60000000-0000-4000-8000-000000000002','task6-local','fixture@example.invalid',now());
insert into public.marketplace_payment_inventory(listing_id,tenant,seller_id) values('60000000-0000-4000-8000-000000000001','task6-local','60000000-0000-4000-8000-000000000002');
insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
values('task6-local','60000000-0000-4000-8000-000000000002','acct_task6',true,'ready',now(),'task6-create');
set local role service_role;
do $$ declare o jsonb; d jsonb; ids uuid[]:=array['60000000-0000-4000-8000-000000000001'::uuid]; begin
  d:=public.marketplace_payment_display(ids,'task6-local',true);
  assert d->0->>'availability'='ready','known ready display';
  assert public.marketplace_payment_display(ids,'wrong',true)->0->>'availability'='unavailable','wrong tenant';
  assert public.marketplace_payment_display(ids,'task6-local',false)->0->>'availability'='unavailable','disabled';
  update public.marketplace_connected_accounts set checked_at=now()-interval '61 seconds' where account_id='acct_task6';
  assert public.marketplace_payment_display(ids,'task6-local',true)->0->>'availability'='unavailable','stale display';
  update public.marketplace_connected_accounts set checked_at=now() where account_id='acct_task6';
  update public.marketplace_payment_inventory set review_required=true where listing_id=ids[1];
  assert public.marketplace_payment_display(ids,'task6-local',true)->0->>'availability'='unavailable','review freeze';
  update public.marketplace_payment_inventory set review_required=false where listing_id=ids[1];
  o:=public.marketplace_reserve_order('task6-local',ids[1],repeat('a',64),'60000000-0000-4000-8000-000000000003',now());
  assert public.marketplace_payment_display(ids,'task6-local',true)->0->>'availability'='reserved','held';
  assert public.marketplace_order_confirmation((o->>'id')::uuid,repeat('b',64),'task6-local',now()) is null,'wrong browser denied';
  assert public.marketplace_order_confirmation((o->>'id')::uuid,repeat('a',64),'other',now()) is null,'wrong tenant denied';
  assert public.marketplace_order_confirmation((o->>'id')::uuid,repeat('a',64),'task6-local',now()+interval '7 days') is null,'seven day expiry';
  d:=public.marketplace_order_confirmation((o->>'id')::uuid,repeat('a',64),'task6-local',now());
  assert d->>'status'='pending' and (select count(*) from jsonb_object_keys(d))=9,'DTO only';
  assert d::text !~ 'sellerEmail|buyerEmail|accountId|sessionId|AccessHash','no private fields';
  update public.marketplace_orders set state='expired' where id=(o->>'id')::uuid;
  insert into public.marketplace_stripe_events(tenant,event_id,order_id,event_type,outcome,source) values('task6-local','operator:task6', (o->>'id')::uuid,'operator.reconcile','review','operator');
  assert public.marketplace_order_confirmation((o->>'id')::uuid,repeat('a',64),'task6-local',now())->>'status'='review','own anomaly receipt shows review';
  update public.marketplace_orders set state='paid' where id=(o->>'id')::uuid;
  update public.marketplace_listings set status='sold' where id=ids[1];
  assert public.marketplace_order_confirmation((o->>'id')::uuid,repeat('a',64),'task6-local',now())->>'status'='paid','paid stays paid';
  assert public.marketplace_payment_display(ids,'task6-local',true)->0->>'availability'='sold','sold';
  assert public.marketplace_browse('Task6 local fixture','All','newest',0)->>'total'='0','sold excluded from active feed/count';
end $$;
reset role;
set local role anon;
do $$ begin
  assert (select count(*) from public.marketplace_listings where id='60000000-0000-4000-8000-000000000001')=1,'sold detail public';
  assert not has_function_privilege('anon','public.marketplace_order_confirmation(uuid,text,text,timestamp with time zone)','EXECUTE'),'order RPC private';
  assert not has_function_privilege('anon','public.marketplace_payment_display(uuid[],text,boolean)','EXECUTE'),'display RPC private';
end $$;
reset role;
update public.marketplace_listings set status='removed' where id='60000000-0000-4000-8000-000000000001';
set local role anon;
do $$ begin assert (select count(*) from public.marketplace_listings where id='60000000-0000-4000-8000-000000000001')=0,'removed remains private'; end $$;
rollback;
