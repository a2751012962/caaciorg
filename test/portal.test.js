import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/portal.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route: Supabase auth validates the token; members lookup returns `member`;
// Stripe billing-portal returns a session URL.
function route(member) {
  return (url) => {
    if (url.includes('/auth/v1/user')) return { body: { id: 'u1' } };
    if (url.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    if (url.includes('billing_portal/sessions'))
      return { body: { id: 'bps_1', url: 'https://billing.stripe/bps_1' } };
    return {};
  };
}

test('portal: rejects a caller without a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: {} }), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('portal: member without a Stripe customer gets a 404', async () => {
  const fetch = mockFetch(route({ id: 'u1', stripe_customer_id: null }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: {}, headers: { authorization: 'Bearer tok' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /No billing profile/);
  } finally {
    fetch.restore();
  }
});

test('portal: returns a billing-portal URL for the signed-in member', async () => {
  const fetch = mockFetch(route({ id: 'u1', stripe_customer_id: 'cus_9' }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        url: 'https://caaci.example/api/portal',
        body: {},
        headers: { authorization: 'Bearer tok' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { url: 'https://billing.stripe/bps_1' });

    const call = fetch.calls.find((c) => c.url.includes('billing_portal/sessions'));
    const body = new URLSearchParams(call.options.body);
    assert.equal(body.get('customer'), 'cus_9');
    assert.equal(body.get('return_url'), 'https://caaci.example/account/');
  } finally {
    fetch.restore();
  }
});
