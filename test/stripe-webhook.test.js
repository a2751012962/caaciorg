import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost, verify } from '../functions/api/stripe-webhook.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const SECRET = 'whsec_test';
// Build a Stripe-style signature header the way verify() expects: t=<ts>,v1=<hex>.
function sign(payload, secret = SECRET, t = 1700000000) {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

test('verify: accepts a correct signature and rejects tampering', async () => {
  const payload = JSON.stringify({ hello: 'world' });
  assert.equal(await verify(payload, sign(payload), SECRET), true);
  assert.equal(await verify(payload, sign(payload, 'wrong-secret'), SECRET), false);
  assert.equal(await verify(payload + 'x', sign(payload), SECRET), false);
});

test('verify: rejects a malformed header (missing t/v1)', async () => {
  assert.equal(await verify('{}', 'garbage', SECRET), false);
  assert.equal(await verify('{}', 't=1', SECRET), false);
});

test('webhook: bad signature -> 400 when a secret is configured', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: { 'stripe-signature': 't=1,v1=deadbeef' } }),
      env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
    });
    assert.equal(r.status, 400);
    assert.equal(fetch.calls.length, 0, 'no DB write on a bad signature');
  } finally {
    fetch.restore();
  }
});

test('webhook: donation completed marks the donation paid', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_42', metadata: { kind: 'donation' } } },
    });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
      env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
    });
    assert.equal(r.status, 200);
    const upd = fetch.calls.find((c) => c.url.includes('/rest/v1/donations'));
    assert.match(upd.url, /stripe_session_id=eq\.cs_42/);
    assert.deepEqual(JSON.parse(upd.options.body), { status: 'paid' });
  } finally {
    fetch.restore();
  }
});

test('webhook: membership completed activates the member with a 1-year expiry', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_99',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { kind: 'membership', member_id: 'u1', tier_id: 'individual' },
        },
      },
    });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
      env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
    });
    assert.equal(r.status, 200);
    const upd = fetch.calls.find((c) => c.url.includes('/rest/v1/members'));
    assert.match(upd.url, /id=eq\.u1/);
    const patch = JSON.parse(upd.options.body);
    assert.equal(patch.status, 'active');
    assert.equal(patch.tier_id, 'individual');
    assert.equal(patch.stripe_customer_id, 'cus_1');
    const years =
      new Date(patch.expires_at).getFullYear() - new Date(patch.member_since).getFullYear();
    assert.equal(years, 1);
  } finally {
    fetch.restore();
  }
});

test('webhook: membership completed with a discount bumps the redemption count', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_disc',
          metadata: {
            kind: 'membership',
            member_id: 'u1',
            tier_id: 'individual',
            discount_code: 'SPRING20',
          },
        },
      },
    });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
      env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
    });
    assert.equal(r.status, 200);
    const rpc = fetch.calls.find((c) => c.url.includes('/rpc/redeem_discount_code'));
    assert.ok(rpc, 'called the atomic redemption RPC');
    assert.deepEqual(JSON.parse(rpc.options.body), { p_code: 'SPRING20' });
  } finally {
    fetch.restore();
  }
});

test('webhook: a failing redemption count never fails the webhook', async () => {
  const fetch = mockFetch((url) =>
    url.includes('/rpc/redeem_discount_code')
      ? { status: 404, body: 'no such function' }
      : { body: '' },
  );
  try {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_disc2',
          metadata: { kind: 'membership', member_id: 'u1', discount_code: 'X' },
        },
      },
    });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
      env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
    });
    assert.equal(r.status, 200, 'membership already active — no Stripe retry loop');
  } finally {
    fetch.restore();
  }
});

test('webhook: skips verification when no secret is set', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const payload = JSON.stringify({ type: 'ping' });
    const r = await onRequestPost({
      request: fakeRequest({ body: payload, headers: {} }),
      env: fakeEnv(), // no STRIPE_WEBHOOK_SECRET
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
  } finally {
    fetch.restore();
  }
});
