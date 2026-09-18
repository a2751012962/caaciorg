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
  } finally {
    fetch.restore();
  }
});

test('stripe().call throws with the API error message on a non-ok response', async () => {
  const fetch = mockFetch(() => ({
    ok: false,
    status: 402,
    body: { error: { message: 'card declined' } },
  }));
  try {
    await assert.rejects(stripe(fakeEnv()).call('charges', {}), /stripe charges: card declined/);
  } finally {
    fetch.restore();
  }
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
  } finally {
    fetch.restore();
  }
});

test('sb().insert with returning:false uses return=minimal and resolves null', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const out = await sb(fakeEnv()).insert('rsvps', { event_id: 'e1' }, { returning: false });
    assert.equal(out, null);
    assert.equal(fetch.calls[0].options.headers.prefer, 'return=minimal');
  } finally {
    fetch.restore();
  }
});

test('sb().insert throws on a non-ok response', async () => {
  const fetch = mockFetch(() => ({ ok: false, status: 409, body: 'conflict' }));
  try {
    await assert.rejects(sb(fakeEnv()).insert('rsvps', {}), /supabase insert rsvps: 409 conflict/);
  } finally {
    fetch.restore();
  }
});

test('sb().upsert posts on_conflict with the merge-duplicates preference and returns rows', async () => {
  const fetch = mockFetch(() => ({ body: [{ id: 'r1', created_at: '2026-09-01T00:00:00Z' }] }));
  try {
    const rows = await sb(fakeEnv()).upsert(
      'event_registrations',
      { event_id: 'e1', email: 'a@x.com' },
      { onConflict: 'event_id,email' },
    );
    assert.deepEqual(rows, [{ id: 'r1', created_at: '2026-09-01T00:00:00Z' }]);
    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://db.example/rest/v1/event_registrations?on_conflict=event_id,email');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.apikey, 'service-key');
    assert.equal(options.headers.prefer, 'resolution=merge-duplicates,return=representation');
    assert.deepEqual(JSON.parse(options.body), { event_id: 'e1', email: 'a@x.com' });
  } finally {
    fetch.restore();
  }
});

test('sb().upsert throws on a non-ok response', async () => {
  const fetch = mockFetch(() => ({ ok: false, status: 400, body: 'no unique constraint' }));
  try {
    await assert.rejects(
      sb(fakeEnv()).upsert('event_registrations', {}, { onConflict: 'event_id,email' }),
      /supabase upsert event_registrations: 400 no unique constraint/,
    );
  } finally {
    fetch.restore();
  }
});

test('sb().update builds an eq filter with URL-encoded values', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    await sb(fakeEnv()).update('members', { id: 'a b&c' }, { status: 'active' });
    const { url, options } = fetch.calls[0];
    assert.equal(url, 'https://db.example/rest/v1/members?id=eq.a%20b%26c');
    assert.equal(options.method, 'PATCH');
  } finally {
    fetch.restore();
  }
});

test('sb().selectOne returns the first row, or null when empty', async () => {
  let fetch = mockFetch(() => ({ body: [{ id: 't1', name: 'Student' }] }));
  try {
    const row = await sb(fakeEnv()).selectOne('membership_tiers', { id: 't1' });
    assert.deepEqual(row, { id: 't1', name: 'Student' });
    assert.match(fetch.calls[0].url, /select=\*&id=eq\.t1&limit=1$/);
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(() => ({ body: [] }));
  try {
    assert.equal(await sb(fakeEnv()).selectOne('membership_tiers', { id: 'none' }), null);
  } finally {
    fetch.restore();
  }
});

test('sendEmail is a no-op (no fetch) when Resend env is unconfigured', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    await sendEmail(fakeEnv(), { subject: 's', html: 'h' });
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
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
    assert.equal(sent.to, 'b@x.com');
  } finally {
    fetch.restore();
  }
});

test('sendEmail without `to` is still a no-op when NOTIFY_TO is unset', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    await sendEmail(fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com' }), {
      subject: 's',
      html: 'h',
    });
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('sendEmail with `to` sends there, needing only RESEND_API_KEY and NOTIFY_FROM', async () => {
  const fetch = mockFetch(() => ({ body: { id: 'email_2' } }));
  try {
    await sendEmail(fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com' }), {
      subject: 'Registered',
      html: '<p>ok</p>',
      to: 'guest@x.com',
    });
    assert.equal(fetch.calls.length, 1);
    const sent = JSON.parse(fetch.calls[0].options.body);
    assert.equal(sent.to, 'guest@x.com');
    assert.equal(sent.from, 'a@x.com');
    assert.equal('reply_to' in sent, false);
  } finally {
    fetch.restore();
  }
});

// A line break in a header value ends that header and starts another, so text a
// visitor typed (the name in a contact-form subject, their address in reply_to)
// could otherwise add a Bcc of its own.
test('sendEmail folds CR/LF out of every header value it sends', async () => {
  const fetch = mockFetch(() => ({ body: { id: 'email_4' } }));
  try {
    await sendEmail(fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com' }), {
      subject: 'CAACI contact form: Pat\r\nBcc: harvest@attacker.example',
      html: '<p>body is not a header</p>',
      replyTo: 'p@x.com\nBcc: harvest@attacker.example',
      to: 'staff@x.com\r\nBcc: harvest@attacker.example',
    });
    const sent = JSON.parse(fetch.calls[0].options.body);
    for (const value of [sent.subject, sent.reply_to, sent.to]) {
      assert.doesNotMatch(value, /[\r\n]/, value);
      assert.match(value, /harvest@attacker\.example/, 'folded, not silently dropped');
    }
    assert.equal(sent.subject, 'CAACI contact form: Pat Bcc: harvest@attacker.example');
  } finally {
    fetch.restore();
  }
});

test('sendEmail with `to` goes to that address, not NOTIFY_TO, even when NOTIFY_TO is set', async () => {
  const fetch = mockFetch(() => ({ body: { id: 'email_3' } }));
  try {
    await sendEmail(
      fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com', NOTIFY_TO: 'staff@x.com' }),
      { subject: 's', html: 'h', to: 'guest@x.com' },
    );
    assert.equal(JSON.parse(fetch.calls[0].options.body).to, 'guest@x.com');
  } finally {
    fetch.restore();
  }
});

test('sendEmail with `to` is a no-op when RESEND_API_KEY or NOTIFY_FROM is unset', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    await sendEmail(fakeEnv({ NOTIFY_FROM: 'a@x.com' }), {
      subject: 's',
      html: 'h',
      to: 'g@x.com',
    });
    await sendEmail(fakeEnv({ RESEND_API_KEY: 're_1' }), {
      subject: 's',
      html: 'h',
      to: 'g@x.com',
    });
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});
