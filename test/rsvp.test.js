import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/rsvp.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Routes the auth lookup (valid token -> user), the events lookup (null -> no
// row), and the rsvps insert.
function route({
  user = { id: 'u1' },
  event = { id: 'e1', published: true },
  insert = { body: '' },
} = {}) {
  return (url) => {
    if (url.includes('/auth/v1/user')) return user ? { body: user } : { ok: false, status: 401 };
    if (url.includes('/rest/v1/events')) return { body: event ? [event] : [] };
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
  } finally {
    fetch.restore();
  }
});

test('rsvp: missing event_id -> 400', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({ body: {} }), env: fakeEnv() });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /event_id required/);
  } finally {
    fetch.restore();
  }
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
  } finally {
    fetch.restore();
  }
});

for (const [label, event] of [
  ['unpublished event', { id: 'e1', published: false }],
  ['nonexistent event', null],
]) {
  test(`rsvp: ${label} -> 404 and no insert`, async () => {
    const fetch = mockFetch(route({ event }));
    try {
      const r = await onRequestPost({
        request: fakeRequest({
          body: { event_id: 'e1' },
          headers: { authorization: 'Bearer good' },
        }),
        env: fakeEnv(),
      });
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
      assert.equal(
        fetch.calls.some((c) => c.url.includes('/rest/v1/rsvps')),
        false,
      );
    } finally {
      fetch.restore();
    }
  });
}

test('rsvp: published event, valid token inserts with guests clamped to >= 0', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        body: { event_id: 'e1', guests: -5 },
        headers: { authorization: 'Bearer good' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const lookup = fetch.calls.find((c) => c.url.includes('/rest/v1/events'));
    assert.match(lookup.url, /select=id,published&id=eq\.e1/);
    const insert = fetch.calls.find((c) => c.url.includes('/rest/v1/rsvps'));
    const row = JSON.parse(insert.options.body);
    assert.equal(row.event_id, 'e1');
    assert.equal(row.member_id, 'u1');
    assert.equal(row.guests, 0);
  } finally {
    fetch.restore();
  }
});

test('rsvp: duplicate insert resolves as { ok: true, already: true }', async () => {
  const fetch = mockFetch(
    route({
      insert: { ok: false, status: 409, body: 'duplicate key value violates unique constraint' },
    }),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: { event_id: 'e1' }, headers: { authorization: 'Bearer good' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, already: true });
  } finally {
    fetch.restore();
  }
});
