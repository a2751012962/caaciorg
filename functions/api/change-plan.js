// POST /api/change-plan
// Switches an existing member's Stripe subscription to a different tier *in place*
// (with proration) instead of creating a second subscription, then updates the
// members row. If the member has no live subscription yet, it falls back to a
// normal Checkout Session and returns { url } — so the client handles both the
// same way.
import { json, bad, sb, stripe } from './_lib.js';

const CARD_SURCHARGE = 0.035; // keep in sync with checkout.js + the UI summary

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!body.member_id || !body.tier_id) return bad('member_id and tier_id are required.');

  const origin = new URL(request.url).origin;
  const S = stripe(env);
  const DB = sb(env);

  try {
    const tier = await DB.selectOne('membership_tiers', { id: body.tier_id });
    if (!tier) return bad('Unknown membership tier.');
    const member = await DB.selectOne('members', { id: body.member_id });
    if (!member) return bad('Member not found.');
    if (member.tier_id === tier.id) return bad('You are already on this plan.');

    const amount = Math.round(tier.price_cents * (1 + CARD_SURCHARGE));

    // No live subscription → behave like a first purchase (fresh Checkout Session).
    if (!member.stripe_subscription_id) {
      const session = await S.call('checkout/sessions', {
        mode: 'subscription',
        success_url: `${origin}/thank-you/?m={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/membership/`,
        customer: member.stripe_customer_id || undefined,
        customer_email: member.stripe_customer_id ? undefined : member.email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: { name: tier.name },
              recurring: { interval: 'year' },
            },
          },
        ],
        metadata: { kind: 'membership', tier_id: tier.id, member_id: member.id },
      });
      return json({ url: session.url });
    }

    // Live subscription → read its single item, then swap that item's price.
    const sub = await S.get(`subscriptions/${member.stripe_subscription_id}`);
    if (!sub || sub.status === 'canceled' || sub.status === 'incomplete_expired') {
      return bad('Your subscription is no longer active. Please re-join.', 409);
    }
    const item = sub.items?.data?.[0];
    if (!item?.id) return bad('Could not read your subscription.', 500);

    // A subscription item can only point at an existing Price, so mint a new
    // Price (inline product) for the target tier, then move the item onto it.
    const price = await S.call('prices', {
      currency: 'usd',
      unit_amount: amount,
      recurring: { interval: 'year' },
      product_data: { name: tier.name },
    });

    await S.call(`subscriptions/${member.stripe_subscription_id}`, {
      proration_behavior: 'create_prorations',
      payment_behavior: 'allow_incomplete',
      items: [{ id: item.id, price: price.id }],
    });

    // Reflect the change immediately; renewal date (expires_at) is unchanged.
    await DB.update('members', { id: member.id }, { tier_id: tier.id });
    return json({ ok: true, tier_id: tier.id });
  } catch (e) {
    return bad(e.message, 500);
  }
}
