-- Seed data for CAACI. Prices are base annual (USD cents) from the live site.
-- A ~3.5% card surcharge is added at checkout for credit-card payments.

-- Paid tiers all carry the same benefits (annual member meeting with lunch, and
-- member perks at the Dragon Boat, Mid-Autumn and Spring Festival events);
-- the Honorable tier is free, Board-invited only, and never sold at checkout.
-- The Free tier is self-serve: /api/checkout activates it directly (no Stripe,
-- no expiry) and it carries none of the festival perks.
insert into public.membership_tiers (id, name, price_cents, description, sort_order, invite_only) values
  ('free',       'Free Membership',       0,
   'Community updates and event announcements — no payment needed. Upgrade any time for festival perks.',
   0, false),
  ('student',    'Student Membership',    1000,  '$10 per year for college students 18 and above.',       1, false),
  ('individual', 'Individual Membership', 3000,  '$30 per year for an individual.',                       2, false),
  ('family',     'Family Membership',     6000,  '$60 per year for a household/family.',                  3, false),
  ('business',   'Business Membership',   10000, '$100 per year, includes business directory listing.',  4, false),
  ('honorary',   'Honorable Membership',  0,
   'Free membership for major contributions to the community. By invitation of the CAACI Board.',
   5, true)
on conflict (id) do update
  set name = excluded.name, price_cents = excluded.price_cents,
      description = excluded.description, sort_order = excluded.sort_order,
      invite_only = excluded.invite_only;

-- Signature annual festivals (the public Events Calendar loads the live list via
-- the WP REST API, which isn't in the static mirror; seed the recurring ones).
insert into public.events (title, slug, description, starts_at, location) values
  ('Chinese New Year Celebration', 'chinese-new-year',
   'Annual Lunar New Year celebration with performances, food, and family activities.',
   '2026-02-17 17:00:00-06', 'Champaign-Urbana, IL'),
  ('Dragon Boat Festival', 'dragon-boat-festival',
   'Celebrating tradition and community spirit.',
   '2026-06-20 11:00:00-05', 'Champaign-Urbana, IL'),
  ('Mid-Autumn Festival', 'mid-autumn-festival',
   'Gather to share mooncakes under the harvest moon.',
   '2026-09-25 18:00:00-05', 'Champaign-Urbana, IL')
on conflict (slug) do nothing;

-- Business directory categories exist on the live site (restaurant, bakery,
-- supermarket). Seed left to the org to populate with real listings.
