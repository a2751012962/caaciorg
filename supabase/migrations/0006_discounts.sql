-- Discount codes for membership checkout.
--   Staff create codes in the admin panel (each gets a shareable QR code that
--   opens /membership/?code=XXX with the discount pre-applied). Validation and
--   redemption counting happen server-side in the Pages Functions.
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

create table if not exists public.discount_codes (
  code             text primary key,                 -- what members type / the QR encodes (uppercase)
  percent_off      integer not null check (percent_off between 1 and 100),
  description      text,                             -- staff-facing note ("2026 Lantern Festival")
  active           boolean not null default true,
  expires_at       timestamptz,                      -- null = never expires
  max_redemptions  integer,                          -- null = unlimited
  times_redeemed   integer not null default 0,
  created_at       timestamptz not null default now()
);

-- RLS on with no anon/authenticated policies: only the service-role key (the
-- Pages Functions) can read or write codes. The public /api/discount endpoint
-- reveals a single code's percent_off only when the exact code is presented.
alter table public.discount_codes enable row level security;

drop policy if exists discount_codes_admin_all on public.discount_codes;
create policy discount_codes_admin_all on public.discount_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- Atomic redemption bump (the webhook calls this once per completed checkout,
-- so a read-modify-write race between two checkouts can't lose a count).
create or replace function public.redeem_discount_code(p_code text)
returns void language sql security definer set search_path = public as $$
  update public.discount_codes
     set times_redeemed = times_redeemed + 1
   where code = p_code;
$$;
