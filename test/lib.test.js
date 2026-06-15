import { test } from 'node:test';
import assert from 'node:assert/strict';
import { json, bad, sb, stripe, sendEmail } from '../functions/api/_lib.js';
import { mockFetch, fakeEnv } from './helpers.js';

test('json() sets status, content-type and serializes the body', async () => {
  const r = json({ hello: 'world' }, 201, { 'x-extra': '1' });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('x-extra'), '1');
  assert.deepEqual(await r.json(), { hello: 'world' });
});

test('bad() returns an { error } body with the given status (default 400)', async () => {
  const r = bad('nope');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'nope' });
  assert.equal(bad('boom', 500).status, 500);
});

test('stripe().call flattens nested objects and arrays into bracket keys', async () => {
  const fetch = mockFetch(() => ({ body: { id: 'cs_1', url: 'https://pay' } }));
  try {
    const data = await stripe(fakeEnv()).call('checkout/sessions', {
      mode: 'payment',
      metadata: { kind: 'donation' },
      line_items: [{ quantity: 1, price_data: { unit_amount: 5000 } }],
    });
    assert.deepEqual(data, { id: 'cs_1', url: 'https://pay' });

    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.headers.authorization, 'Bearer sk_test_123');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('mode'), 'payment');
    assert.equal(body.get('metadata[kind]'), 'donation');
    assert.equal(body.get('line_items[0][quantity]'), '1');
    assert.equal(body.get('line_items[0][price_data][unit_amount]'), '5000');
  } finally { fetch.restore(); }
});

test('stripe().call throws with the API error message on a non-ok response', async () => {
  const fetch = mockFetch(() => ({ ok: false, status: 402, body: { error: { message: 'card declined' } } }));
  try {
    await assert.rejects(
      stripe(fakeEnv()).call('charges', {}),
      /stripe charges: card declined/,
    );
  } finally { fetch.restore(); }
});

test('sb().insert sends the service-role headers and return preference', async () => {
  const fetch = mockFetch(() => ({ body: [{ id: 1 }] }));
  try {
    const rows = await sb(fakeEnv()).insert('donations', { amount_cents: 500 });
    assert.deepEqual(rows, [{ id: 1 }]);
    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://db.example/rest/v1/donations');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.apikey, 'service-key');
    assert.equal(options.headers.prefer, 'return=representation');
  } finally { fetch.restore(); }
});

test('sb().insert with returning:false uses return=minimal and resolves null', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const out = await sb(fakeEnv()).insert('rsvps', { event_id: 'e1' }, { returning: false });
    assert.equal(out, null);
    assert.equal(fetch.calls[0].options.headers.prefer, 'return=minimal');
  } finally { fetch.restore(); }
});

test('sb().insert throws on a non-ok response', async () => {
  const fetch = mockFetch(() => ({ ok: false, status: 409, body: 'conflict' }));
  try {
    await assert.rejects(sb(fakeEnv()).insert('rsvps', {}), /supabase insert rsvps: 409 conflict/);
  } finally { fetch.restore(); }
});

test('sb().update builds an eq filter with URL-encoded values', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    await sb(fakeEnv()).update('members', { id: 'a b&c' }, { status: 'active' });
    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://db.example/rest/v1/members?id=eq.a%20b%26c');
    assert.equal(options.method, 'PATCH');
  } finally { fetch.restore(); }
});

test('sb().selectOne returns the first row, or null when empty', async () => {
  let fetch = mockFetch(() => ({ body: [{ id: 't1', name: 'Student' }] }));
  try {
    const row = await sb(fakeEnv()).selectOne('membership_tiers', { id: 't1' });
    assert.deepEqual(row, { id: 't1', name: 'Student' });
    assert.match(fetch.calls[0].url, /select=\*&id=eq\.t1&limit=1$/);
  } finally { fetch.restore(); }

  fetch = mockFetch(() => ({ body: [] }));
  try {
    assert.equal(await sb(fakeEnv()).selectOne('membership_tiers', { id: 'none' }), null);
  } finally { fetch.restore(); }
});

test('sendEmail is a no-op (no fetch) when Resend env is unconfigured', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    await sendEmail(fakeEnv(), { subject: 's', html: 'h' });
    assert.equal(fetch.calls.length, 0);
  } finally { fetch.restore(); }
});

test('sendEmail posts to Resend with reply_to when configured', async () => {
  const fetch = mockFetch(() => ({ body: { id: 'email_1' } }));
  try {
    await sendEmail(
      fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com', NOTIFY_TO: 'b@x.com' }),
      { subject: 'Hi', html: '<p>hi</p>', replyTo: 'c@x.com' },
    );
    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers.authorization, 'Bearer re_1');
    const sent = JSON.parse(options.body);
    assert.equal(sent.subject, 'Hi');
    assert.equal(sent.reply_to, 'c@x.com');
    assert.equal(sent.from, 'a@x.com');
  } finally { fetch.restore(); }
});
