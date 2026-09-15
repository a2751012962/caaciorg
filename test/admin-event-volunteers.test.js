import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestDelete } from '../functions/api/admin/event-volunteers.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const EV = '11111111-1111-4111-8111-111111111111';
const EV_OTHER = '22222222-2222-4222-8222-222222222222';
const STARTS = '2026-09-27T19:00:00+00:00';
const EARLY = '2026-09-10T12:00:00+00:00';
const LATE = '2026-09-22T12:00:00+00:00';

const EVENTS = {
  [EV]: {
    id: EV,
    slug: 'mid-autumn-festival',
    title: 'Mid-Autumn Festival',
    title_zh: '中秋节',
    starts_at: STARTS,
  },
  [EV_OTHER]: { id: EV_OTHER, slug: 'picnic', title: 'Picnic', title_zh: null, starts_at: STARTS },
};
const embedOf = (id) => {
  const { slug, title, title_zh, starts_at } = EVENTS[id];
  return { slug, title, title_zh, starts_at };
};

const MEMBERS = [
  {
    id: 'm-mei',
    email: 'Mei.Lin@Example.com',
    created_at: EARLY,
    status: 'active',
    tier_id: 'family',
  },
  { id: 'm-jun', email: 'jun@example.com', created_at: EARLY, status: 'pending', tier_id: null },
];

const vol = (over) => ({
  id: `v-${over.email}`,
  event_id: EV,
  name: 'Someone',
  email: over.email,
  phone: null,
  message: null,
  source: 'volunteer',
  member_id: null,
  created_at: EARLY,
  updated_at: EARLY,
  ...over,
});

// Rows for this one event (the handler asks for created_at.asc).
const EVENT_ROWS = [
  vol({ email: 'mei.lin@example.com', name: 'Mei Lin', phone: '217-555-0100' }),
  // member_id wins over the email, which belongs to nobody
  vol({ email: 'helper@example.com', member_id: 'm-jun', source: 'registration' }),
  vol({ email: 'nobody@example.com', member_id: 'm-gone', created_at: LATE }),
];

// Every sign-up, newest first, each with its embedded event (null = any event).
const ALL_ROWS = [
  vol({
    email: 'anyone@example.com',
    event_id: null,
    message: 'Weekends work best',
    created_at: LATE,
    events: null,
  }),
  vol({ email: 'mei.lin@example.com', name: 'Mei Lin', events: embedOf(EV) }),
  vol({
    email: 'jun@example.com',
    event_id: EV_OTHER,
    source: 'registration',
    events: embedOf(EV_OTHER),
    created_at: EARLY,
  }),
];

function route({ admin = true, eventRows = EVENT_ROWS, allRows = ALL_ROWS } = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/events')) {
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)?.[1] || '');
      return { body: EVENTS[id] ? [EVENTS[id]] : [] };
    }
    if (u.includes('/rest/v1/event_volunteers'))
      return { body: u.includes('event_id=eq.') ? eventRows : allRows };
    if (u.includes('/rest/v1/members')) return { body: MEMBERS };
    return { body: [] };
  };
}

const get = (query, headers = { authorization: 'Bearer tok' }) =>
  onRequestGet({
    request: fakeRequest({
      url: `https://caaci.example/api/admin/event-volunteers${query}`,
      headers,
    }),
    env: fakeEnv(),
  });

const del = (body, headers = { authorization: 'Bearer tok' }) =>
  onRequestDelete({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/event-volunteers',
      body,
      headers,
    }),
    env: fakeEnv(),
  });

