-- CAACI backend schema (Supabase / Postgres)
-- Replaces MemberPress + WooCommerce + Events Calendar data model.
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

-- ============================================================
-- Membership tiers (public read). Prices in USD cents.
-- Base prices from the live site; card surcharge ~3.5% applied at checkout.
-- ============================================================
create table if not exists public.membership_tiers (
  id            text primary key,                 -- 'student' | 'individual' | 'family' | 'business'
  name          text not null,
  price_cents   integer not null,                 -- base annual price
  period        text not null default 'year',
  description   text,
  sort_order    integer not null default 0,
  active        boolean not null default true
);

-- ============================================================
-- Members — one row per authenticated user (linked to auth.users)
-- ============================================================
create table if not exists public.members (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  email           text,
  phone           text,
  tier_id         text references public.membership_tiers(id),
  status          text not null default 'pending',  -- pending | active | expired | cancelled
  member_since    timestamptz,
  expires_at      timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  is_admin        boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- Events (The Events Calendar replacement). Public read.
-- ============================================================
create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text unique,
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  location     text,
  image_url    text,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  member_id   uuid not null references auth.users(id) on delete cascade,
  guests      integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_id, member_id)
);

-- ============================================================
-- Business directory. Public read for approved entries.
-- ============================================================
create table if not exists public.business_directory (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text,                                -- restaurant | bakery | supermarket | other
  description  text,
  address      text,
  phone        text,
  website      text,
  image_url    text,
  owner_id     uuid references auth.users(id) on delete set null,
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- Donations (Stripe). Server-written only.
-- ============================================================
create table if not exists public.donations (
  id                 uuid primary key default gen_random_uuid(),
  donor_name         text,
  donor_email        text,
  amount_cents       integer not null,
  recurring          boolean not null default false,
  stripe_session_id  text,
  status             text not null default 'pending',  -- pending | paid | failed
  created_at         timestamptz not null default now()
);

-- ============================================================
-- Generic form submissions (contact form, etc.)
-- ============================================================
create table if not exists public.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'contact',    -- contact | volunteer | other
  name        text,
  email       text,
  phone       text,
  message     text,
  created_at  timestamptz not null default now()
);

-- Auto-create a members row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
