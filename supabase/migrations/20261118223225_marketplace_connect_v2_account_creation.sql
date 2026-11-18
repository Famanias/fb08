begin;

-- Change the API only for new slots. A retry must keep its original key and
-- API operation even when its first provider response was lost.
create or replace function public.marketplace_ensure_account_slot(p_tenant text,p_seller_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.marketplace_connected_accounts;
begin
  if not exists(select 1 from public.marketplace_payment_sellers where id=p_seller_id and tenant=p_tenant) then raise exception 'seller_unavailable'; end if;
  insert into public.marketplace_connected_accounts(tenant,seller_id,account_create_key)
    values(p_tenant,p_seller_id,p_tenant||':account:'||gen_random_uuid()::text||':v2')
    on conflict(tenant,seller_id) do nothing;
  select * into strict a from public.marketplace_connected_accounts where tenant=p_tenant and seller_id=p_seller_id;
  return jsonb_build_object('seller_id',a.seller_id,'account_id',a.account_id,'account_create_key',a.account_create_key,'prepared_at',a.prepared_at);
end $$;

commit;
