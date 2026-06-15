// POST /api/checkout
// Creates a Stripe Checkout Session for either a membership or a donation,
// and returns { url } for the client to redirect to.
import { json, bad, sb, stripe } from './_lib.js';

const CARD_SURCHARGE = 0.035; // ~3.5% card fee, matching the live site's pricing

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad('invalid JSON');
  }

  const origin = new URL(request.url).origin;
  const S = stripe(env);
  const DB = sb(env);

  try {
    if (body.type === 'donation') {
      const amount = Math.round(Number(body.amount_cents));
      if (!amount || amount < 100) return bad('Minimum donation is $1.');
      const session = await S.call('checkout/sessions', {
        mode: body.recurring ? 'subscription' : 'payment',
        success_url: `${origin}/thank-you/?d={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/donate/`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: { name: 'Donation to CAACI' },
              ...(body.recurring ? { recurring: { interval: 'month' } } : {}),
            },
          },
        ],
        metadata: { kind: 'donation', donor_name: body.name || '', donor_email: body.email || '' },
      });
      await DB.insert(
        'donations',
        {
          donor_name: body.name || null,
          donor_email: body.email || null,
          amount_cents: amount,
          recurring: !!body.recurring,
          stripe_session_id: session.id,
        },
        { returning: false },
      );
      return json({ url: session.url });
    }

    // membership checkout
    const tier = await DB.selectOne('membership_tiers', { id: body.tier_id });
    if (!tier) return bad('Unknown membership tier.');
    const amount = Math.round(tier.price_cents * (1 + CARD_SURCHARGE));
    const session = await S.call('checkout/sessions', {
      mode: 'subscription',
      success_url: `${origin}/thank-you/?m={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/membership/`,
      customer_email: body.email || undefined,
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
      metadata: { kind: 'membership', tier_id: tier.id, member_id: body.member_id || '' },
    });
    return json({ url: session.url });
  } catch (e) {
    return bad(e.message, 500);
  }
}
