-- 0038 — test accounts stay out of the token books.
--
-- The dev account bought $500 of "cash" tokens on 2026-09-18 to try the desk,
-- and token_overview() has counted the unspent ~4,970 of them as money CAACI
-- owes its members ever since; its 1-token test charges sit in the merchant
-- sales figures the same way. The ledger is append-only and that is right, so
-- the fix is not to delete rows but to say which ACCOUNTS are not real:
--
--   members.is_test  — set by an admin from the Members tab. Nothing about the
--                      account changes except that four read-only reports skip
--                      its rows: token_overview (unspent balances, holders),
--                      token_cash_report, token_merchant_sales and
--                      token_item_report.
--
-- Deliberately NOT skipped:
--   * the ledger itself — every row still shows, tagged "test" in the back
--     office, because hiding history is how mistakes become invisible;
--   * what is owed to a partner shop (token_overview.owed_to_partners and the
--     settlement functions). That is a third party's claim, and it must match
--     the statement they are sent whatever flag the payer carries. Test against
--     CAACI's own internal merchant, not a partner.
--
-- Everything is recreated as it was in 0024 / 0032 / 0033 with one extra
-- predicate; same SECURITY DEFINER + pinned search_path, EXECUTE revoked from
-- the browser roles and granted to service_role. Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

alter table public.members
  add column if not exists is_test boolean not null default false;

comment on column public.members.is_test is
  'A developer or demo account. Its token rows are left out of the finance reports (0038); the ledger still shows them.';

-- ------------------------------------------------------------ overview ----
create or replace function public.token_overview()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'outstanding', (
      select coalesce(jsonb_object_agg(source, total), '{}'::jsonb) from (
        select l.source, sum(l.remaining)::integer as total from public.token_lots l
         where l.remaining > 0 and (l.expires_at is null or l.expires_at > now())
           and not exists (select 1 from public.members mm where mm.id = l.member_id and mm.is_test)
         group by l.source) s),
    'holders', (
      select count(distinct l.member_id)::integer from public.token_lots l
       where l.remaining > 0 and (l.expires_at is null or l.expires_at > now())
         and not exists (select 1 from public.members mm where mm.id = l.member_id and mm.is_test)),
    -- a partner's claim is real whoever paid: no is_test here (see header)
    'owed_to_partners', (
      select coalesce(-sum(t.amount), 0)::integer from public.token_tx t
        join public.merchants m on m.id = t.merchant_id
       where m.kind = 'partner' and t.settlement_id is null),
    'statements_due_cents', (
      select coalesce(sum(amount_cents), 0)::integer from public.merchant_settlements where status = 'due'),
    'open_disputes', (select count(*)::integer from public.token_tx where state = 'disputed'),
    'failed_receipts', (
      select count(*)::integer from public.token_tx
       where kind = 'charge' and receipt_error is not null and created_at > now() - interval '30 days')
  );
$$;

-- --------------------------------------------------------- cash report ----
create or replace function public.token_cash_report(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(r order by r.cash_cents desc), '[]'::jsonb) from (
    select t.actor_id, m.full_name as actor_name, count(*)::integer as count,
           sum(t.cash_cents)::integer as cash_cents, sum(t.amount)::integer as tokens
      from public.token_tx t left join public.members m on m.id = t.actor_id
     where t.kind = 'cash' and t.created_at >= p_from and t.created_at < p_to
       and not exists (select 1 from public.members mm where mm.id = t.member_id and mm.is_test)
     group by t.actor_id, m.full_name) r;
$$;

-- --------------------------------------------------------- item report ----
create or replace function public.token_item_report(
  p_item uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language sql security definer stable set search_path = public, pg_temp as $$
  with hits as (
    select tx.id, tx.created_at, tx.state, 1 as units, (-tx.amount) as tok
      from public.token_tx tx
     where tx.kind = 'charge' and tx.pay_item_id = p_item
       and not exists (select 1 from public.members mm where mm.id = tx.member_id and mm.is_test)
    union all
    select tx.id, tx.created_at, tx.state,
           sum(coalesce((l ->> 'qty')::integer, 1))::integer,
           sum(coalesce((l ->> 'tokens')::integer, 0)
               * coalesce((l ->> 'qty')::integer, 1))::integer
      from public.token_tx tx
      cross join lateral jsonb_array_elements(coalesce(tx.items, '[]'::jsonb)) l
     where tx.kind = 'charge'
       and tx.pay_item_id is distinct from p_item
       and l ->> 'id' = p_item::text
       and not exists (select 1 from public.members mm where mm.id = tx.member_id and mm.is_test)
     group by tx.id, tx.created_at, tx.state
  )
  select jsonb_build_object(
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

-- ------------------------------------------------------ merchant sales ----
create or replace function public.token_merchant_sales()
returns table (merchant_id uuid, item_id text, charges integer, units integer, tokens integer)
language sql security definer stable set search_path = public, pg_temp as $$
  with standing as (
    select tx.id, tx.merchant_id, tx.pay_item_id, tx.items, (-tx.amount) as tok
      from public.token_tx tx
     where tx.kind = 'charge' and tx.state = 'ok' and tx.merchant_id is not null
       and not exists (select 1 from public.members mm where mm.id = tx.member_id and mm.is_test)
  ),
  lines as (
    select s.merchant_id, s.pay_item_id::text as item_id, 1 as units, s.tok
      from standing s
     where s.pay_item_id is not null
    union all
    select s.merchant_id, l ->> 'id',
           coalesce((l ->> 'qty')::integer, 1),
           coalesce((l ->> 'tokens')::integer, 0) * coalesce((l ->> 'qty')::integer, 1)
      from standing s
      cross join lateral jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) l
     where s.pay_item_id is null and (l ->> 'id') is not null
  )
  select s.merchant_id, null::text, count(*)::integer, 0, coalesce(sum(s.tok), 0)::integer
    from standing s
   group by s.merchant_id
  union all
  select l.merchant_id, l.item_id, 0, sum(l.units)::integer, sum(l.tok)::integer
    from lines l
   group by l.merchant_id, l.item_id;
$$;

-- ---- service-role only, as before ----
revoke execute on function public.token_overview() from public, anon, authenticated;
revoke execute on function public.token_cash_report(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.token_item_report(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.token_merchant_sales() from public, anon, authenticated;
grant  execute on function public.token_overview() to service_role;
grant  execute on function public.token_cash_report(timestamptz, timestamptz) to service_role;
grant  execute on function public.token_item_report(uuid, integer, integer) to service_role;
grant  execute on function public.token_merchant_sales() to service_role;
