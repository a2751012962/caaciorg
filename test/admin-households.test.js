import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut } from '../functions/api/admin/households.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const DAY = 86_400_000;
const past = new Date(Date.now() - DAY).toISOString();
const future = new Date(Date.now() + 7 * DAY).toISOString();

// What the always-on query returns: families with their accounts and people.
const MAIN = [
  {
    id: 'h1',
    name: 'Lin family',
    status: 'active',
    tier_id: 'family',
    founder_member_id: 'a1',
    accounts: [
      { id: 'a1', full_name: 'Mei Lin', email: 'mei@x.com', status: 'active', tier_id: 'family' },
      { id: 'a2', full_name: 'Jun Lin', email: 'jun@x.com', status: 'active', tier_id: 'family' },
    ],
    people: [
      { id: 'p-a2', household_id: 'h1', member_id: 'a2', full_name: 'Jun Lin' },
      { id: 'p1', household_id: 'h1', member_id: null, full_name: 'Kai Lin' },
    ],
  },
  { id: 'h2', name: 'Empty family', status: 'active', tier_id: null, accounts: [], people: [] },
];

// What the invitations/activity query returns (needs migration 0017).
const EXTRAS = [
  {
    id: 'h1',
    founder: { id: 'a1', full_name: 'Mei Lin', email: 'mei@x.com' },
    invites: [
      // a new person: takes a seat
      {
        id: 'i-new',
        email: 'ann@x.com',
        full_name: 'Ann',
        relationship: 'parent',
        created_at: past,
        expires_at: future,
        person_id: null,
      },
      // for name-only Kai, still in the family: rides on Kai's seat
      {
        id: 'i-rides',
        email: 'kai@x.com',
        full_name: 'Kai Lin',
        relationship: 'child',
        created_at: past,
        expires_at: future,
        person_id: 'p1',
      },
      // for a person who has since been removed: takes a seat of its own
      {
        id: 'i-gone',
        email: 'bo@x.com',
        full_name: 'Bo',
        relationship: 'other',
        created_at: past,
        expires_at: future,
        person_id: 'p-deleted',
      },
      // still "pending" but past its expiry: neither listed nor counted
      {
        id: 'i-stale',
        email: 'old@x.com',
        full_name: null,
        relationship: null,
        created_at: past,
        expires_at: past,
        person_id: null,
      },
    ],
    events: [
      {
        type: 'invite_sent',
        subject_email: 'ann@x.com',
        subject_name: null,
        created_at: past,
        actor: { email: 'mei@x.com' },
      },
      {
        type: 'person_added',
        subject_email: null,
        subject_name: 'Kai Lin',
        created_at: past,
        actor: null,
      },
    ],
  },
  { id: 'h2', founder: null, invites: [], events: [] },
];

// Family-plan members with no family yet.
const PLAN_MEMBERS = [
  {
    id: 'f1',
    full_name: 'Zheng Liu',
    email: 'zg@x.com',
    status: 'active',
    member_since: past,
    expires_at: future,
  },
];

function route({
  extras = () => ({ body: EXTRAS }),
  planMembers = () => ({ body: PLAN_MEMBERS }),
} = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/members') && u.includes('tier_id=eq.family')) return planMembers();
    if (u.includes('/rest/v1/households') && decodeURIComponent(u).includes('accounts:'))
      return { body: MAIN };
    if (u.includes('/rest/v1/households')) return extras();
    return { body: [] };
  };
}

const get = () =>
  onRequestGet({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/households',
      headers: { authorization: 'Bearer tok' },
    }),
    env: fakeEnv(),
  });

const householdUrls = (fetch) =>
  fetch.calls
    .filter((c) => c.url.includes('/rest/v1/households'))
    .map((c) => decodeURIComponent(c.url));

