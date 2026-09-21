-- 0032 — one menu item's own sales record.
--
-- The back office could list a merchant's items and print their stickers, but it
-- could not answer the first question anybody asks about a stall: how much of
-- this did we sell, and which charges were they? The ledger filters by merchant,
-- never by item, so a stall with fifteen lines on its menu was one undivided
-- column of numbers.
--
-- Two shapes of charge carry an item, and they have to be added up together:
--   * self-serve (0030): the whole charge IS the item — token_tx.pay_item_id
--     points at it and the amount is its price.
--   * a clerk's charge (0024): the item is one line of token_tx.items, next to
--     the other things the customer bought. From this migration on the line
--     carries the item's `id` as well as its name, which is what makes it
--     findable; charges written before that are named but not linked, so they
--     count toward the merchant's totals and not this item's. Nothing is lost —
--     the line text is still in the ledger — and nothing is rewritten.
--
-- Returns ids, not rows: the page of transactions is then read through the same
-- select and the same shaping every other ledger view uses, so a row looks the
-- same wherever it is shown.
--
-- Server-only like the rest of 0024: SECURITY DEFINER with a fixed search_path,
-- EXECUTE revoked from public/anon/authenticated and granted to service_role.
-- Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

create or replace function public.token_item_report(
  p_item uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language sql security definer stable set search_path = public, pg_temp as $$
  with hits as (
    -- self-serve: one item, one charge, the whole amount
    select tx.id, tx.created_at, tx.state, 1 as units, (-tx.amount) as tok
      from public.token_tx tx
     where tx.kind = 'charge' and tx.pay_item_id = p_item
    union all
    -- a clerk's charge: this item is one line among several
    select tx.id, tx.created_at, tx.state,
           sum(coalesce((l ->> 'qty')::integer, 1))::integer,
           sum(coalesce((l ->> 'tokens')::integer, 0)
               * coalesce((l ->> 'qty')::integer, 1))::integer
      from public.token_tx tx
      cross join lateral jsonb_array_elements(coalesce(tx.items, '[]'::jsonb)) l
     where tx.kind = 'charge'
       and tx.pay_item_id is distinct from p_item
       and l ->> 'id' = p_item::text
     group by tx.id, tx.created_at, tx.state
  )
  select jsonb_build_object(
    -- 'ok' only: a voided or refunded charge was not a sale
    'sold',      (select coalesce(sum(units), 0) from hits where state = 'ok'),
    'tokens',    (select coalesce(sum(tok), 0)   from hits where state = 'ok'),
    'undone',    (select count(*) from hits where state <> 'ok'),
    'first_at',  (select min(created_at) from hits),
    'last_at',   (select max(created_at) from hits),
    'total',     (select count(*) from hits),
    'ids',       (select coalesce(jsonb_agg(id order by created_at desc), '[]'::jsonb)
                    from (select id, created_at from hits
                           order by created_at desc
                           limit greatest(coalesce(p_limit, 50), 0)
                          offset greatest(coalesce(p_offset, 0), 0)) page)
  );
$$;

revoke execute on function public.token_item_report(uuid, integer, integer)
  from public, anon, authenticated;
grant  execute on function public.token_item_report(uuid, integer, integer) to service_role;

comment on function public.token_item_report(uuid, integer, integer) is
  'One menu item''s sales: units, tokens, first/last sale, and a page of transaction ids (newest first).';
