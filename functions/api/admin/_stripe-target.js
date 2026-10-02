// Find the Stripe charge behind something CAACI was paid for, so it can be
// refunded without anyone handling raw charge ids. Shared by the membership
// refunds (admin/refunds.js) and the token refunds (admin/tokens.js, 0039).

// A Stripe field is sometimes a string id, sometimes an expanded object.
export const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || null;

// The payment_intent/charge that paid an invoice.
export async function fromInvoice(S, invoiceId) {
  const inv = await S.get(`invoices/${invoiceId}`);
  const pi = idOf(inv.payment_intent);
  if (pi) return { payment_intent: pi };
  const ch = idOf(inv.charge);
  return ch ? { charge: ch } : null;
}

// The target for a refund, from whichever reference was stored. A Checkout
// Session in payment mode (a token pack, a first-year membership) carries its
// payment_intent; a subscription-mode session was paid through the invoice it
// created, so that invoice is resolved instead. Returns
// { payment_intent } | { charge } | null.
export async function resolveTarget(S, { stripe_session_id, stripe_invoice_id } = {}) {
  if (stripe_session_id) {
    const s = await S.get(`checkout/sessions/${stripe_session_id}`);
    const pi = idOf(s.payment_intent);
    if (pi) return { payment_intent: pi };
    const inv = idOf(s.invoice);
    if (inv) {
      const target = await fromInvoice(S, inv);
      if (target) return target;
    }
  }
  if (stripe_invoice_id) return fromInvoice(S, stripe_invoice_id);
  return null;
}
