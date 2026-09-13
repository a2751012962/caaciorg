import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/admin/event-registrations.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const EV = '11111111-1111-4111-8111-111111111111'; // perk_deadline set
const EV_NO_PERK = '22222222-2222-4222-8222-222222222222'; // perk_deadline null → starts_at
const DEADLINE = '2026-09-21T04:59:59+00:00';
const STARTS = '2026-09-27T19:00:00+00:00';

const EVENTS = {
  [EV]: { id: EV, title: 'Mid-Autumn Festival', starts_at: STARTS, perk_deadline: DEADLINE },
  [EV_NO_PERK]: { id: EV_NO_PERK, title: 'Picnic', starts_at: STARTS, perk_deadline: null },
};

const BEFORE = '2026-09-10T12:00:00+00:00';
const AFTER = '2026-09-22T12:00:00+00:00';

// PostgREST returns members oldest first (the handler asks for created_at.asc).
const MEMBERS = [
  {
    id: 'm-mei',
    email: 'Mei.Lin@Example.com',
    created_at: BEFORE,
    status: 'active',
    tier_id: 'free',
  },
  { id: 'm-jun', email: 'jun@example.com', created_at: BEFORE, status: 'pending', tier_id: null },
  { id: 'm-late', email: 'late@example.com', created_at: AFTER, status: 'active', tier_id: 'free' },
  {
    id: 'm-edge',
    email: 'edge@example.com',
    created_at: DEADLINE,
    status: 'active',
    tier_id: 'free',
  },
];

const reg = (over) => ({
  id: over.email,
  attending: true,
  attendee_names: 'Someone',
  heard_from: 'Website',
  wants_meal: null,
  created_at: BEFORE,
  updated_at: BEFORE,
  member_id: null,
  ...over,
});

// Ordered by created_at, as the query asks the database to.
const REGS = [
  // matched by case-insensitive email; account + registration before deadline
  reg({ email: 'mei.lin@example.com', wants_meal: true }),
  // member_id wins over the email, which belongs to someone else's account
  reg({ email: 'late@example.com', member_id: 'm-jun', attending: false, attendee_names: null }),
  // registered and account created EXACTLY at the deadline → counts
  reg({ email: 'edge@example.com', created_at: DEADLINE, wants_meal: false }),
  // account created after the deadline
  reg({ email: 'late2@example.com', member_id: 'm-late', created_at: DEADLINE }),
  // no account at all; a stale member_id falls back to the (unknown) email
  reg({
    email: 'nobody@example.com',
    member_id: 'm-gone',
    created_at: '2026-09-21T05:00:00+00:00',
  }),
  // registered after the deadline, account is fine
  reg({ email: 'jun@example.com', created_at: AFTER }),
];

function route({ admin = true, regs = REGS } = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/events')) {
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)?.[1] || '');
      return { body: EVENTS[id] ? [EVENTS[id]] : [] };
    }
    if (u.includes('/rest/v1/event_registrations')) return { body: regs };
    if (u.includes('/rest/v1/members')) return { body: MEMBERS };
    return { body: [] };
  };
}

const get = (query, headers = { authorization: 'Bearer tok' }) =>
  onRequestGet({
    request: fakeRequest({
      url: `https://caaci.example/api/admin/event-registrations${query}`,
      headers,
    }),
    env: fakeEnv(),
  });

test('admin registrations: 401 without a token, 403 for a non-admin', async () => {
  let fetch = mockFetch(route());
  try {
    const anon = await get(`?event_id=${EV}`, {});
    assert.equal(anon.status, 401);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ admin: false }));
  try {
    const member = await get(`?event_id=${EV}`);
    assert.equal(member.status, 403);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/event_registrations')),
      false,
      'no registration data is read for a non-admin',
    );
  } finally {
    fetch.restore();
  }
});

test('admin registrations: event_id required; unknown or malformed event is 404', async () => {
  const fetch = mockFetch(route());
  try {
    const missing = await get('');
    assert.equal(missing.status, 400);

    const unknown = await get('?event_id=33333333-3333-4333-8333-333333333333');
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'Event not found.');

    const calls = fetch.calls.length;
    const malformed = await get('?event_id=not-a-uuid');
    assert.equal(malformed.status, 404);
    assert.equal(
      fetch.calls.slice(calls).some((c) => c.url.includes('/rest/v1/events')),
      false,
      'a malformed id never reaches PostgREST',
    );
  } finally {
    fetch.restore();
  }
});

