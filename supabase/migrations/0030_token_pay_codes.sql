-- 0030 — self-serve pay codes: the customer scans the PRODUCT, not the other
-- way round.
--
-- 0024 built one direction only: the clerk scans the member card and presses a
-- button on /charge/. That needs a phone, a CAACI account on the staff list and
-- someone free to hold it. A stall selling $3 cups of juice has none of those
-- to spare, so this adds the mirror image: a sticker on the cup carries a QR
-- for https://<site>/pay/?c=<code>, the member scans it with their own camera,
-- sees WHICH shop and WHAT for, taps once, and the tokens move.
--
-- One code per menu item (merchant_items.pay_code), because that is what is
-- printed: "Orange juice · 30 tokens". The code carries no price — the price is
-- read from the item here, at the moment of the charge — so a URL cannot be
-- edited into a cheaper one. Change an item's price and every sticker already
-- printed for it now charges the new price; the admin screen says so and the
-- reprint is the admin's job.
--
-- What a static, public code can and cannot do:
--   * Anyone who has the code can pay, from anywhere. That is the point (no
--     staff device), and it is also why the shop still has to CHECK: the
--     merchant console lists each self-serve charge with a four-character
--     confirmation code the customer's screen shows. Reading a receipt off a
--     customer's phone alone proves nothing — a screenshot looks identical.
--   * A code texted to someone out of the blue is the one real attack: they tap
--     confirm and pay a shop they are not at. The page names the shop in large
--     type before the tap, every charge emails the member a receipt with the
--     "this wasn't me" link of 0024, max_charge still caps a single charge, and
--     partner shops are paid monthly — so it is visible, disputable and
--     recoverable before any money leaves.
--   * Double taps: the page sends one idem_key per visit (as /charge/ does), and
--     beyond that a second charge for the SAME item by the SAME member within
--     token_settings.pay_repeat_seconds is refused until the page asks again
--     ("you paid for this a minute ago — again?"). Buying two juices is two
--     deliberate taps, not one accidental one.
--
-- Who may take self-serve payments is a policy switch, not a code change:
-- token_settings.pay_allow_partners starts FALSE, so only CAACI's own internal
-- merchant can. The compliance position of the whole token system (see 0027)
-- rests on CAACI running the shops itself; opening this to outside merchants is
-- the decision that changes that, and it should be made deliberately, by
-- flipping one boolean, after that review.
--
-- Server-only like the rest of 0024: RLS on, no policies, every privilege
-- revoked from anon and authenticated, EXECUTE on the new function revoked from
-- public/anon/authenticated and granted to service_role. Idempotent.
-- Run via: paste into the Supabase SQL editor (never supabase db push; see SETUP.md)

-- ------------------------------------------------------------- columns ------
-- The printed code. NULL = this item has no sticker. Rotating it (a sticker
-- that was swapped, photographed or over-printed) is one UPDATE, and every
-- sheet printed from the old code stops working the moment it changes.
alter table public.merchant_items add column if not exists pay_code    text;
alter table public.merchant_items add column if not exists pay_code_at timestamptz;

create unique index if not exists merchant_items_pay_code
  on public.merchant_items (pay_code) where pay_code is not null;

comment on column public.merchant_items.pay_code is
  'Code printed in this item''s QR (/pay/?c=…). NULL = no sticker. Rotate to kill printed copies.';
comment on column public.merchant_items.pay_code_at is
  'When the current pay_code was issued — a price edited after this dates every printed sheet.';

-- How the charge was made. self_serve is the permanent fact (it survives the
-- item being deleted, which past charges must); pay_item_id is the live link,
-- used to spot the same person paying for the same thing twice in a row.
alter table public.token_tx add column if not exists self_serve  boolean not null default false;
alter table public.token_tx add column if not exists pay_item_id uuid
  references public.merchant_items(id) on delete set null;

create index if not exists token_tx_pay_item on public.token_tx (pay_item_id, member_id, created_at desc)
  where pay_item_id is not null;

-- ------------------------------------------------------------ settings ------
alter table public.token_settings
  add column if not exists pay_repeat_seconds integer not null default 120;
alter table public.token_settings
  add column if not exists pay_allow_partners boolean not null default false;

