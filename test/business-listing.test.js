import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/business-listing.js';
import { fakeRequest, mockFetch, fakeEnv, turnstileRoute, withTurnstile } from './helpers.js';

// Every submission that gets past the required-field checks passes the Turnstile
// check first; fakeRequest's default url is the host its token must come from.
const route =
  (handler = () => ({ body: '' })) =>
  (url, options) =>
    turnstileRoute(url, 'business_listing') ?? handler(url, options);

const resendEnv = () =>
  fakeEnv({ RESEND_API_KEY: 're_1', NOTIFY_FROM: 'a@x.com', NOTIFY_TO: 'b@x.com' });

test('business-listing: invalid JSON -> 400', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: 'nope' }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'invalid JSON' });
  } finally {
    fetch.restore();
  }
});

test('business-listing: name and email are required', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { name: 'Acme' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /required/);
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('business-listing: honeypot _hp silently accepted, no DB write', async () => {
  const fetch = mockFetch(() => ({}));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { name: 'Acme', email: 'a@x.com', _hp: '1' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('business-listing: defaults category to "services" and approved to false', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        body: withTurnstile({ name: 'Acme', email: 'a@x.com', description: 'we <sell> things' }),
      }),
      env: resendEnv(),
    });
    assert.equal(r.status, 200);

    const insert = fetch.calls.find((c) => c.url.includes('/rest/v1/business_directory'));
    const row = JSON.parse(insert.options.body);
    assert.equal(row.category, 'services');
    assert.equal(row.approved, false);
    assert.equal(row.name, 'Acme');

    const email = fetch.calls.find((c) => c.url.includes('resend.com'));
    assert.match(JSON.parse(email.options.body).html, /we &lt;sell&gt; things/);
  } finally {
    fetch.restore();
  }
});
