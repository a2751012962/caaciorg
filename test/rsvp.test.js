import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/rsvp.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Routes the auth lookup (valid token -> user) and the rsvps insert.
function route({ user = { id: 'u1' }, insert = { body: '' } } = {}) {
  return (url) => {
    if (url.includes('/auth/v1/user')) return user ? { body: user } : { ok: false, status: 401 };
    if (url.includes('/rest/v1/rsvps')) return insert;
    return { body: {} };
  };
}

test('rsvp: invalid JSON -> 400', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: 'x' }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'invalid JSON' });
  } finally { fetch.restore(); }
});

test('rsvp: missing event_id -> 400', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: {} }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /event_id required/);
  } finally { fetch.restore(); }
});

test('rsvp: no/invalid token -> 401', async () => {
  const fetch = mockFetch(route({ user: null }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { event_id: 'e1' }, headers: { authorization: 'Bearer bad' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /logged in/);
  } finally { fetch.restore(); }
});

test('rsvp: valid token inserts with guests clamped to >= 0', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { event_id: 'e1', guests: -5 }, headers: { authorization: 'Bearer good' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const insert = fetch.calls.find(c => c.url.includes('/rest/v1/rsvps'));
    const row = JSON.parse(insert.options.body);
    assert.equal(row.event_id, 'e1');
    assert.equal(row.member_id, 'u1');
    assert.equal(row.guests, 0);
  } finally { fetch.restore(); }
});

test('rsvp: duplicate insert resolves as { ok: true, already: true }', async () => {
  const fetch = mockFetch(route({ insert: { ok: false, status: 409, body: 'duplicate key value violates unique constraint' } }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { event_id: 'e1' }, headers: { authorization: 'Bearer good' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, already: true });
  } finally { fetch.restore(); }
});
