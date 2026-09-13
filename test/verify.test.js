import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/verify.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const url = (m) => `https://caaci.example/api/verify?m=${m}`;

function route(member) {
  return (u) => {
    // membership_tiers first — "/rest/v1/members" is a substring of it.
    if (u.includes('membership_tiers')) return { body: [{ name: 'Family Membership' }] };
    if (u.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    return {};
  };
}

test('verify: active unexpired member renders the green VALID page', async () => {
  const fetch = mockFetch(
    route({
      full_name: 'Mei Lin',
      tier_id: 'family',
      status: 'active',
      expires_at: '2999-01-01T00:00:00Z',
    }),
  );
  try {
    const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    assert.match(html, /VALID MEMBER/);
    assert.match(html, /Mei Lin/);
    assert.match(html, /Family Membership/);
  } finally {
    fetch.restore();
  }
});

test('verify: expired or cancelled membership renders NOT VALID', async () => {
  for (const member of [
    {
      full_name: 'Old Guy',
      tier_id: 'family',
      status: 'active',
      expires_at: '2020-01-01T00:00:00Z',
    },
    { full_name: 'Quit Guy', tier_id: 'family', status: 'cancelled', expires_at: null },
    null, // no such member
  ]) {
    const fetch = mockFetch(route(member));
    try {
      const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
      const html = await r.text();
      assert.match(html, /NOT VALID/);
      assert.doesNotMatch(html, /Old Guy|Quit Guy/, 'no name leaked for invalid members');
    } finally {
      fetch.restore();
    }
  }
});

// A joined family member has no plan of their own: the card stands for the
// family plan, i.e. the founder's members row, or the households row for a
// legacy admin-made family with no founder.
const FOUNDER = '99999999-2222-3333-4444-555555555555';
const HOUSE = '88888888-2222-3333-4444-555555555555';
const FAMILY_UNTIL = '2999-06-30T12:00:00Z';
const joined = (extra = {}) => ({
  id: UUID,
  full_name: 'Kid Lin',
  tier_id: null,
  status: 'pending',
  expires_at: null,
  household_id: HOUSE,
  ...extra,
});
const founderRow = (extra = {}) => ({
  id: FOUNDER,
  full_name: 'Mei Lin',
  tier_id: 'family',
  status: 'active',
  expires_at: FAMILY_UNTIL,
  household_id: HOUSE,
  ...extra,
});
const house = (extra = {}) => ({
  id: HOUSE,
  status: 'active',
  tier_id: 'family',
  expires_at: null,
  founder_member_id: FOUNDER,
  ...extra,
});

// Rows are served by table and id, so the family lookups are really exercised.
function familyRoute({ member, founder = null, household = null }) {
  const names = { family: 'Family Membership', individual: 'Individual Membership' };
  return (u) => {
    const url = new URL(u);
    const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
    if (url.pathname.endsWith('/membership_tiers')) return { body: [{ name: names[id] || id }] };
    if (url.pathname.endsWith('/households'))
      return { body: household && household.id === id ? [household] : [] };
    if (url.pathname.endsWith('/members'))
      return { body: [member, founder].filter((r) => r && r.id === id) };
    return {};
  };
}

async function verifyPage(rows) {
  const fetch = mockFetch(familyRoute(rows));
  try {
    const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
    return await r.text();
  } finally {
    fetch.restore();
  }
}

test('verify: a joined family member is valid on the active family plan, with its tier and expiry', async () => {
  const html = await verifyPage({ member: joined(), founder: founderRow(), household: house() });
  assert.match(html, /VALID MEMBER/);
  assert.doesNotMatch(html, /NOT VALID/);
  assert.match(html, /Kid Lin/);
  assert.match(html, /Family Membership/);
  assert.ok(html.includes(new Date(FAMILY_UNTIL).toLocaleDateString('en-US')), 'family expiry');
});

test('verify: a joined family member is not valid when the family plan is not', async () => {
  const cases = {
    'founder expired': { founder: founderRow({ expires_at: '2020-01-01T00:00:00Z' }) },
    'founder past due': { founder: founderRow({ status: 'past_due' }) },
    'founder off the family tier': { founder: founderRow({ tier_id: 'individual' }) },
    'founder row gone': { founder: null },
    'family dissolved': { household: house({ status: 'cancelled' }) },
    'no such family': { household: null },
  };
  for (const [what, rows] of Object.entries(cases)) {
    const html = await verifyPage({
      member: joined(),
      founder: founderRow(),
      household: house(),
      ...rows,
    });
    assert.match(html, /NOT VALID/, what);
    assert.doesNotMatch(html, /Kid Lin/, what);
  }
});

test('verify: a legacy family with no founder uses the household plan', async () => {
  const legacy = { founder_member_id: null, expires_at: FAMILY_UNTIL };
  const ok = await verifyPage({ member: joined(), household: house(legacy) });
  assert.match(ok, /VALID MEMBER/);
  assert.doesNotMatch(ok, /NOT VALID/);
  assert.match(ok, /Family Membership/);
  const lapsed = await verifyPage({
    member: joined(),
    household: house({ ...legacy, expires_at: '2020-01-01T00:00:00Z' }),
  });
  assert.match(lapsed, /NOT VALID/);
});

test('verify: a member with no plan and no family is still not valid', async () => {
  assert.match(await verifyPage({ member: joined({ household_id: null }) }), /NOT VALID/);
  assert.match(await verifyPage({ member: null }), /NOT VALID/);
});

// This code deploys before 0017 is applied, so the family lookup can fail with a
// PostgREST error (42703 on a column the migration adds). The member's own plan
// then decides, and a failed lookup is never reported VALID.
const MISSING_COLUMN = {
  status: 400,
  body: {
    code: '42703',
    details: null,
    hint: null,
    message: 'column households.founder_member_id does not exist',
  },
};

test('verify: before 0017, a failing family lookup leaves the member’s own plan in charge', async () => {
  const cases = [
    [
      'own active plan',
      joined({ tier_id: 'individual', status: 'active', expires_at: FAMILY_UNTIL }),
      true,
    ],
    ['family plan only', joined(), false],
  ];
  for (const [what, member, valid] of cases) {
    const fetch = mockFetch((u) => {
      const path = new URL(u).pathname;
      if (path.endsWith('/membership_tiers')) return { body: [{ name: 'Individual Membership' }] };
      if (path.endsWith('/households')) return MISSING_COLUMN;
      if (path.endsWith('/members')) return { body: [member] };
      return {};
    });
    try {
      const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
      assert.equal(r.status, 200, what);
      const html = await r.text();
      if (valid) {
        assert.match(html, /VALID MEMBER/, what);
        assert.doesNotMatch(html, /NOT VALID/, what);
      } else {
        assert.match(html, /NOT VALID/, what);
        assert.ok(
          fetch.calls.some((c) => c.url.includes('/rest/v1/households')),
          'the failing family lookup was really reached',
        );
      }
    } finally {
      fetch.restore();
    }
  }
});

test('verify: a malformed id never hits the database', async () => {
  const fetch = mockFetch(route(null));
  try {
    const r = await onRequestGet({
      request: fakeRequest({ url: url('not-a-uuid') }),
      env: fakeEnv(),
    });
    assert.match(await r.text(), /NOT VALID/);
    assert.equal(fetch.calls.length, 0, 'no DB query for junk input');
  } finally {
    fetch.restore();
  }
});
