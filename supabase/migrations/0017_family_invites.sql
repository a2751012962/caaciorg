-- Self-service family invitations (/api/family).
-- A family ("household") covers at most 3 people, founder included: login
-- accounts linked through members.household_id, name-only people in
-- household_members (member_id is null), and pending invitations that have not
-- expired. The founder is the member holding the family plan; they invite people
-- by email, and an invitee joins by accepting while signed in with that address.
--   * households.founder_member_id — who holds the plan. Null for families an
--     admin made by hand before this; those keep using the households row's plan.
--   * household_invites — one row per invitation. The email is stored
--     lower-cased (checked), and at most one PENDING invitation per address per
--     family (partial unique index).
--   * household_events — join / leave / remove / invite / dissolve history, kept
--     when a family is dissolved (only deleting the household removes it).
--   * family_* functions — the 3-person cap is enforced here, not in the Worker:
--     each one locks the households row (select ... for update) before counting,
--     so two concurrent invitations cannot both take the last seat. They return
--     jsonb { ok, reason } instead of raising, so /api/family can map a refusal
--     to a readable answer.
-- Both tables and every function are server-only, as in 0015: RLS on with no
-- policies, every table privilege revoked from anon and authenticated, and
-- EXECUTE revoked from public, anon and authenticated (Supabase grants those
-- roles EXECUTE on new functions by default) and granted to service_role only.
-- Browser writes on members were already revoked by 0014.
-- Idempotent (if not exists / create or replace / revoke), so pasting it twice is safe.
-- Apply by pasting into the Supabase SQL editor, in filename order (see SETUP.md).

alter table public.households
  add column if not exists founder_member_id uuid references public.members(id) on delete set null;

create table if not exists public.household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  email         text not null check (email = lower(email)),
  full_name     text,
  relationship  text check (relationship in ('head', 'spouse', 'child', 'parent', 'other')),
  invited_by    uuid references public.members(id) on delete set null,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  responded_at  timestamptz,
  member_id     uuid references public.members(id) on delete set null  -- the invitee's account, once known
);

create unique index if not exists household_invites_one_pending
  on public.household_invites (household_id, lower(email)) where status = 'pending';
create index if not exists household_invites_household_idx on public.household_invites (household_id);
create index if not exists household_invites_email_idx on public.household_invites (email);

create table if not exists public.household_events (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  type              text not null check (type in (
                      'joined', 'left', 'member_removed', 'invite_sent', 'invite_cancelled',
                      'invite_declined', 'person_added', 'person_removed', 'dissolved')),
  actor_member_id   uuid references public.members(id) on delete set null,
  subject_member_id uuid references public.members(id) on delete set null,
  subject_email     text,
  created_at        timestamptz not null default now()
);

create index if not exists household_events_household_idx
  on public.household_events (household_id, created_at desc);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.household_invites enable row level security;
alter table public.household_events  enable row level security;
revoke all on table public.household_invites from anon, authenticated;
revoke all on table public.household_events  from anon, authenticated;

-- ============================================================
-- Seats in use: linked login accounts + name-only people + pending, unexpired
-- invitations. p_except_invite leaves out the invitation being accepted, so it
-- does not count twice once its invitee is linked.
-- ============================================================
create or replace function public.family_seats_used(p_household uuid, p_except_invite uuid default null)
returns integer language sql stable security definer set search_path = public as $$
  select (
      (select count(*) from public.members where household_id = p_household)
    + (select count(*) from public.household_members
         where household_id = p_household and member_id is null)
    + (select count(*) from public.household_invites
         where household_id = p_household and status = 'pending' and expires_at > now()
           and (p_except_invite is null or id <> p_except_invite))
  )::integer;
$$;

