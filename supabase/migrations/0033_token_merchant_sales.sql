-- 0033 — what every merchant, and every line on its menu, has sold so far.
--
-- The merchants page listed each shop's menu and could open one item for its
-- own record (0032), but the list itself said nothing about trade: an admin
-- scanning twelve stalls at the festival had to open every item to learn which
-- were moving. This adds one call that answers for all of them at once, so the
-- merchant row can show the tokens it has taken and each menu line how many it
-- has sold.
--
-- Same two shapes of charge as 0032, added up the same way:
--   * self-serve (0030): token_tx.pay_item_id names the item, one unit, the
--     whole amount.
--   * a clerk's charge (0024): each line of token_tx.items that carries an `id`
--     (written from 0032 on) is qty units of that item. Older lines are named,
--     not linked, so they reach the merchant's total and no item's.
-- Only charges that still stand ('ok') count: a voided or refunded one was not
-- a sale. The merchant's own row (item_id null) sums every standing charge,
-- linked or not, so it is the true takings; the item rows are the part of it
-- that can be attributed.
--
-- Server-only like the rest of 0024: SECURITY DEFINER with a fixed search_path,
-- EXECUTE revoked from public/anon/authenticated and granted to service_role.
-- Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

create or replace function public.token_merchant_sales()
returns table (merchant_id uuid, item_id text, charges integer, units integer, tokens integer)
language sql security definer stable set search_path = public, pg_temp as $$
  with standing as (
    select tx.id, tx.merchant_id, tx.pay_item_id, tx.items, (-tx.amount) as tok
      from public.token_tx tx
     where tx.kind = 'charge' and tx.state = 'ok' and tx.merchant_id is not null
  ),
  lines as (
    -- self-serve: the whole charge is one unit of one item
    select s.merchant_id, s.pay_item_id::text as item_id, 1 as units, s.tok
      from standing s
     where s.pay_item_id is not null
    union all
    -- a clerk's charge: every linked line is qty units of its item
    select s.merchant_id, l ->> 'id',
           coalesce((l ->> 'qty')::integer, 1),
           coalesce((l ->> 'tokens')::integer, 0) * coalesce((l ->> 'qty')::integer, 1)
      from standing s
      cross join lateral jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) l
     where s.pay_item_id is null and (l ->> 'id') is not null
  )
  -- the merchant itself: every standing charge, whether or not its lines are linked
  select s.merchant_id, null::text, count(*)::integer, 0, coalesce(sum(s.tok), 0)::integer
    from standing s
   group by s.merchant_id
  union all
  select l.merchant_id, l.item_id, 0, sum(l.units)::integer, sum(l.tok)::integer
    from lines l
   group by l.merchant_id, l.item_id;
$$;

revoke execute on function public.token_merchant_sales() from public, anon, authenticated;
grant  execute on function public.token_merchant_sales() to service_role;

comment on function public.token_merchant_sales() is
  'Standing charges per merchant (item_id null: charges + tokens) and per linked menu item (units + tokens).';
