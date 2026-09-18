-- 0027 — tokens never expire.
--
-- Policy change (2026-09-18). 0024 let granted tokens expire with the
-- membership year and admin 'mint' credits expire after a year. Both are now
-- permanent, because the compliance position for the whole system rests on it:
--
--   * 815 ILCS 505/2SS bans a gift certificate expiring sooner than 5 years
--     after issue. No expiry at all clears that outright, so we no longer have
--     to argue the award/loyalty or food exemptions.
--   * 765 ILCS 1026 (RUUPA) + 74 Ill. Adm. Code 760.230 exempt a "gift card"
--     from escheat only while it has NO expiration date, NO dormancy fee and
--     is NOT redeemable for money. The check constraint below makes the first
--     of those three structurally true, so nobody can reintroduce an expiry
--     without a deliberate migration. The other two stay policy: never add a
--     maintenance or inactivity fee, and never let a holder cash out a balance
--     (a narrow refund of a mistaken purchase via token_admin_debit is fine).
--
-- Grants still happen once per membership period and still top up after a
-- mid-year upgrade -- that logic is anchored on members.expires_at (the
-- MEMBERSHIP expiry), which is untouched. Only the token lot's own expiry
-- goes away. So a member who renews for five years accumulates five grants
-- that never lapse; that outstanding balance is a permanent liability and
-- token_stats().outstanding is the number the treasurer should watch.
--
-- 0024's header comment and the `expires_at timestamptz -- null = never`
-- comment on token_lots are stale as of this migration.

-- Nothing in the system may carry an expiry any more, including anything
-- already granted on the live DB before this ran.
update public.token_lots set expires_at = null where expires_at is not null;

alter table public.token_lots drop constraint if exists token_lots_never_expires;
alter table public.token_lots add constraint token_lots_never_expires check (expires_at is null);

-- The yearly grant for the plan on the member's OWN row (a family's grant lands
-- on the founder, who holds the family tier). Tops the member up to the tier's
-- amount for the current membership year, so it is safe to call again: a second
-- call grants nothing, and after an upgrade it grants the difference. A new
-- year only starts when the expiry moved at least 300 days past the last
-- granted one, so nudging an expiry date cannot farm a second grant.
-- Since 0027 the tokens it hands out never expire.
create or replace function public.token_membership_grant(p_member uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m          public.members%rowtype;
  v_target   integer;
  v_expiry   timestamptz;
  v_period   date;
  v_last     date;
  v_already  integer;
  v_amount   integer;
  v_tx       uuid;
begin
  perform public.token_lock(p_member);
  select * into m from public.members where id = p_member;
  if not found then return jsonb_build_object('error', 'member_not_found'); end if;
  if m.tier_id is null or m.status <> 'active' or (m.expires_at is not null and m.expires_at <= now()) then
    return jsonb_build_object('error', 'membership_not_active');
  end if;

  select coalesce((grants ->> m.tier_id)::integer, 0) into v_target from public.token_settings;
  if coalesce(v_target, 0) <= 0 then
    return jsonb_build_object('ok', true, 'granted', 0, 'tier_id', m.tier_id, 'balance', public.token_balance(p_member));
  end if;

  -- The MEMBERSHIP expiry still anchors the period, so one renewal = one grant
  -- and a nudged date cannot farm a second. It no longer dates the tokens.
  v_expiry := coalesce(m.expires_at, now() + interval '1 year');
  v_period := (v_expiry at time zone 'UTC')::date;
  select max(grant_period) into v_last from public.token_tx where member_id = p_member and kind = 'grant';
  if v_last is not null and v_period < v_last + 300 then
    v_period := v_last;   -- still the membership year already granted for
  end if;

  select coalesce(sum(amount), 0) into v_already
    from public.token_tx where member_id = p_member and kind = 'grant' and grant_period = v_period;
  v_amount := v_target - v_already;
  if v_amount <= 0 then
    return jsonb_build_object('ok', true, 'granted', 0, 'tier_id', m.tier_id, 'balance', public.token_balance(p_member));
  end if;

  v_tx := public.token_credit_row(p_member, 'grant', v_amount, null, p_actor,
                                  'membership:' || m.tier_id, null, null, v_period);
  return jsonb_build_object('ok', true, 'granted', v_amount, 'tier_id', m.tier_id, 'tx_id', v_tx,
                            'expires_at', null, 'balance', public.token_balance(p_member));
end $$;

-- An admin adds tokens by hand: 'cash' (money taken at a desk; the amount must
-- match the cash at the going rate) or 'mint' (a gift or a fix; needs a
-- reason). An admin who is not root is held to admin_mint_cap per action, and
-- their free mints to admin_daily_cap per day (Central time). Root is exempt
-- from both caps. Since 0027 neither kind expires.
create or replace function public.token_admin_credit(
  p_member uuid, p_kind text, p_amount integer, p_cash_cents integer, p_actor uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.token_settings%rowtype;
  v_admin  boolean;
  v_root   boolean;
  v_today  integer;
  v_tx     uuid;
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
    if p_cash_cents * s.tokens_per_dollar <> p_amount * 100 then
      return jsonb_build_object('error', 'cash_amount_mismatch');
    end if;
  else
    if coalesce(btrim(p_reason), '') = '' then return jsonb_build_object('error', 'reason_required'); end if;
  end if;

  -- Serialise this admin's credits so the daily cap cannot be raced past.
  perform public.token_lock(p_actor);
  if not coalesce(v_root, false) then
    if p_amount > s.admin_mint_cap then
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

  perform public.token_lock(p_member);
  v_tx := public.token_credit_row(
    p_member, p_kind, p_amount, null,
    p_actor, nullif(btrim(coalesce(p_reason, '')), ''),
    case when p_kind = 'cash' then p_cash_cents else null end, null, null);
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
end $$;
