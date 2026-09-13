import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/admin/event-registrations.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const EV = '11111111-1111-4111-8111-111111111111'; // perk_deadline set
const EV_NO_DEADLINE = '22222222-2222-4222-8222-222222222222'; // perk_deadline null → starts_at
const EV_NO_GIFT = '44444444-4444-4444-8444-444444444444'; // no gift names
const EV_CLOSED = '55555555-5555-4555-8555-555555555555'; // registration_questions null
const DEADLINE = '2026-09-21T04:59:59+00:00';
const STARTS = '2026-09-27T19:00:00+00:00';

const QUESTIONS = [
  {
    id: 'attending',
    type: 'single',
    label_en: 'Can you attend?',
    label_zh: '您能参加吗？',
    required: true,
    options: [
      { id: 'yes', label_en: "Yes, I'll be there", label_zh: '能，我会参加' },
      { id: 'no', label_en: "Sorry, can't make it", label_zh: '抱歉，无法参加' },
    ],
    other: false,
  },
  {
    id: 'names',
    type: 'textarea',
    label_en: 'Names',
    label_zh: '姓名',
    required: true,
  },
  {
    id: 'heard_from',
    type: 'single',
    label_en: 'How did you hear?',
    label_zh: '您是从哪里得知的？',
    required: false,
    options: [
      { id: 'website', label_en: 'Website', label_zh: '网站' },
      { id: 'friend', label_en: 'Friend', label_zh: '朋友' },
    ],
    other: true,
  },
  {
    id: 'food',
    type: 'multi',
    label_en: 'Food',
    label_zh: '食物',
    required: false,
    options: [
      { id: 'dumplings', label_en: 'Dumplings', label_zh: '饺子' },
      { id: 'tea', label_en: 'Tea', label_zh: '茶' },
    ],
    other: true,
  },
];

const GIFT = { perk_item_zh: '月饼', perk_item_en: 'mooncake' };
const EVENTS = {
  [EV]: {
    id: EV,
    slug: 'mid-autumn-festival',
    title: 'Mid-Autumn Festival',
    title_zh: '中秋节',
    starts_at: STARTS,
    perk_deadline: DEADLINE,
    ...GIFT,
    registration_questions: QUESTIONS,
  },
  [EV_NO_DEADLINE]: {
    id: EV_NO_DEADLINE,
    slug: 'picnic',
    title: 'Picnic',
    title_zh: null,
    starts_at: STARTS,
    perk_deadline: null,
    ...GIFT,
    registration_questions: QUESTIONS,
  },
  [EV_NO_GIFT]: {
    id: EV_NO_GIFT,
    slug: 'talk',
    title: 'Talk',
    title_zh: null,
    starts_at: STARTS,
    perk_deadline: DEADLINE,
    perk_item_zh: null,
    perk_item_en: null,
    registration_questions: QUESTIONS,
  },
  [EV_CLOSED]: {
    id: EV_CLOSED,
    slug: 'closed',
    title: 'Closed',
    title_zh: null,
    starts_at: STARTS,
    perk_deadline: DEADLINE,
    ...GIFT,
    registration_questions: null,
  },
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
  {
    id: 'm-unconf',
    email: 'unconfirmed@example.com',
    created_at: BEFORE,
    status: 'pending',
    tier_id: null,
  },
  { id: 'm-late', email: 'late@example.com', created_at: AFTER, status: 'active', tier_id: 'free' },
  {
    id: 'm-edge',
    email: 'edge@example.com',
    created_at: DEADLINE,
    status: 'active',
    tier_id: 'free',
  },
];

// GoTrue /auth/v1/admin/users. m-unconf signed up (the trigger made its members
// row) but never confirmed the email.
const AUTH_USERS = [
  { id: 'admin-1', email_confirmed_at: BEFORE },
  { id: 'm-mei', email_confirmed_at: BEFORE },
  { id: 'm-jun', email_confirmed_at: null, confirmed_at: BEFORE }, // only confirmed_at set
  { id: 'm-unconf', email_confirmed_at: null, confirmed_at: null },
  { id: 'm-late', email_confirmed_at: AFTER },
  { id: 'm-edge', email_confirmed_at: DEADLINE },
];

const reg = (over) => ({
  id: over.email,
  answers: { attending: { option: 'yes' }, names: 'Someone', heard_from: { option: 'website' } },
  created_at: BEFORE,
  updated_at: BEFORE,
  member_id: null,
  ...over,
});

