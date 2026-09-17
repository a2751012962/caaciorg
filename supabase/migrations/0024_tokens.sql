-- CAACI tokens (华协币): a stored-value ledger members spend by showing the QR
-- on their member card. $1 = 10 tokens. Paid plans are granted tokens for each
-- membership year, members can buy more (Stripe, or cash at an event desk), and
-- a merchant's staff deduct them. CAACI pays partner merchants the face value
-- of what they took, monthly, outside this system; this records what is owed.
--
-- Roles: root > admin > merchant > user.
--   * root     — members.is_root. Can ONLY be set from the SQL editor (a trigger
--                refuses the change from the API's service_role), appoints
--                admins, edits token_settings, and is exempt from the mint caps.
--   * admin    — members.is_admin (unchanged). Mints within the caps, takes cash,
--                grants the yearly amount, manages merchants, resolves disputes.
--   * merchant — a row in merchant_staff. Charges, and voids its own shop's
--                charge within token_settings.void_hours. Can never add tokens.
--   * user     — everyone: sees their balance, buys, shows the QR.
--
-- Shape of the ledger:
--   * token_tx      — append-only history. amount > 0 credits the member,
--                     amount < 0 debits. Only `state` and the dispute/settlement
--                     stamps on a row ever change; a correction is a new row
--                     (void / reversal) pointing at the charge via related_tx.
--   * token_lots    — one row per credit with what is left of it, so granted
--                     tokens can expire with the membership year while bought
--                     ones never do. The balance is the sum of `remaining` over
--                     unexpired lots; a charge draws the earliest-expiring first.
--   * token_tx_lots — which lots a debit drew from, so a void puts the tokens
--                     back where they came from.
--   * A merchant's receivable is -sum(amount) over its token_tx rows that have
--     no settlement_id yet. A void or an upheld dispute after a month was paid
--     is simply an unstamped positive row, so it comes off the next statement.
--
-- Every table here is server-only, like 0013-0021: RLS on with no policies and
-- every privilege revoked from anon and authenticated. Every function has
-- EXECUTE revoked from public, anon and authenticated (Supabase grants those by
-- default, and PostgREST would expose them as /rpc) and granted to service_role.
-- Only the Pages Functions, with the service-role key, touch any of it.
-- Idempotent (if not exists / create or replace / revoke), so pasting it twice is safe.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

-- ---------------------------------------------------------------- root ------
alter table public.members add column if not exists is_root boolean not null default false;

-- is_root changes only from the SQL editor (role postgres). The API reaches the
-- database as service_role, so even a bug in an admin endpoint cannot mint a root.
create or replace function public.members_guard_root()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.is_root)
     or (tg_op = 'UPDATE' and new.is_root is distinct from old.is_root) then
    if current_user not in ('postgres', 'supabase_admin') then
      raise exception 'is_root can only be changed from the SQL editor';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_guard_root on public.members;
create trigger members_guard_root
  before insert or update on public.members
  for each row execute function public.members_guard_root();

-- ------------------------------------------------------------ settings ------
create table if not exists public.token_settings (
  id                 boolean primary key default true check (id),   -- single row
  tokens_per_dollar  integer not null default 10   check (tokens_per_dollar > 0),
  grants             jsonb   not null default '{"student":150,"individual":450,"family":900}'::jsonb,
  packs_cents        jsonb   not null default '[1000,2000,5000,10000]'::jsonb,  -- online packs, before the card fee
  max_charge         integer not null default 500  check (max_charge > 0),      -- tokens per charge
  admin_mint_cap     integer not null default 500  check (admin_mint_cap > 0),  -- tokens per admin action
  admin_daily_cap    integer not null default 2000 check (admin_daily_cap > 0), -- free mints per admin per day
  cash_min_cents     integer not null default 500  check (cash_min_cents > 0),
  void_hours         integer not null default 24   check (void_hours > 0),
  dispute_days       integer not null default 60   check (dispute_days > 0),
  settle_min_cents   integer not null default 2000 check (settle_min_cents >= 0), -- below this a month rolls over
  suspend_after      integer not null default 3    check (suspend_after > 0),     -- upheld disputes per month
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null
);
insert into public.token_settings (id) values (true) on conflict (id) do nothing;