test('admin registrations: matches accounts and applies the eligibility rule', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 200);
    const data = await r.json();

    assert.deepEqual(data.event, {
      id: EV,
      title: 'Mid-Autumn Festival',
      starts_at: STARTS,
      perk_deadline: DEADLINE,
      deadline: DEADLINE,
    });

    const by = Object.fromEntries(data.rows.map((x) => [x.email, x]));
    // case-insensitive email match against a mixed-case members.email
    assert.equal(by['mei.lin@example.com'].account.id, 'm-mei');
    assert.deepEqual(by['mei.lin@example.com'].account, {
      id: 'm-mei',
      created_at: BEFORE,
      status: 'active',
      tier_id: 'free',
    });
    assert.equal(by['mei.lin@example.com'].perk_eligible, true);
    // member_id first, even though the email belongs to m-late
    assert.equal(by['late@example.com'].account.id, 'm-jun');
    assert.equal(by['late@example.com'].perk_eligible, true);
    // exactly at the deadline (both timestamps) is inclusive
    assert.equal(by['edge@example.com'].account.id, 'm-edge');
    assert.equal(by['edge@example.com'].perk_eligible, true);
    // account created after the deadline
    assert.equal(by['late2@example.com'].account.id, 'm-late');
    assert.equal(by['late2@example.com'].perk_eligible, false);
    // no account (stale member_id, unknown email); also registered 1s late
    assert.equal(by['nobody@example.com'].account, null);
    assert.equal(by['nobody@example.com'].perk_eligible, false);
    // registered after the deadline, account before it
    assert.equal(by['jun@example.com'].account.id, 'm-jun');
    assert.equal(by['jun@example.com'].perk_eligible, false);

    // The row shape the admin panel and CSV rely on.
    assert.deepEqual(Object.keys(data.rows[0]).sort(), [
      'account',
      'attendee_names',
      'attending',
      'created_at',
      'email',
      'heard_from',
      'id',
      'member_id',
      'perk_eligible',
      'updated_at',
      'wants_meal',
    ]);

    assert.deepEqual(data.summary, {
      total: 6,
      attending: 5,
      not_attending: 1,
      meal: 1,
      with_account: 5,
      perk_eligible: 3,
    });
  } finally {
    fetch.restore();
  }
});

test('admin registrations: a null perk_deadline falls back to the event start', async () => {
  const onlyAfterDeadline = [
    reg({ email: 'mei.lin@example.com', created_at: AFTER }), // after the 21st, before the 27th
    reg({ email: 'jun@example.com', created_at: '2026-09-27T19:00:01+00:00' }), // 1s after start
  ];
  const fetch = mockFetch(route({ regs: onlyAfterDeadline }));
  try {
    const data = await (await get(`?event_id=${EV_NO_PERK}`)).json();
    assert.equal(data.event.perk_deadline, null);
    assert.equal(data.event.deadline, STARTS);
    assert.deepEqual(
      data.rows.map((x) => [x.email, x.perk_eligible]),
      [
        ['mei.lin@example.com', true],
        ['jun@example.com', false],
      ],
    );
    assert.equal(data.summary.perk_eligible, 1);
  } finally {
    fetch.restore();
  }
});

test('admin registrations: asks for this event, oldest first, and keeps that order', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get(`?event_id=${EV}`)).json();
    const q = fetch.calls.find((c) => c.url.includes('/rest/v1/event_registrations')).url;
    assert.ok(q.includes(`event_id=eq.${EV}`));
    assert.ok(q.includes('order=created_at.asc'));
    assert.ok(q.includes('limit=2000'));
    const m = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/members') && !c.url.includes('is_admin'),
    ).url;
    assert.ok(m.includes('select=id,email,created_at,status,tier_id'));
    assert.ok(m.includes('limit=5000'));
    assert.deepEqual(
      data.rows.map((x) => x.email),
      REGS.map((x) => x.email),
    );
  } finally {
    fetch.restore();
  }
});

test('admin registrations: a database error is a 500', async () => {
  const fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_registrations')
      ? { status: 503, body: 'upstream down' }
      : route()(u, o),
  );
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /event_registrations: 503/);
  } finally {
    fetch.restore();
  }
});
