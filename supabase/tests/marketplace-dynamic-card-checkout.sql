-- Tests only disposable rows. The outer transaction is always rolled back.
begin;
set local role service_role;
do $$
declare
  t text := 'dynamic-checkout-'||gen_random_uuid()::text;
  listing uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  account text := 'acct_'||replace(gen_random_uuid()::text,'-','');
  o jsonb; metadata jsonb; params jsonb; changed jsonb;
begin
  insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,inventory_kind)
    values(listing,'Fictional dynamic fixture','Fixture only',1234.50,'Other','Test','listings/'||listing::text||'.webp','sandbox');
  insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at)
    values(seller,t,seller::text||'@example.invalid',now());
  insert into public.marketplace_payment_inventory(listing_id,tenant,seller_id)
    values(listing,t,seller);
  insert into public.marketplace_connected_accounts(tenant,seller_id,account_id,ready,connection,checked_at,account_create_key)
    values(t,seller,account,true,'ready',now(),t||':account:fixture:v2');
  o:=public.marketplace_reserve_order(t,listing,'buyer-fixture',gen_random_uuid(),now());
  metadata:=jsonb_build_object('fb08_app','marketplace-payments-v1','tenant',t,'order_id',o->>'id','listing_id',listing::text);
  params:=jsonb_build_object(
    'mode','payment','client_reference_id',o->>'id','expires_at',(o->>'checkout_expires_at')::bigint,
    'excluded_payment_method_types','["paypal","us_bank_account"]'::jsonb,
    'wallet_options','{"link":{"display":"never"}}'::jsonb,
    'metadata',metadata,'line_items','[{"quantity":1,"price_data":{"currency":"php","unit_amount":123450}}]'::jsonb,
    'payment_intent_data',jsonb_build_object('application_fee_amount',12345,'metadata',metadata)
  );
  for changed in select value from jsonb_array_elements(jsonb_build_array(
    params-'wallet_options',
    params||'{"wallet_options":{"link":{"display":"auto"}}}'::jsonb,
    params||'{"excluded_payment_method_types":["card"]}'::jsonb,
    params||'{"payment_method_types":["card"]}'::jsonb
  )) loop
    begin
      perform public.marketplace_prepare_checkout(t,(o->>'id')::uuid,changed,'test-version');
      raise exception 'invalid dynamic Checkout snapshot was accepted';
    exception when raise_exception then
      if sqlerrm<>'invalid_checkout' then raise; end if;
    end;
  end loop;
  assert (public.marketplace_prepare_checkout(t,(o->>'id')::uuid,params,'test-version')->'create_params')=params;
  assert (public.marketplace_prepare_checkout(t,(o->>'id')::uuid,'{}','different-version')->'create_params')=params;
end $$;
rollback;