// Ordered by created_at, as the query asks the database to.
const REGS = [
  // matched by case-insensitive email; account + registration before deadline
  reg({ email: 'mei.lin@example.com' }),
  // member_id wins over the email, which belongs to someone else's account
  reg({
    email: 'late@example.com',
    member_id: 'm-jun',
    answers: { attending: { option: 'no' }, names: 'Jun', food: { options: ['tea'] } },
  }),
  // account made in time but never confirmed → shown, not counted
  reg({
    email: 'unconfirmed@example.com',
    answers: {
      attending: { option: 'yes' },
      names: 'U',
      heard_from: { other: 'a poster' },
      food: { options: ['dumplings', 'tea'], other: '' },
    },
  }),
  // registered and account created EXACTLY at the deadline → counts
  reg({ email: 'edge@example.com', created_at: DEADLINE }),
  // account created after the deadline
  reg({ email: 'late2@example.com', member_id: 'm-late', created_at: DEADLINE }),
  // no account at all; a stale member_id falls back to the (unknown) email
  reg({
    email: 'nobody@example.com',
    member_id: 'm-gone',
    created_at: '2026-09-21T05:00:00+00:00',
    answers: { attending: { option: 'yes' }, heard_from: { option: 'removed-option' } },
  }),
  // registered after the deadline, account is fine; a legacy row never backfilled
  reg({ email: 'jun@example.com', created_at: AFTER, answers: {} }),
];

function route({ admin = true, regs = REGS, authPages = [AUTH_USERS], events = EVENTS } = {}) {
  return (u) => {
    if (u.includes('/auth/v1/admin/users')) {
      const page = Number(new URL(u).searchParams.get('page'));
      return { body: { users: authPages[page - 1] || [] } };
    }
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/events')) {
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)?.[1] || '');
      return { body: events[id] ? [events[id]] : [] };
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

const authCalls = (fetch) => fetch.calls.filter((c) => c.url.includes('/auth/v1/admin/users'));

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
    assert.equal(authCalls(fetch).length, 0, 'no auth user list for a non-admin');
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
      slug: 'mid-autumn-festival',
      title: 'Mid-Autumn Festival',
      title_zh: '中秋节',
      starts_at: STARTS,
      perk: { item_en: 'mooncake', item_zh: '月饼', deadline: DEADLINE },
    });
    assert.deepEqual(data.questions, QUESTIONS);

    const by = Object.fromEntries(data.rows.map((x) => [x.email, x]));
    // case-insensitive email match against a mixed-case members.email
    assert.deepEqual(by['mei.lin@example.com'].account, {
      id: 'm-mei',
      created_at: BEFORE,
      status: 'active',
      tier_id: 'free',
      confirmed: true,
    });
    assert.equal(by['mei.lin@example.com'].perk_eligible, true);
    // member_id first, even though the email belongs to m-late; confirmed_at counts
    assert.equal(by['late@example.com'].account.id, 'm-jun');
    assert.equal(by['late@example.com'].account.confirmed, true);
    assert.equal(by['late@example.com'].perk_eligible, true);
    // an unconfirmed signup is listed, but it isn't an account for the gift
    assert.deepEqual(by['unconfirmed@example.com'].account, {
      id: 'm-unconf',
      created_at: BEFORE,
      status: 'pending',
      tier_id: null,
      confirmed: false,
    });
    assert.equal(by['unconfirmed@example.com'].perk_eligible, false);
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

    // The row shape the admin panel and CSV rely on: answers as stored.
    assert.deepEqual(Object.keys(data.rows[0]).sort(), [
      'account',
      'answers',
      'created_at',
      'email',
      'id',
      'member_id',
      'perk_eligible',
      'updated_at',
    ]);
    assert.deepEqual(by['unconfirmed@example.com'].answers, REGS[2].answers);

    // with_account counts confirmed accounts only (not the unconfirmed signup).
    assert.deepEqual(data.summary, {
      total: 7,
      with_account: 5,
      perk_eligible: 3,
      choices: {
        attending: { yes: 5, no: 1, other: 0 },
        heard_from: { website: 3, friend: 0, other: 1 },
        food: { dumplings: 1, tea: 2, other: 1 },
      },
    });
  } finally {
    fetch.restore();
  }
});

test('admin registrations: choice counts skip text questions, removed options and malformed answers', async () => {
  const regs = [
    reg({ email: 'a@example.com', answers: { attending: { option: 'other' }, names: 'yes' } }),
    reg({ email: 'b@example.com', answers: { attending: 'yes', food: { options: 'tea' } } }),
    reg({ email: 'c@example.com', answers: null }),
    reg({ email: 'd@example.com', answers: { food: { options: ['tea', 'tea', 'gone'] } } }),
    reg({ email: 'e@example.com', answers: { heard_from: { other: 5 } } }),
  ];
  const fetch = mockFetch(route({ regs }));
  try {
    const data = await (await get(`?event_id=${EV}`)).json();
    assert.deepEqual(data.summary.choices, {
      attending: { yes: 0, no: 0, other: 0 },
      heard_from: { website: 0, friend: 0, other: 0 },
      food: { dumplings: 0, tea: 1, other: 0 },
    });
    assert.equal('names' in data.summary.choices, false);
    assert.deepEqual(
      data.rows.find((x) => x.email === 'c@example.com').answers,
      {},
      'a null answers value comes back as {}',
    );
  } finally {
    fetch.restore();
  }
});

