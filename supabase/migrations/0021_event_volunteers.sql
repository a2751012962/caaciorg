-- Volunteer sign-ups: people who offer to help, either from the /volunteer/
-- page (which lets them tick the events they would like to help with, or none
-- in particular) or from the "I'd also like to volunteer" box on an event's
-- registration form.
--   * event_volunteers — one row per email address per event. event_id null is
--     the "no particular event / wherever needed" sign-up, and counts as one
--     event of its own, so the unique index uses `nulls not distinct`: without
--     it Postgres treats every null as different and the same person could
--     stack up unlimited "any event" rows. The email is stored lower-cased
--     (checked) so the unique key cannot be dodged by case, and
--     /api/volunteer upserts on (event_id, email).
--   * source — which form created the row ('volunteer' | 'registration'), so
--     the admin list can tell a volunteer-page sign-up from one that came with
--     an event registration.
--   * created_at is the FIRST sign-up time: a second submission updates the
--     name/phone/message and updated_at, but the API never sends created_at.
--   * member_id is set only when the submission came from a signed-in account
--     whose own login email is the one on the form (same rule as
--     event_registrations), so a sign-up can never be counted against a
--     stranger's account.
-- The table holds people's names, email addresses and phone numbers, and only
-- /api/volunteer, /api/event-register and /api/admin/event-volunteers touch it,
-- with the service-role key, which bypasses both RLS and table grants. Supabase
-- grants anon/authenticated every privilege on a new table in public by
-- default, so, as 0013, 0014 and 0015 did for older tables: RLS on with no
-- policies, and every table privilege revoked from both browser roles.
-- Idempotent (if not exists / revoke), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

create table if not exists public.event_volunteers (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events(id) on delete cascade,  -- null = no particular event
  name        text not null,
  email       text not null check (email = lower(email)),
  phone       text,
  message     text,                 -- how they would like to help / availability (optional)
  source      text not null default 'volunteer'
              check (source in ('volunteer', 'registration')),  -- which form created the row
  member_id   uuid references auth.users(id) on delete set null,   -- set when the signed-in account's own email
  created_at  timestamptz not null default now(),   -- first submission; never overwritten
  updated_at  timestamptz not null default now()
);

-- one row per address per event; the "no particular event" rows count as one event too
create unique index if not exists event_volunteers_event_email
  on public.event_volunteers (event_id, email) nulls not distinct;

create index if not exists event_volunteers_created on public.event_volunteers (created_at);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.event_volunteers enable row level security;
revoke all on table public.event_volunteers from anon, authenticated;
