import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/admin/news.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Ada is the signed-in admin; Bo is another admin; Mei is an ordinary member.
// Resend accepts every message in a batch.
const route = (u, options = {}) => {
  if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
  if (u.includes('/rest/v1/members') && u.includes('is_admin=eq.true'))
    return { body: [{ email: 'ada@x.com' }, { email: 'Bo@X.com' }] };
  if (u.includes('/rest/v1/members') && u.includes('id=eq.'))
    return { body: [{ id: 'admin-1', email: 'Ada@X.com', full_name: 'Ada', is_admin: true }] };
  if (u.includes('/rest/v1/members')) return { body: [{ email: 'mei@x.com' }] };
  if (u.includes('/rest/v1/news_posts')) return { status: 201, body: [{ id: 'post-1' }] };
  if (u === 'https://api.resend.com/emails/batch')
    return { body: { data: JSON.parse(options.body).map((_, i) => ({ id: `e${i}` })) } };
  return { body: [] };
};

const ENV = { RESEND_API_KEY: 're_test', NOTIFY_FROM: 'CAACI <news@caaci.example>' };
const request = (body) =>
  fakeRequest({
    url: 'https://caaciorg.com/api/admin/news',
    headers: { authorization: 'Bearer tok' },
    body,
  });
const post = (body, env = {}) =>
  onRequestPost({ request: request(body), env: fakeEnv({ ...ENV, ...env }) });

const batches = (fetch) =>
  fetch.calls
    .filter((c) => c.url === 'https://api.resend.com/emails/batch')
    .map((c) => JSON.parse(c.options.body));
const auditCalls = (fetch) => fetch.calls.filter((c) => c.url.includes('/rest/v1/news_posts'));
// Member reads other than the admin check and the admin list: the audience.
const audienceReads = (fetch) =>
  fetch.calls.filter(
    (c) =>
      c.url.includes('/rest/v1/members') &&
      !c.url.includes('is_admin=eq.true') &&
      !c.url.includes('id=eq.'),
  );

test('news test send: to the signed-in admin and other admins only, prefixed, with no confirm, audit row or audience read', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await post({
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      test: true,
      test_to: ['BO@x.com', ' ada@x.com ', 'bo@x.com'],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      test: true,
      sent: 2,
      recipients: ['ada@x.com', 'bo@x.com'],
    });
    assert.deepEqual(
      batches(fetch)
        .flat()
        .map((m) => [m.to, m.subject, m.html]),
      [
        ['ada@x.com', '【测试 TEST】Hello', '<p>Hi</p>'],
        ['bo@x.com', '【测试 TEST】Hello', '<p>Hi</p>'],
      ],
    );
    assert.deepEqual(auditCalls(fetch), []);
    assert.deepEqual(audienceReads(fetch), []);
  } finally {
    fetch.restore();
  }
});

test('news test send: with no extras it goes to you alone, without reading the admin list', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await post({ subject: 'Hello', body_html: '<p>Hi</p>', test: true });
    assert.deepEqual((await r.json()).recipients, ['ada@x.com']);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('is_admin=eq.true')),
      false,
    );
    // A comma-separated string works too.
    const s = await post({
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      test: true,
      test_to: 'bo@x.com, ;',
    });
    assert.deepEqual((await s.json()).recipients, ['ada@x.com', 'bo@x.com']);
  } finally {
    fetch.restore();
  }
});

test('news test send: a non-admin address or too many extras is refused and nothing is sent', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await post({
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      test: true,
      test_to: ['bo@x.com', 'Mei@x.com', 'stranger@evil.example'],
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), {
      error: 'Test emails can only go to admin accounts: mei@x.com, stranger@evil.example',
    });

    const many = Array.from({ length: 11 }, (_, i) => `a${i}@x.com`);
    const m = await post({ subject: 'Hello', body_html: '<p>Hi</p>', test: true, test_to: many });
    assert.equal(m.status, 400);
    assert.deepEqual(await m.json(), { error: 'At most 10 extra test recipients.' });

    const empty = await post({ subject: 'Hello', body_html: ' ', test: true });
    assert.equal(empty.status, 400);
    assert.deepEqual(batches(fetch), []);
  } finally {
    fetch.restore();
  }
});

test('news: NEWS_TEST_ONLY refuses a real send before anything is read, test sends still work, and GET reports it', async () => {
  const real = { subject: 'Hello', body_html: '<p>Hi</p>', audience: 'active', confirm: true };
  let fetch = mockFetch(route);
  try {
    const r = await post(real, { NEWS_TEST_ONLY: '1' });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /only sends test emails/);
    assert.deepEqual(auditCalls(fetch), []);
    assert.deepEqual(audienceReads(fetch), []);
    assert.deepEqual(batches(fetch), []);

    const t = await post({ ...real, test: true }, { NEWS_TEST_ONLY: '1' });
    assert.equal(t.status, 200);
    assert.deepEqual((await t.json()).recipients, ['ada@x.com']);

    const get = async (env) =>
      (await onRequestGet({ request: request(), env: fakeEnv({ ...ENV, ...env }) })).json();
    assert.deepEqual(await get({ NEWS_TEST_ONLY: '1' }), { test_only: true });
    assert.deepEqual(await get({}), { test_only: false });
  } finally {
    fetch.restore();
  }

  // Without the flag the same real send goes to the audience.
  fetch = mockFetch(route);
  try {
    const r = await post(real);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, sent: 1, failed: 0, total: 1 });
    assert.deepEqual(
      batches(fetch)
        .flat()
        .map((m) => [m.to, m.subject]),
      [['mei@x.com', 'Hello']],
    );
  } finally {
    fetch.restore();
  }
});

test('news GET needs an admin', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await onRequestGet({
      request: fakeRequest({ url: 'https://caaciorg.com/api/admin/news' }),
      env: fakeEnv(ENV),
    });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});
