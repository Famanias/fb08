-- Run with service/admin authorization. All test rows exist only inside this
-- transaction and are rolled back, so fake inventory is never publicly visible.
begin;
do $$
declare i integer; v_id uuid; v_result jsonb; v_actor text := 'test:' || gen_random_uuid()::text;
begin
  for i in 1..21 loop
    v_id := gen_random_uuid();
    insert into public.marketplace_listings(id,title,description,price,category,seller_display_name,image_path,created_at)
    values(v_id,'__transaction_test__ ' || lpad(i::text,2,'0'),'Transaction only fixture',i,
      case when i=21 then 'Books' else 'Electronics' end,'Test Seller','listings/' || v_id::text || '.webp',now() - make_interval(mins=>i));
  end loop;
  v_result := public.marketplace_browse('__transaction_test__','All','newest',0);
  if (v_result->>'total')::integer <> 21 or jsonb_array_length(v_result->'listings')<>18 then raise exception 'first_page_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','All','newest',1);
  if jsonb_array_length(v_result->'listings')<>3 or v_result->'listings'->0->>'title'<>'__transaction_test__ 19' then raise exception 'second_page_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','Books','newest',0);
  if (v_result->>'total')::integer<>1 or v_result->'listings'->0->>'title'<>'__transaction_test__ 21' then raise exception 'filter_beyond_first_page_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','All','price_asc',0);
  if (v_result->'listings'->0->>'price')::numeric<>1 then raise exception 'ascending_price_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','All','price_desc',0);
  if (v_result->'listings'->0->>'price')::numeric<>21 then raise exception 'descending_price_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','All','name',0);
  if v_result->'listings'->0->>'title'<>'__transaction_test__ 01' then raise exception 'name_sort_failed'; end if;
  v_result := public.marketplace_browse('Test Seller','All','newest',0);
  if (v_result->>'total')::integer<21 then raise exception 'seller_search_failed'; end if;
  v_result := public.marketplace_browse('__transaction_test__','All','newest',100);
  if jsonb_array_length(v_result->'listings')<>0 or (v_result->>'total')::integer<>21 then raise exception 'out_of_range_failed'; end if;
  if not public.marketplace_consume_rate(v_actor,'test',2) or not public.marketplace_consume_rate(v_actor,'test',2) or public.marketplace_consume_rate(v_actor,'test',2) then raise exception 'rate_limit_failed'; end if;
  if has_table_privilege('anon','public.marketplace_listing_contacts','select') or has_table_privilege('anon','public.marketplace_inquiries','select') or has_table_privilege('anon','public.marketplace_listings','insert') then raise exception 'private_grants_failed'; end if;
  if has_function_privilege('anon','public.marketplace_publish(uuid,text,uuid,text,jsonb)','execute') or has_function_privilege('authenticated','public.marketplace_save_inquiry(uuid,text,jsonb)','execute') then raise exception 'private_rpc_grants_failed'; end if;
  raise notice 'Marketplace transaction tests passed: pagination, all sorts, full-feed filtering, seller search, stale pages, rate limits and grants.';
end;
$$;
rollback;
