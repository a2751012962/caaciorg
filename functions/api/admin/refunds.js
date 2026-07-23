// POST /api/admin/refunds  (admin only)
// Issue a refund against a ledger row without opening the Stripe Dashboard.
//   body: { payment_id, amount_cents?, reason? }
// A payment can be refunded in full (omit amount_cents) or in part, and more
// than once, up to the amount originally paid. The Stripe charge is resolved
// from whichever reference the ledger stored — the Checkout Session (first
// year) or the Invoice (auto-renewal) — so staff never handle raw charge ids.
// The row's running `refunded_cents` total is updated for the audit trail and
// the Payments / Refunds tabs.
import { json, bad, sb, stripe, requireAdmin } from '../_lib.js';

// Stripe's `reason` field only accepts a fixed enum; free-text notes ride along
// in metadata + our own `refund_reason` column instead.
const STRIPE_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

// A Stripe field is sometimes a string id, sometimes an expanded object.
const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

// Find the charge/payment_intent behind a ledger row so it can be refunded.
async function resolveTarget(S, payment) {
  if (payment.stripe_session_id) {
    const s = await S.get(`checkout/sessions/${payment.stripe_session_id}`);
    const pi = idOf(s.payment_intent);
    if (pi) return { payment_intent: pi };
  }
  if (payment.stripe_invoice_id) {
    const inv = await S.get(`invoices/${payment.stripe_invoice_id}`);
    const pi = idOf(inv.payment_intent);
    if (pi) return { payment_intent: pi };
    const ch = idOf(inv.charge);
    if (ch) return { charge: ch };
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b.payment_id) return bad('payment_id is required.');

  const reason = String(b.reason || '').trim() || null;
  const S = stripe(env);
  const DB = sb(env);

  try {
    const payment = await DB.selectOne('payments', { id: b.payment_id });
    if (!payment) return bad('Payment not found.', 404);

    const paid = payment.amount_cents || 0;
    const already = payment.refunded_cents || 0;
    const remaining = paid - already;
    if (remaining <= 0) return bad('This payment is already fully refunded.', 409);

    // Default to refunding the whole remaining balance; validate a partial ask.
    let amount = remaining;
    if (b.amount_cents !== undefined && b.amount_cents !== null && b.amount_cents !== '') {
      amount = parseInt(b.amount_cents, 10);
      if (!Number.isFinite(amount) || amount < 1)
        return bad('Refund amount must be at least 1 cent.');
      if (amount > remaining)
        return bad(`Refund exceeds the refundable balance (${remaining} cents remaining).`);
    }

    const target = await resolveTarget(S, payment);
    if (!target)
      return bad('No Stripe charge is linked to this payment — refund it in the Dashboard.', 422);

    const refund = await S.call('refunds', {
      ...target,
      amount,
      ...(reason && STRIPE_REASONS.has(reason) ? { reason } : {}),
      metadata: {
        payment_id: payment.id,
        member_id: payment.member_id || '',
        issued_by: gate.member.email || gate.member.id,
        ...(reason ? { note: reason } : {}),
      },
    });

    const refunded_cents = already + amount;
    await DB.update(
      'payments',
      { id: payment.id },
      {
        refunded_cents,
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refund.id,
        refund_reason: reason,
      },
    );

    return json({
      ok: true,
      refund_id: refund.id,
      amount_cents: amount,
      refunded_cents,
      fully_refunded: refunded_cents >= paid,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
