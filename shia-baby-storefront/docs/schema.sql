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
