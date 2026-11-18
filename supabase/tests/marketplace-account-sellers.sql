-- Owned disposable database only. All fixtures roll back.
begin;
insert into public.board_users(id,username,password_hash) values
  ('71000000-0000-4000-8000-000000000001','payment-owner-one','local-fixture'),
  ('71000000-0000-4000-8000-000000000002','payment-owner-two','local-fixture');

set local role service_role;
do $$
declare
  first_owner uuid := '71000000-0000-4000-8000-000000000001';
  second_owner uuid := '71000000-0000-4000-8000-000000000002';
  first_item uuid := gen_random_uuid();
  second_item uuid := gen_random_uuid();
  legacy_item uuid := gen_random_uuid();
  submission uuid := gen_random_uuid();
  tenant text := 'account-sellers-sql';
  first_seller uuid;
  second_seller uuid;
  legacy_seller uuid;
  input jsonb := '{"inventoryKind":"sandbox","title":"Fictional","description":"Fixture","price":"1234.50","category":"Other","sellerDisplayName":"Seller","sellerEmail":"same@example.invalid"}';
  display jsonb;
begin
  insert into storage.objects(bucket_id,name) select 'marketplace-images','listings/'||id::text||'.webp'
    from unnest(array[first_item,second_item,legacy_item]) as items(id);

  assert public.marketplace_publish_owned_sandbox(submission,'one',first_item,'listings/'||first_item||'.webp',input,tenant,first_owner)=first_item;
  assert public.marketplace_publish_owned_sandbox(submission,'one',gen_random_uuid(),'unused',input,tenant,first_owner)=first_item;
  begin
    perform public.marketplace_publish_owned_sandbox(submission,'one',first_item,'listings/'||first_item||'.webp',input,tenant,second_owner);
    raise exception 'another user reused the listing request';
  exception when raise_exception then
    if sqlerrm<>'request_conflict' then raise; end if;
  end;
  assert public.marketplace_publish_owned_sandbox(gen_random_uuid(),'two',second_item,'listings/'||second_item||'.webp',input,tenant,second_owner)=second_item;
  perform public.marketplace_publish(gen_random_uuid(),'legacy',legacy_item,'listings/'||legacy_item||'.webp',input||jsonb_build_object('paymentTenant',tenant));

  select seller_id into strict first_seller from public.marketplace_payment_inventory where listing_id=first_item;
  select seller_id into strict second_seller from public.marketplace_payment_inventory where listing_id=second_item;
  assert first_seller is not null and second_seller is not null and first_seller<>second_seller,'shared inquiry email must not share ownership';
  assert (select user_id from public.marketplace_payment_sellers where id=first_seller)=first_owner;
  assert (select user_id from public.marketplace_payment_sellers where id=second_seller)=second_owner;
  insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
  values(tenant,first_seller,'acct_ownershipfixture',true,'ready',now(),'owned-account-create');
  insert into public.marketplace_payment_sellers(tenant,email_normalized,verified_at)
    values(tenant,'same@example.invalid',now()) returning id into legacy_seller;
  insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
  values(tenant,legacy_seller,'acct_legacyfixture',true,'ready',now(),'legacy-account-create');
  update public.marketplace_listing_contacts set seller_email='new-contact@example.invalid' where listing_id=first_item;
  display:=public.marketplace_payment_display(array[first_item,second_item,legacy_item],tenant,true);
  assert (select row->>'availability' from jsonb_array_elements(display) row where row->>'listing_id'=first_item::text)='ready';
  assert (select row->>'availability' from jsonb_array_elements(display) row where row->>'listing_id'=second_item::text)='unavailable';
  assert (select row->>'availability' from jsonb_array_elements(display) row where row->>'listing_id'=legacy_item::text)='unavailable';
  assert (public.marketplace_reserve_order(tenant,first_item,'buyer-proof',gen_random_uuid(),now())->>'seller_id')::uuid=first_seller;
  begin
    perform public.marketplace_reserve_order(tenant,legacy_item,'legacy-buyer',gen_random_uuid(),now());
    raise exception 'unowned inventory was reserved';
  exception when raise_exception then
    if sqlerrm not in ('listing_unavailable','seller_unavailable') then raise; end if;
  end;

  assert not has_function_privilege('anon','public.marketplace_publish_owned_sandbox(uuid,text,uuid,text,jsonb,text,uuid)','execute');
  assert not has_function_privilege('authenticated','public.marketplace_publish_owned_sandbox(uuid,text,uuid,text,jsonb,text,uuid)','execute');
end $$;
rollback;
