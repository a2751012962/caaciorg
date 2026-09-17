// POST /api/tokens/buy { pack_cents } — a Stripe Checkout session for one of
// the token packs in token_settings.packs_cents. The buyer is the signed-in
// account (never a member_id from the body) and needs an active membership of
// any plan, free included. The price is the pack plus the same ~3.5% card fee
// the membership checkout adds; the webhook credits pack_cents worth of tokens
// once Stripe says the session is paid.
import { json, bad, stripe, CARD_SURCHARGE } from '../_lib.js';
import { tokenGate } from '../_tokens.js';

export async function onRequestPost({ request, env }) {
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  let body;
  try {
    body = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const pack = Math.round(Number(body.pack_cents));

  try {
    const [settings, member] = await Promise.all([
      DB.selectOne('token_settings', { id: true }),
      DB.selectOne('members', { id: user.id }, 'id,email,status,stripe_customer_id'),
    ]);
    if (!member || member.status !== 'active')
      return bad('Join CAACI (the free plan counts) before buying tokens.', 403);
    if (!(settings?.packs_cents || []).includes(pack)) return bad('Pick one of the token packs.');

    const tokens = (pack * settings.tokens_per_dollar) / 100;
    const origin = new URL(request.url).origin;
    const session = await stripe(env).call('checkout/sessions', {
      mode: 'payment',
      success_url: `${origin}/account/?tokens=bought`,
      cancel_url: `${origin}/account/?tokens=cancelled`,
      ...(member.stripe_customer_id
        ? { customer: member.stripe_customer_id }
        : { customer_email: member.email || user.email || undefined }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(pack * (1 + CARD_SURCHARGE)),
            product_data: { name: `CAACI Tokens × ${tokens} · 华协币` },
          },
        },
      ],
      metadata: {
        kind: 'tokens',
        member_id: user.id,
        tokens: String(tokens),
        pack_cents: String(pack),
      },
    });
    return json({ url: session.url });
  } catch (e) {
    return bad(e.message, 500);
  }
}
