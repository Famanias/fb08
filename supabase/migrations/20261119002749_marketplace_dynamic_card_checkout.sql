begin;

-- Accept dynamic card-only Checkout snapshots. Existing snapshots remain immutable.
create or replace function public.marketplace_prepare_checkout(p_tenant text,p_order_id uuid,p_params jsonb,p_api_version text)
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
    and p_params-array['mode','payment_method_types','excluded_payment_method_types','wallet_options','client_reference_id','expires_at','metadata','line_items','payment_intent_data','success_url','cancel_url','automatic_tax','adaptive_pricing','allow_promotion_codes','discounts','shipping_options','after_expiration']='{}'::jsonb
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
    p_params->>'mode'='payment' and (
      (p_params->'payment_method_types'='["card"]'::jsonb
        and not (p_params ? 'excluded_payment_method_types') and not (p_params ? 'wallet_options'))
      or (not (p_params ? 'payment_method_types')
        and p_params->'wallet_options'='{"link":{"display":"never"}}'::jsonb
        and jsonb_typeof(p_params->'excluded_payment_method_types')='array'
        and jsonb_array_length(p_params->'excluded_payment_method_types') between 1 and 100
        and not ((p_params->'excluded_payment_method_types') ? 'card'))
    )
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

commit;
