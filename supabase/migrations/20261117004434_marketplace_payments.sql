begin;
alter table public.marketplace_listings add column inventory_kind text not null default 'ordinary'
  check (inventory_kind in ('ordinary','demo','sandbox'));

create table public.marketplace_payment_inventory (
  listing_id uuid primary key references public.marketplace_listings(id) on delete restrict,
  tenant text not null check (char_length(tenant) between 1 and 100),
  unique(listing_id,tenant)
);
create table public.marketplace_payment_sellers (
  id uuid primary key default gen_random_uuid(),
  tenant text not null check (char_length(tenant) between 1 and 100),
  email_normalized text not null check (email_normalized=lower(btrim(email_normalized)) and char_length(email_normalized) between 3 and 254),
  verified_at timestamptz not null,
  unique(tenant,email_normalized), unique(id,tenant)
);
create table public.marketplace_seller_challenges (
  id uuid primary key default gen_random_uuid(), tenant text not null,
  email_normalized text not null, browser_nonce_hash text not null, code_hash text not null,
  expires_at timestamptz not null, attempts integer not null default 0 check(attempts between 0 and 5),
  consumed_at timestamptz, created_at timestamptz not null default now()
);
create index marketplace_challenges_browser on public.marketplace_seller_challenges(tenant,email_normalized,browser_nonce_hash);
create table public.marketplace_seller_sessions (
  token_hash text primary key, tenant text not null, seller_id uuid not null,
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key(seller_id,tenant) references public.marketplace_payment_sellers(id,tenant) on delete restrict
);
create table public.marketplace_connected_accounts (
  seller_id uuid not null, tenant text not null,
  account_id text unique, ready boolean not null default false,
  connection text not null default 'pending' check(connection in ('pending','ready','restricted')),
  checked_at timestamptz, account_create_key text not null unique, prepared_at timestamptz not null default now(),
  charges_enabled boolean not null default false, payouts_enabled boolean not null default false,
  details_submitted boolean not null default false, card_payments_active boolean not null default false,
  transfers_active boolean not null default false, disabled_reason text,
  primary key(tenant,seller_id), unique(tenant,seller_id,account_id),
  foreign key(seller_id,tenant) references public.marketplace_payment_sellers(id,tenant) on delete restrict,
  check(not ready or (account_id is not null and connection='ready' and checked_at is not null))
);
create table public.marketplace_orders (
  id uuid primary key default gen_random_uuid(), tenant text not null, listing_id uuid not null,
  seller_id uuid not null, account_id text not null, buyer_access_hash text not null check(char_length(buyer_access_hash) between 1 and 256),
  read_expires_at timestamptz not null, submission_key uuid not null,
  state text not null default 'preparing' check(state in ('preparing','open','paid','expired','review')),
  title text not null, gross_minor bigint not null check(gross_minor between 10000 and 99999999),
  fee_minor bigint not null check(fee_minor=(gross_minor+5)/10),
  currency text not null default 'php' check(currency='php'), livemode boolean not null default false check(not livemode),
  session_id text unique, payment_intent_id text unique, create_key text not null unique,
  checkout_expires_at bigint not null check(checkout_expires_at between 0 and 9007199254740991),
  prepared_at timestamptz not null, stripe_api_version text, create_params jsonb,
  settlement jsonb, updated_at timestamptz not null default now(),
  unique(tenant,buyer_access_hash,submission_key), unique(id,tenant),
  foreign key(listing_id,tenant) references public.marketplace_payment_inventory(listing_id,tenant) on delete restrict,
  foreign key(tenant,seller_id,account_id) references public.marketplace_connected_accounts(tenant,seller_id,account_id) on delete restrict,
  check((create_params is null)=(stripe_api_version is null))
);
create unique index marketplace_one_hold on public.marketplace_orders(listing_id) where state in ('preparing','open','review');
create unique index marketplace_one_sale on public.marketplace_orders(listing_id) where state='paid';
create index marketplace_orders_reconcile on public.marketplace_orders(tenant,state,prepared_at);
create table public.marketplace_stripe_events (
  tenant text not null, event_id text not null, order_id uuid not null,
  event_type text not null, outcome text not null check(outcome in ('paid','expired','held','review','duplicate')),
  source text not null check(source in ('webhook','operator')),
  created_at timestamptz not null default now(), primary key(tenant,event_id),
  foreign key(order_id,tenant) references public.marketplace_orders(id,tenant) on delete restrict
);
do $$ declare t text; begin
  foreach t in array array['marketplace_payment_inventory','marketplace_payment_sellers','marketplace_seller_challenges','marketplace_seller_sessions','marketplace_connected_accounts','marketplace_orders','marketplace_stripe_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
commit;
