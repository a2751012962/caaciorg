-- Row Level Security for CAACI tables.
-- Anon (public) client uses the anon key; Pages Functions use the service-role
-- key which BYPASSES RLS, so server writes (Stripe/webhooks/forms) are unaffected.

alter table public.membership_tiers   enable row level security;
alter table public.members            enable row level security;
alter table public.events             enable row level security;
alter table public.rsvps              enable row level security;
alter table public.business_directory enable row level security;
alter table public.donations          enable row level security;
alter table public.form_submissions   enable row level security;

-- helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where id = auth.uid()), false);
$$;

-- ---- membership_tiers: anyone can read active tiers ----
drop policy if exists tiers_read on public.membership_tiers;
create policy tiers_read on public.membership_tiers
  for select using (active = true or public.is_admin());

-- ---- members: a user sees/edits only their own row; admins see all ----
drop policy if exists members_self_read on public.members;
create policy members_self_read on public.members
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists members_self_update on public.members;
create policy members_self_update on public.members
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- events: public reads published; admins manage ----
drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select using (published = true or public.is_admin());
drop policy if exists events_admin_write on public.events;
create policy events_admin_write on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- ---- rsvps: a member manages their own RSVPs ----
drop policy if exists rsvps_self on public.rsvps;
create policy rsvps_self on public.rsvps
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- ---- business_directory: public reads approved; owner manages own; admin all ----
drop policy if exists biz_read on public.business_directory;
create policy biz_read on public.business_directory
  for select using (approved = true or owner_id = auth.uid() or public.is_admin());
drop policy if exists biz_owner_write on public.business_directory;
create policy biz_owner_write on public.business_directory
  for all using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ---- donations & form_submissions: no public access (server-only via service key) ----
-- (RLS enabled with no policies = anon/auth clients get nothing; service role bypasses.)
drop policy if exists donations_admin_read on public.donations;
create policy donations_admin_read on public.donations
  for select using (public.is_admin());
drop policy if exists forms_admin_read on public.form_submissions;
create policy forms_admin_read on public.form_submissions
  for select using (public.is_admin());
