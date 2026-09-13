-- Server-only writes for business_directory and rsvps.
-- 0002 let a signed-in browser write these tables straight through PostgREST:
--   * biz_owner_write (for all, no column restriction) let a user insert a
--     listing with owner_id = self and approved = true, or flip their own row to
--     approved, and have it shown publicly through biz_read without admin review.
--   * rsvps_self (for all) let a member RSVP to any event, published or not.
-- Nothing in the browser writes either table: listings arrive via
-- /api/business-listing, admin edits via /api/admin/business, RSVPs via
-- /api/rsvp — all with the service-role key, which bypasses both RLS and these
-- grants. So the write policies go, and so does the table-level write privilege
-- Supabase grants anon/authenticated by default (truncate included: it ignores
-- RLS entirely). Read access is unchanged.

-- ---- business_directory: public reads approved (biz_read); writes are server-only ----
drop policy if exists biz_owner_write on public.business_directory;
revoke insert, update, delete, truncate on public.business_directory from anon, authenticated;

-- ---- rsvps: a member reads their own RSVPs; writes are server-only ----
drop policy if exists rsvps_self on public.rsvps;
drop policy if exists rsvps_self_read on public.rsvps;
create policy rsvps_self_read on public.rsvps
  for select using (member_id = auth.uid());
revoke insert, update, delete, truncate on public.rsvps from anon, authenticated;
