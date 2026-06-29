-- Admin / back-office support.
--   1. Allow a 'past_due' member status (Stripe invoice.payment_failed).
--   2. Audit table for news emails sent to the membership.
-- Run via: supabase db push   (or paste into the Supabase SQL editor)

-- ============================================================
-- members.status now includes 'past_due'. The column was free-text;
-- add an explicit CHECK so the admin panel can't write a bad value.
-- ============================================================
alter table public.members drop constraint if exists members_status_chk;
alter table public.members add constraint members_status_chk
  check (status in ('pending','active','expired','cancelled','past_due'));

comment on column public.members.status is
  'pending | active | expired | cancelled | past_due';

-- ============================================================
-- news_posts — audit log of admin news emails. Written server-side
-- (service role) only; admins can read. Body is admin-authored HTML.
-- ============================================================
create table if not exists public.news_posts (
  id              uuid primary key default gen_random_uuid(),
  subject         text not null,
  body_html       text,
  audience        text not null default 'active',   -- all | active | tier:<id>
  recipient_count integer not null default 0,
  error_count     integer not null default 0,
  sent_by         uuid references public.members(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.news_posts enable row level security;

-- Admins can read the audit log; nobody inserts via the public/auth client
-- (server uses the service-role key, which bypasses RLS).
drop policy if exists news_admin_read on public.news_posts;
create policy news_admin_read on public.news_posts
  for select using (public.is_admin());
