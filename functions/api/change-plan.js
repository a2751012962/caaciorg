// POST /api/change-plan
// Switches an existing member's Stripe subscription to a different tier *in place*
// (with proration) instead of creating a second subscription, then updates the
// members row. If the member has no live subscription yet, it falls back to a
// normal Checkout Session and returns { url } — so the client handles both the
// same way.
import { json, bad, sb, stripe, tierPrice, isFreeTier, activateFreeTier } from './_lib.js';

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
    if (tier.invite_only) return bad('This membership is by invitation only.');
    const member = await DB.selectOne('members', { id: body.member_id });
    if (!member) return bad('Member not found.');
    if (member.tier_id === tier.id) return bad('You are already on this plan.');

    // Moving to the free tier is not a Stripe price swap. A member whose paid
    // subscription is still live must cancel it in the billing portal first
    // (the webhook then marks them cancelled and they can join free); anyone
    // else — expired, cancelled, or never paid — is simply activated on it.
    if (isFreeTier(tier)) {
      const r = await activateFreeTier(DB, member.id, tier, member);
      if (r.error)
        return bad(
          'To move to the free membership, cancel your paid plan from Manage billing first.',
          409,
        );
      return json({ ok: true, tier_id: tier.id });
    }

    // No live subscription → behave like a first purchase (fresh Checkout Session).
    if (!member.stripe_subscription_id) {
      const session = await S.call('checkout/sessions', {
        mode: 'subscription',
        success_url: `${origin}/thank-you/?m={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/membership/`,
        customer: member.stripe_customer_id || undefined,
        customer_email: member.stripe_customer_id ? undefined : member.email || undefined,
        line_items: [{ quantity: 1, ...(await tierPrice(S, tier)) }],
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

    // A subscription item can only point at an existing Price: use the tier's
    // catalogue Price when there is one, else mint one from the inline pricing.
    const pricing = await tierPrice(S, tier);
    const priceId = pricing.price || (await S.call('prices', pricing.price_data)).id;

    await S.call(`subscriptions/${member.stripe_subscription_id}`, {
      proration_behavior: 'create_prorations',
      payment_behavior: 'allow_incomplete',
      items: [{ id: item.id, price: priceId }],
    });

    // Reflect the change immediately; renewal date (expires_at) is unchanged.
    await DB.update('members', { id: member.id }, { tier_id: tier.id });
    return json({ ok: true, tier_id: tier.id });
  } catch (e) {
    return bad(e.message, 500);
  }
}
