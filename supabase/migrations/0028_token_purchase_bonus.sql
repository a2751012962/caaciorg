-- 0028 — a time-boxed purchase bonus.
--
-- Seeded for Mid-Autumn 2026: +50% on what a dollar buys, on 2026-09-27 only
-- (America/Chicago), on the first $100 each member spends that day, for both
-- online card purchases and cash taken at the event desk. Outside the window
-- the rate is the plain tokens_per_dollar (10 tokens per $1) with no bonus.
--
-- The bonus changes how many tokens a DOLLAR BUYS. It never changes what a
-- token is WORTH when it is spent: merchants are still settled at
-- tokens_per_dollar, so 0024's settlement maths is deliberately untouched. A
-- bonus token is therefore a promotion CAACI funds out of its own margin.
--
-- Because of that the split is recorded on the ledger row rather than folded
-- into one number, so the treasurer can read both off the same row:
--   sum(amount - bonus_tokens)  = tokens actually sold   (deferred revenue)
--   sum(bonus_tokens)           = tokens given away      (promotional expense)
--
-- Everything stays non-expiring, so 0027's constraint and the compliance
-- position it backs are unaffected. The bonus portion is also squarely a
-- promotional credit, which is the category both 815 ILCS 505/2SS and
-- Reg E 1005.20(b)(3) already carve out.

-- ------------------------------------------------------------- settings ----
alter table public.token_settings
  add column if not exists bonus_pct       integer not null default 0,
  add column if not exists bonus_from      timestamptz,
  add column if not exists bonus_to        timestamptz,
  add column if not exists bonus_cap_cents integer not null default 10000;

alter table public.token_settings drop constraint if exists token_settings_bonus_pct_range;
alter table public.token_settings add  constraint token_settings_bonus_pct_range
  check (bonus_pct >= 0 and bonus_pct <= 100);
alter table public.token_settings drop constraint if exists token_settings_bonus_cap_nonneg;
alter table public.token_settings add  constraint token_settings_bonus_cap_nonneg
  check (bonus_cap_cents >= 0);
alter table public.token_settings drop constraint if exists token_settings_bonus_window;
alter table public.token_settings add  constraint token_settings_bonus_window
  check (bonus_from is null or bonus_to is null or bonus_to > bonus_from);

-- The Mid-Autumn window, only if nobody has configured a bonus yet, so pasting
-- this again cannot stomp an admin's later edit.
update public.token_settings
   set bonus_pct       = 50,
       bonus_from      = timestamptz '2026-09-27 00:00:00 America/Chicago',
       bonus_to        = timestamptz '2026-09-28 00:00:00 America/Chicago',
       bonus_cap_cents = 10000
 where id and bonus_pct = 0 and bonus_from is null and bonus_to is null;

-- ----------------------------------------------------------- ledger row ----
alter table public.token_tx
  add column if not exists bonus_tokens integer not null default 0;
alter table public.token_tx drop constraint if exists token_tx_bonus_nonneg;
alter table public.token_tx add  constraint token_tx_bonus_nonneg
  check (bonus_tokens >= 0 and bonus_tokens <= abs(amount));

comment on column public.token_tx.bonus_tokens is
  'Of `amount`, how many tokens were a promotion rather than paid for.';

-- ---------------------------------------------------------------- quote ----
-- What p_cents buys this member right now. The single source of truth for the
-- rate: the wallet, the buy page, the cash desk and the Stripe webhook all
-- read it, so none of them can drift from the others.
--
-- The cap is per member for the whole window and counts money already spent in
-- it, so a member cannot split $200 into two $100 purchases to double the
-- bonus. Callers that are about to write must hold token_lock(p_member) first,
-- or two concurrent purchases could both read the cap as free.
create or replace function public.token_quote(p_member uuid, p_cents integer)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s        public.token_settings%rowtype;
  v_base   integer;
  v_active boolean;
  v_used   integer := 0;
  v_left   integer := 0;
  v_elig   integer := 0;
  v_bonus  integer := 0;
begin
  if p_cents is null or p_cents < 0 then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  select * into s from public.token_settings;
  v_base := (p_cents * s.tokens_per_dollar) / 100;

  v_active := s.bonus_pct > 0
          and s.bonus_from is not null and s.bonus_to is not null
          and now() >= s.bonus_from and now() < s.bonus_to;

  if v_active and p_member is not null then
    select coalesce(sum(cash_cents), 0) into v_used
      from public.token_tx
     where member_id = p_member
       and kind in ('purchase', 'cash')
       and state = 'ok'
       and created_at >= s.bonus_from
       and created_at <  s.bonus_to;
    v_left  := greatest(0, s.bonus_cap_cents - v_used);
    v_elig  := least(p_cents, v_left);
    v_bonus := (v_elig * s.tokens_per_dollar * s.bonus_pct) / 10000;
  end if;

  return jsonb_build_object(
    'cents',            p_cents,
    'rate',             s.tokens_per_dollar,
    'base',             v_base,
    'bonus',            v_bonus,
    'total',            v_base + v_bonus,
    'bonus_active',     v_active,
    'bonus_pct',        case when v_active then s.bonus_pct else 0 end,
    'bonus_from',       s.bonus_from,
    'bonus_to',         s.bonus_to,
    'bonus_cap_cents',  s.bonus_cap_cents,
    'bonus_cents_left', case when v_active then v_left else 0 end);
