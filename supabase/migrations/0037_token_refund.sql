-- 0037 — refund a top-up: take the tokens back and record the money returned.
--
-- The back office could add tokens for cash and take tokens away with a reason
-- (token_admin_debit), but nothing tied the second to the first. A member who
-- paid $20 at a desk and asked for it back got an 'adjust' row that said
-- "refund" in free text, with no record of which top-up it undid or how much
-- cash left the box. The treasurer then had to reconcile that by hand.
--
-- token_admin_refund points the take-back at the credit it undoes
-- (related_tx) and writes the cash handed back on the row (cash_cents), so a
-- top-up and its refunds read as one story in the ledger, and a credit can
-- never be refunded past what it was: tokens up to the credit's amount, money
-- up to the cash it took. Both are measured against every earlier refund of
-- the same row, so two partial refunds cannot add up to more than one top-up.
--
-- What it refuses:
--   * a row that is not a 'cash' or 'purchase' credit (a grant or a mint was
--     never paid for, so there is nothing to refund — token_admin_debit is for
--     taking those back);
--   * more tokens or more cash than the credit still has unrefunded;
--   * tokens the member has already spent (insufficient_balance): a refund
--     takes tokens out of the account, it does not conjure them;
--   * for a non-root admin, cash above admin_cash_cap_cents per action — the
--     same ceiling as taking the cash in 0029. No mint cap on the tokens: they
--     are bounded by the credit, which was itself capped when it was made.
-- The reason is optional: the related row says what this is.
--
-- An online purchase (kind 'purchase') is refunded on the CARD in Stripe (the
-- admin panel's Payments tab, or the Dashboard); this records that it happened
-- and takes the tokens back. It does not move money itself.
--
-- The member's wallet and the ledger tell a refund from any other 'adjust' row
-- by cash_cents being set (0 for a token-only take-back of a purchase). No new
-- kind: token_tx_sign and every report keep their meaning.
--
-- The member's side — token_refund_request — lets a signed-in member ask from
-- their own history, for a charge ("this wasn't me", the same as the receipt
-- link but proven by the session instead of the key) or for a top-up ("I want
-- this back"). Either way the row goes to state 'disputed' with the note, which
-- is what the back office's Disputes tab already lists and what the overview
-- counts. An admin then resolves it: a charge is upheld (reversal) or
-- rejected as before; a top-up is refunded through token_admin_refund, which
-- marks the request resolved, or rejected. Upholding a top-up directly is
-- refused (use_refund), so the money returned is always on the record.
--
-- Server-only like the rest of 0024: SECURITY DEFINER with a fixed search_path,
-- EXECUTE revoked from public/anon/authenticated and granted to service_role.
-- Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

-- A member asks for one of their own rows to be looked at. Within dispute_days
-- of the row, like the receipt link; a second ask on the same row answers
-- { ok, already } rather than refusing.
create or replace function public.token_refund_request(p_tx uuid, p_member uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c       public.token_tx%rowtype;
  v_days  integer;
  v_back  integer;
begin
  if p_member is null then return jsonb_build_object('error', 'tx_not_found'); end if;
  perform public.token_lock(p_member);
  select * into c from public.token_tx where id = p_tx and member_id = p_member;
  if not found or c.kind not in ('charge', 'cash', 'purchase') then
    return jsonb_build_object('error', 'tx_not_found');
  end if;
  if c.state = 'disputed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if c.state <> 'ok' then return jsonb_build_object('error', 'already_undone'); end if;
  select dispute_days into v_days from public.token_settings;
  if c.created_at < now() - make_interval(days => v_days) then
    return jsonb_build_object('error', 'dispute_window_closed', 'days', v_days);
  end if;
  if c.kind in ('cash', 'purchase') then
    select coalesce(sum(-amount), 0) into v_back
      from public.token_tx where related_tx = p_tx and kind = 'adjust';
    if c.amount - v_back <= 0 then return jsonb_build_object('error', 'already_refunded'); end if;
  end if;
  update public.token_tx
     set state = 'disputed', disputed_at = now(),
         dispute_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_tx;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'amount', c.amount);
end $$;

-- An admin settles a dispute or a refund request. A charge: upheld, the tokens
-- go back (a 'reversal' row, off the merchant's next statement) and a partner
-- shop with suspend_after upheld disputes in the calendar month (Central time)
-- is suspended until an admin re-activates it; rejected, the charge stands.
-- A top-up: rejected here; given back through token_admin_refund, never here,
-- so the cash handed back is always on the record (use_refund).
create or replace function public.token_dispute_resolve(p_tx uuid, p_actor uuid, p_uphold boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        public.token_tx%rowtype;
  v_tx     uuid;
  v_count  integer;
  v_limit  integer;
  v_susp   boolean := false;
begin
  if not exists (select 1 from public.members where id = p_actor and (is_admin or is_root)) then
    return jsonb_build_object('error', 'not_admin');
  end if;
  select * into c from public.token_tx where id = p_tx;
  if not found or c.kind not in ('charge', 'cash', 'purchase') then
    return jsonb_build_object('error', 'charge_not_found');
  end if;
  if c.member_id is not null then perform public.token_lock(c.member_id); end if;
  select * into c from public.token_tx where id = p_tx;
  if c.state <> 'disputed' then return jsonb_build_object('error', 'not_disputed'); end if;

  if not p_uphold then
    update public.token_tx
       set state = 'ok', resolved_at = now(), resolved_by = p_actor, resolution = 'rejected',
           dispute_note = coalesce(dispute_note, '') || case when coalesce(btrim(p_note), '') = '' then '' else E'\n— ' || btrim(p_note) end
     where id = p_tx;
    return jsonb_build_object('ok', true, 'upheld', false);
  end if;
  if c.kind <> 'charge' then return jsonb_build_object('error', 'use_refund'); end if;

  v_tx := public.token_undo_charge(c, 'reversal', p_actor, p_note, 'reversed');
  update public.token_tx set resolved_at = now(), resolved_by = p_actor, resolution = 'upheld' where id = p_tx;

  select suspend_after into v_limit from public.token_settings;
  select count(*) into v_count from public.token_tx
   where merchant_id = c.merchant_id and kind = 'reversal'
     and created_at >= (date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago');
  if v_count >= v_limit then
    update public.merchants
       set status = 'suspended',
           suspended_reason = v_count || ' upheld disputes this month'
     where id = c.merchant_id and kind = 'partner' and status = 'active';
    v_susp := found;
  end if;
  return jsonb_build_object('ok', true, 'upheld', true, 'tx_id', v_tx, 'merchant_suspended', v_susp);
end $$;

create or replace function public.token_admin_refund(
  p_tx uuid, p_amount integer, p_cash_cents integer, p_actor uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c             public.token_tx%rowtype;
  v_admin       boolean;
  v_root        boolean;
  v_cash_cap    integer;
  v_tokens_back integer;
  v_cents_back  integer;
  v_cents       integer;
  v_avail       integer;
  v_tx          uuid;
begin
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('error', 'invalid_amount'); end if;
  if p_cash_cents is null or p_cash_cents < 0 then return jsonb_build_object('error', 'invalid_amount'); end if;
  select is_admin, is_root into v_admin, v_root from public.members where id = p_actor;
  if not coalesce(v_admin, false) and not coalesce(v_root, false) then
    return jsonb_build_object('error', 'not_admin');
  end if;

  select * into c from public.token_tx where id = p_tx;
  if not found or c.kind not in ('cash', 'purchase') then
    return jsonb_build_object('error', 'credit_not_found');
  end if;
  if c.member_id is null then return jsonb_build_object('error', 'member_not_found'); end if;

  -- The same ceiling as taking the cash (0029): on the money, per action.
  select admin_cash_cap_cents into v_cash_cap from public.token_settings;
  if not coalesce(v_root, false) and p_cash_cents > v_cash_cap then
    return jsonb_build_object('error', 'over_cash_cap', 'cap_cents', v_cash_cap);
  end if;

  perform public.token_lock(c.member_id);
  select * into c from public.token_tx where id = p_tx;    -- re-read under the lock
  select coalesce(sum(-amount), 0), coalesce(sum(cash_cents), 0)
    into v_tokens_back, v_cents_back
    from public.token_tx where related_tx = p_tx and kind = 'adjust';
  v_cents := coalesce(c.cash_cents, 0);
  if p_amount > c.amount - v_tokens_back then
    return jsonb_build_object('error', 'over_refund',
                              'left', c.amount - v_tokens_back, 'cents_left', v_cents - v_cents_back);
  end if;
  if p_cash_cents > v_cents - v_cents_back then
    return jsonb_build_object('error', 'over_refund_cash',
                              'left', c.amount - v_tokens_back, 'cents_left', v_cents - v_cents_back);
  end if;

  v_avail := public.token_balance(c.member_id);
  if v_avail < p_amount then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', v_avail);
  end if;

  insert into public.token_tx (member_id, kind, amount, actor_id, related_tx, cash_cents, reason)
  values (c.member_id, 'adjust', -p_amount, p_actor, p_tx, p_cash_cents,
          nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_tx;
  perform public.token_draw(c.member_id, v_tx, p_amount);

  -- The member asked for this: the refund is the answer, so the request closes.
  if c.state = 'disputed' then
    update public.token_tx
       set state = 'ok', resolved_at = now(), resolved_by = p_actor, resolution = 'refunded'
     where id = p_tx;
  end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'resolved', c.state = 'disputed',
                            'balance', public.token_balance(c.member_id),
                            'tokens_left', c.amount - v_tokens_back - p_amount,
                            'cents_left', v_cents - v_cents_back - p_cash_cents);
end $$;

revoke execute on function public.token_admin_refund(uuid, integer, integer, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_refund_request(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_dispute_resolve(uuid, uuid, boolean, text) from public, anon, authenticated;
grant  execute on function public.token_admin_refund(uuid, integer, integer, uuid, text) to service_role;
grant  execute on function public.token_refund_request(uuid, uuid, text) to service_role;
grant  execute on function public.token_dispute_resolve(uuid, uuid, boolean, text) to service_role;