alter table public.token_settings drop constraint if exists token_settings_pay_repeat_pos;
alter table public.token_settings add  constraint token_settings_pay_repeat_pos
  check (pay_repeat_seconds >= 0);

comment on column public.token_settings.pay_repeat_seconds is
  'Within this many seconds, a second self-serve charge for the same item by the same member needs a second confirmation.';
comment on column public.token_settings.pay_allow_partners is
  'FALSE: only CAACI''s own (internal) merchants may take scan-to-pay. Flipping this is the compliance decision of 0027, not a code change.';

-- ------------------------------------------------------------ function ------
-- A member pays a printed code from their own phone. The actor IS the member —
-- that is what makes it self-serve — so this deliberately does NOT share
-- token_charge's "not_staff" and "cannot_charge_self" guards; the code itself
-- is the authorisation, and everything it authorises is written on the sticker.
-- p_idem makes a retried request land once, exactly as for a clerk's charge.
create or replace function public.token_charge_code(
  p_member uuid, p_code text, p_idem text, p_allow_repeat boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s        public.token_settings%rowtype;
  it       public.merchant_items%rowtype;
  mer      public.merchants%rowtype;
  v_code   text;
  v_prev   timestamptz;
  v_tx     uuid;
  v_avail  integer;
begin
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then return jsonb_build_object('error', 'code_not_found'); end if;

  select * into it from public.merchant_items where pay_code = v_code;
  if not found or not it.active then return jsonb_build_object('error', 'code_not_found'); end if;
  if it.tokens is null or it.tokens <= 0 then return jsonb_build_object('error', 'invalid_amount'); end if;

  select * into mer from public.merchants where id = it.merchant_id;
  if not found then return jsonb_build_object('error', 'merchant_not_found'); end if;
  if mer.status <> 'active' then return jsonb_build_object('error', 'merchant_suspended'); end if;

  select * into s from public.token_settings;
  if mer.kind <> 'internal' and not s.pay_allow_partners then
    return jsonb_build_object('error', 'self_serve_not_allowed');
  end if;
  if it.tokens > s.max_charge then
    return jsonb_build_object('error', 'over_max_charge', 'max', s.max_charge);
  end if;

  if not exists (select 1 from public.members where id = p_member) then
    return jsonb_build_object('error', 'member_not_found');
  end if;

  perform public.token_lock(p_member);

  if coalesce(p_idem, '') <> '' then
    select id into v_tx from public.token_tx where idem_key = p_idem;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'tx_id', v_tx,
                                'amount', it.tokens, 'balance', public.token_balance(p_member));
    end if;
  end if;

  -- The same person, the same item, a moment ago: almost always a double tap or
  -- a re-scan, occasionally a genuine second cup. Ask, do not decide.
  if not coalesce(p_allow_repeat, false) and s.pay_repeat_seconds > 0 then
    select created_at into v_prev from public.token_tx
     where member_id = p_member and pay_item_id = it.id and state = 'ok'
       and created_at > now() - make_interval(secs => s.pay_repeat_seconds)
     order by created_at desc limit 1;
    if found then
      return jsonb_build_object('error', 'repeat_too_soon',
                                'seconds', s.pay_repeat_seconds, 'at', v_prev);
    end if;
  end if;

  v_avail := public.token_balance(p_member);
  if v_avail < it.tokens then
    return jsonb_build_object('error', 'insufficient_balance', 'balance', v_avail);
  end if;

  insert into public.token_tx (member_id, kind, amount, merchant_id, actor_id, items, idem_key,
                               self_serve, pay_item_id)
  values (p_member, 'charge', -it.tokens, mer.id, p_member,
          jsonb_build_array(jsonb_build_object(
            'name', it.name, 'name_zh', it.name_zh, 'tokens', it.tokens, 'qty', 1)),
          nullif(p_idem, ''), true, it.id)
  returning id into v_tx;

  perform public.token_draw(p_member, v_tx, it.tokens);
  return jsonb_build_object('ok', true, 'tx_id', v_tx, 'amount', it.tokens,
                            'merchant_id', mer.id, 'balance', public.token_balance(p_member));
end $$;

revoke execute on function public.token_charge_code(uuid, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.token_charge_code(uuid, text, text, boolean) to service_role;
