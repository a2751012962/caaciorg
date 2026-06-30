-- Households (family memberships) + admin member management.
-- A "household" is one family membership that can cover several people. Adult
-- members who have their own login are linked via members.household_id; family
-- members WITHOUT a login (children, a spouse who never signs in) live in
-- household_members so admins can manage the whole family from one place.
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

-- ============================================================
-- Households — one row per family membership
-- ============================================================
create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                       -- e.g. 'The Lee Family'
  tier_id      text references public.membership_tiers(id),
  status       text not null default 'active'
                 check (status in ('pending', 'active', 'expired', 'cancelled')),
  member_since timestamptz,
  expires_at   timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);

-- Link a member (login account) to a household, plus a free-text admin note.
alter table public.members
  add column if not exists household_id uuid references public.households(id) on delete set null,
  add column if not exists notes        text;

-- ============================================================
-- People inside a household. member_id is set when the person also has a login
-- account; it's null for account-less family members (kids, etc.).
-- ============================================================
create table if not exists public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id    uuid references public.members(id) on delete set null,
  full_name    text not null,
  email        text,
  phone        text,
  relationship text,                                -- head | spouse | child | parent | other
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists household_members_household_idx on public.household_members(household_id);
create index if not exists members_household_idx on public.members(household_id);
