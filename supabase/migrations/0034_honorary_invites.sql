-- 0034 — Honorable Membership by invitation code.
--
-- Until now the invite-only Honorable tier (0011) could only be handed out one
-- member at a time from the admin panel, with the emailed verification code
-- each time. This lets the Board hand out a LINK instead: an admin creates a
-- code in the back office (with an optional expiry and a cap on how many people
-- may use it), sends /account/?invite=<code> to the people it honours, and each
-- of them signs in — or signs up — and activates the membership themselves.
--
--   * invite_codes       — one row per code: which tier it grants (honorary
--                          today; the column exists so a second invite-only
--                          tier needs no new table), whether it is still
--                          active, when it expires, how many people may use it
--                          and how many have. Codes are stored upper-cased.
--   * invite_redemptions — who used which code, when. A code that has been
--                          used is never deleted (the API refuses), so this
--                          stays the record of how each Honorable member got
--                          the tier.
--   * invite_redeem()    — the whole activation, in one transaction under a
--                          lock on the code's row, so two people using the
--                          last seat of a capped code cannot both get it. It
--                          returns jsonb { ok, reason } instead of raising, so
--                          /api/invite can map a refusal to a readable answer.
--                          A member who currently holds an ACTIVE PAID plan is
--                          refused (reason paid_plan): trading a paid year for
--                          the free tier is the Board's call to make from the
--                          admin panel, and a Stripe subscription would go on
--                          billing someone the site shows as Honorable.
--
-- Tokens: the Board decided (2026-09-24) that an Honorable member receives 20
-- 华协币 on activation, a token of thanks rather than the paid plans' yearly
-- amount. That is one more key in token_settings.grants, read by the same
-- token_membership_grant() the Stripe webhook calls, so /api/invite grants it
-- the way a payment would and the admin token settings page can change it.
-- The key is only added when it is absent, so re-pasting this file never
-- overwrites a number an admin has since changed.
--
-- Both tables and the function are server-only, as in 0017: RLS on with no
-- policies, every table privilege revoked from anon and authenticated, and
-- EXECUTE revoked from public, anon and authenticated and granted to
-- service_role only.
-- Idempotent (if not exists / create or replace / revoke), so pasting it twice is safe.
-- Apply by pasting into the Supabase SQL editor, in filename order (see SETUP.md).

create table if not exists public.invite_codes (
  code             text primary key check (code = upper(code) and code <> ''),
  tier_id          text not null default 'honorary' references public.membership_tiers(id),
  note             text,                              -- staff-facing: who this batch is for
  active           boolean not null default true,
  expires_at       timestamptz,                       -- null = never expires
  max_redemptions  integer check (max_redemptions is null or max_redemptions >= 1),  -- null = unlimited
  times_redeemed   integer not null default 0,
  created_by       uuid references public.members(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.invite_redemptions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null references public.invite_codes(code),
  member_id    uuid not null references public.members(id) on delete cascade,
  tier_id      text not null,
  redeemed_at  timestamptz not null default now(),
  unique (code, member_id)
);

create index if not exists invite_redemptions_member_idx on public.invite_redemptions (member_id);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.invite_codes       enable row level security;
alter table public.invite_redemptions enable row level security;
revoke all on table public.invite_codes       from anon, authenticated;
revoke all on table public.invite_redemptions from anon, authenticated;

-- Activate the code's tier for one member. Locks the code's row first, then the
-- member's, so the cap is counted under the lock. Reasons:
--   invalid          unknown code, or switched off
--   expired          past expires_at
--   used_up          times_redeemed has reached max_redemptions
--   no_member        p_member has no members row
--   paid_plan        the member holds an active paid tier, or a live Stripe subscription
--   already_member   the member already holds this tier, active
--   already_redeemed this member has used this code before
create or replace function public.invite_redeem(p_code text, p_member uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.invite_codes%rowtype;
  m public.members%rowtype;
begin
  select * into c from public.invite_codes
    where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not c.active then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_redemptions is not null and c.times_redeemed >= c.max_redemptions then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;

  select * into m from public.members where id = p_member for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;
  if m.stripe_subscription_id is not null and m.status in ('active', 'past_due') then
    return jsonb_build_object('ok', false, 'reason', 'paid_plan');
  end if;
  if m.status = 'active' and (m.expires_at is null or m.expires_at > now()) then
    if m.tier_id = c.tier_id then
      return jsonb_build_object('ok', false, 'reason', 'already_member');
    end if;
    if exists (select 1 from public.membership_tiers t where t.id = m.tier_id and t.price_cents > 0) then
      return jsonb_build_object('ok', false, 'reason', 'paid_plan');
    end if;
  end if;
  if exists (select 1 from public.invite_redemptions r where r.code = c.code and r.member_id = p_member) then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  update public.members
     set tier_id = c.tier_id,
         status = 'active',
         member_since = coalesce(member_since, now()),
         expires_at = null,
         stripe_subscription_id = null
   where id = p_member;
  insert into public.invite_redemptions (code, member_id, tier_id) values (c.code, p_member, c.tier_id);
  update public.invite_codes set times_redeemed = times_redeemed + 1 where code = c.code;
  return jsonb_build_object('ok', true, 'code', c.code, 'tier_id', c.tier_id);
end $$;

-- ---- server-only: only the service role (the Pages Functions) may call this ----
revoke execute on function public.invite_redeem(text, uuid) from public, anon, authenticated;
grant execute on function public.invite_redeem(text, uuid) to service_role;

-- 20 华协币 on activation (see the header). Added only when the key is absent.
update public.token_settings
   set grants = grants || '{"honorary": 20}'::jsonb
 where not (grants ? 'honorary');
