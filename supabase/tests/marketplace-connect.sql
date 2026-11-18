-- Only the owned disposable local stack. Every fixture rolls back.
begin;
set local role service_role;
do $$
declare s uuid:='72000000-0000-4000-8000-000000000001'; slot jsonb; again jsonb; f record; r text;
begin
  insert into public.marketplace_payment_sellers(id,tenant,email_normalized,verified_at) values(s,'connect-sql','seller@example.invalid',now());
  slot:=public.marketplace_ensure_account_slot('connect-sql',s);
  again:=public.marketplace_ensure_account_slot('connect-sql',s);
  assert slot=again and slot->>'account_id' is null and slot->>'account_create_key' is not null, 'durable stable slot';
  begin perform public.marketplace_ensure_account_slot('foreign',s); raise exception 'expected rejection'; exception when others then assert sqlerrm='seller_unavailable'; end;
  begin perform public.marketplace_save_account('connect-sql',s,'acct_sql','wrong-key'); raise exception 'expected rejection'; exception when others then assert sqlerrm='account_conflict'; end;
  perform public.marketplace_save_account('connect-sql',s,'acct_sql',slot->>'account_create_key');
  perform public.marketplace_save_account('connect-sql',s,'acct_sql',slot->>'account_create_key');
  begin perform public.marketplace_save_account('connect-sql',s,'acct_other',slot->>'account_create_key'); raise exception 'expected rejection'; exception when others then assert sqlerrm='account_conflict'; end;
  assert not public.marketplace_acquire_account_refresh('foreign','acct_sql',repeat('a',64));
  assert public.marketplace_acquire_account_refresh('connect-sql','acct_sql',repeat('a',64));
  assert not public.marketplace_acquire_account_refresh('connect-sql','acct_sql',repeat('b',64)), 'single lease';
  assert not public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('b',64),true,'ready',now()), 'wrong fence';
  assert public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('a',64),true,'ready',now()), 'current fence';
  assert (select ready from public.marketplace_connected_accounts where tenant='connect-sql' and seller_id=s);
  assert not public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('a',64),false,'restricted',now()), 'released fence cannot replay';
  assert public.marketplace_acquire_account_refresh('connect-sql','acct_sql',repeat('c',64));
  assert not (select ready from public.marketplace_connected_accounts where tenant='connect-sql' and seller_id=s), 'refresh immediately fails closed';
  update public.marketplace_connected_accounts set refresh_expires_at=clock_timestamp()-interval '1 second' where tenant='connect-sql' and seller_id=s;
  assert not public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('c',64),true,'ready',now()), 'expired fence';
  assert public.marketplace_acquire_account_refresh('connect-sql','acct_sql',repeat('d',64));
  assert not public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('c',64),true,'ready',now()), 'superseded fence';
  assert public.marketplace_save_account_readiness('connect-sql','acct_sql',repeat('d',64),false,'restricted',now());
  assert not (select ready from public.marketplace_connected_accounts where tenant='connect-sql' and seller_id=s);
  for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('marketplace_ensure_account_slot','marketplace_save_account','marketplace_acquire_account_refresh','marketplace_save_account_readiness') loop
    assert not f.prosecdef and f.proconfig @> array['search_path=""'], 'invoker and empty path';
    foreach r in array array['anon','authenticated'] loop assert not has_function_privilege(r,f.oid,'EXECUTE'), 'service-only'; end loop;
  end loop;
end $$;
rollback;
