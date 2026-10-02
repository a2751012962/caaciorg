-- 0039 — a refund of an online purchase goes back to the card from the token
-- back office, and can be undone when Stripe refuses.
--
-- 0037 recorded a refund (an 'adjust' row pointing at the top-up, carrying the
-- cash returned) but moved no money: an online purchase still had to be
-- refunded by hand in the Stripe Dashboard, in a second system, with nothing
-- checking that both halves were done. From here the back office does both in
-- one action — the ledger first, then Stripe — so the two have to be able to
-- disagree gracefully:
--
--   * stripe_refund_id on the refund row: Stripe's id for the money, written
--     once the card refund went through. The one stamp this row ever gets.
--   * token_refund_undo: when Stripe refuses AFTER the ledger took the tokens,
--     the API puts them back here. The refund row is marked 'voided' and a
--     'void' row pointing at it restores the lots it drew from — the same
--     shape as voiding a charge, so every report already understands it. A
--     voided refund no longer counts as refunded: both sums that measure what
--     a top-up has had refunded (token_admin_refund's cap and
--     token_refund_request's "nothing left") skip 'voided' rows from here on.
--
-- Why the ledger goes first: the ledger can refuse (tokens already spent,
-- over the cap) and that refusal costs nothing to honour; a card refund can
-- only be undone by charging the member again. So the order is the one whose
-- failure is reversible.
--
-- Server-only like the rest of 0024: SECURITY DEFINER with a fixed search_path,
-- EXECUTE revoked from public/anon/authenticated and granted to service_role.
-- Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

alter table public.token_tx add column if not exists stripe_refund_id text;
comment on column public.token_tx.stripe_refund_id is
  'On a refund row (adjust + related_tx + cash_cents): the Stripe refund that returned the money to the card.';

-- Undo a refund that Stripe then refused: the tokens go back where they came
-- from and the refund row is voided. Only a refund row, only once.
create or replace function public.token_refund_undo(p_tx uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c     public.token_tx%rowtype;
  v_tx  uuid;
  r     record;
begin
  if not exists (select 1 from public.members where id = p_actor and (is_admin or is_root)) then
    return jsonb_build_object('error', 'not_admin');
  end if;
  select * into c from public.token_tx where id = p_tx;
  if not found or c.kind <> 'adjust' or c.related_tx is null or c.cash_cents is null then
    return jsonb_build_object('error', 'refund_not_found');
  end if;
  if c.member_id is null then return jsonb_build_object('error', 'member_not_found'); end if;
  perform public.token_lock(c.member_id);
  select * into c from public.token_tx where id = p_tx;    -- re-read under the lock
  if c.state <> 'ok' then return jsonb_build_object('error', 'already_undone'); end if;

  for r in select lot_id, amount from public.token_tx_lots where tx_id = c.id loop
    update public.token_lots set remaining = remaining + r.amount where id = r.lot_id;
  end loop;
  insert into public.token_tx (member_id, kind, amount, actor_id, related_tx, reason)
  values (c.member_id, 'void', -c.amount, p_actor, c.id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_tx;
  update public.token_tx set state = 'voided' where id = c.id;
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'balance', public.token_balance(c.member_id));
end $$;

-- As 0037, with one change: a refund that was voided (Stripe refused it) is
-- not a refund, so it does not use up what the top-up can still give back.
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

  select admin_cash_cap_cents into v_cash_cap from public.token_settings;
  if not coalesce(v_root, false) and p_cash_cents > v_cash_cap then
    return jsonb_build_object('error', 'over_cash_cap', 'cap_cents', v_cash_cap);
  end if;

  perform public.token_lock(c.member_id);
  select * into c from public.token_tx where id = p_tx;    -- re-read under the lock
  select coalesce(sum(-amount), 0), coalesce(sum(cash_cents), 0)
    into v_tokens_back, v_cents_back
    from public.token_tx where related_tx = p_tx and kind = 'adjust' and state <> 'voided';
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

-- As 0037, skipping voided refunds in the "already fully refunded" check.
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
      from public.token_tx where related_tx = p_tx and kind = 'adjust' and state <> 'voided';
    if c.amount - v_back <= 0 then return jsonb_build_object('error', 'already_refunded'); end if;
  end if;
  update public.token_tx
     set state = 'disputed', disputed_at = now(),
         dispute_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_tx;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'amount', c.amount);
end $$;

revoke execute on function public.token_refund_undo(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_admin_refund(uuid, integer, integer, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_refund_request(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.token_refund_undo(uuid, uuid, text) to service_role;
grant  execute on function public.token_admin_refund(uuid, integer, integer, uuid, text) to service_role;
grant  execute on function public.token_refund_request(uuid, uuid, text) to service_role;
