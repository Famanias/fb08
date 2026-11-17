-- Explicit disposable local database only. Fixtures always roll back.
begin;
do $$
declare f record; r text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('marketplace_issue_seller_challenge','marketplace_consume_seller_challenge','marketplace_proof_hashes_equal') loop
    foreach r in array array['anon','authenticated'] loop assert not has_function_privilege(r,f.oid,'EXECUTE'), 'private proof RPC grants'; end loop;
  end loop;
end $$;
set local role service_role;
do $$
declare a uuid:='71000000-0000-4000-8000-000000000001'; b uuid:='71000000-0000-4000-8000-000000000002'; c uuid:='71000000-0000-4000-8000-000000000003'; d uuid:='71000000-0000-4000-8000-000000000004'; result jsonb; i integer; t timestamptz:=now();
begin
  perform public.marketplace_issue_seller_challenge(a,'seller@example.invalid','proof-sql',repeat('a',64),repeat('b',64),t+interval '10 minutes');
  assert public.marketplace_consume_seller_challenge(a,'foreign',repeat('a',64),repeat('b',64),repeat('1',64),t) is null, 'tenant bound';
  assert public.marketplace_consume_seller_challenge(a,'proof-sql',repeat('c',64),repeat('b',64),repeat('1',64),t) is null, 'browser bound';
  assert (select attempts from public.marketplace_seller_challenges where id=a)=0;
  for i in 1..5 loop
    assert public.marketplace_consume_seller_challenge(a,'proof-sql',repeat('a',64),repeat('c',64),repeat('1',64),t) is null, 'wrong guess';
  end loop;
  assert (select attempts from public.marketplace_seller_challenges where id=a)=5, 'failed attempts durable';
  assert public.marketplace_consume_seller_challenge(a,'proof-sql',repeat('a',64),repeat('b',64),repeat('1',64),t) is null, 'fifth guess exhaustion';
  perform public.marketplace_issue_seller_challenge(b,'seller@example.invalid','proof-sql',repeat('a',64),repeat('b',64),t+interval '10 minutes');
  assert (select consumed_at is not null from public.marketplace_seller_challenges where id=a), 'resend invalidates';
  assert public.marketplace_consume_seller_challenge(b,'proof-sql',repeat('a',64),repeat('b',64),repeat('1',64),t+interval '10 minutes') is null, 'expiry boundary';
  perform public.marketplace_issue_seller_challenge(c,'seller@example.invalid','proof-sql',repeat('a',64),repeat('b',64),t+interval '10 minutes');
  assert public.marketplace_consume_seller_challenge(b,'proof-sql',repeat('a',64),repeat('b',64),repeat('1',64),t) is null, 'replaced challenge';
  result:=public.marketplace_consume_seller_challenge(c,'proof-sql',repeat('a',64),repeat('b',64),repeat('1',64),t);
  assert result->>'email_normalized'='seller@example.invalid' and result->>'tenant'='proof-sql', 'verified identity';
  assert public.marketplace_consume_seller_challenge(c,'proof-sql',repeat('a',64),repeat('b',64),repeat('2',64),t) is null, 'single use';
  assert (select count(*) from public.marketplace_seller_sessions where tenant='proof-sql')=1, 'one session';
  assert (select expires_at=t+interval '1 hour' from public.marketplace_seller_sessions where token_hash=repeat('1',64)), 'one hour expiry';
  perform public.marketplace_issue_seller_challenge(d,'seller+one@example.invalid','proof-sql',repeat('a',64),repeat('b',64),t+interval '10 minutes');
  assert (public.marketplace_consume_seller_challenge(d,'proof-sql',repeat('a',64),repeat('b',64),repeat('2',64),t)->>'id')<>result->>'id', 'plus address distinct';
  assert public.marketplace_proof_hashes_equal(repeat('a',64),repeat('a',64));
  assert not public.marketplace_proof_hashes_equal(repeat('a',64),repeat('a',63)||'b');
  assert not public.marketplace_proof_hashes_equal(repeat('a',64),'short');
end $$;
rollback;
