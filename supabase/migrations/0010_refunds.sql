-- Refunds — record money returned against a ledger row so staff can issue
-- refunds from the admin panel instead of opening the Stripe Dashboard.
-- A payment can be refunded in part and more than once, so we track a running
-- `refunded_cents` total on the row (capped server-side at the amount paid)
-- plus the last Stripe refund id / timestamp / reason for the audit trail.
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

alter table public.payments
  add column if not exists refunded_cents  integer not null default 0,
  add column if not exists refunded_at      timestamptz,
  add column if not exists stripe_refund_id text,
  add column if not exists refund_reason    text;
