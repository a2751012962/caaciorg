// POST /api/portal — open the Stripe Billing Portal for the signed-in member.
// The portal is where a member updates their card, downloads invoices, or
// cancels the subscription; Stripe hosts it, we just mint a session URL.
import { json, bad, sb, stripe, requireUser } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;

  const origin = new URL(request.url).origin;
  try {
    const member = await sb(env).selectOne(
      'members',
      { id: gate.user.id },
      'id,stripe_customer_id',
    );
    if (!member?.stripe_customer_id)
      return bad('No billing profile yet — join a membership first.', 404);
    const session = await stripe(env).call('billing_portal/sessions', {
      customer: member.stripe_customer_id,
      return_url: `${origin}/account/`,
    });
    return json({ url: session.url });
  } catch (e) {
    return bad(e.message, 500);
  }
}