test('admin households: every members embed names its foreign key, and invitations are a separate query', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get();
    assert.equal(r.status, 200);
    const urls = householdUrls(fetch);
    for (const u of urls) assert.doesNotMatch(u, /[=,(:]members\(/, 'no unhinted members embed');

    const main = urls.find((u) => u.includes('accounts:'));
    assert.match(
      main,
      // expires_at rides along so each account's status reads as of today.
      /accounts:members!members_household_id_fkey\(id,full_name,email,status,tier_id,expires_at\)/,
    );
    assert.match(main, /people:household_members\(\*\)/);
    // The accounts query must load before 0017 too: nothing from 0017 in it.
    assert.doesNotMatch(main, /founder|household_invites|household_events/);

    const extra = urls.find((u) => u.includes('founder:'));
    assert.ok(extra, 'invitations/activity requested');
    assert.match(extra, /founder:members!households_founder_member_id_fkey\(id,full_name,email\)/);
    assert.match(
      extra,
      /invites:household_invites\(id,email,full_name,relationship,created_at,expires_at,person_id\)/,
    );
    assert.match(
      extra,
      /events:household_events\([^)]*actor:members!household_events_actor_member_id_fkey\(email\)/,
    );
    assert.match(extra, /[?&]invites\.status=eq\.pending(&|$)/);
    assert.match(extra, /[?&]events\.order=created_at\.desc(&|$)/);
    assert.match(extra, /[?&]events\.limit=20(&|$)/);
  } finally {
    fetch.restore();
  }
});

test('admin households: each family gets its founder, live invitations, latest activity and seats in use', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get()).json();
    assert.equal(data.invites_available, true);
    const [h1, h2] = data.rows;

    assert.equal(h1.accounts.length, 2);
    assert.equal(h1.people.length, 2);
    assert.deepEqual(h1.founder, { id: 'a1', full_name: 'Mei Lin', email: 'mei@x.com' });
    assert.deepEqual(
      h1.invites.map((i) => i.id),
      ['i-new', 'i-rides', 'i-gone'],
      'expired invitations are dropped',
    );
    assert.deepEqual(h1.invites[0], EXTRAS[0].invites[0]);
    assert.deepEqual(h1.events, [
      {
        type: 'invite_sent',
        actor_email: 'mei@x.com',
        subject_email: 'ann@x.com',
        subject_name: null,
        created_at: past,
      },
      {
        type: 'person_added',
        actor_email: null,
        subject_email: null,
        subject_name: 'Kai Lin',
        created_at: past,
      },
    ]);
    // 2 accounts + name-only Kai + Ann's invite + Bo's invite (his person row is gone);
    // Kai's own invite rides on Kai's seat and the expired one counts for nothing.
    assert.equal(h1.seats_used, 5);
    assert.equal(h1.seats_limit, 3);

    assert.equal(h2.founder, null);
    assert.deepEqual(h2.invites, []);
    assert.deepEqual(h2.events, []);
    assert.equal(h2.seats_used, 0);
  } finally {
    fetch.restore();
  }
});

test('admin households: families still load when the invitation tables are missing', async () => {
  const fetch = mockFetch(
    route({
      extras: () => ({
        status: 400,
        body: {
          code: 'PGRST200',
          message: "Could not find a relationship between 'households' and 'household_invites'",
        },
      }),
    }),
  );
  try {
    const r = await get();
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.invites_available, false);
    const [h1] = data.rows;
    assert.equal(h1.accounts.length, 2);
    assert.equal(h1.people.length, 2);
    assert.equal(h1.founder, null);
    assert.deepEqual(h1.invites, []);
    assert.deepEqual(h1.events, []);
    assert.equal(h1.seats_used, 3, '2 accounts + name-only Kai');
  } finally {
    fetch.restore();
  }
});

test('admin households: lists family-plan members who have no family yet', async () => {
  const fetch = mockFetch(route());
  try {
    const data = await (await get()).json();
    assert.deepEqual(data.family_plan_members, PLAN_MEMBERS);
    const url = fetch.calls
      .map((c) => decodeURIComponent(c.url))
      .find((u) => u.includes('/rest/v1/members') && u.includes('tier_id='));
    assert.match(url, /select=id,full_name,email,status,member_since,expires_at(&|$)/);
    assert.match(url, /[?&]tier_id=eq\.family(&|$)/);
    assert.match(url, /[?&]household_id=is\.null(&|$)/);
  } finally {
    fetch.restore();
  }
});

