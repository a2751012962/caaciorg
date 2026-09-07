-- Honorable Membership — a free tier granted by the CAACI Board for major
-- contributions to the community. It is never self-serve: checkout and
-- change-plan refuse `invite_only` tiers, the plan page shows it without a
-- Join button, and staff assign it from the admin panel (tier + status=active),
-- so no Stripe subscription is involved.
alter table public.membership_tiers
  add column if not exists invite_only boolean not null default false;

insert into public.membership_tiers (id, name, price_cents, description, sort_order, invite_only) values
  ('honorary', 'Honorable Membership', 0,
   'Free membership for major contributions to the community. By invitation of the CAACI Board.',
   5, true)
on conflict (id) do update
  set name = excluded.name, price_cents = excluded.price_cents,
      description = excluded.description, sort_order = excluded.sort_order,
      invite_only = excluded.invite_only;
