import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/news.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// An admin, one active member, and a Resend batch that accepts everything.
const route = (u) => {
  if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
  if (u.includes('/rest/v1/members') && u.includes('is_admin'))
    return { body: [{ id: 'admin-1', is_admin: true }] };
  if (u.includes('/rest/v1/news_posts')) return { status: 201, body: [{ id: 'post-1' }] };
  if (u.includes('/rest/v1/members')) return { body: [{ email: 'mei@x.com' }] };
  if (u.includes('api.resend.com')) return { body: { data: [{ id: 'email-1' }] } };
  return { body: [] };
};

const post = (body) =>
  onRequestPost({
    request: fakeRequest({
      url: 'https://caaciorg.com/api/admin/news',
      headers: { authorization: 'Bearer tok' },
      body,
    }),
    env: fakeEnv({ RESEND_API_KEY: 're_test', NOTIFY_FROM: 'CAACI <news@caaci.example>' }),
  });

// Everything past the admin check: the throttle read, recipients, the audit row, email.
const pastTheGate = (fetch) =>
  fetch.calls.filter(
    (c) =>
      c.url.includes('/rest/v1/news_posts') ||
      c.url.includes('api.resend.com') ||
      (c.url.includes('/rest/v1/members') && !c.url.includes('is_admin')),
  );

// The renewal lists. Most of the roster paid once and has no subscription, so
// nobody in Stripe will ever prompt them — these two audiences are how they get
// asked. Anyone Stripe does renew is deliberately left out of 'expiring'.
test('news: the renewal audiences ask the database for the right people', async () => {
  const fetch = mockFetch(route);
  try {
    const recipients = () =>
      fetch.calls.find((c) => c.url.includes('/rest/v1/members') && !c.url.includes('is_admin'))
        ?.url;

    let r = await post({ subject: 'Renew', body_html: '<p>hi</p>', audience: 'expiring', confirm: true });
    assert.equal(r.status, 200);
    const soon = recipients();
    assert.match(soon, /and=\(status\.eq\.active,expires_at\.gte\./);
    assert.match(soon, /expires_at\.lte\./);
    assert.match(soon, /stripe_subscription_id\.is\.null\)/);

    fetch.calls.length = 0;
    r = await post({ subject: 'Come back', body_html: '<p>hi</p>', audience: 'lapsed', confirm: true });
    assert.equal(r.status, 200);
    // Both kinds of expired: the stored ones and the 'active' rows past the date.
    assert.match(recipients(), /and=\(or\(status\.eq\.expired,and\(status\.eq\.active,expires_at\.lte\./);
  } finally {
    fetch.restore();
  }
});

test('news: an audience nobody defined is refused', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await post({
      subject: 'Hi',
      body_html: '<p>hi</p>',
      audience: 'everyone-ever',
      confirm: true,
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Invalid audience.' });
    assert.deepEqual(pastTheGate(fetch), []);
  } finally {
    fetch.restore();
  }
});

test('news: a message still holding a template placeholder is refused before anything is read or sent', async () => {
  const fetch = mockFetch(route);
  try {
    for (const [subject, body_html] of [
      ['Hello', '<p>【待填写：中文正文】</p>'],
      ['[To fill in: English heading]', '<p>Hi</p>'],
    ]) {
      const r = await post({ subject, body_html, audience: 'active', confirm: true });
      assert.equal(r.status, 400, subject);
      assert.deepEqual(await r.json(), {
        error: 'Replace the 【待填写】 / [To fill in] text before sending.',
      });
    }
    assert.deepEqual(pastTheGate(fetch), []);
  } finally {
    fetch.restore();
  }
});

test('news: a message with no placeholder is sent to the audience', async () => {
  const fetch = mockFetch(route);
  try {
    const r = await post({
      subject: 'Hello',
      body_html: '<p>【活动】 See you [soon]</p>',
      audience: 'active',
      confirm: true,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, sent: 1, failed: 0, total: 1 });
    const batch = fetch.calls.find((c) => c.url === 'https://api.resend.com/emails/batch');
    assert.deepEqual(
      JSON.parse(batch.options.body).map((m) => [m.to, m.subject]),
      [['mei@x.com', 'Hello']],
    );
  } finally {
    fetch.restore();
  }
});
