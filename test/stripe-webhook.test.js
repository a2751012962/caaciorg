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

// --- invoice.paid renewals ---------------------------------------------------

// POST a signed event to the webhook.
function postEvent(event) {
  const payload = JSON.stringify(event);
  return onRequestPost({
    request: fakeRequest({ body: payload, headers: { 'stripe-signature': sign(payload) } }),
    env: fakeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
  });
}

// Supabase stand-in: a members lookup by stripe_subscription_id or
// stripe_customer_id returns `member` when the key matches (else no rows);
// every write (PATCH members, POST payments) succeeds.
function renewalFetch(member) {
  return mockFetch((url, options) => {
    if (url.includes('/rest/v1/members?') && !options.method) {
      const q = new URL(url).searchParams;
      const hit =
        (member.stripe_subscription_id &&
          q.get('stripe_subscription_id') === `eq.${member.stripe_subscription_id}`) ||
        (member.stripe_customer_id &&
          q.get('stripe_customer_id') === `eq.${member.stripe_customer_id}`);
      return { body: hit ? [member] : [] };
    }
    return { body: '' };
  });
}

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

// A yearly renewal invoice the way Stripe sends it for a subscription that
// MemberPress created: legacy top-level `subscription`, no metadata of ours,
// a MemberPress plan price, and the billed period on the line item.
function memberpressInvoice({ periodStart, periodEnd, sub = 'sub_legacy' }) {
  return {
    id: 'in_mp_1',
    object: 'invoice',
    billing_reason: 'subscription_cycle',
    customer: 'cus_mp',
    subscription: sub,
    amount_paid: 5000,
    currency: 'usd',
    metadata: {},
    lines: {
      data: [
        {
          id: 'il_mp_1',
          object: 'line_item',
          type: 'subscription',
          subscription: sub,
          price: { id: 'plan_R3aheKqNoUbjU0', recurring: { interval: 'year' } },
          plan: { id: 'plan_R3aheKqNoUbjU0', interval: 'year' },
          metadata: {},
          period: { start: periodStart, end: periodEnd },
        },
      ],
    },
  };
}

function memberPatch(fetch) {
  const upd = fetch.calls.find(
    (c) => c.url.includes('/rest/v1/members?') && c.options.method === 'PATCH',
  );
  assert.ok(upd, 'patched the member');
  return { url: upd.url, patch: JSON.parse(upd.options.body) };
}

test('webhook: MemberPress legacy renewal sets expiry to the invoice period end', async () => {
  // Imported member: expires_at = the subscription's old current_period_end,
  // which has just passed when the cycle invoice is finalized and paid.
  const periodStart = nowSec() - 2 * 3600;
  const periodEnd = periodStart + 365 * DAY;
  const member = {
    id: 'mp1',
    tier_id: 'individual',
    status: 'active',
    stripe_customer_id: 'cus_mp',
    stripe_subscription_id: 'sub_legacy',
    expires_at: new Date(periodStart * 1000).toISOString(),
  };
  const fetch = renewalFetch(member);
  try {
    const r = await postEvent({
      type: 'invoice.paid',
      data: { object: memberpressInvoice({ periodStart, periodEnd }) },
    });
    assert.equal(r.status, 200);
    assert.match(fetch.calls[0].url, /stripe_subscription_id=eq\.sub_legacy/);
    const { url, patch } = memberPatch(fetch);
    assert.match(url, /id=eq\.mp1/);
    assert.equal(patch.expires_at, new Date(periodEnd * 1000).toISOString());
    assert.equal(patch.status, 'active');
    assert.equal(patch.stripe_subscription_id, 'sub_legacy');
    const pay = fetch.calls.find((c) => c.url.includes('/rest/v1/payments'));
    assert.ok(pay, 'recorded a payment row');
    assert.deepEqual(JSON.parse(pay.options.body), {
      member_id: 'mp1',
      kind: 'renewal',
      amount_cents: 5000,
      currency: 'usd',
      tier_id: 'individual',
      stripe_invoice_id: 'in_mp_1',
    });
  } finally {
    fetch.restore();
  }
});

