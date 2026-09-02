-- Shia & Co. storefront — subscriber schema.
--
-- Additive and idempotent, per APP_BUILD_STANDARD.md §8. Run this once against
-- the Supabase project referenced by SHIA_SUPABASE_URL.
--
-- This file creates ONLY the storefront's own table. It deliberately does not
-- touch `shia_song_orders`, which is owned by the Shia-songs application:
-- two systems must not hold conflicting write authority over one mutable
-- resource (Factory Constitution, Invariant 7).

create table if not exists public.shia_subscribers (
  id               bigint generated always as identity primary key,
  first_name       text        not null,
  email            text        not null,
  phone            text,
  sms_opt_in       boolean     not null default false,
  -- Drives the milestone reminder flow: babies outgrow a size roughly every
  -- three months, which is what makes this list repeat revenue rather than a
  -- newsletter.
  due_or_birthday  date,
  locale           text        not null default 'en' check (locale in ('en', 'es')),
  source           text        not null default 'storefront',
  utm_campaign     text,
  utm_source       text,
  utm_medium       text,
  created_at       timestamptz not null default now()
);

-- One record per email address; a repeat signup should update, not duplicate.
create unique index if not exists shia_subscribers_email_key
  on public.shia_subscribers (lower(email));

-- Supports the milestone reminder job ("who needs the next size this month?").
create index if not exists shia_subscribers_due_idx
  on public.shia_subscribers (due_or_birthday)
  where due_or_birthday is not null;

-- Campaign attribution lookups.
create index if not exists shia_subscribers_campaign_idx
  on public.shia_subscribers (utm_campaign)
  where utm_campaign is not null;

-- Row Level Security: the storefront writes with the service role key, which
-- bypasses RLS. Enabling RLS with no permissive policy means an anon or
-- authenticated client key cannot read this table even if it leaks.
alter table public.shia_subscribers enable row level security;

-- ---------------------------------------------------------------------------
-- Product catalog — the storefront's display of real inventory.
--
-- Populated by importing an export from the shia-baby-inventory app. `cost` is
-- NOT stored here: wholesale pricing stays in the inventory tool, so it cannot
-- leak from the public API even by accident.
-- ---------------------------------------------------------------------------

create table if not exists public.shia_products (
  id           bigint generated always as identity primary key,
  sku          text unique,
  gtin         text,
  name         text        not null,
  size         text,
  category     text        not null default 'other',
  price_cents  integer     not null check (price_cents >= 0),
  currency     text        not null default 'USD',
  stock        integer     not null default 0 check (stock >= 0),
  vendor       text,
  description  text,
  image_url    text,
  -- Imports land unpublished; nothing shows to customers until deliberately published.
  published    boolean     not null default false,
  source       text        not null default 'shia-baby-inventory',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The public storefront's only query shape.
create index if not exists shia_products_published_idx
  on public.shia_products (published, category, size)
  where published = true;

create index if not exists shia_products_name_idx on public.shia_products (name);

-- Keep updated_at honest without application code remembering to set it.
create or replace function public.shia_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shia_products_touch on public.shia_products;
create trigger shia_products_touch
  before update on public.shia_products
  for each row execute function public.shia_touch_updated_at();

-- Writes go through the service role key on the server. RLS on with no
-- permissive policy means a leaked anon key still cannot read or write.
alter table public.shia_products enable row level security;

-- ---------------------------------------------------------------------------
-- Reveal & experience box orders.
--
-- CONFIDENTIALITY
-- ---------------
-- `secret_gender` is the answer the buyer must not see. It is deliberately in
-- the same row as the order rather than a separate table, because the risk here
-- is not database access — the service role reads everything either way — it is
-- an application selecting `*` into a customer-facing response. That is guarded
-- in code by toBuyerView() and covered by tests/reveal.test.js.
--
-- `keeper_token_hash` stores only a SHA-256 hash. If this table leaked, the
-- hashes could not be replayed as working secret-keeper links.
-- ---------------------------------------------------------------------------
create table if not exists public.shia_reveal_orders (
  id                  uuid primary key,
  kind                text not null,
  status              text not null default 'awaiting_secret',
  buyer_name          text not null,
  buyer_email         text not null,
  buyer_phone         text,
  baby_family_name    text,
  outfit_size         text,
  reveal_date         date,
  song_notes          text,
  keeper_email        text,
  keeper_token_hash   text,
  keeper_submitted_at timestamptz,
  secret_gender       text,
  square_order_id     text,
  internal_notes      text,
  locale              text not null default 'en',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- The secret-keeper lookup is by hash on every visit to the link, so it is the
-- one query that must not table-scan.
create unique index if not exists shia_reveal_keeper_hash_idx
  on public.shia_reveal_orders (keeper_token_hash)
  where keeper_token_hash is not null;

create index if not exists shia_reveal_status_idx on public.shia_reveal_orders (status);
create index if not exists shia_reveal_created_idx on public.shia_reveal_orders (created_at desc);

drop trigger if exists shia_reveal_touch on public.shia_reveal_orders;
create trigger shia_reveal_touch
  before update on public.shia_reveal_orders
  for each row execute function public.shia_touch_updated_at();

alter table public.shia_reveal_orders enable row level security;
