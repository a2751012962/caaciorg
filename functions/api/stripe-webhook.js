// POST /api/stripe-webhook
// Stripe calls this after checkout completes. Verifies the signature, then
// activates the membership / marks the donation paid in Supabase, and keeps the
// payments ledger's refund total in step with refunds made anywhere in Stripe.
import { sb, stripe } from './_lib.js';
import { grantMembershipTokens, tokensEnabled } from './_tokens.js';

// A Stripe field is sometimes a string id, sometimes an expanded object.
const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

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
  const S = stripe(env);

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

  // The end (unix seconds) of the billing period an invoice pays for: the latest
  // lines.data[].period.end, which every API version carries. null if no line
  // has one.
  function invoicePeriodEnd(inv) {
    const ends = (inv.lines?.data || [])
      .map((line) => line?.period?.end)
      .filter((end) => typeof end === 'number' && Number.isFinite(end));
    return ends.length ? Math.max(...ends) : null;
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

  // The ledger row a refunded charge paid for. Renewals are stored by invoice;
  // a first year by the Checkout Session that created the subscription, which
  // in subscription mode has no payment_intent — only the invoice it created —
  // so the session is found through the invoice's subscription and must name
  // this exact invoice. One-off (payment-mode) sessions match by payment_intent.
  // Relies on the account's 2024-06-20 API shape, where a Charge names its invoice.
  async function findPaymentForCharge(ch) {
    const inv = idOf(ch.invoice);
    if (inv) {
      const byInvoice = await DB.selectOne('payments', { stripe_invoice_id: inv });
      if (byInvoice) return byInvoice;
      const sub = invoiceSub(await S.get(`invoices/${inv}`));
      if (!sub) return null;
      const sessions = await S.get(
        `checkout/sessions?subscription=${encodeURIComponent(sub)}&limit=10`,
      );
      for (const s of sessions.data || []) {
        if (idOf(s.invoice) !== inv) continue;
        const row = await DB.selectOne('payments', { stripe_session_id: s.id });
        if (row) return row;
      }
      return null;
    }
    const pi = idOf(ch.payment_intent);
    if (!pi) return null;
    const found = await S.get(`checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`);
    const s = found.data?.[0];
    return s ? DB.selectOne('payments', { stripe_session_id: s.id }) : null;
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
        await grantMembershipTokens(env, DB, md.member_id);
      } else if (md.kind === 'tokens' && md.member_id && tokensEnabled(env)) {
        // A token pack. Credit only what Stripe says is paid; the ledger function
        // is idempotent on the session id, so a retried event credits once. A
        // failure here must 500 so Stripe retries: the member has paid.
        if (s.payment_status === 'paid') {
          const cents = Number(md.pack_cents);
          const settings = await DB.selectOne('token_settings', { id: true }, 'tokens_per_dollar');
          const tokens = (cents * (settings?.tokens_per_dollar || 10)) / 100;
          if (Number.isInteger(tokens) && tokens > 0) {
            const result = await DB.rpc('token_purchase_credit', {
              p_member: md.member_id,
              p_amount: tokens,
              p_cents: cents,
              p_session: s.id,
            });
            if (!result?.ok)
              throw new Error('token purchase not credited: ' + (result?.error || 'unknown'));
          }
        }
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
          // Expire when the billed period ends, so a late or retried payment
          // doesn't drift the expiry to paid-time + 1 year.
          const periodEnd = invoicePeriodEnd(inv);
          let base;
          if (periodEnd !== null) {
            base = new Date(periodEnd * 1000);
          } else {
            // No line period: extend from the current expiry if it's still in
            // the future, else from now.
            base =
              m.expires_at && new Date(m.expires_at) > new Date()
                ? new Date(m.expires_at)
                : new Date();
            base.setFullYear(base.getFullYear() + 1);
          }
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
          // a renewal is a new membership year: the plan's tokens are granted again
          await grantMembershipTokens(env, DB, m.id);
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
    } else if (event.type === 'charge.refunded') {
      // Fires for every refund — full or partial, from the admin Refunds tab or
      // the Stripe Dashboard. amount_refunded is Stripe's running total for the
      // charge, so writing it (not adding to it) is idempotent under retries and
      // agrees with the total the Refunds tab records for its own refunds.
      const ch = event.data.object;
      const row = await findPaymentForCharge(ch);
      const total = ch.amount_refunded ?? 0;
      if (row && total !== (row.refunded_cents || 0)) {
        const refunds = await S.get(`refunds?charge=${encodeURIComponent(ch.id)}&limit=1`);
        const latest = refunds.data?.[0];
        await DB.update(
          'payments',
          { id: row.id },
          {
            refunded_cents: total,
            refunded_at: new Date((latest?.created ?? Date.now() / 1000) * 1000).toISOString(),
            ...(latest ? { stripe_refund_id: latest.id } : {}),
            // The Refunds tab tags its refunds with metadata.payment_id and writes
            // its own note; anything else was issued in the Stripe Dashboard.
            ...(latest && !latest.metadata?.payment_id
              ? { refund_reason: `Stripe Dashboard${latest.reason ? ` (${latest.reason})` : ''}` }
              : {}),
          },
        );
      }
    }
    return new Response('ok');
  } catch (e) {
    return new Response(`error: ${e.message}`, { status: 500 });
  }
}