test('webhook: renewal in the newer invoice shape (parent.subscription_details) uses the latest line period end', async () => {
  const periodStart = nowSec() - 2 * 3600;
  const periodEnd = periodStart + 365 * DAY;
  const member = {
    id: 'mp1',
    stripe_customer_id: 'cus_mp',
    stripe_subscription_id: 'sub_legacy',
    expires_at: new Date(periodStart * 1000).toISOString(),
  };
  const inv = memberpressInvoice({ periodStart, periodEnd });
  delete inv.subscription;
  inv.parent = {
    type: 'subscription_details',
    subscription_details: { subscription: 'sub_legacy', metadata: {} },
  };
  inv.lines.data = [
    // An earlier-ending line and a line without a period must not win.
    { id: 'il_early', period: { start: periodStart, end: periodEnd - 30 * DAY } },
    { id: 'il_noperiod' },
    {
      id: 'il_mp_1',
      object: 'line_item',
      parent: {
        type: 'subscription_item_details',
        subscription_item_details: { subscription: 'sub_legacy', subscription_item: 'si_1' },
      },
      pricing: { price_details: { price: 'plan_R3aheKqNoUbjU0' } },
      metadata: {},
      period: { start: periodStart, end: periodEnd },
    },
  ];
  const fetch = renewalFetch(member);
  try {
    const r = await postEvent({ type: 'invoice.paid', data: { object: inv } });
    assert.equal(r.status, 200);
    assert.match(fetch.calls[0].url, /stripe_subscription_id=eq\.sub_legacy/);
    const { patch } = memberPatch(fetch);
    assert.equal(patch.expires_at, new Date(periodEnd * 1000).toISOString());
    assert.equal(patch.status, 'active');
  } finally {
    fetch.restore();
  }
});

test('webhook: a renewal paid days late still expires at the period end, not paid-time + 1 year', async () => {
  // Payment retried 9 days after the period rolled over.
  const periodStart = nowSec() - 9 * DAY;
  const periodEnd = periodStart + 365 * DAY;
  const member = {
    id: 'mp1',
    status: 'past_due',
    stripe_customer_id: 'cus_mp',
    stripe_subscription_id: 'sub_legacy',
    expires_at: new Date(periodStart * 1000).toISOString(),
  };
  const fetch = renewalFetch(member);
  try {
    const r = await postEvent({
      type: 'invoice.paid',
      data: { object: memberpressInvoice({ periodStart, periodEnd }) },
    });
    assert.equal(r.status, 200);
    const { patch } = memberPatch(fetch);
    assert.equal(patch.expires_at, new Date(periodEnd * 1000).toISOString());
    assert.equal(patch.status, 'active');
  } finally {
    fetch.restore();
  }
});

test('webhook: renewal matches the member by customer id when no member has the subscription id', async () => {
  const periodStart = nowSec() - 2 * 3600;
  const periodEnd = periodStart + 365 * DAY;
  const member = {
    id: 'mp2',
    stripe_customer_id: 'cus_mp',
    stripe_subscription_id: null,
    expires_at: new Date(periodStart * 1000).toISOString(),
  };
  const fetch = renewalFetch(member);
  try {
    const r = await postEvent({
      type: 'invoice.paid',
      data: { object: memberpressInvoice({ periodStart, periodEnd }) },
    });
    assert.equal(r.status, 200);
    assert.match(fetch.calls[0].url, /stripe_subscription_id=eq\.sub_legacy/);
    assert.match(fetch.calls[1].url, /stripe_customer_id=eq\.cus_mp/);
    const { url, patch } = memberPatch(fetch);
    assert.match(url, /id=eq\.mp2/);
    assert.equal(patch.expires_at, new Date(periodEnd * 1000).toISOString());
    assert.equal(patch.stripe_subscription_id, 'sub_legacy');
  } finally {
    fetch.restore();
  }
});

test('webhook: renewal without a line period falls back to extending the current expiry by a year', async () => {
  const current = new Date(Date.now() + 30 * DAY * 1000);
  const member = {
    id: 'mp1',
    stripe_customer_id: 'cus_mp',
    stripe_subscription_id: 'sub_legacy',
    expires_at: current.toISOString(),
  };
  const inv = memberpressInvoice({ periodStart: 0, periodEnd: 0 });
  delete inv.lines.data[0].period;
  const fetch = renewalFetch(member);
  try {
    const r = await postEvent({ type: 'invoice.paid', data: { object: inv } });
    assert.equal(r.status, 200);
    const { patch } = memberPatch(fetch);
    const expected = new Date(current);
    expected.setFullYear(expected.getFullYear() + 1);
    assert.equal(patch.expires_at, expected.toISOString());
    assert.equal(patch.status, 'active');
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
