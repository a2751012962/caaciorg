import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/contact.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const resendEnv = () => fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com', NOTIFY_TO: 'b@x.com' });

test('contact: invalid JSON -> 400', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: '{bad' }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'invalid JSON' });
  } finally { fetch.restore(); }
});

test('contact: missing required fields -> 400', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: { name: 'Pat' } }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /required/);
    assert.equal(fetch.calls.length, 0, 'no DB write on validation failure');
  } finally { fetch.restore(); }
});

test('contact: honeypot _hp is silently accepted with no DB write', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { name: 'Bot', email: 'b@x.com', message: 'spam', _hp: 'x' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(fetch.calls.length, 0);
  } finally { fetch.restore(); }
});

test('contact: valid submission inserts and emails, escaping HTML', async () => {
  const fetch = mockFetch(() => ({ body: '' }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { name: 'A<b>', email: 'a@x.com', phone: '123', message: 'x & y > z' } }),
      env: resendEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });

    const insert = fetch.calls.find(c => c.url.includes('/rest/v1/form_submissions'));
    assert.equal(JSON.parse(insert.options.body).kind, 'contact');

    const email = fetch.calls.find(c => c.url.includes('resend.com'));
    const html = JSON.parse(email.options.body).html;
    assert.match(html, /A&lt;b&gt;/, 'user-supplied markup is escaped');
    assert.match(html, /x &amp; y &gt; z/);
  } finally { fetch.restore(); }
});
