import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTier, lookupKey, chargeCents } from '../stripe-catalog.mjs';
import { tierPrice, tierLookupKey, stripe } from '../functions/api/_lib.js';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestPost as changePlan } from '../functions/api/change-plan.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const tier = { id: 'individual', name: 'Individual Membership', price_cents: 3000 };

test('catalog and runtime agree on the lookup_key and the fee-inclusive charge', () => {
  assert.equal(lookupKey('family'), tierLookupKey('family'));
  assert.equal(chargeCents(3000), 3105);
});

test('planTier: create when missing, ok when matching, reprice on drift', () => {
  assert.equal(planTier(tier, null).action, 'create');
  const price = { unit_amount: 3105, currency: 'usd', recurring: { interval: 'year' } };
  assert.equal(planTier(tier, price).action, 'ok');
  assert.deepEqual(planTier(tier, { ...price, unit_amount: 3000 }), {
    action: 'reprice',
    want: 3105,
    from: 3000,
  });
  assert.equal(planTier(tier, { ...price, recurring: { interval: 'month' } }).action, 'reprice');
});

test('tierPrice: resolves the catalogue Price by lookup_key', async () => {
  const fetch = mockFetch((url) =>
    url.includes('lookup_keys') ? { body: { data: [{ id: 'price_cat' }] } } : {},
  );
  try {
    assert.deepEqual(await tierPrice(stripe(fakeEnv()), tier), { price: 'price_cat' });
    assert.match(fetch.calls[0].url, /lookup_keys\[\]=caaci_individual_year/);
  } finally {
    fetch.restore();
  }
});

test('tierPrice: falls back to inline price_data when the catalogue is empty', async () => {
  const fetch = mockFetch(() => ({ body: { data: [] } }));
  try {
    const r = await tierPrice(stripe(fakeEnv()), tier);
    assert.equal(r.price, undefined);
    assert.equal(r.price_data.unit_amount, 3105);
    assert.equal(r.price_data.product_data.name, 'Individual Membership');
  } finally {
    fetch.restore();
  }
});

test('tierPrice: a failing lookup does not break checkout', async () => {
  const fetch = mockFetch((url) => (url.includes('lookup_keys') ? { status: 500 } : {}));
  try {
    assert.ok((await tierPrice(stripe(fakeEnv()), tier)).price_data);
  } finally {
    fetch.restore();
  }
});

test('checkout: membership session uses the catalogue Price when present', async () => {
  const fetch = mockFetch((url) => {
    if (url.includes('lookup_keys')) return { body: { data: [{ id: 'price_cat' }] } };
    if (url.includes('checkout/sessions')) return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
    if (url.includes('membership_tiers')) return { body: [tier] };
    return { body: [] };
  });
  try {
    const r = await checkout({
      request: fakeRequest({ body: { tier_id: 'individual', member_id: 'u1' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const session = fetch.calls.find((c) => c.url.includes('checkout/sessions'));
    const params = new URLSearchParams(session.options.body);
    assert.equal(params.get('line_items[0][price]'), 'price_cat');
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), null);
  } finally {
    fetch.restore();
  }
});

test('change-plan: swaps the subscription item onto the catalogue Price without minting one', async () => {
  const fetch = mockFetch((url, options = {}) => {
    if (url.includes('lookup_keys')) return { body: { data: [{ id: 'price_cat' }] } };
    if (url.includes('/rest/v1/membership_tiers')) return { body: [tier] };
    if (url.includes('/rest/v1/members'))
      return options.method === 'PATCH'
        ? { body: [] }
        : { body: [{ id: 'u1', tier_id: 'student', stripe_subscription_id: 'sub_1' }] };
    if (url.includes('/subscriptions/sub_1') && !options.method)
      return { body: { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } } };
    if (url.includes('/subscriptions/sub_1')) return { body: { id: 'sub_1' } };
    return {};
  });
  try {
    const r = await changePlan({
      request: fakeRequest({ body: { member_id: 'u1', tier_id: 'individual' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(
      fetch.calls.find((c) => c.url.endsWith('/v1/prices') && c.options.method === 'POST'),
      undefined,
    );
    const swap = fetch.calls.find(
      (c) => c.url.includes('/subscriptions/sub_1') && c.options.method === 'POST',
    );
    assert.equal(new URLSearchParams(swap.options.body).get('items[0][price]'), 'price_cat');
  } finally {
    fetch.restore();
  }
});
