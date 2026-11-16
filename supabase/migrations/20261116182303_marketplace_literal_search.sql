begin;
-- Parameterized substring search avoids PostgREST wildcard/filter grammar entirely.
-- This invoker function returns only active public listing data and obeys RLS.
create function public.marketplace_browse(p_q text default '', p_category text default 'All', p_sort text default 'newest', p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if p_q is null or char_length(p_q)>100 or p_page is null or p_page<0 or p_page>100000
     or p_sort is null or p_sort not in ('newest','price_asc','price_desc','name')
     or p_category is null or p_category not in ('All','Electronics','Furniture','Clothing','Books','Sports','Home','Other')
  then raise exception 'invalid_filters'; end if;
  with filtered as materialized (
    select id,title,description,price,currency,category,seller_display_name,image_path,status,created_at
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
