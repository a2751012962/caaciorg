import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/checkout.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route a request: Stripe -> a session; Supabase selectOne/insert -> canned rows.
function route(tier) {
  return (url) => {
    if (url.includes('api.stripe.com')) return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
    if (url.includes('membership_tiers')) return { body: tier ? [tier] : [] };
    return { body: [] }; // donations insert
  };
}

test('checkout: invalid JSON -> 400', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: 'not json' }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'invalid JSON' });
  } finally {
    fetch.restore();
  }
});

test('checkout: donation below $1 is rejected', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { type: 'donation', amount_cents: 50 } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Minimum donation/);
  } finally {
    fetch.restore();
  }
});

test('checkout: valid donation creates a session and inserts into donations', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        body: { type: 'donation', amount_cents: 2500, name: 'Pat', email: 'p@x.com' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { url: 'https://pay/cs_1' });

    const stripeCall = fetch.calls.find((c) => c.url.includes('api.stripe.com'));
    assert.equal(
      new URLSearchParams(stripeCall.options.body).get('line_items[0][price_data][unit_amount]'),
      '2500',
    );

    const insert = fetch.calls.find((c) => c.url.includes('/rest/v1/donations'));
    const row = JSON.parse(insert.options.body);
    assert.equal(row.amount_cents, 2500);
    assert.equal(row.stripe_session_id, 'cs_1');
  } finally {
    fetch.restore();
  }
});

test('checkout: unknown membership tier -> 400', async () => {
  const fetch = mockFetch(route(null));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { tier_id: 'ghost' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Unknown membership tier/);
  } finally {
    fetch.restore();
  }
});

test('checkout: membership applies the 3.5% card surcharge to unit_amount', async () => {
  const fetch = mockFetch(route({ id: 'individual', name: 'Individual', price_cents: 10000 }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { tier_id: 'individual', email: 'm@x.com', member_id: 'u1' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const stripeCall = fetch.calls.find((c) => c.url.includes('api.stripe.com'));
    const body = new URLSearchParams(stripeCall.options.body);
    // round(10000 * 1.035) = 10350
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '10350');
    assert.equal(body.get('mode'), 'subscription');
    assert.equal(body.get('metadata[member_id]'), 'u1');
  } finally {
    fetch.restore();
  }
});
