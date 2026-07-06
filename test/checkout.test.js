import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/checkout.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route a request: Stripe -> a session; Supabase selectOne/insert -> canned rows.
function route(tier, discount) {
  return (url) => {
    if (url.includes('api.stripe.com/v1/coupons')) return { body: { id: 'co_1' } };
    if (url.includes('api.stripe.com')) return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
    if (url.includes('membership_tiers')) return { body: tier ? [tier] : [] };
    if (url.includes('discount_codes')) return { body: discount ? [discount] : [] };
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
    assert.equal(body.get('discounts[0][coupon]'), null, 'no coupon without a code');
  } finally {
    fetch.restore();
  }
});

// The webhook activates memberships by metadata.member_id — a session created
// without one would be paid yet never activate anyone.
test('checkout: membership without a member_id is refused', async () => {
  const fetch = mockFetch(route({ id: 'individual', name: 'Individual', price_cents: 10000 }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { tier_id: 'individual', email: 'm@x.com' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /log in or create an account/);
    assert.equal(
      fetch.calls.filter((c) => c.url.includes('api.stripe.com')).length,
      0,
      'no Stripe session created',
    );
  } finally {
    fetch.restore();
  }
});

test('checkout: a valid discount code mints a once-only coupon and tags the session', async () => {
  const fetch = mockFetch(
    route(
      { id: 'individual', name: 'Individual', price_cents: 10000 },
      { code: 'SPRING20', percent_off: 20, active: true, times_redeemed: 0 },
    ),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        body: {
          tier_id: 'individual',
          email: 'm@x.com',
          member_id: 'u1',
          discount_code: 'spring20',
        },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);

    const couponCall = fetch.calls.find((c) => c.url.includes('/v1/coupons'));
    const coupon = new URLSearchParams(couponCall.options.body);
    assert.equal(coupon.get('percent_off'), '20');
    assert.equal(coupon.get('duration'), 'once'); // first year only

    const sessionCall = fetch.calls.find((c) => c.url.includes('checkout/sessions'));
    const body = new URLSearchParams(sessionCall.options.body);
    assert.equal(body.get('discounts[0][coupon]'), 'co_1');
    assert.equal(body.get('metadata[discount_code]'), 'SPRING20');
  } finally {
    fetch.restore();
  }
});

test('checkout: an expired discount code aborts before any Stripe call', async () => {
  const fetch = mockFetch(
    route(
      { id: 'individual', name: 'Individual', price_cents: 10000 },
      { code: 'OLD', percent_off: 10, active: true, expires_at: '2020-01-01T00:00:00Z' },
    ),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        body: { tier_id: 'individual', member_id: 'u1', discount_code: 'OLD' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /expired/);
    assert.equal(fetch.calls.filter((c) => c.url.includes('api.stripe.com')).length, 0);
  } finally {
    fetch.restore();
  }
});
