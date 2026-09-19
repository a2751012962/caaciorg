-- 0029 — a separate, larger cap for cash taken at a desk.
--
-- 0024 held BOTH admin actions to admin_mint_cap (500 tokens), so a non-root
-- admin could not take more than $50 in one go at an event desk -- and with
-- 0028's launch-day promotion running, $50 of cash is 750 tokens, which made
-- the ceiling bite even sooner. That cap is the right control for MINTING,
-- where an admin invents tokens out of nothing, but the wrong one for CASH,
-- which is backed by money in the box and reconciled after the event.
--
-- So the two are split:
--   * mint  -> admin_mint_cap, still 500 TOKENS per action, unchanged.
--   * cash  -> admin_cash_cap_cents, $200 of MONEY per action (owner's call,
--              2026-09-18). Cents is the honest unit here: the limit is how
--              much cash one volunteer may take at once, not how many tokens
--              the rate happens to produce.
-- Root stays exempt from both, and the per-day mint cap is untouched.

alter table public.token_settings
  add column if not exists admin_cash_cap_cents integer not null default 20000;

alter table public.token_settings drop constraint if exists token_settings_admin_cash_cap_pos;
alter table public.token_settings add  constraint token_settings_admin_cash_cap_pos
  check (admin_cash_cap_cents > 0);

comment on column public.token_settings.admin_cash_cap_cents is
  'Most cash, in cents, a non-root admin may take in one token_admin_credit call.';

-- An admin adds tokens by hand: 'cash' (money taken at a desk; the tokens must
-- match what token_quote says that money buys, bonus included) or 'mint' (a
-- gift or a fix; needs a reason, never gets a bonus). A non-root admin is held
-- to admin_cash_cap_cents of cash per action, or admin_mint_cap tokens per mint
-- plus admin_daily_cap of free mints per day (Central time). Root is exempt.
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
    -- Checked on the MONEY, before the rate is applied, so a promotion can
    -- never move the ceiling.
    if not coalesce(v_root, false) and p_cash_cents > s.admin_cash_cap_cents then
      return jsonb_build_object('error', 'over_cash_cap', 'cap_cents', s.admin_cash_cap_cents);
    end if;
  else
    if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('error', 'reason_required'); end if;
    if not coalesce(v_root, false) and p_amount > s.admin_mint_cap then
      return jsonb_build_object('error', 'over_admin_cap', 'cap', s.admin_mint_cap);
    end if;
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
  elsif not coalesce(v_root, false) then
    select coalesce(sum(amount), 0) into v_today from public.token_tx
     where actor_id = p_actor and kind = 'mint'
       and created_at >= (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago');
    if v_today + p_amount > s.admin_daily_cap then
      return jsonb_build_object('error', 'over_daily_cap', 'cap', s.admin_daily_cap, 'used', v_today);
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
