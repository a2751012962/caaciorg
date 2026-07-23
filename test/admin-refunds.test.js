import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/refunds.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route the admin gate, the payments select/update, and the Stripe calls.
// `payment` is the ledger row returned for the selectOne by id.
function route(payment) {
  return (url, options = {}) => {
    const m = options.method;
    if (url.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (url.includes('/rest/v1/members') && url.includes('is_admin'))
      return { body: [{ id: 'admin-1', email: 'admin@x.com', is_admin: true }] };
    if (url.includes('/rest/v1/payments')) {
      if (m === 'PATCH') return { body: {} };
      return { body: payment ? [payment] : [] };
    }
    if (url.includes('api.stripe.com')) {
      if (url.includes('checkout/sessions'))
        return { body: { id: 'cs_1', payment_intent: 'pi_1' } };
      if (url.includes('/invoices/')) return { body: { id: 'in_1', payment_intent: 'pi_2' } };
      if (url.includes('/refunds')) return { body: { id: 're_1' } };
    }
    return { body: {} };
  };
}

const adminReq = (body) =>
  fakeRequest({
    url: 'https://caaci.example/api/admin/refunds',
    headers: { authorization: 'Bearer tok' },
    body,
  });

test('admin refunds: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { payment_id: 'p1' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: payment_id is required', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: adminReq({}), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /payment_id/);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: unknown payment -> 404', async () => {
  const fetch = mockFetch(route(null));
  try {
    const r = await onRequestPost({ request: adminReq({ payment_id: 'nope' }), env: fakeEnv() });
    assert.equal(r.status, 404);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: full refund of a session payment resolves the payment_intent', async () => {
  const fetch = mockFetch(
    route({
      id: 'p1',
      member_id: 'm1',
      amount_cents: 6210,
      refunded_cents: 0,
      stripe_session_id: 'cs_1',
    }),
  );
  try {
    const r = await onRequestPost({ request: adminReq({ payment_id: 'p1' }), env: fakeEnv() });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    assert.equal(data.amount_cents, 6210); // defaulted to the full balance
    assert.equal(data.refunded_cents, 6210);
    assert.equal(data.fully_refunded, true);

    // Refunded the resolved payment_intent for the full amount.
    const refundCall = fetch.calls.find(
      (c) => c.url.includes('api.stripe.com/v1/refunds') && c.options.method === 'POST',
    );
    const body = new URLSearchParams(refundCall.options.body);
    assert.equal(body.get('payment_intent'), 'pi_1');
    assert.equal(body.get('amount'), '6210');

    // Wrote the running total back to the ledger row.
    const patch = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/payments') && c.options.method === 'PATCH',
    );
    assert.equal(JSON.parse(patch.options.body).refunded_cents, 6210);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: partial refund accumulates onto prior refunds', async () => {
  const fetch = mockFetch(
    route({
      id: 'p1',
      member_id: 'm1',
      amount_cents: 6210,
      refunded_cents: 1000,
      stripe_invoice_id: 'in_1',
    }),
  );
  try {
    const r = await onRequestPost({
      request: adminReq({ payment_id: 'p1', amount_cents: 2000 }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.amount_cents, 2000);
    assert.equal(data.refunded_cents, 3000);
    assert.equal(data.fully_refunded, false);

    // Invoice payments resolve their payment_intent too.
    const refundCall = fetch.calls.find(
      (c) => c.url.includes('api.stripe.com/v1/refunds') && c.options.method === 'POST',
    );
    assert.equal(new URLSearchParams(refundCall.options.body).get('payment_intent'), 'pi_2');
  } finally {
    fetch.restore();
  }
});

test('admin refunds: refunding more than the balance -> 400', async () => {
  const fetch = mockFetch(
    route({ id: 'p1', amount_cents: 5000, refunded_cents: 4000, stripe_session_id: 'cs_1' }),
  );
  try {
    const r = await onRequestPost({
      request: adminReq({ payment_id: 'p1', amount_cents: 2000 }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /exceeds/);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: an already fully-refunded payment -> 409', async () => {
  const fetch = mockFetch(
    route({ id: 'p1', amount_cents: 5000, refunded_cents: 5000, stripe_session_id: 'cs_1' }),
  );
  try {
    const r = await onRequestPost({ request: adminReq({ payment_id: 'p1' }), env: fakeEnv() });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /already fully refunded/);
  } finally {
    fetch.restore();
  }
});

test('admin refunds: no Stripe reference on the row -> 422', async () => {
  const fetch = mockFetch(route({ id: 'p1', amount_cents: 5000, refunded_cents: 0 }));
  try {
    const r = await onRequestPost({ request: adminReq({ payment_id: 'p1' }), env: fakeEnv() });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /Dashboard/);
  } finally {
    fetch.restore();
  }
});
