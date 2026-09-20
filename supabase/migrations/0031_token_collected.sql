-- 0031 — "handed over": the stall ticks a scan-to-pay charge off its list.
--
-- 0030 gave the counter something to check (the four-character confirmation
-- code, looked up in the merchant console) but nothing to check it OFF with.
-- Reading the code proves the payment exists; it does not prove that the
-- person holding the phone is the one who paid, and it does not stop the same
-- payment being collected twice. Whoever glanced at someone else's screen, or
-- simply came back for a second cup on one payment, would find the row looking
-- exactly as un-served as the first time.
--
-- So each self-serve charge can be stamped once: collected_at + collected_by.
-- What this buys is not secrecy — a four-character code is not a secret — but
-- a CONFLICT at the counter instead of a silent loss. The first person to be
-- served takes the stamp; the second finds "已出货 12:03 · Volunteer Li" and
-- the volunteer knows to stop and ask. That is the whole mechanism.
--
-- The stamp is taken with a conditional UPDATE (`where collected_at is null`),
-- so two volunteers tapping the same row at the same moment cannot both
-- succeed: one gets ok, the other gets already_collected with who and when.
-- Un-ticking is allowed for the obvious reason that people mis-tap, and is
-- open to exactly the people who could have ticked it (that shop's staff, or
-- an admin) — it is a stall's own record of what it handed over, not an
-- authorisation.
--
-- Only `charge` rows with self_serve are stampable, and only while state =
-- 'ok': a voided, reversed or disputed charge is not something to hand a juice
-- over for.
--
-- Server-only like the rest: EXECUTE revoked from public/anon/authenticated and
-- granted to service_role. Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

alter table public.token_tx add column if not exists collected_at timestamptz;
alter table public.token_tx add column if not exists collected_by uuid
  references auth.users(id) on delete set null;

comment on column public.token_tx.collected_at is
  'When a stall handed over what this scan-to-pay charge bought. NULL = not served yet.';
comment on column public.token_tx.collected_by is
  'Which staff account ticked it off. Kept so a second claim on the same payment names someone.';

-- The un-served queue a volunteer actually looks at, newest first.
create index if not exists token_tx_uncollected
  on public.token_tx (merchant_id, created_at desc)
  where self_serve and collected_at is null;

-- Tick a self-serve charge as handed over (p_collected true), or undo a
-- mis-tap (false). Same callers as a void: that shop's staff, or an admin.
create or replace function public.token_collect(p_tx uuid, p_actor uuid, p_collected boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        public.token_tx%rowtype;
  v_admin  boolean;
  v_name   text;
begin
  select * into c from public.token_tx where id = p_tx;
  if not found or c.kind <> 'charge' then return jsonb_build_object('error', 'charge_not_found'); end if;
  if not coalesce(c.self_serve, false) then return jsonb_build_object('error', 'not_self_serve'); end if;

  select (is_admin or is_root) into v_admin from public.members where id = p_actor;
  if not coalesce(v_admin, false)
     and not exists (select 1 from public.merchant_staff
                      where merchant_id = c.merchant_id and member_id = p_actor) then
    return jsonb_build_object('error', 'not_staff');
  end if;
  if c.state <> 'ok' then return jsonb_build_object('error', 'charge_not_ok', 'state', c.state); end if;

  if coalesce(p_collected, true) then
    -- One winner: the row is only stamped while nobody has stamped it.
    update public.token_tx set collected_at = now(), collected_by = p_actor
     where id = p_tx and collected_at is null;
    if not found then
      select * into c from public.token_tx where id = p_tx;
      select full_name into v_name from public.members where id = c.collected_by;
      return jsonb_build_object('error', 'already_collected', 'at', c.collected_at, 'by', v_name);
    end if;
  else
    update public.token_tx set collected_at = null, collected_by = null
     where id = p_tx and collected_at is not null;
    if not found then return jsonb_build_object('error', 'not_collected'); end if;
  end if;

  select * into c from public.token_tx where id = p_tx;
  select full_name into v_name from public.members where id = c.collected_by;
  return jsonb_build_object('ok', true, 'collected_at', c.collected_at, 'collected_by', v_name);
end $$;

revoke execute on function public.token_collect(uuid, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.token_collect(uuid, uuid, boolean) to service_role;
