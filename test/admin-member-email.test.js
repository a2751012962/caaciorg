import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/member-email.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Route the admin gate, the target-member lookup, the Auth Admin user read, and
// the two GoTrue email endpoints. Every option overrides one upstream answer.
function route({
  isAdmin = true,
  member = { id: 'm1', email: 'mei@x.com' },
  authUser = { id: 'm1', email: 'mei@x.com', email_confirmed_at: null, last_sign_in_at: null },
  recover = { body: {} },
  invite = { body: { id: 'm1' } },
} = {}) {
  return (url) => {
    if (url.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (url.includes('/rest/v1/members') && url.includes('is_admin'))
      return { body: [{ id: 'admin-1', email: 'admin@x.com', is_admin: isAdmin }] };
    if (url.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    if (url.includes('/auth/v1/admin/users/'))
      return authUser ? { body: authUser } : { status: 404, body: { msg: 'User not found' } };
    if (url.includes('/auth/v1/recover')) return recover;
    if (url.includes('/auth/v1/invite')) return invite;
    return { body: {} };
  };
}

const adminReq = (body) =>
  fakeRequest({
    url: 'https://caaci.example/api/admin/member-email',
    headers: { authorization: 'Bearer tok' },
    body,
  });

const emailCalls = (fetch) => fetch.calls.filter((c) => /\/auth\/v1\/(recover|invite)/.test(c.url));

test('member email: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { member_id: 'm1', action: 'reset' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 401);
    assert.equal(emailCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member email: a non-admin is refused and nothing is sent', async () => {
  const fetch = mockFetch(route({ isAdmin: false }));
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'reset' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 403);
    assert.equal(emailCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member email: validates action and member_id', async () => {
  const fetch = mockFetch(route());
  try {
    const noAction = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'delete' }),
      env: fakeEnv(),
    });
    assert.equal(noAction.status, 400);
    const noId = await onRequestPost({ request: adminReq({ action: 'reset' }), env: fakeEnv() });
    assert.equal(noId.status, 400);
    assert.equal(emailCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member email: unknown member -> 404', async () => {
  const fetch = mockFetch(route({ member: null }));
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'nope', action: 'reset' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 404);
    assert.equal(emailCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member email: reset sends recovery to the looked-up address, not the client one', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'reset', email: 'attacker@evil.com' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    assert.doesNotMatch(JSON.stringify(data), /@/, 'response carries no email address');

    const calls = emailCalls(fetch);
    assert.equal(calls.length, 1);
    const call = calls[0];
    const u = new URL(call.url);
    assert.equal(u.origin + u.pathname, 'https://db.example/auth/v1/recover');
    assert.equal(u.searchParams.get('redirect_to'), 'https://caaci.example/account/?recovery=1');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.apikey, 'service-key');
    assert.deepEqual(JSON.parse(call.options.body), { email: 'mei@x.com' });
  } finally {
    fetch.restore();
  }
});

test('member email: invite sends the invite email for a never-signed-in member', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'invite' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const calls = emailCalls(fetch);
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://db.example/auth/v1/invite');
    assert.equal(u.searchParams.get('redirect_to'), 'https://caaci.example/account/?recovery=1');
    assert.equal(calls[0].options.headers.authorization, 'Bearer service-key');
    assert.equal(JSON.parse(calls[0].options.body).email, 'mei@x.com');
  } finally {
    fetch.restore();
  }
});

test('member email: invite for an already-confirmed login -> 409 pointing at reset', async () => {
  const fetch = mockFetch(
    route({
      authUser: { id: 'm1', email_confirmed_at: '2026-01-01T00:00:00Z', last_sign_in_at: null },
    }),
  );
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'invite' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /reset/i);
    assert.equal(emailCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('member email: GoTrue refusing the invite as already registered -> 409', async () => {
  const fetch = mockFetch(
    route({
      invite: {
        status: 422,
        body: {
          code: 422,
          error_code: 'email_exists',
          msg: 'A user with this email address has already been registered',
        },
      },
    }),
  );
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'invite' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /reset/i);
  } finally {
    fetch.restore();
  }
});

test('member email: upstream rate limit -> 429 with a readable message', async () => {
  const fetch = mockFetch(
    route({
      recover: {
        status: 429,
        body: {
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'For security purposes, you can only request this after 42 seconds.',
        },
      },
    }),
  );
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action: 'reset' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /wait/i);
  } finally {
    fetch.restore();
  }
});

// One admin request for member m1; returns the response and the GoTrue email calls.
async function send(action, opts) {
  const fetch = mockFetch(route(opts));
  try {
    const r = await onRequestPost({
      request: adminReq({ member_id: 'm1', action }),
      env: fakeEnv(),
    });
    return { status: r.status, body: await r.json(), calls: emailCalls(fetch) };
  } finally {
    fetch.restore();
  }
}

test('member email: other upstream failures -> 502 without echoing the upstream body', async () => {
  const { status, body } = await send('reset', {
    recover: { status: 500, body: { code: 500, msg: 'boom re_SECRET123' } },
  });
  assert.equal(status, 502);
  assert.doesNotMatch(JSON.stringify(body), /SECRET|boom/);
});

test('member email: a 502 drops an upstream string code that is not a plain machine code', async () => {
  const { status, body } = await send('reset', {
    recover: { status: 500, body: { code: 'Bad Code <script>', msg: 'x' } },
  });
  assert.equal(status, 502);
  assert.equal('code' in body, false);
});

test('member email: a 502 passes a plain GoTrue machine code through for debugging', async () => {
  const { status, body } = await send('reset', {
    recover: { status: 403, body: { error_code: 'email_address_not_authorized', msg: 'x' } },
  });
  assert.equal(status, 502);
  assert.equal(body.code, 'email_address_not_authorized');
});

test('member email: both actions send to the login email, not the editable profile email', async () => {
  const profileEdited = { id: 'm1', email: 'attacker@evil.com' };
  for (const action of ['reset', 'invite']) {
    const { status, calls } = await send(action, { member: profileEdited });
    assert.equal(status, 200, action);
    assert.equal(calls.length, 1, action);
    assert.equal(JSON.parse(calls[0].options.body).email, 'mei@x.com', action);
  }
});

test('member email: a member with no login account -> 404 for either action', async () => {
  for (const action of ['reset', 'invite']) {
    const { status, calls } = await send(action, { authUser: null });
    assert.equal(status, 404, action);
    assert.equal(calls.length, 0, action);
  }
});

test('member email: a rate-limit code alone (non-429 status) -> 429', async () => {
  const { status } = await send('reset', {
    recover: { status: 400, body: { code: 'over_email_send_rate_limit', message: 'x' } },
  });
  assert.equal(status, 429);
});

test('member email: a new-shape email_exists code alone -> 409', async () => {
  const { status, body } = await send('invite', {
    invite: { status: 422, body: { code: 'email_exists', message: 'x' } },
  });
  assert.equal(status, 409);
  assert.match(body.error, /reset/i);
});

test('member email: an "already been registered" message alone -> 409', async () => {
  const { status } = await send('invite', {
    invite: {
      status: 400,
      body: { msg: 'A user with this email address has already been registered' },
    },
  });
  assert.equal(status, 409);
});

test('member email: a JSON null error body is mapped, not thrown', async () => {
  const { status } = await send('reset', { recover: { status: 429, body: 'null' } });
  assert.equal(status, 429);
});
