-- Payment ledger — the in-system record of every membership charge, so staff
-- can track who paid, when, and how much without opening the Stripe Dashboard.
-- Written by the Stripe webhook (first purchase + yearly auto-renewals).
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid references public.members(id) on delete set null,
  kind               text not null default 'membership',  -- membership (first year) | renewal
  amount_cents       integer not null,
  currency           text not null default 'usd',
  tier_id            text,
  discount_code      text,
  stripe_session_id  text,
  stripe_invoice_id  text,
  paid_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- Webhook retries must not double-count a payment.
create unique index if not exists payments_session_uq
  on public.payments (stripe_session_id) where stripe_session_id is not null;
create unique index if not exists payments_invoice_uq
  on public.payments (stripe_invoice_id) where stripe_invoice_id is not null;

create index if not exists payments_member_idx on public.payments (member_id, paid_at desc);
create index if not exists payments_paid_at_idx on public.payments (paid_at desc);

-- RLS: a member may read their own payment history (the account page shows it);
-- admins read everything; only the service role (webhook) writes.
alter table public.payments enable row level security;

drop policy if exists payments_self_read on public.payments;
create policy payments_self_read on public.payments
  for select using (member_id = auth.uid() or public.is_admin());