test('admin registrations: only a confirmed account makes a registrant eligible', async () => {
  const one = [reg({ email: 'mei.lin@example.com' })];
  const cases = [
    ['email_confirmed_at set', [{ id: 'm-mei', email_confirmed_at: BEFORE }], true],
    [
      'only confirmed_at set',
      [{ id: 'm-mei', email_confirmed_at: null, confirmed_at: BEFORE }],
      true,
    ],
    ['unconfirmed', [{ id: 'm-mei', email_confirmed_at: null, confirmed_at: null }], false],
    ['no auth user at all', [], false],
  ];
  for (const [label, users, confirmed] of cases) {
    const fetch = mockFetch(route({ regs: one, authPages: [users] }));
    try {
      const data = await (await get(`?event_id=${EV}`)).json();
      const [row] = data.rows;
      assert.equal(row.account.id, 'm-mei', `${label}: account still shown`);
      assert.equal(row.account.confirmed, confirmed, `${label}: confirmed`);
      assert.equal(row.perk_eligible, confirmed, `${label}: perk_eligible`);
      assert.equal(data.summary.with_account, confirmed ? 1 : 0, `${label}: with_account`);
      assert.equal(data.summary.perk_eligible, confirmed ? 1 : 0, `${label}: summary`);
    } finally {
      fetch.restore();
    }
  }
});

test('admin registrations: an event with no gift has nobody eligible, accounts still matched', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get(`?event_id=${EV_NO_GIFT}`)).json();
    assert.equal(data.event.perk, null);
    assert.equal(
      data.rows.some((x) => x.perk_eligible),
      false,
    );
    assert.equal(data.summary.perk_eligible, 0);
    assert.equal(data.summary.with_account, 5);
  } finally {
    fetch.restore();
  }
});

test('admin registrations: a form no longer taking registrations still lists them, with no question columns', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get(`?event_id=${EV_CLOSED}`)).json();
    assert.deepEqual(data.questions, []);
    assert.deepEqual(data.summary.choices, {});
    assert.equal(data.rows.length, REGS.length);
  } finally {
    fetch.restore();
  }
  const broken = { ...EVENTS, [EV]: { ...EVENTS[EV], registration_questions: [{ id: 'X' }] } };
  const again = mockFetch(route({ events: broken }));
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(data.questions, [], 'a hand-edited invalid form hides only the columns');
    assert.equal(data.rows.length, REGS.length);
  } finally {
    again.restore();
  }
});

test('admin registrations: pages through auth users with the service-role key', async () => {
  const filler = Array.from({ length: 999 }, (_, i) => ({
    id: `u-${i}`,
    email_confirmed_at: BEFORE,
  }));
  const page1 = [...filler, { id: 'm-mei', email_confirmed_at: BEFORE }]; // full page
  const page2 = [{ id: 'm-jun', email_confirmed_at: BEFORE }]; // short page → last
  const fetch = mockFetch(route({ authPages: [page1, page2] }));
  try {
    const data = await (await get(`?event_id=${EV}`)).json();
    assert.deepEqual(
      authCalls(fetch).map((c) => c.url),
      [
        'https://db.example/auth/v1/admin/users?page=1&per_page=1000',
        'https://db.example/auth/v1/admin/users?page=2&per_page=1000',
      ],
    );
    for (const c of authCalls(fetch)) {
      assert.equal(c.options.headers.apikey, 'service-key');
      assert.equal(c.options.headers.authorization, 'Bearer service-key');
    }
    const by = Object.fromEntries(data.rows.map((x) => [x.email, x]));
    assert.equal(by['mei.lin@example.com'].account.confirmed, true, 'found on page 1');
    assert.equal(by['jun@example.com'].account.confirmed, true, 'found on page 2');
    assert.equal(by['edge@example.com'].account.confirmed, false, 'on neither page');
  } finally {
    fetch.restore();
  }
});

test('admin registrations: stops listing auth users after 20 full pages', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({
    id: `u-${i}`,
    email_confirmed_at: BEFORE,
  }));
  const fetch = mockFetch(route({ authPages: Array(25).fill(full) }));
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 200);
    assert.equal(authCalls(fetch).length, 20);
    assert.match(authCalls(fetch).at(-1).url, /page=20&/);
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
    const data = await (await get(`?event_id=${EV_NO_DEADLINE}`)).json();
    assert.equal(data.event.perk.deadline, STARTS);
    assert.equal(data.event.title_zh, null);
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
    assert.ok(q.includes('select=id,email,answers,created_at,updated_at,member_id&'));
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

test('admin registrations: a failing auth user list is a 500, not "nobody is confirmed"', async () => {
  const fetch = mockFetch((u, o) =>
    u.includes('/auth/v1/admin/users') ? { status: 401, body: 'bad key' } : route()(u, o),
  );
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /auth list users: 401/);
  } finally {
    fetch.restore();
  }
});