test('admin households: families still load when the family-plan members query fails', async () => {
  const fetch = mockFetch(route({ planMembers: () => ({ status: 500, body: 'boom' }) }));
  try {
    const r = await get();
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.family_plan_members, null);
    assert.equal(data.rows.length, 2);
  } finally {
    fetch.restore();
  }
});

// ---------- PUT { founder_member_id }: start a family for a family-plan member ----------
const PLAN_MEMBER = {
  id: 'f1',
  full_name: 'Zheng Liu',
  email: 'zg@x.com',
  tier_id: 'family',
  household_id: null,
};

function createRoute({
  member = PLAN_MEMBER,
  rpc = () => ({ body: { ok: true, household_id: 'h9' } }),
} = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    if (u.includes('/rest/v1/rpc/family_create_household')) return rpc();
    return { body: [] };
  };
}

const put = (body) =>
  onRequestPut({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/households',
      headers: { authorization: 'Bearer tok' },
      body,
    }),
    env: fakeEnv(),
  });

const rpcCalls = (fetch) =>
  fetch.calls.filter((c) => c.url.includes('/rpc/family_create_household'));
const householdInserts = (fetch) =>
  fetch.calls.filter((c) => c.url.includes('/rest/v1/households') && c.options.method === 'POST');

test('admin households: a family-plan member gets a family through family_create_household, as its founder', async () => {
  const fetch = mockFetch(createRoute());
  try {
    const r = await put({ founder_member_id: 'f1' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, household_id: 'h9' });
    const [call] = rpcCalls(fetch);
    assert.deepEqual(JSON.parse(call.options.body), {
      p_founder: 'f1',
      p_name: "zg@x.com's family",
      p_full_name: 'Zheng Liu',
      p_email: 'zg@x.com',
    });
    const lookup = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/members') && c.url.includes('id=eq.f1'),
    );
    assert.ok(lookup, 'member looked up by id');
    assert.equal(householdInserts(fetch).length, 0, 'no plain households insert');
  } finally {
    fetch.restore();
  }
});

test('admin households: creating a family for a member is refused when it cannot apply', async () => {
  const cases = [
    { name: 'no id', body: { founder_member_id: '' }, status: 400 },
    { name: 'unknown member', route: { member: null }, status: 404 },
    {
      name: 'already in a family',
      route: { member: { ...PLAN_MEMBER, household_id: 'h1' } },
      status: 409,
      error: 'That member is already in a family.',
    },
    {
      name: 'not on the family plan',
      route: { member: { ...PLAN_MEMBER, tier_id: 'individual' } },
      status: 400,
      error: 'That member is not on the family plan.',
    },
  ];
  for (const c of cases) {
    const fetch = mockFetch(createRoute(c.route));
    try {
      const r = await put(c.body || { founder_member_id: 'f1' });
      assert.equal(r.status, c.status, c.name);
      if (c.error) assert.equal((await r.json()).error, c.error, c.name);
      assert.equal(rpcCalls(fetch).length, 0, `${c.name}: no rpc`);
      assert.equal(householdInserts(fetch).length, 0, `${c.name}: no insert`);
    } finally {
      fetch.restore();
    }
  }
});

test('admin households: a refusal from family_create_household maps to a readable error', async () => {
  const fetch = mockFetch(
    createRoute({ rpc: () => ({ body: { ok: false, reason: 'already_in_household' } }) }),
  );
  try {
    const r = await put({ founder_member_id: 'f1' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'That member is already in a family.');
  } finally {
    fetch.restore();
  }
});

test('admin households: a failing family_create_household call is a 500', async () => {
  const fetch = mockFetch(createRoute({ rpc: () => ({ status: 404, body: 'no such function' }) }));
  try {
    const r = await put({ founder_member_id: 'f1' });
    assert.equal(r.status, 500);
  } finally {
    fetch.restore();
  }
});

test('admin households: a failing families query is still an error', async () => {
  const fetch = mockFetch((u) => {
    if (u.includes('/rest/v1/households') && decodeURIComponent(u).includes('accounts:'))
      return { status: 500, body: 'boom' };
    return route()(u);
  });
  try {
    const r = await get();
    assert.equal(r.status, 500);
  } finally {
    fetch.restore();
  }
});
