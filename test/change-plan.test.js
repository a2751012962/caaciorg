import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/change-plan.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route Supabase selects/updates and the Stripe calls the endpoint makes.
// Stripe subscription retrieve (GET, no method) vs update (POST) share a URL,
// so they're told apart by options.method.
function route({ tier, member } = {}) {
  return (url, options = {}) => {
    const m = options.method;
    if (url.includes('/rest/v1/membership_tiers')) return { body: tier ? [tier] : [] };
    if (url.includes('/rest/v1/members')) {
      if (m === 'PATCH') return { body: {} };
      return { body: member ? [member] : [] };
    }
    if (url.includes('api.stripe.com')) {
      if (url.includes('checkout/sessions'))
        return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
      if (url.includes('/prices')) return { body: { id: 'price_new' } };
      if (url.includes('/subscriptions/') && (!m || m === 'GET'))
        return { body: { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } } };
      if (url.includes('/subscriptions/')) return { body: { id: 'sub_1' } };
    }
    return { body: {} };
  };
}

test('change-plan: missing member_id/tier_id -> 400', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { tier_id: 'individual' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /required/);
  } finally {
    fetch.restore();
  }
});

test('change-plan: switching to the plan you already have -> 400', async () => {
  const fetch = mockFetch(
    route({ tier: { id: 'family', price_cents: 6000 }, member: { id: 'u1', tier_id: 'family' } }),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { member_id: 'u1', tier_id: 'family' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /already on this plan/);
  } finally {
    fetch.restore();
  }
});

test('change-plan: a member with no live subscription falls back to a Checkout Session', async () => {
  const fetch = mockFetch(
    route({
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      member: { id: 'u1', tier_id: 'family', email: 'm@x.com' }, // no stripe_subscription_id
    }),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { member_id: 'u1', tier_id: 'individual' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { url: 'https://pay/cs_1' });
    assert.ok(fetch.calls.find((c) => c.url.includes('checkout/sessions')));
  } finally {
    fetch.restore();
  }
});

test('change-plan: an active subscription is swapped in place with proration', async () => {
  const fetch = mockFetch(
    route({
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      member: { id: 'u1', tier_id: 'family', stripe_subscription_id: 'sub_1' },
    }),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { member_id: 'u1', tier_id: 'individual' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, tier_id: 'individual' });

    // Minted a new Price with the surcharged amount: round(3000 * 1.035) = 3105.
    const priceCall = fetch.calls.find(
      (c) => c.url.includes('api.stripe.com/v1/prices') && c.options.method === 'POST',
    );
    assert.equal(new URLSearchParams(priceCall.options.body).get('unit_amount'), '3105');

    // Moved the existing item onto it, with proration.
    const updateCall = fetch.calls.find(
      (c) => c.url.includes('/subscriptions/sub_1') && c.options.method === 'POST',
    );
    const body = new URLSearchParams(updateCall.options.body);
    assert.equal(body.get('items[0][id]'), 'si_1');
    assert.equal(body.get('items[0][price]'), 'price_new');
    assert.equal(body.get('proration_behavior'), 'create_prorations');

    // Reflected the change on the members row.
    const patch = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/members') && c.options.method === 'PATCH',
    );
    assert.equal(JSON.parse(patch.options.body).tier_id, 'individual');
  } finally {
    fetch.restore();
  }
});