-- A family-plan member with no family yet becomes its founder: a new household,
-- their account linked to it, and a 'head' household_members row.
create or replace function public.family_create_household(
  p_founder uuid, p_name text, p_full_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_current   uuid;
  v_household uuid;
begin
  select household_id into v_current from public.members where id = p_founder for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;
  if v_current is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_in_household');
  end if;
  insert into public.households (name, tier_id, status, member_since, founder_member_id)
    values (p_name, 'family', 'active', now(), p_founder)
    returning id into v_household;
  update public.members set household_id = v_household where id = p_founder;
  insert into public.household_members (household_id, member_id, full_name, relationship, email, is_primary)
    values (v_household, p_founder, p_full_name, 'head', lower(p_email), true);
  return jsonb_build_object('ok', true, 'household_id', v_household);
end;
$$;

-- Claim a seat with a new pending invitation.
create or replace function public.family_create_invite(
  p_household uuid, p_email text, p_full_name text, p_relationship text,
  p_invited_by uuid, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invite public.household_invites;
begin
  perform 1 from public.households
    where id = p_household and status <> 'cancelled' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_household');
  end if;
  -- Stale invitations neither hold a seat nor block a new one for the same address.
  update public.household_invites set status = 'expired'
    where household_id = p_household and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.household_invites
               where household_id = p_household and status = 'pending'
                 and lower(email) = lower(p_email)) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_invite');
  end if;
  if public.family_seats_used(p_household) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'family_full');
  end if;
  insert into public.household_invites (household_id, email, full_name, relationship, invited_by, member_id)
    values (p_household, lower(p_email), p_full_name, p_relationship, p_invited_by, p_member_id)
    returning * into v_invite;
  return jsonb_build_object('ok', true, 'invite', to_jsonb(v_invite));
end;
$$;

-- Claim a seat with a name-only person (no login account).
create or replace function public.family_add_person(
  p_household uuid, p_full_name text, p_relationship text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_person public.household_members;
begin
  perform 1 from public.households
    where id = p_household and status <> 'cancelled' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_household');
  end if;
  update public.household_invites set status = 'expired'
    where household_id = p_household and status = 'pending' and expires_at <= now();
  if public.family_seats_used(p_household) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'family_full');
  end if;
  insert into public.household_members (household_id, full_name, relationship)
    values (p_household, p_full_name, p_relationship)
    returning * into v_person;
  return jsonb_build_object('ok', true, 'person', to_jsonb(v_person));
end;
$$;

-- Turn a pending invitation into a linked account. The invitation already holds
-- a seat, so the cap check leaves it out; everything else that took a seat since
-- it was sent still counts.
create or replace function public.family_accept_invite(
  p_invite uuid, p_member uuid, p_email text, p_full_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_household uuid;
  v_invite    public.household_invites;
  v_current   uuid;
begin
  select household_id into v_household from public.household_invites where id = p_invite;
  if v_household is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform 1 from public.households
    where id = v_household and status <> 'cancelled' for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_household');
  end if;
  select * into v_invite from public.household_invites where id = p_invite for update;
  if lower(v_invite.email) <> lower(p_email) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_email');
  end if;
  if v_invite.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;
  if v_invite.expires_at <= now() then
    update public.household_invites set status = 'expired' where id = p_invite;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select household_id into v_current from public.members where id = p_member for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;
  if v_current is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_in_household');
  end if;
  if public.family_seats_used(v_household, p_invite) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'family_full');
  end if;
  update public.members set household_id = v_household where id = p_member;
  insert into public.household_members (household_id, member_id, full_name, relationship, email)
    values (v_household, p_member, coalesce(nullif(v_invite.full_name, ''), p_full_name, lower(p_email)),
            v_invite.relationship, lower(p_email));
  update public.household_invites
    set status = 'accepted', responded_at = now(), member_id = p_member
    where id = p_invite;
  return jsonb_build_object('ok', true, 'household_id', v_household);
end;
$$;

-- ---- server-only: only the service role (the Pages Functions) may call these ----
revoke execute on function public.family_seats_used(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.family_create_household(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.family_create_invite(uuid, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.family_add_person(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.family_accept_invite(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.family_seats_used(uuid, uuid) to service_role;
grant execute on function public.family_create_household(uuid, text, text, text) to service_role;
grant execute on function public.family_create_invite(uuid, text, text, text, uuid, uuid) to service_role;
grant execute on function public.family_add_person(uuid, text, text) to service_role;
grant execute on function public.family_accept_invite(uuid, uuid, text, text) to service_role;
