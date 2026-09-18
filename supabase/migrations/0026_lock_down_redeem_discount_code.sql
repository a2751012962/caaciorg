-- Close the last SECURITY DEFINER function still callable by a stranger.
--
-- public.redeem_discount_code(text) bumps times_redeemed, and the Stripe webhook
-- calls it once per completed checkout. Postgres grants EXECUTE on a new
-- function to PUBLIC, which on Supabase means anon and authenticated too — so
-- anyone could POST /rest/v1/rpc/redeem_discount_code with the anon key (it is
-- public by design) and run the counter up until every code reads "fully
-- redeemed", refusing real members at checkout. The function is SECURITY
-- DEFINER, so discount_codes' RLS never sees the caller.
--
-- 0017, 0018 and 0024 already lock their functions down this way; 0006 predates
-- the pattern. Nothing in the site calls this RPC with anything but the
-- service-role key, so revoking is invisible to members.
--
-- Apply by pasting into the Supabase SQL editor (see Applying migrations in
-- SETUP.md). Safe to re-run.

revoke all on function public.redeem_discount_code(text) from public, anon, authenticated;
grant execute on function public.redeem_discount_code(text) to service_role;
