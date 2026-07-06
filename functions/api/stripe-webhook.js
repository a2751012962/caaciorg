// POST /api/stripe-webhook
// Stripe calls this after checkout completes. Verifies the signature, then
// activates the membership / marks the donation paid in Supabase.
import { sb } from './_lib.js';

// Verify Stripe's signature (HMAC-SHA256) using Web Crypto (Workers-compatible).
// Exported so the signature logic can be unit-tested directly.
export async function verify(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const t = parts.t,
    v1 = parts.v1;
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  if (env.STRIPE_WEBHOOK_SECRET) {
    const ok = await verify(payload, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!ok) return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  const DB = sb(env);

  // The Invoice object moved the subscription reference across API versions:
  //   legacy (< 2025-03-31.basil): invoice.subscription (string)
  //   newer:                       invoice.parent.subscription_details.subscription
  //                                (and per-line under lines.data[].parent…)
  // Read every known location so renewals/failures match regardless of version.
  function invoiceSub(inv) {
    return (
      inv.subscription ||
      inv.parent?.subscription_details?.subscription ||
      inv.lines?.data?.[0]?.subscription ||
      inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ||
      null
    );
  }

  // Find the member behind a subscription invoice/event. Match on the most
  // precise key first (subscription id), then fall back to customer id.
  async function findMember({ sub, cust }) {
    if (sub) {
      const m = await DB.selectOne('members', { stripe_subscription_id: sub });
      if (m) return m;
    }
    if (cust) return DB.selectOne('members', { stripe_customer_id: cust });
    return null;
  }

  // Append a row to the payments ledger (who paid, when, how much) so staff can
  // track dues in the admin panel without opening the Stripe Dashboard. Never
  // fatal: the membership state is already updated, the unique indexes on the
  // Stripe ids swallow webhook-retry duplicates, and a missing table (migration
  // not yet applied) must not 500 the webhook into a retry loop.
  async function recordPayment(row) {
    try {
      await DB.insert('payments', row, { returning: false });
    } catch (err) {
      console.warn('stripe-webhook: payments insert failed —', err.message);
    }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const md = s.metadata || {};
      if (md.kind === 'donation') {
        await DB.update('donations', { stripe_session_id: s.id }, { status: 'paid' });
      } else if (md.kind === 'membership' && md.member_id) {
        const now = new Date();
        const expires = new Date(now);
        expires.setFullYear(expires.getFullYear() + 1);
        await DB.update(
          'members',
          { id: md.member_id },
          {
            tier_id: md.tier_id || null,
            status: 'active',
            member_since: now.toISOString(),
            expires_at: expires.toISOString(),
            stripe_customer_id: s.customer || null,
            stripe_subscription_id: s.subscription || null,
          },
        );
        // Count the discount redemption (atomic — see 0006_discounts.sql). Never
        // let a missing function/table fail the webhook: the membership is
        // already active, and a 500 here would make Stripe retry the event.
        if (md.discount_code) {
          try {
            await DB.rpc('redeem_discount_code', { p_code: md.discount_code });
          } catch (err) {
            console.warn('stripe-webhook: redeem_discount_code failed —', err.message);
          }
        }
        await recordPayment({
          member_id: md.member_id,
          kind: 'membership',
          amount_cents: s.amount_total ?? 0,
          currency: s.currency || 'usd',
          tier_id: md.tier_id || null,
          discount_code: md.discount_code || null,
          stripe_session_id: s.id,
        });
      }
    } else if (event.type === 'invoice.paid') {
      // Only RENEWALS extend the membership. The first invoice at signup has
      // billing_reason 'subscription_create' and is already handled by
      // checkout.session.completed (which sets the initial year + customer/sub
      // ids); extending here too would double-count the first year.
      const inv = event.data.object;
      if (inv.billing_reason === 'subscription_cycle') {
        const sub = invoiceSub(inv);
        const m = await findMember({ sub, cust: inv.customer });
        if (m) {
          // Extend from the current expiry if it's still in the future, else from now.
          const base =
            m.expires_at && new Date(m.expires_at) > new Date()
              ? new Date(m.expires_at)
              : new Date();
          base.setFullYear(base.getFullYear() + 1);
          await DB.update(
            'members',
            { id: m.id },
            {
              status: 'active',
              expires_at: base.toISOString(),
              stripe_subscription_id: sub || m.stripe_subscription_id,
            },
          );
          await recordPayment({
            member_id: m.id,
            kind: 'renewal',
            amount_cents: inv.amount_paid ?? 0,
            currency: inv.currency || 'usd',
            tier_id: m.tier_id || null,
            stripe_invoice_id: inv.id,
          });
        }
      }
    } else if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      const m = await findMember({ sub: invoiceSub(inv), cust: inv.customer });
      if (m) await DB.update('members', { id: m.id }, { status: 'past_due' });
    } else if (event.type === 'customer.subscription.deleted') {
      const s = event.data.object;
      const m = await findMember({ sub: s.id, cust: s.customer });
      if (m) await DB.update('members', { id: m.id }, { status: 'cancelled' });
    }
    return new Response('ok');
  } catch (e) {
    return new Response(`error: ${e.message}`, { status: 500 });
  }
}