-- ----------------------------------------------------------- merchants ------
create table if not exists public.merchants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  name_zh          text,
  kind             text not null default 'partner' check (kind in ('internal', 'partner')), -- internal = CAACI itself, never settled
  status           text not null default 'active'  check (status in ('active', 'suspended')),
  suspended_reason text,
  directory_id     uuid references public.business_directory(id) on delete set null,
  contact_name     text,
  contact_email    text,
  payout_note      text,                 -- how CAACI pays them (Zelle handle, cheque payee…)
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null
);

create table if not exists public.merchant_staff (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  member_id   uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  primary key (merchant_id, member_id)
);
create index if not exists merchant_staff_member on public.merchant_staff (member_id);

create table if not exists public.merchant_items (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  group_label text,                      -- e.g. the stall at a CAACI event
  name        text not null,
  name_zh     text,
  tokens      integer not null check (tokens > 0),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists merchant_items_merchant on public.merchant_items (merchant_id, sort_order);

create table if not exists public.merchant_settlements (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete restrict,
  period_end   timestamptz not null,     -- rows created before this instant are covered
  tokens       integer not null,
  amount_cents integer not null,
  status       text not null default 'due' check (status in ('due', 'paid')),
  reference    text,                     -- cheque number / Zelle note
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  paid_at      timestamptz,
  paid_by      uuid references auth.users(id) on delete set null,
  unique (merchant_id, period_end)
);

-- -------------------------------------------------------------- ledger ------
create table if not exists public.token_tx (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  member_id         uuid references auth.users(id) on delete set null,  -- history outlives the account
  kind              text not null check (kind in
                      ('grant', 'purchase', 'cash', 'mint', 'charge', 'void', 'reversal', 'transfer_out', 'transfer_in')),
  amount            integer not null,    -- > 0 credits the member, < 0 debits
  merchant_id       uuid references public.merchants(id) on delete restrict,
  actor_id          uuid references auth.users(id) on delete set null,  -- who pressed the button
  related_tx        uuid references public.token_tx(id),                -- void/reversal -> the charge
  items             jsonb,               -- [{ name, name_zh, tokens, qty }]
  note              text,
  reason            text,
  cash_cents        integer check (cash_cents is null or cash_cents >= 0), -- money taken (cash desk / Stripe, before fee)
  stripe_session_id text,
  grant_period      date,                -- membership expiry the grant was for
  idem_key          text,                -- client-made, so a retried charge lands once
  state             text not null default 'ok' check (state in ('ok', 'voided', 'disputed', 'reversed')),
  dispute_key       uuid not null default gen_random_uuid(),  -- secret in the receipt's "not me" link
  disputed_at       timestamptz,
  dispute_note      text,
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users(id) on delete set null,
  resolution        text,
  settlement_id     uuid references public.merchant_settlements(id) on delete set null,
  constraint token_tx_sign check (
    (kind in ('charge', 'transfer_out') and amount < 0)
    or (kind not in ('charge', 'transfer_out') and amount > 0)
  )
);
create unique index if not exists token_tx_stripe_session on public.token_tx (stripe_session_id)
  where stripe_session_id is not null;
create unique index if not exists token_tx_idem on public.token_tx (idem_key) where idem_key is not null;
create index if not exists token_tx_member   on public.token_tx (member_id, created_at desc);
create index if not exists token_tx_merchant on public.token_tx (merchant_id, created_at desc);
create index if not exists token_tx_actor    on public.token_tx (actor_id, created_at desc);

create table if not exists public.token_lots (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users(id) on delete cascade,
  tx_id      uuid not null references public.token_tx(id),
  source     text not null check (source in ('grant', 'purchase', 'cash', 'mint')),
  amount     integer not null check (amount > 0),
  remaining  integer not null,
  expires_at timestamptz,               -- null = never (bought tokens)
  created_at timestamptz not null default now(),
  constraint token_lots_remaining check (remaining >= 0 and remaining <= amount)
);
create index if not exists token_lots_member on public.token_lots (member_id, expires_at);

create table if not exists public.token_tx_lots (
  tx_id  uuid not null references public.token_tx(id),
  lot_id uuid not null references public.token_lots(id) on delete cascade,
  amount integer not null check (amount > 0),
  primary key (tx_id, lot_id)
);

-- ---- server-only: RLS on, no policies, no table privileges for browser roles ----
alter table public.token_settings       enable row level security;
alter table public.merchants            enable row level security;
alter table public.merchant_staff       enable row level security;
alter table public.merchant_items       enable row level security;
alter table public.merchant_settlements enable row level security;
alter table public.token_tx             enable row level security;
alter table public.token_lots           enable row level security;
alter table public.token_tx_lots        enable row level security;
revoke all on table public.token_settings       from anon, authenticated;
revoke all on table public.merchants            from anon, authenticated;
revoke all on table public.merchant_staff       from anon, authenticated;
revoke all on table public.merchant_items       from anon, authenticated;
revoke all on table public.merchant_settlements from anon, authenticated;
revoke all on table public.token_tx             from anon, authenticated;
revoke all on table public.token_lots           from anon, authenticated;
revoke all on table public.token_tx_lots        from anon, authenticated;

-- ------------------------------------------------------------ functions -----
-- All return jsonb: { ok: true, … } or { error: '<code>' }, like the family_*
-- functions of 0017, so the API can map a code to a sentence.

-- One member's ledger is changed by one transaction at a time.
create or replace function public.token_lock(p_member uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('caaci-token:' || p_member::text, 0));
$$;

create or replace function public.token_balance(p_member uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(remaining), 0)::integer
    from public.token_lots
   where member_id = p_member
     and remaining > 0
     and (expires_at is null or expires_at > now());
$$;

-- Insert a credit row and its lot. Internal: callers hold the member lock.
create or replace function public.token_credit_row(
  p_member uuid, p_kind text, p_amount integer, p_expires timestamptz, p_actor uuid,
  p_reason text, p_cash_cents integer, p_session text, p_period date
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tx uuid;
begin
  insert into public.token_tx (member_id, kind, amount, actor_id, reason, cash_cents, stripe_session_id, grant_period)
  values (p_member, p_kind, p_amount, p_actor, p_reason, p_cash_cents, p_session, p_period)
  returning id into v_tx;
  insert into public.token_lots (member_id, tx_id, source, amount, remaining, expires_at)
  values (p_member, v_tx, p_kind, p_amount, p_amount, p_expires);
  return v_tx;
end $$;

-- The yearly grant for the plan on the member's OWN row (a family's grant lands
-- on the founder, who holds the family tier). Tops the member up to the tier's
-- amount for the current membership year, so it is safe to call again: a second
-- call grants nothing, and after an upgrade it grants the difference. A new
-- year only starts when the expiry moved at least 300 days past the last
-- granted one, so nudging an expiry date cannot farm a second grant.
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

  v_tx := public.token_credit_row(p_member, 'grant', v_amount, v_expiry, p_actor,
                                  'membership:' || m.tier_id, null, null, v_period);
  return jsonb_build_object('ok', true, 'granted', v_amount, 'tier_id', m.tier_id, 'tx_id', v_tx,
                            'expires_at', v_expiry, 'balance', public.token_balance(p_member));
end $$;

-- Tokens bought online. Idempotent on the Stripe session, so a webhook retry
-- credits once. Bought tokens never expire.
create or replace function public.token_purchase_credit(
  p_member uuid, p_amount integer, p_cents integer, p_session text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tx uuid;
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
  v_tx := public.token_credit_row(p_member, 'purchase', p_amount, null, null, 'stripe', p_cents, p_session, null);
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
end $$;

-- An admin adds tokens by hand: 'cash' (money taken at a desk; the amount must
-- match the cash at the going rate; never expires) or 'mint' (a gift or a fix;
-- needs a reason; expires after a year). An admin who is not root is held to
-- admin_mint_cap per action, and their free mints to admin_daily_cap per day
-- (Central time). Root is exempt from both caps.
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
    p_member, p_kind, p_amount,
    case when p_kind = 'mint' then now() + interval '1 year' else null end,
    p_actor, nullif(btrim(coalesce(p_reason, '')), ''),
    case when p_kind = 'cash' then p_cash_cents else null end, null, null);
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
end $$;

-- A merchant's staff (or, for CAACI's own internal merchant, any admin) takes
-- tokens from a member. Earliest-expiring lots first. p_idem makes a retried
-- request land once. Nobody charges their own account.
create or replace function public.token_charge(
  p_member uuid, p_merchant uuid, p_actor uuid, p_amount integer, p_items jsonb, p_note text, p_idem text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.token_settings%rowtype;
  mer      public.merchants%rowtype;
  v_tx     uuid;
  v_left   integer;
  v_take   integer;
  v_avail  integer;
  l        record;
begin
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('error', 'invalid_amount'); end if;
  select * into s from public.token_settings;
  if p_amount > s.max_charge then return jsonb_build_object('error', 'over_max_charge', 'max', s.max_charge); end if;
  if p_actor = p_member then return jsonb_build_object('error', 'cannot_charge_self'); end if;

  select * into mer from public.merchants where id = p_merchant;
  if not found then return jsonb_build_object('error', 'merchant_not_found'); end if;
  if mer.status <> 'active' then return jsonb_build_object('error', 'merchant_suspended'); end if;
  if not exists (select 1 from public.merchant_staff where merchant_id = p_merchant and member_id = p_actor)
     and not (mer.kind = 'internal'
              and exists (select 1 from public.members where id = p_actor and (is_admin or is_root))) then
    return jsonb_build_object('error', 'not_staff');
  end if;
  if not exists (select 1 from public.members where id = p_member) then
    return jsonb_build_object('error', 'member_not_found');
  end if;

  perform public.token_lock(p_member);
  if coalesce(p_idem, '') <> '' then
    select id into v_tx from public.token_tx where idem_key = p_idem;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
    end if;
  end if;

  v_avail := public.token_balance(p_member);
  if v_avail < p_amount then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', v_avail);
  end if;

  insert into public.token_tx (member_id, kind, amount, merchant_id, actor_id, items, note, idem_key)
  values (p_member, 'charge', -p_amount, p_merchant, p_actor, p_items,
          nullif(btrim(coalesce(p_note, '')), ''), nullif(p_idem, ''))
  returning id into v_tx;

  v_left := p_amount;
  for l in
    select id, remaining from public.token_lots
     where member_id = p_member and remaining > 0 and (expires_at is null or expires_at > now())
     order by expires_at asc nulls last, created_at asc, id asc
     for update
  loop
    exit when v_left = 0;
    v_take := least(l.remaining, v_left);
    update public.token_lots set remaining = remaining - v_take where id = l.id;
    insert into public.token_tx_lots (tx_id, lot_id, amount) values (v_tx, l.id, v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'token_charge: lots do not cover the balance'; end if;

  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'balance', public.token_balance(p_member));
end $$;

-- Put a charge's tokens back where they came from. Internal; p_kind is 'void'
-- or 'reversal' and the caller has checked who may do it.
create or replace function public.token_undo_charge(
  p_charge public.token_tx, p_kind text, p_actor uuid, p_reason text, p_state text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tx uuid; r record;
begin
  for r in select lot_id, amount from public.token_tx_lots where tx_id = p_charge.id loop
    update public.token_lots set remaining = remaining + r.amount where id = r.lot_id;
  end loop;
  insert into public.token_tx (member_id, kind, amount, merchant_id, actor_id, related_tx, reason)
  values (p_charge.member_id, p_kind, -p_charge.amount, p_charge.merchant_id, p_actor, p_charge.id,
          nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_tx;
  update public.token_tx set state = p_state where id = p_charge.id;
  return v_tx;
end $$;

-- Void a charge. Staff: their own shop's charge, within void_hours. Admin: any
-- charge that has not been voided or reversed already.
create or replace function public.token_void(p_tx uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c        public.token_tx%rowtype;
  v_admin  boolean;
  v_hours  integer;
  v_tx     uuid;
begin
  select * into c from public.token_tx where id = p_tx;
  if not found or c.kind <> 'charge' then return jsonb_build_object('error', 'charge_not_found'); end if;
  if c.member_id is not null then perform public.token_lock(c.member_id); end if;
  select * into c from public.token_tx where id = p_tx;    -- re-read under the lock
  if c.state in ('voided', 'reversed') then return jsonb_build_object('error', 'already_undone'); end if;

  select (is_admin or is_root) into v_admin from public.members where id = p_actor;
  if not coalesce(v_admin, false) then
    if not exists (select 1 from public.merchant_staff where merchant_id = c.merchant_id and member_id = p_actor) then
      return jsonb_build_object('error', 'not_staff');
    end if;
    select void_hours into v_hours from public.token_settings;
    if c.created_at < now() - make_interval(hours => v_hours) then
      return jsonb_build_object('error', 'void_window_closed', 'hours', v_hours);
    end if;
  end if;

  v_tx := public.token_undo_charge(c, 'void', p_actor, p_reason, 'voided');
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'amount', -c.amount,
                            'balance', case when c.member_id is null then null else public.token_balance(c.member_id) end);
end $$;

-- The member's "this wasn't me" from the receipt email. p_key is the secret in
-- that link, so knowing a transaction id is not enough.
create or replace function public.token_dispute_open(p_tx uuid, p_key uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.token_tx%rowtype; v_days integer;
begin
  select * into c from public.token_tx where id = p_tx and dispute_key = p_key;
  if not found or c.kind <> 'charge' then return jsonb_build_object('error', 'charge_not_found'); end if;
  if c.state = 'disputed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if c.state <> 'ok' then return jsonb_build_object('error', 'already_undone'); end if;
  select dispute_days into v_days from public.token_settings;
  if c.created_at < now() - make_interval(days => v_days) then
    return jsonb_build_object('error', 'dispute_window_closed', 'days', v_days);
  end if;
  update public.token_tx
     set state = 'disputed', disputed_at = now(), dispute_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_tx;
  return jsonb_build_object('ok', true);
end $$;

-- An admin settles a dispute. Upheld: the tokens go back (a 'reversal' row, off
-- the merchant's next statement) and a partner shop with suspend_after upheld
-- disputes in the calendar month (Central time) is suspended until an admin
-- re-activates it. Rejected: the charge stands.
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
  if not found or c.kind <> 'charge' then return jsonb_build_object('error', 'charge_not_found'); end if;
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

-- Move tokens between two people of the same family. Each piece keeps the
-- source and the expiry of the lot it came from.
create or replace function public.token_transfer(p_from uuid, p_to uuid, p_amount integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_h_from uuid; v_h_to uuid;
  v_out uuid; v_in uuid;
  v_left integer; v_take integer;
  l record;
begin
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('error', 'invalid_amount'); end if;
  if p_from = p_to then return jsonb_build_object('error', 'same_member'); end if;
  select household_id into v_h_from from public.members where id = p_from;
  select household_id into v_h_to   from public.members where id = p_to;
  if v_h_from is null or v_h_to is null or v_h_from <> v_h_to then
    return jsonb_build_object('error', 'not_same_family');
  end if;
  -- lock both ledgers in a fixed order so two opposite transfers cannot deadlock
  if p_from < p_to then perform public.token_lock(p_from); perform public.token_lock(p_to);
  else perform public.token_lock(p_to); perform public.token_lock(p_from); end if;

  if public.token_balance(p_from) < p_amount then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', public.token_balance(p_from));
  end if;

  insert into public.token_tx (member_id, kind, amount, actor_id) values (p_from, 'transfer_out', -p_amount, p_from)
  returning id into v_out;
  insert into public.token_tx (member_id, kind, amount, actor_id, related_tx) values (p_to, 'transfer_in', p_amount, p_from, v_out)
  returning id into v_in;
  update public.token_tx set related_tx = v_in where id = v_out;

  v_left := p_amount;
  for l in
    select id, remaining, source, expires_at from public.token_lots
     where member_id = p_from and remaining > 0 and (expires_at is null or expires_at > now())
     order by expires_at asc nulls last, created_at asc, id asc
     for update
  loop
    exit when v_left = 0;
    v_take := least(l.remaining, v_left);
    update public.token_lots set remaining = remaining - v_take where id = l.id;
    insert into public.token_tx_lots (tx_id, lot_id, amount) values (v_out, l.id, v_take);
    insert into public.token_lots (member_id, tx_id, source, amount, remaining, expires_at)
    values (p_to, v_in, l.source, v_take, v_take, l.expires_at);
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'token_transfer: lots do not cover the balance'; end if;

  return jsonb_build_object('ok', true, 'tx_id', v_out, 'balance', public.token_balance(p_from));
end $$;

-- What CAACI owes a partner merchant for everything before p_before that is not
-- on a statement yet. Charges still in dispute wait for their outcome.
create or replace function public.token_merchant_open(p_merchant uuid, p_before timestamptz)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(-sum(amount), 0)::integer
    from public.token_tx
   where merchant_id = p_merchant and settlement_id is null
     and created_at < p_before and state <> 'disputed';
$$;

-- Close a statement: stamp the rows and record what is due. Below
-- settle_min_cents (or negative) nothing is closed — the rows stay open and
-- roll into the next statement by themselves.
create or replace function public.token_settlement_close(p_merchant uuid, p_before timestamptz, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.token_settings%rowtype;
  mer public.merchants%rowtype;
  v_tokens integer; v_cents integer; v_id uuid;
begin
  if not exists (select 1 from public.members where id = p_actor and (is_admin or is_root)) then
    return jsonb_build_object('error', 'not_admin');
  end if;
  select * into mer from public.merchants where id = p_merchant for update;
  if not found then return jsonb_build_object('error', 'merchant_not_found'); end if;
  if mer.kind = 'internal' then return jsonb_build_object('error', 'internal_not_settled'); end if;
  if p_before > now() then return jsonb_build_object('error', 'period_not_over'); end if;
  select * into s from public.token_settings;

  v_tokens := public.token_merchant_open(p_merchant, p_before);
  v_cents  := (v_tokens * 100) / s.tokens_per_dollar;
  if v_cents < s.settle_min_cents or v_cents <= 0 then
    return jsonb_build_object('ok', true, 'rolled_over', true, 'tokens', v_tokens, 'amount_cents', v_cents);
  end if;

  insert into public.merchant_settlements (merchant_id, period_end, tokens, amount_cents, created_by)
  values (p_merchant, p_before, v_tokens, v_cents, p_actor)
  returning id into v_id;
  update public.token_tx set settlement_id = v_id
   where merchant_id = p_merchant and settlement_id is null
     and created_at < p_before and state <> 'disputed';
  return jsonb_build_object('ok', true, 'settlement_id', v_id, 'tokens', v_tokens, 'amount_cents', v_cents);
end $$;

-- ---- functions are service-role only ----
revoke execute on function public.members_guard_root() from public, anon, authenticated;
revoke execute on function public.token_lock(uuid) from public, anon, authenticated;
revoke execute on function public.token_balance(uuid) from public, anon, authenticated;
revoke execute on function public.token_credit_row(uuid, text, integer, timestamptz, uuid, text, integer, text, date) from public, anon, authenticated;
revoke execute on function public.token_membership_grant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.token_purchase_credit(uuid, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.token_admin_credit(uuid, text, integer, integer, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_charge(uuid, uuid, uuid, integer, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.token_undo_charge(public.token_tx, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.token_void(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_dispute_open(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.token_dispute_resolve(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.token_transfer(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.token_merchant_open(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.token_settlement_close(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.token_balance(uuid) to service_role;
grant execute on function public.token_membership_grant(uuid, uuid) to service_role;
grant execute on function public.token_purchase_credit(uuid, integer, integer, text) to service_role;
grant execute on function public.token_admin_credit(uuid, text, integer, integer, uuid, text) to service_role;
grant execute on function public.token_charge(uuid, uuid, uuid, integer, jsonb, text, text) to service_role;
grant execute on function public.token_void(uuid, uuid, text) to service_role;
grant execute on function public.token_dispute_open(uuid, uuid, text) to service_role;
grant execute on function public.token_dispute_resolve(uuid, uuid, boolean, text) to service_role;
grant execute on function public.token_transfer(uuid, uuid, integer) to service_role;
grant execute on function public.token_merchant_open(uuid, timestamptz) to service_role;
grant execute on function public.token_settlement_close(uuid, timestamptz, uuid) to service_role;

-- CAACI's own "merchant": event stalls run by volunteers. Never settled.
insert into public.merchants (name, name_zh, kind)
select 'CAACI Events', '华协活动', 'internal'
 where not exists (select 1 from public.merchants where kind = 'internal');