test('admin volunteers: 401 without a token, 403 for a non-admin, on GET and DELETE', async () => {
  let fetch = mockFetch(route());
  try {
    assert.equal((await get('?scope=all', {})).status, 401);
    assert.equal((await del({ id: 'v-1' }, {})).status, 401);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ admin: false }));
  try {
    assert.equal((await get('?scope=all')).status, 403);
    assert.equal((await del({ id: 'v-1' })).status, 403);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/event_volunteers')),
      false,
      'no volunteer data is read or deleted for a non-admin',
    );
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: a malformed event_id is 404 and never reaches PostgREST', async () => {
  const fetch = mockFetch(route());
  try {
    const malformed = await get('?event_id=not-a-uuid');
    assert.equal(malformed.status, 404);
    assert.equal((await malformed.json()).error, 'Event not found.');
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/events')),
      false,
    );
    const unknown = await get('?event_id=33333333-3333-4333-8333-333333333333');
    assert.equal(unknown.status, 404);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/event_volunteers')),
      false,
      'an unknown event lists nothing',
    );
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: one event lists its sign-ups oldest first, with accounts and a summary', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 200);
    const data = await r.json();

    assert.deepEqual(data.event, {
      id: EV,
      slug: 'mid-autumn-festival',
      title: 'Mid-Autumn Festival',
      title_zh: '中秋节',
      starts_at: STARTS,
    });
    const q = fetch.calls.find((c) => c.url.includes('/rest/v1/event_volunteers')).url;
    assert.ok(
      q.includes(
        'select=id,event_id,name,email,phone,message,source,member_id,created_at,updated_at&',
      ),
      'no embed is asked for when the event is already known',
    );
    assert.ok(q.includes(`event_id=eq.${EV}`));
    assert.ok(q.includes('order=created_at.asc'));
    assert.ok(q.includes('limit=2000'));

    assert.deepEqual(
      data.rows.map((x) => x.email),
      EVENT_ROWS.map((x) => x.email),
    );
    const by = Object.fromEntries(data.rows.map((x) => [x.email, x]));
    // case-insensitive email match against a mixed-case members.email
    assert.deepEqual(by['mei.lin@example.com'].account, {
      id: 'm-mei',
      status: 'active',
      tier_id: 'family',
    });
    assert.deepEqual(by['mei.lin@example.com'].event, {
      slug: 'mid-autumn-festival',
      title: 'Mid-Autumn Festival',
      title_zh: '中秋节',
      starts_at: STARTS,
    });
    // member_id first; a stale one falls back to the (unknown) email
    assert.equal(by['helper@example.com'].account.id, 'm-jun');
    assert.equal(by['nobody@example.com'].account, null);

    // The row shape the admin panel and CSV rely on.
    assert.deepEqual(Object.keys(data.rows[0]).sort(), [
      'account',
      'created_at',
      'email',
      'event',
      'event_id',
      'id',
      'member_id',
      'message',
      'name',
      'phone',
      'source',
      'updated_at',
    ]);
    assert.deepEqual(data.summary, { total: 3, with_account: 2 });
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: scope=all embeds each row’s event, newest first, "any event" as null', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get('?scope=all');
    assert.equal(r.status, 200);
    const data = await r.json();

    const q = fetch.calls.find((c) => c.url.includes('/rest/v1/event_volunteers')).url;
    assert.ok(
      q.includes(
        'select=id,event_id,name,email,phone,message,source,member_id,created_at,updated_at,events(slug,title,title_zh,starts_at)&',
      ),
      'the PostgREST embed carries every row’s event',
    );
    assert.ok(q.includes('order=created_at.desc'));
    assert.ok(q.includes('limit=2000'));
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/events?')),
      false,
      'no separate event lookup',
    );

    assert.deepEqual(
      data.rows.map((x) => [x.email, x.event?.slug ?? null]),
      [
        ['anyone@example.com', null],
        ['mei.lin@example.com', 'mid-autumn-festival'],
        ['jun@example.com', 'picnic'],
      ],
    );
    // The embed is folded into `event`; the raw PostgREST key is not passed on.
    assert.equal('events' in data.rows[0], false);
    assert.deepEqual(data.rows[2].event, {
      slug: 'picnic',
      title: 'Picnic',
      title_zh: null,
      starts_at: STARTS,
    });
    assert.equal(data.rows[0].message, 'Weekends work best');
    assert.equal(data.rows[2].source, 'registration');
    assert.equal(data.rows[2].account.id, 'm-jun');
    assert.equal(data.rows[0].account, null);
    assert.deepEqual(data.summary, { total: 3 });
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: no query at all behaves like scope=all', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get('')).json();
    assert.equal(data.rows.length, 3);
    assert.deepEqual(data.summary, { total: 3 });
    assert.equal(data.event, undefined);
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: DELETE removes one sign-up by id, from the body or the query', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await del({ id: 'v-mei.lin@example.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const call = fetch.calls.find((c) => c.options.method === 'DELETE');
    assert.equal(
      call.url,
      'https://db.example/rest/v1/event_volunteers?id=eq.v-mei.lin%40example.com',
    );

    const missing = await del({});
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'Volunteer id is required.');

    const viaQuery = await onRequestDelete({
      request: fakeRequest({
        url: 'https://caaci.example/api/admin/event-volunteers?id=v-2',
        headers: { authorization: 'Bearer tok' },
      }),
      env: fakeEnv(),
    });
    assert.equal(viaQuery.status, 200);
    assert.ok(
      fetch.calls.some((c) => c.url.endsWith('event_volunteers?id=eq.v-2')),
      'the query string works when there is no body',
    );
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: a database error is a 500', async () => {
  const fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_volunteers')
      ? { status: 503, body: 'upstream down' }
      : route()(u, o),
  );
  try {
    const r = await get('?scope=all');
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /event_volunteers: 503/);

    const d = await del({ id: 'v-1' });
    assert.equal(d.status, 500);
    assert.match((await d.json()).error, /event_volunteers: 503/);
  } finally {
    fetch.restore();
  }
});
