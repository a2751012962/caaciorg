// charge.refunded: refunds made anywhere in Stripe (the admin Refunds tab or the
// Stripe Dashboard) reach the payments ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost } from '../functions/api/stripe-webhook.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const SECRET = 'whsec_test';
function sign(payload, secret = SECRET, t = 1700000000) {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

// `ledger` maps a `column=eq.value` fragment to the payments rows that select
// returns; `stripe` maps a Stripe path fragment to a response body.
function refundRoutes({ ledger = {}, stripe = {} }) {
  return (url, options = {}) => {
    if (url.includes('/rest/v1/payments')) {
      if (options.method === 'PATCH') return { body: [] };
      for (const [frag, rows] of Object.entries(ledger))
        if (url.includes(frag)) return { body: rows };
      return { body: [] };
    }
    if (url.includes('api.stripe.com')) {
      for (const [frag, body] of Object.entries(stripe)) if (url.includes(frag)) return { body };
      return { status: 404, body: { error: { message: `unmocked ${url}` } } };
    }
    return { body: [] };
  };
}

function deliverRefund(charge) {
  const payload = JSON.stringify({ type: 'charge.refunded', data: { object: charge } });
  return onRequestPost({
    request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
    env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
  });
}

const ledgerPatches = (fetch) =>
  fetch.calls.filter((c) => c.url.includes('/rest/v1/payments') && c.options.method === 'PATCH');

test('refund webhook: a Stripe Dashboard refund on a renewal updates that invoice’s ledger row', async () => {
  const fetch = mockFetch(
    refundRoutes({
      ledger: {
        'stripe_invoice_id=eq.in_renew': [{ id: 'p9', amount_cents: 3105, refunded_cents: 0 }],
      },
      stripe: {
        'refunds?charge=ch_9': {
          data: [
            { id: 're_9', created: 1700000000, reason: 'requested_by_customer', metadata: {} },
          ],
        },
      },
    }),
  );
  try {
    const r = await deliverRefund({ id: 'ch_9', invoice: 'in_renew', amount_refunded: 3105 });
    assert.equal(r.status, 200, await r.text());
    const [patch] = ledgerPatches(fetch);
    assert.match(patch.url, /id=eq\.p9/);
    assert.deepEqual(JSON.parse(patch.options.body), {
      refunded_cents: 3105,
      refunded_at: new Date(1700000000 * 1000).toISOString(),
      stripe_refund_id: 're_9',
      refund_reason: 'Stripe Dashboard (requested_by_customer)',
    });
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a first-year refund is matched through the session that created the subscription', async () => {
  const fetch = mockFetch(
    refundRoutes({
      ledger: {
        'stripe_session_id=eq.cs_first': [{ id: 'p1', amount_cents: 1035, refunded_cents: 0 }],
      },
      stripe: {
        'invoices/in_first': { id: 'in_first', subscription: 'sub_1' },
        'checkout/sessions?subscription=sub_1': {
          data: [
            { id: 'cs_other', invoice: 'in_somethingelse' },
            { id: 'cs_first', invoice: 'in_first' },
          ],
        },
        // Issued from the admin Refunds tab: tagged with payment_id, so its note is kept.
        'refunds?charge=ch_1': {
          data: [{ id: 're_1', created: 1700000100, metadata: { payment_id: 'p1' } }],
        },
      },
    }),
  );
  try {
    const r = await deliverRefund({ id: 'ch_1', invoice: 'in_first', amount_refunded: 500 });
    assert.equal(r.status, 200, await r.text());
    assert.ok(!fetch.calls.some((c) => c.url.includes('stripe_session_id=eq.cs_other')));
    const [patch] = ledgerPatches(fetch);
    assert.match(patch.url, /id=eq\.p1/);
    const body = JSON.parse(patch.options.body);
    assert.equal(body.refunded_cents, 500, 'a partial refund writes the running total');
    assert.equal(body.stripe_refund_id, 're_1');
    assert.equal('refund_reason' in body, false);
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a renewal invoice is never matched to the first-year session row', async () => {
  const fetch = mockFetch(
    refundRoutes({
      ledger: {
        'stripe_session_id=eq.cs_first': [{ id: 'p1', amount_cents: 1035, refunded_cents: 0 }],
      },
      stripe: {
        'invoices/in_year2': { id: 'in_year2', subscription: 'sub_1' },
        'checkout/sessions?subscription=sub_1': { data: [{ id: 'cs_first', invoice: 'in_first' }] },
      },
    }),
  );
  try {
    const r = await deliverRefund({ id: 'ch_y2', invoice: 'in_year2', amount_refunded: 1035 });
    assert.equal(r.status, 200);
    assert.equal(ledgerPatches(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a refund the Refunds tab already recorded writes nothing (retries are idempotent)', async () => {
  const fetch = mockFetch(
    refundRoutes({
      ledger: {
        'stripe_invoice_id=eq.in_2': [{ id: 'p2', amount_cents: 3105, refunded_cents: 3105 }],
      },
    }),
  );
  try {
    const r = await deliverRefund({ id: 'ch_2', invoice: 'in_2', amount_refunded: 3105 });
    assert.equal(r.status, 200);
    assert.equal(ledgerPatches(fetch).length, 0);
    assert.ok(!fetch.calls.some((c) => c.url.includes('/v1/refunds')));
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a charge the ledger never saw (e.g. a MemberPress renewal) is a quiet no-op', async () => {
  const fetch = mockFetch(
    refundRoutes({
      stripe: {
        'invoices/in_mp': { id: 'in_mp', subscription: 'sub_mp' },
        'checkout/sessions?subscription=sub_mp': { data: [] },
      },
    }),
  );
  try {
    const r = await deliverRefund({ id: 'ch_mp', invoice: 'in_mp', amount_refunded: 6000 });
    assert.equal(r.status, 200);
    assert.equal(ledgerPatches(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a payment-mode charge is matched by its payment_intent session', async () => {
  const fetch = mockFetch(
    refundRoutes({
      ledger: {
        'stripe_session_id=eq.cs_pay': [{ id: 'p3', amount_cents: 2000, refunded_cents: 0 }],
      },
      stripe: {
        'checkout/sessions?payment_intent=pi_pay': { data: [{ id: 'cs_pay' }] },
        'refunds?charge=ch_pay': { data: [] },
      },
    }),
  );
  try {
    const r = await deliverRefund({
      id: 'ch_pay',
      invoice: null,
      payment_intent: 'pi_pay',
      amount_refunded: 2000,
    });
    assert.equal(r.status, 200, await r.text());
    const [patch] = ledgerPatches(fetch);
    assert.match(patch.url, /id=eq\.p3/);
    assert.equal(JSON.parse(patch.options.body).refunded_cents, 2000);
  } finally {
    fetch.restore();
  }
});

test('refund webhook: a Stripe lookup failure answers 500 so Stripe retries', async () => {
  const fetch = mockFetch(refundRoutes({}));
  try {
    const r = await deliverRefund({ id: 'ch_x', invoice: 'in_unknown', amount_refunded: 100 });
    assert.equal(r.status, 500);
    assert.equal(ledgerPatches(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});
