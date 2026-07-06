import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, discountProblem, normalizeCode } from '../functions/api/discount.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const CODE = {
  code: 'SPRING20',
  percent_off: 20,
  active: true,
  expires_at: null,
  max_redemptions: null,
  times_redeemed: 0,
};

const route = (row) => (url) => (url.includes('discount_codes') ? { body: row ? [row] : [] } : {});

test('discount: normalizeCode trims and uppercases', () => {
  assert.equal(normalizeCode('  spring20 '), 'SPRING20');
  assert.equal(normalizeCode(null), '');
});

test('discountProblem covers inactive / expired / exhausted / usable', () => {
  assert.equal(discountProblem(null), 'Invalid discount code.');
  assert.equal(discountProblem({ ...CODE, active: false }), 'Invalid discount code.');
  assert.match(discountProblem({ ...CODE, expires_at: '2020-01-01T00:00:00Z' }), /expired/);
  assert.match(discountProblem({ ...CODE, max_redemptions: 5, times_redeemed: 5 }), /redeemed/);
  assert.equal(discountProblem(CODE), null);
  // a future expiry and remaining uses are fine
  assert.equal(
    discountProblem({ ...CODE, expires_at: '2999-01-01T00:00:00Z', max_redemptions: 5 }),
    null,
  );
});

test('discount: a valid code returns code + percent_off (case-insensitive)', async () => {
  const fetch = mockFetch(route(CODE));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { code: 'spring20' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { code: 'SPRING20', percent_off: 20 });
    // the lookup queried the normalized code
    const q = fetch.calls.find((c) => c.url.includes('discount_codes'));
    assert.match(q.url, /code=eq\.SPRING20/);
  } finally {
    fetch.restore();
  }
});

test('discount: unknown or empty codes are rejected', async () => {
  const fetch = mockFetch(route(null));
  try {
    let r = await onRequestPost({
      request: fakeRequest({ body: { code: 'NOPE' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Invalid discount code/);

    r = await onRequestPost({ request: fakeRequest({ body: {} }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Enter a discount code/);
  } finally {
    fetch.restore();
  }
});
