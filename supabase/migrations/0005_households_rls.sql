-- Row Level Security for households + household_members.
-- Admins manage everything (the /api/admin/* Functions use the service-role key,
-- which bypasses RLS anyway); a logged-in member may read their own family.

alter table public.households        enable row level security;
alter table public.household_members enable row level security;

-- helper: the household the current user belongs to (security definer so the
-- subquery on members does not re-trigger members' own RLS / recurse).
create or replace function public.current_household_id()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.members where id = auth.uid();
$$;

-- ---- households: admins manage all; a member reads their own ----
drop policy if exists households_admin_all on public.households;
create policy households_admin_all on public.households
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists households_self_read on public.households;
create policy households_self_read on public.households
  for select using (public.is_admin() or id = public.current_household_id());

-- ---- household_members: admins manage all; a member reads their own family ----
drop policy if exists hm_admin_all on public.household_members;
create policy hm_admin_all on public.household_members
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists hm_self_read on public.household_members;
create policy hm_self_read on public.household_members
  for select using (public.is_admin() or household_id = public.current_household_id());