end $$;

-- ------------------------------------------------------------- purchase ----
-- Tokens bought online. Idempotent on the Stripe session, so a webhook retry
-- credits once. The caller reports what Stripe collected; the bonus is decided
-- HERE, so a caller cannot award itself one. Nothing expires (0027).
create or replace function public.token_purchase_credit(
  p_member uuid, p_amount integer, p_cents integer, p_session text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tx    uuid;
  v_bonus integer := 0;
  v_total integer;
begin
  if p_amount is null or p_amount <= 0 or coalesce(p_session, '') = '' then
    return jsonb_build_object('error', 'invalid_amount');
  end if;
  perform public.token_lock(p_member);
  select id into v_tx from public.token_tx where stripe_session_id = p_session;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
  end if;
  if not exists (select 1 from public.members where id = p_member) then
    return jsonb_build_object('error', 'member_not_found');
  end if;

  v_bonus := coalesce((public.token_quote(p_member, coalesce(p_cents, 0)) ->> 'bonus')::integer, 0);
  v_total := p_amount + v_bonus;

  v_tx := public.token_credit_row(p_member, 'purchase', v_total, null, null, 'stripe', p_cents, p_session, null);
  if v_bonus > 0 then
    update public.token_tx set bonus_tokens = v_bonus where id = v_tx;
  end if;
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'amount', v_total, 'bonus', v_bonus,
                            'balance', public.token_balance(p_member));
end $$;

-- ----------------------------------------------------------- admin desk ----
-- An admin adds tokens by hand: 'cash' (money taken at a desk; the tokens must
-- match what token_quote says that money buys, bonus included) or 'mint' (a
-- gift or a fix; needs a reason, never gets a bonus). An admin who is not root
-- is held to admin_mint_cap per action and admin_daily_cap of free mints per
-- day (Central time); the cap is measured on the PAID tokens, because the
-- bonus is a rule rather than the admin's discretion. Root is exempt.
-- Nothing expires (0027).
create or replace function public.token_admin_credit(
  p_member uuid, p_kind text, p_amount integer, p_cash_cents integer, p_actor uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.token_settings%rowtype;
  v_admin  boolean;
  v_root   boolean;
  v_today  integer;
  v_tx     uuid;
  v_q      jsonb;
  v_bonus  integer := 0;
  v_paid   integer;
begin
  if p_kind not in ('cash', 'mint') then return jsonb_build_object('error', 'invalid_kind'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('error', 'invalid_amount'); end if;
  select is_admin, is_root into v_admin, v_root from public.members where id = p_actor;
  if not coalesce(v_admin, false) and not coalesce(v_root, false) then
    return jsonb_build_object('error', 'not_admin');
  end if;
  if not exists (select 1 from public.members where id = p_member) then
    return jsonb_build_object('error', 'member_not_found');
  end if;
  select * into s from public.token_settings;

  if p_kind = 'cash' then
    if p_cash_cents is null or p_cash_cents < s.cash_min_cents then
      return jsonb_build_object('error', 'cash_below_minimum', 'min_cents', s.cash_min_cents);
    end if;
  else
    if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('error', 'reason_required'); end if;
  end if;

  -- Serialise this admin's credits so the daily cap cannot be raced past, then
  -- the member so two desks cannot both see the bonus cap as free. Same lock
  -- order as before (actor, then member).
  perform public.token_lock(p_actor);
  perform public.token_lock(p_member);

  if p_kind = 'cash' then
    v_q     := public.token_quote(p_member, p_cash_cents);
    v_bonus := coalesce((v_q ->> 'bonus')::integer, 0);
    if coalesce((v_q ->> 'total')::integer, -1) <> p_amount then
      return jsonb_build_object('error', 'cash_amount_mismatch',
                                'expected', (v_q ->> 'total')::integer,
                                'base', (v_q ->> 'base')::integer, 'bonus', v_bonus);
    end if;
  end if;
  v_paid := p_amount - v_bonus;

  if not coalesce(v_root, false) then
    if v_paid > s.admin_mint_cap then
      return jsonb_build_object('error', 'over_admin_cap', 'cap', s.admin_mint_cap);
    end if;
    if p_kind = 'mint' then
      select coalesce(sum(amount), 0) into v_today from public.token_tx
       where actor_id = p_actor and kind = 'mint'
         and created_at >= (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago');
      if v_today + p_amount > s.admin_daily_cap then
        return jsonb_build_object('error', 'over_daily_cap', 'cap', s.admin_daily_cap, 'used', v_today);
      end if;
    end if;
  end if;

  v_tx := public.token_credit_row(
    p_member, p_kind, p_amount, null,
    p_actor, nullif(btrim(coalesce(p_reason, '')), ''),
    case when p_kind = 'cash' then p_cash_cents else null end, null, null);
  if v_bonus > 0 then
    update public.token_tx set bonus_tokens = v_bonus where id = v_tx;
  end if;
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'bonus', v_bonus,
                            'balance', public.token_balance(p_member));
end $$;

-- Service-role only, like every other function in 0024: Supabase grants EXECUTE
-- to public by default and PostgREST would expose this as /rpc/token_quote.
revoke execute on function public.token_quote(uuid, integer) from public, anon, authenticated;
grant  execute on function public.token_quote(uuid, integer) to service_role;
