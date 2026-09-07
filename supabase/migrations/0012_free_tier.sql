-- Free Membership — the self-serve $0 tier. Anyone can join it: /api/checkout
-- activates it directly (status active, no expiry, no Stripe subscription) and
-- it carries none of the paid-tier perks (annual meeting lunch, festival
-- benefits). A member with a live paid subscription must cancel it in the
-- billing portal before moving here, so Stripe never keeps billing someone the
-- site shows as free. Mirrors the row in supabase/seed.sql.
insert into public.membership_tiers (id, name, price_cents, description, sort_order, invite_only) values
  ('free', 'Free Membership', 0,
   'Community updates and event announcements — no payment needed. Upgrade any time for festival perks.',
   0, false)
on conflict (id) do update
  set name = excluded.name, price_cents = excluded.price_cents,
      description = excluded.description, sort_order = excluded.sort_order,
      invite_only = excluded.invite_only;
