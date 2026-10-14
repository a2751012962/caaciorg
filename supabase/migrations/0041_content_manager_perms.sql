-- 0041 — what else a content manager may do, besides columns and page copy.
--
-- The back office now has three roles: root, administrators (members.is_admin)
-- and content managers (a content_editors row, 0040). A content manager sees
-- only what their row allows: some or all article columns and page copy
-- (0040), and — added here, in `perms` — any of:
--   events     the Events tab (create, edit, publish, form templates), each
--              event's registrations and its volunteers
--   news       Send news: the email to members (and its test send)
--   invites    invitation codes
--   plans      membership plans: names, card text and prices (a price change
--              also updates the Stripe price, as it does for an admin)
--   directory  the business directory
-- They never see members, families, payments, refunds, discount codes, the
-- dashboard or tokens; those stay with administrators.
--
-- Default empty: nobody gains access by this migration; existing rows keep
-- exactly what they had, and administrators are unaffected.
-- Paste AFTER 0040. The code reads content_editors with select=*, so it also
-- runs before this one, with none of these for any content manager.
-- Run via: paste into the Supabase SQL editor (never supabase db push on this project; see SETUP.md)

alter table public.content_editors
  add column if not exists perms text[] not null default '{}';

alter table public.content_editors drop constraint if exists content_editors_perms_known;
alter table public.content_editors add constraint content_editors_perms_known
  check (perms <@ array['events', 'news', 'invites', 'plans', 'directory']::text[]);
