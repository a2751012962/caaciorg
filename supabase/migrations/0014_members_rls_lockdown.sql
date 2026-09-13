-- Server-only writes for members.
-- 0002 gave members a self-update policy with no column restriction, and
-- Supabase grants anon/authenticated every table privilege by default, so a
-- signed-in member could PATCH /rest/v1/members?id=eq.<self> and set is_admin,
-- tier_id, status, expires_at, household_id or the stripe_* ids on their own
-- row. is_admin is what public.is_admin() and requireAdmin (functions/api/_lib.js)
-- trust, so that was a full escalation to the admin API and admin-readable tables.
-- Nothing in the browser writes members: the row is created by handle_new_user
-- (security definer), and checkout, the Stripe webhook, change-plan and
-- /api/admin/members all use the service-role key, which bypasses both RLS and
-- these grants. So the update policy goes, and so does the table-level write
-- privilege (truncate included: it ignores RLS entirely). Members still read
-- their own row through members_self_read.
-- Apply by pasting into the Supabase SQL editor, in filename order (see SETUP.md).

drop policy if exists members_self_update on public.members;
revoke insert, update, delete, truncate on public.members from anon, authenticated;
