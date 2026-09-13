import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/member-password.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route the admin gate, the target member's row, the Auth Admin user read (GET)
// and update (PUT), and Resend. Every option overrides one upstream answer.
function route({
  isAdmin = true,
  target = { id: 'm1', is_admin: false },
  authUser = { id: 'm1', email: 'mei@x.com', email_confirmed_at: null },
  update = { body: { id: 'm1' } },
  resend = { body: { id: 'email-1' } },
} = {}) {
  return (url, options = {}) => {
    if (url.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (url.includes('/rest/v1/members') && url.includes('id=eq.admin-1'))
      return { body: [{ id: 'admin-1', email: 'admin@x.com', is_admin: isAdmin }] };
    if (url.includes('/rest/v1/members')) {
      if (typeof target === 'function') return target();
      return { body: target ? [target] : [] };
    }
    if (url.includes('/auth/v1/admin/users/')) {
      if (options.method === 'PUT') return update;
      if (typeof authUser === 'function') return authUser();
      return authUser ? { body: authUser } : { status: 404, body: { msg: 'User not found' } };
    }
    if (url.startsWith('https://api.resend.com/')) {
      if (typeof resend === 'function') return resend();
      return resend;
    }
    return { body: {} };
  };
}

const adminReq = (body) =>
  fakeRequest({
    url: 'https://caaci.example/api/admin/member-password',
    headers: { authorization: 'Bearer tok' },
    body,
  });

const MAIL_ENV = {
  RESEND_API_KEY: 're_test',
  NOTIFY_FROM: 'CAACI <no-reply@caaci.example>',
  NOTIFY_TO: 'staff@caaci.example',
};
const puts = (fetch) => fetch.calls.filter((c) => c.options.method === 'PUT');
const mails = (fetch) => fetch.calls.filter((c) => c.url.startsWith('https://api.resend.com/'));
const post = (body, env = {}) => onRequestPost({ request: adminReq(body), env: fakeEnv(env) });
const GOOD = { member_id: 'm1', password: 'new-pass-123' };

test('member password: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: GOOD }), env: fakeEnv() });
    assert.equal(r.status, 401);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: a non-admin is refused and nothing changes', async () => {
  const fetch = mockFetch(route({ isAdmin: false }));
  try {
    const r = await post(GOOD);
    assert.equal(r.status, 403);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: validates member_id and the password length', async () => {
  const fetch = mockFetch(route());
  try {
    assert.equal((await post({ password: 'new-pass-123' })).status, 400);
    const short = await post({ member_id: 'm1', password: 'short' });
    assert.equal(short.status, 400);
    assert.match((await short.json()).error, /at least 8/);
    // 25 CJK characters pass the character floor but are 75 UTF-8 bytes.
    const long = await post({ member_id: 'm1', password: '密'.repeat(25) });
    assert.equal(long.status, 400);
    assert.match((await long.json()).error, /72 bytes/);
    assert.equal((await post({ member_id: 'm1', password: 12345678 })).status, 400);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: an admin cannot set their own password here', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ member_id: 'admin-1', password: 'new-pass-123' });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /My account/);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test("member password: another administrator's password is refused", async () => {
  const fetch = mockFetch(route({ target: { id: 'm1', is_admin: true } }));
  try {
    const r = await post(GOOD, MAIL_ENV);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /administrator's password/);
    assert.equal(puts(fetch).length, 0);
    assert.equal(mails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: a member without a login gets 404 and nothing is written', async () => {
  const fetch = mockFetch(route({ authUser: null }));
  try {
    const r = await post(GOOD);
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /invitation/);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: sets the password as the service role and confirms the email', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post(GOOD);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body, { ok: true });
    const [put] = puts(fetch);
    assert.equal(put.url, 'https://db.example/auth/v1/admin/users/m1');
    assert.equal(put.options.headers.authorization, 'Bearer service-key');
    assert.deepEqual(JSON.parse(put.options.body), {
      password: 'new-pass-123',
      email_confirm: true,
    });
    // Without Resend configured, no email is attempted.
    assert.equal(mails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: the member is emailed a notice, after the change, without the password', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post(GOOD, MAIL_ENV);
    assert.equal(r.status, 200);
    assert.equal(mails(fetch).length, 1);
    const [mail] = mails(fetch);
    const sent = JSON.parse(mail.options.body);
    assert.equal(sent.to, 'mei@x.com', 'the login email from Supabase Auth');
    assert.equal(sent.reply_to, 'staff@caaci.example');
    assert.match(sent.subject, /password was changed/);
    assert.match(sent.html, /mei@x\.com/);
    assert.doesNotMatch(mail.options.body, /new-pass-123/);
    const order = fetch.calls.map((c) => c.options.method === 'PUT' || c === mail);
    assert.ok(order.indexOf(true) < order.lastIndexOf(true), 'PUT comes before the email');
  } finally {
    fetch.restore();
  }
});

test('member password: a failed notice email does not undo the success', async () => {
  const fetch = mockFetch(
    route({
      resend: () => {
        throw new TypeError('fetch failed');
      },
    }),
  );
  try {
    const r = await post(GOOD, MAIL_ENV);
    assert.equal(r.status, 200);
    assert.equal(puts(fetch).length, 1);
  } finally {
    fetch.restore();
  }
});

test("member password: GoTrue's weak-password answer reaches the admin, and no email goes out", async () => {
  const fetch = mockFetch(
    route({
      update: {
        status: 422,
        body: { code: 'weak_password', message: 'Password should contain a digit.' },
      },
    }),
  );
  try {
    const r = await post(GOOD, MAIL_ENV);
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error, 'Password should contain a digit.');
    assert.equal(mails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member password: upstream failures answer 502 without leaking details', async () => {
  let fetch = mockFetch(route({ update: { status: 500, body: { msg: 'db exploded at row 7' } } }));
  try {
    const r = await post(GOOD, MAIL_ENV);
    assert.equal(r.status, 502);
    assert.doesNotMatch((await r.json()).error, /exploded/);
    assert.equal(mails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ authUser: () => ({ status: 500, body: {} }) }));
  try {
    assert.equal((await post(GOOD)).status, 502);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ target: () => ({ status: 500, body: {} }) }));
  try {
    assert.equal((await post(GOOD)).status, 502);
    assert.equal(puts(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});
