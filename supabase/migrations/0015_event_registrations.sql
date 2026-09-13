-- Event registrations: a public, no-account sign-up form per event (first use:
-- the Mid-Autumn Festival form at /mid_autumn_festival_form/, which replaces a
-- Google Form), plus a free-gift cutoff on events.
--   * events.perk_deadline — people who register AND have a CAACI account by
--     this time get the festival's free mooncake. Null means the event's start.
--   * event_registrations — one row per email address per event. The email is
--     stored lower-cased (checked) so the unique key cannot be dodged by case,
--     and /api/event-register upserts on (event_id, email). created_at is the
--     FIRST submission time: a resubmission updates the answers and updated_at,
--     but the API never sends created_at, so re-sending the form cannot move the
--     time that decides the mooncake.
-- The table holds people's email addresses and the names of who they are
-- bringing, and only /api/event-register and /api/admin/event-registrations use
-- it, with the service-role key, which bypasses both RLS and table grants.
-- Supabase grants anon/authenticated every privilege on a new table in public
-- by default, so, as 0013 and 0014 did for older tables: RLS on with no
-- policies, and every table privilege revoked from both browser roles —
-- select, insert, update, delete, truncate (which ignores RLS entirely),
-- references and trigger (and maintain, on Postgres 17).
-- Idempotent (if not exists / revoke), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.events add column if not exists perk_deadline timestamptz;

create table if not exists public.event_registrations (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  email           text not null check (email = lower(email)),  -- one registration per address per event
  attending       boolean not null,
  attendee_names  text,            -- the API requires it when attending
  heard_from      text,            -- Website | Friend | Newsletter | Social Media | free text (Other)
  wants_meal      boolean,         -- null = not answered
  member_id       uuid references auth.users(id) on delete set null,  -- set when submitted while signed in
  created_at      timestamptz not null default now(),  -- FIRST submission time; never overwritten
  updated_at      timestamptz not null default now(),
  unique (event_id, email)
);

create index if not exists event_registrations_event_created
  on public.event_registrations (event_id, created_at);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.event_registrations enable row level security;
revoke all on table public.event_registrations from anon, authenticated;
