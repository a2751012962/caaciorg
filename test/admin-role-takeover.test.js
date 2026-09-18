// One admin must not be able to take over another admin's login.
//
// /api/admin/member-password already refuses to re-key an administrator, but it
// decides from members.is_admin — and POST /api/admin/members could clear that
// same flag with nothing but the session. So an attacker holding one admin's
// access token demoted the victim, then set their password, then signed in as
// them. Demoting an administrator now needs the emailed verification code, the
// control that exists for actions a stolen session should not be enough for;
// root's flag cannot be changed here at all. Appointing an admin is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/members.js';
import { onRequestPost as setPassword } from '../functions/api/admin/member-password.js';
import { codeFor, currentSlot } from '../functions/api/admin/_action-code.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// `target` is the row /rest/v1/members returns for anyone who is not the caller.
function route(target = { id: 'victim', is_admin: true }) {
  return (url, options = {}) => {
    if (url.includes('/auth/v1/user')) return { body: { id: 'attacker' } };
    if (url.includes('/rest/v1/members') && url.includes('id=eq.attacker'))
      return { body: [{ id: 'attacker', email: 'a@x.com', is_admin: true }] };
    if (url.includes('/rest/v1/members') && options.method === 'PATCH') return { body: {} };
    if (url.includes('/rest/v1/members')) return { body: target ? [target] : [] };
    if (url.includes('/auth/v1/admin/users/')) {
      if (options.method === 'PUT') return { body: { id: 'victim' } };
      return { body: { id: 'victim', email: 'victim@x.com' } };
    }
    return { body: {} };
  };
}

const patches = (fetch) =>
  fetch.calls.filter((c) => c.url.includes('/rest/v1/members') && c.options.method === 'PATCH');

const post = (body, headers = {}) =>
  onRequestPost({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/members',
      headers: { authorization: 'Bearer tok', ...headers },
      body,
    }),
    env: fakeEnv(),
  });

test('members: demoting another administrator without the emailed code is refused, and writes nothing', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ id: 'victim', is_admin: false });
    assert.equal(r.status, 428);
    assert.equal((await r.json()).code_required, true);
    assert.equal(patches(fetch).length, 0, 'the victim keeps their admin access');
  } finally {
    fetch.restore();
  }
});

test('members: demoting an administrator with the code still works', async () => {
  const fetch = mockFetch(route());
  try {
    const code = await codeFor(fakeEnv(), 'attacker', currentSlot());
    const r = await post({ id: 'victim', is_admin: false }, { 'x-admin-code': code });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(patches(fetch)[0].options.body).is_admin, false);
  } finally {
    fetch.restore();
  }
});

test('members: appointing an admin needs no code — only taking the flag away does', async () => {
  const fetch = mockFetch(route({ id: 'helper', is_admin: false }));
  try {
    const r = await post({ id: 'helper', is_admin: true });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(patches(fetch)[0].options.body).is_admin, true);
  } finally {
    fetch.restore();
  }
});

test("members: root's admin flag cannot be changed here, code or no code", async () => {
  for (const headers of [
    {},
    { 'x-admin-code': await codeFor(fakeEnv(), 'attacker', currentSlot()) },
  ]) {
    const fetch = mockFetch(route({ id: 'root-1', is_admin: true, is_root: true }));
    try {
      const r = await post({ id: 'root-1', is_admin: false }, headers);
      assert.equal(r.status, 403);
      assert.match((await r.json()).error, /Root/);
      assert.equal(patches(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  }
});

test('members: a member who is not there is a 404, not a silent write', async () => {
  const fetch = mockFetch(route(null));
  try {
    const r = await post({ id: 'ghost', is_admin: true });
    assert.equal(r.status, 404);
    assert.equal(patches(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

// The chain end to end: with the demotion refused, the password endpoint keeps
// refusing too, so a stolen admin session cannot become another admin's login.
test('takeover chain: demotion refused, so the password endpoint still refuses', async () => {
  const fetch = mockFetch(route());
  try {
    assert.equal((await post({ id: 'victim', is_admin: false })).status, 428);
    const r = await setPassword({
      request: fakeRequest({
        url: 'https://caaci.example/api/admin/member-password',
        headers: { authorization: 'Bearer tok' },
        body: { member_id: 'victim', password: 'attacker-pass-1' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 403);
    assert.equal(
      fetch.calls.filter(
        (c) => c.url.includes('/auth/v1/admin/users/') && c.options.method === 'PUT',
      ).length,
      0,
      "the victim's password is never set",
    );
  } finally {
    fetch.restore();
  }
});
