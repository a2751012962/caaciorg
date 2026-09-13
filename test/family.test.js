// /api/family against an in-memory stand-in for PostgREST, GoTrue and Resend.
// The family_* RPCs are faked here with the same counting rule as 0017's SQL
// functions (accounts + name-only people + pending unexpired invitations, the
// accepted invitation left out, an invitation for a name-only person riding on
// that person's seat); the real lock and cap are pinned by
// family-invites-rls.test.js. What these tests pin is the Worker: who may do
// what, which Supabase/Resend calls it makes and in what order, that seat-taking
// inserts only ever happen through the RPCs, and what reaches an inbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/family.js';
import { authAdmin } from '../functions/api/_lib.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F = uid(1); // founder
const M = uid(2); // a joined member
const I = uid(3); // an invitee with an account
const H = uid(100);
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';
const HOSTILE = '<a href="https://evil.example">Verify your bank</a> 请立即汇款';
const EMAIL_ON = { RESEND_API_KEY: 're_test', NOTIFY_FROM: 'CAACI <no-reply@caaciorg.com>' };

// ---------------------------------------------------------------- the fake

function world() {
  return {
    session: { id: F, email: 'founder@x.com' },
    auth: [
      { id: F, email: 'founder@x.com', email_confirmed_at: PAST, user_metadata: {} },
      { id: M, email: 'member@x.com', email_confirmed_at: PAST, user_metadata: {} },
      { id: I, email: 'invitee@x.com', email_confirmed_at: PAST, user_metadata: {} },
    ],
    members: [
      member(F, 'founder@x.com', { tier_id: 'family', household_id: H, full_name: HOSTILE }),
      member(M, 'member@x.com', { household_id: H, full_name: HOSTILE }),
      member(I, 'invitee@x.com', { full_name: HOSTILE }),
    ],
    households: [
      {
        id: H,
        name: HOSTILE,
        status: 'active',
        tier_id: 'family',
        expires_at: null,
        founder_member_id: F,
      },
    ],
    household_members: [
      {
        id: uid(201),
        household_id: H,
        member_id: F,
        full_name: HOSTILE,
        relationship: 'head',
        created_at: '1',
      },
      {
        id: uid(202),
        household_id: H,
        member_id: M,
        full_name: HOSTILE,
        relationship: 'spouse',
        created_at: '2',
      },
    ],
    household_invites: [],
    household_events: [],
    rpc: {},
    responses: {},
    log: [], // ordered GoTrue/Resend/RPC calls
    emails: [],
    seq: 1000,
  };
}

function member(id, email, extra = {}) {
  return {
    id,
    email,
    full_name: null,
    tier_id: 'individual',
    status: 'active',
    expires_at: FUTURE,
    household_id: null,
    ...extra,
  };
}

const invite = (s, extra = {}) => {
  const row = {
    id: uid(++s.seq),
    household_id: H,
    email: 'invitee@x.com',
    full_name: HOSTILE,
    relationship: 'child',
    invited_by: F,
    status: 'pending',
    created_at: new Date().toISOString(),
    expires_at: FUTURE,
    responded_at: null,
    member_id: null,
    person_id: null,
    ...extra,
  };
  s.household_invites.push(row);
  return row;
};

const nameOnlyRow = (s, hid, id) =>
  s.household_members.find((p) => p.id === id && p.household_id === hid && !p.member_id);

const seatsUsed = (s, hid, except) =>
  s.members.filter((m) => m.household_id === hid).length +
  s.household_members.filter((p) => p.household_id === hid && !p.member_id).length +
  s.household_invites.filter(
    (i) =>
      i.household_id === hid &&
      i.status === 'pending' &&
      new Date(i.expires_at) > new Date() &&
      i.id !== except &&
      !nameOnlyRow(s, hid, i.person_id),
  ).length;

// Mirrors the SQL functions in 0017, minus the row lock.
const RPC = {
  family_create_household(s, a) {
    const m = s.members.find((x) => x.id === a.p_founder);
    if (!m) return { ok: false, reason: 'no_member' };
    if (m.household_id) return { ok: false, reason: 'already_in_household' };
    const id = uid(++s.seq);
    s.households.push({
      id,
      name: a.p_name,
      status: 'active',
      tier_id: 'family',
      expires_at: null,
      founder_member_id: m.id,
    });
    m.household_id = id;
    s.household_members.push({
      id: uid(++s.seq),
      household_id: id,
      member_id: m.id,
      full_name: a.p_full_name,
      relationship: 'head',
      email: a.p_email,
    });
    return { ok: true, household_id: id };
  },
  family_create_invite(s, a) {
    const h = s.households.find((x) => x.id === a.p_household && x.status !== 'cancelled');
    if (!h) return { ok: false, reason: 'no_household' };
    const live = s.household_invites.filter(
      (i) => i.household_id === h.id && i.status === 'pending',
    );
    for (const i of live) if (new Date(i.expires_at) <= new Date()) i.status = 'expired';
    if (live.some((i) => i.status === 'pending' && i.email === a.p_email.toLowerCase()))
      return { ok: false, reason: 'duplicate_invite' };
    if (a.p_person_id) {
      if (!nameOnlyRow(s, h.id, a.p_person_id)) return { ok: false, reason: 'person_not_found' };
      if (s.household_invites.some((i) => i.person_id === a.p_person_id && i.status === 'pending'))
        return { ok: false, reason: 'person_already_invited' };
    } else if (seatsUsed(s, h.id) >= 3) return { ok: false, reason: 'family_full' };
    const row = invite(s, {
      household_id: h.id,
      email: a.p_email,
      full_name: a.p_full_name,
      relationship: a.p_relationship,
      invited_by: a.p_invited_by,
      member_id: a.p_member_id,
      person_id: a.p_person_id ?? null,
    });
    return { ok: true, invite: { ...row } };
  },
  family_remove_person(s, a) {
    const h = s.households.find((x) => x.id === a.p_household && x.status !== 'cancelled');
    if (!h) return { ok: false, reason: 'no_household' };
    const row = s.household_members.find((p) => p.id === a.p_person && p.household_id === h.id);
    let mid = row ? row.member_id : null;
    if (!row) {
      const m = s.members.find((x) => x.id === a.p_person && x.household_id === h.id);
      if (!m) return { ok: false, reason: 'person_not_found' };
      mid = m.id;
    }
    if (mid && mid === h.founder_member_id) return { ok: false, reason: 'is_founder' };
    const linked = !!mid && s.members.some((x) => x.id === mid && x.household_id === h.id);
    const others =
      s.members.filter((x) => x.household_id === h.id && x.id !== h.founder_member_id).length +
      s.household_members.filter((p) => p.household_id === h.id && !p.member_id).length;
    if ((!mid || linked) && others <= 1) return { ok: false, reason: 'last_person' };
    if (!mid) {
      const cancelled = s.household_invites.filter(
        (i) => i.person_id === row.id && i.status === 'pending',
      );
      for (const i of cancelled) Object.assign(i, { status: 'cancelled', responded_at: 'now' });
      deletePeople(s, [row]);
      return {
        ok: true,
        kind: 'name_only',
        full_name: row.full_name,
        cancelled: cancelled.map(({ id, email, member_id }) => ({ id, email, member_id })),
      };
    }
    const m = s.members.find((x) => x.id === mid && x.household_id === h.id);
    if (m) m.household_id = null;
    deletePeople(
      s,
      s.household_members.filter((p) => p.member_id === mid && p.household_id === h.id),
    );
    return { ok: true, kind: 'account', member_id: mid, linked };
  },
  family_leave(s, a) {
    const h = s.households.find((x) => x.id === a.p_household && x.status !== 'cancelled');
    if (!h) return { ok: false, reason: 'no_household' };
    const m = s.members.find((x) => x.id === a.p_member && x.household_id === h.id);
    if (!m) return { ok: false, reason: 'not_member' };
    if (m.id === h.founder_member_id) return { ok: false, reason: 'is_founder' };
    m.household_id = null;
    deletePeople(
      s,
      s.household_members.filter((p) => p.member_id === m.id && p.household_id === h.id),
    );
    return { ok: true };
  },
  family_add_person(s, a) {
    const h = s.households.find((x) => x.id === a.p_household && x.status !== 'cancelled');
    if (!h) return { ok: false, reason: 'no_household' };
    if (seatsUsed(s, h.id) >= 3) return { ok: false, reason: 'family_full' };
    const row = {
      id: uid(++s.seq),
      household_id: h.id,
      member_id: null,
      full_name: a.p_full_name,
      relationship: a.p_relationship,
      created_at: '9',
    };
    s.household_members.push(row);
    return { ok: true, person: { ...row } };
  },
  family_accept_invite(s, a) {
    const inv = s.household_invites.find((i) => i.id === a.p_invite);
    if (!inv) return { ok: false, reason: 'not_found' };
    if (inv.email !== a.p_email.toLowerCase()) return { ok: false, reason: 'wrong_email' };
    if (inv.status !== 'pending') return { ok: false, reason: 'not_pending' };
    const m = s.members.find((x) => x.id === a.p_member);
    if (m.household_id) return { ok: false, reason: 'already_in_household' };
    const person = inv.person_id ? nameOnlyRow(s, inv.household_id, inv.person_id) : null;
    if (seatsUsed(s, inv.household_id, inv.id) + (person ? 0 : 1) > 3)
      return { ok: false, reason: 'family_full' };
    m.household_id = inv.household_id;
    if (person) Object.assign(person, { member_id: m.id, email: a.p_email });
    else
      s.household_members.push({
        id: uid(++s.seq),
        household_id: inv.household_id,
        member_id: m.id,
        full_name: inv.full_name || a.p_full_name,
        relationship: inv.relationship,
        email: a.p_email,
        created_at: '9',
      });
    Object.assign(inv, { status: 'accepted', member_id: m.id, responded_at: 'now' });
    return { ok: true, household_id: inv.household_id };
  },
};

const TABLES = [
  'members',
  'households',
  'household_members',
  'household_invites',
  'household_events',
];

function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'offset', 'order'].includes(k)) continue;
    if (v === 'is.null') {
      if (row[k] != null) return false;
    } else if (v.startsWith('eq.')) {
      if (String(row[k]) !== v.slice(3)) return false;
    } else throw new Error(`fake PostgREST does not understand ${k}=${v}`);
  }
  return true;
}

// Deleting a household_members row: household_invites.person_id is ON DELETE SET NULL.
function deletePeople(s, rows) {
  s.household_members = s.household_members.filter((r) => !rows.includes(r));
  for (const inv of s.household_invites)
    if (rows.some((r) => r.id === inv.person_id)) inv.person_id = null;
}

function backend(s) {
  return async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    const path = u.pathname;

    if (u.hostname === 'api.resend.com') {
      s.log.push({ kind: 'resend' });
      s.emails.push(...body);
      return { body: { data: body.map((_, i) => ({ id: `e${i}` })) } };
    }
    if (path === '/auth/v1/user')
      return s.session ? { body: s.session } : { status: 401, body: {} };
    if (path === '/auth/v1/admin/users' && method === 'GET') {
      const f = u.searchParams.get('filter') || '';
      return { body: { users: s.auth.filter((x) => x.email.includes(f)) } };
    }
    if (path.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(path.split('/').pop());
      const user = s.auth.find((x) => x.id === id);
      if (!user) return { status: 404, body: { msg: 'User not found' } };
      if (method === 'PUT') {
        s.log.push({ kind: 'metadata', id, patch: body.user_metadata });
        for (const [k, v] of Object.entries(body.user_metadata)) {
          if (v === null) delete user.user_metadata[k];
          else user.user_metadata[k] = v;
        }
      }
      return { body: user };
    }
    if (path === '/auth/v1/invite' || path === '/auth/v1/otp') {
      const kind = path.endsWith('invite') ? 'invite' : 'otp';
      const call = { kind, redirect_to: u.searchParams.get('redirect_to'), body };
      s.log.push(call);
      const user = s.auth.find((x) => x.email === body.email);
      call.metadata = user ? { ...user.user_metadata } : { ...body.data };
      if (typeof s.responses[kind] === 'function') return s.responses[kind](s, body);
      if (s.responses[kind]) return s.responses[kind];
      if (kind === 'invite' && !user) {
        const created = { id: uid(++s.seq), email: body.email, user_metadata: { ...body.data } };
        s.auth.push(created);
        s.members.push(member(created.id, body.email));
        return { body: created };
      }
      return { body: {} };
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop();
      s.log.push({ kind: 'rpc', fn, args: body });
      const impl = s.rpc[fn] || RPC[fn];
      return { body: impl(s, body) };
    }
    const table = path.replace('/rest/v1/', '');
    if (!TABLES.includes(table)) throw new Error(`unexpected fetch ${method} ${url}`);
    const params = [...u.searchParams.entries()];
    const hit = s[table].filter((r) => matches(r, params));
    if (method === 'POST') {
      s.log.push({ kind: 'insert', table });
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({
        id: uid(++s.seq),
        created_at: new Date().toISOString(),
        ...r,
      }));
      s[table].push(...rows);
      return { body: rows };
    }
    if (method === 'PATCH') {
      s.log.push({ kind: 'write', method, table });
      for (const r of hit) Object.assign(r, body);
      return { body: '' };
    }
    if (method === 'DELETE') {
      s.log.push({ kind: 'write', method, table });
      if (table === 'household_members') deletePeople(s, hit);
      else s[table] = s[table].filter((r) => !hit.includes(r));
      return { body: '' };
    }
    const select = u.searchParams.get('select') || '';
    let rows = hit.map((r) => ({ ...r }));
    if (select.includes('households(')) {
      rows = rows.map((r) => {
        const h = s.households.find((x) => x.id === r.household_id);
        return {
          ...r,
          households: h && {
            name: h.name,
            status: h.status,
            founder_member_id: h.founder_member_id,
          },
        };
      });
    }
    if (select.includes('actor:members')) {
      rows = rows.map((r) => ({
        ...r,
        actor: { email: s.members.find((x) => x.id === r.actor_member_id)?.email ?? null },
      }));
    }
    const limit = Number(u.searchParams.get('limit') || rows.length);
    return { body: rows.slice(0, limit) };
  };
}

// One request against world `s`. Returns { status, body, headers }.
async function call(s, { method = 'POST', body, env = {}, token = 'tok' } = {}) {
  const fetch = mockFetch(backend(s));
  try {
    const request = fakeRequest({
      url: 'https://caaci.example/api/family',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body,
    });
    const handler = method === 'GET' ? onRequestGet : onRequestPost;
    const r = await handler({ request, env: fakeEnv(env) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  } finally {
    fetch.restore();
  }
}
const as = (s, id) => {
  s.session = { id, email: s.auth.find((x) => x.id === id).email };
  return s;
};
const ofKind = (s, kind) => s.log.filter((c) => c.kind === kind);
const eventsOf = (s, type) => s.household_events.filter((e) => e.type === type);
const nameOnly = (s, n = 1, extra = {}) => {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {
      id: uid(++s.seq),
      household_id: H,
      member_id: null,
      full_name: HOSTILE,
      relationship: 'child',
      created_at: '3',
      ...extra,
    };
    s.household_members.push(row);
    rows.push(row);
  }
  return rows;
};
// Founder plus name-only people only: the joined member M is taken out.
const founderWithKids = (n) => {
  const s = world();
  s.members.find((m) => m.id === M).household_id = null;
  s.household_members = s.household_members.filter((p) => p.member_id !== M);
  return { s, kids: nameOnly(s, n) };
};

// ---------------------------------------------------------------- GET

test('family: requires a bearer token', async () => {
  const s = world();
  assert.equal((await call(s, { method: 'GET', token: '' })).status, 401);
  assert.equal((await call(s, { body: { action: 'leave' }, token: '' })).status, 401);
});

test('GET: a member with no family and no invitations gets nulls and empty arrays', async () => {
  const s = as(world(), I);
  const { status, body } = await call(s, { method: 'GET' });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    role: 'none',
    can_start_family: false,
    household: null,
    plan: null,
    founder: null,
    seats: { used: 0, limit: 3 },
    people: [],
    invites: [],
    events: [],
    invitations_for_me: [],
  });
});

test('GET: can_start_family for an active family-plan member with no family, who holds seat 1', async () => {
  const cases = [
    [{ tier_id: 'family', status: 'active' }, true, 1],
    [{ tier_id: 'family', status: 'past_due' }, false, 0],
    [{ tier_id: 'family', status: 'active', expires_at: PAST }, false, 0],
    [{ tier_id: 'individual', status: 'active' }, false, 0],
  ];
  for (const [patch, can, used] of cases) {
    const s = as(world(), I);
    Object.assign(
      s.members.find((m) => m.id === I),
      patch,
    );
    const { body } = await call(s, { method: 'GET' });
    assert.equal(body.role, 'none', JSON.stringify(patch));
    assert.equal(body.can_start_family, can, JSON.stringify(patch));
    assert.deepEqual(body.seats, { used, limit: 3 }, JSON.stringify(patch));
  }
  // founders and joined members never get it
  assert.equal((await call(world(), { method: 'GET' })).body.can_start_family, false);
  assert.equal((await call(as(world(), M), { method: 'GET' })).body.can_start_family, false);
});

test('GET: the founder sees seats, people, pending invitations and history', async () => {
  const s = world();
  nameOnly(s);
  const pending = invite(s, { email: 'new@x.com' });
  invite(s, { email: 'old@x.com', expires_at: PAST, member_id: I });
  invite(s, { email: 'done@x.com', status: 'accepted' });
  invite(s, { email: 'no@x.com', status: 'declined' });
  s.household_events.push({
    id: uid(900),
    household_id: H,
    type: 'joined',
    actor_member_id: M,
    subject_email: 'member@x.com',
    created_at: '2026-01-01',
  });
  const { status, body } = await call(s, { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(body.role, 'founder');
  assert.equal(body.can_start_family, false);
  assert.deepEqual(body.household, { id: H, name: HOSTILE, status: 'active' });
  assert.deepEqual(body.plan, { tier_id: 'family', status: 'active', expires_at: FUTURE });
  assert.deepEqual(body.founder, { member_id: F, email: 'founder@x.com' });
  // founder + member + name-only + one live invitation; the expired one holds no seat
  assert.deepEqual(body.seats, { used: 4, limit: 3 });
  assert.deepEqual(
    body.people.map((p) => [p.kind, p.member_id, p.is_founder, p.linked]),
    [
      ['account', F, true, true],
      ['account', M, false, true],
      ['name_only', null, false, false],
    ],
  );
  // only pending, unexpired invitations are listed
  assert.deepEqual(
    body.invites.map((i) => [i.email, i.status]),
    [['new@x.com', 'pending']],
  );
  assert.deepEqual(Object.keys(body.invites.find((i) => i.id === pending.id)).sort(), [
    'created_at',
    'email',
    'expires_at',
    'full_name',
    'id',
    'person_id',
    'relationship',
    'status',
  ]);
  assert.deepEqual(body.events, [
    {
      type: 'joined',
      actor_email: 'member@x.com',
      subject_email: 'member@x.com',
      subject_name: null,
      created_at: '2026-01-01',
    },
  ]);
  // the stale invitation is written back as expired and its email flag cleared
  assert.equal(s.household_invites.find((i) => i.email === 'old@x.com').status, 'expired');
  assert.ok(ofKind(s, 'metadata').some((c) => c.id === I && c.patch.family_invite_from === null));
});

test('GET: a joined member sees the founder plan but not invitations or history', async () => {
  const s = as(world(), M);
  s.members.find((m) => m.id === F).status = 'past_due';
  invite(s, { email: 'new@x.com' });
  s.household_events.push({
    id: uid(900),
    household_id: H,
    type: 'joined',
    actor_member_id: M,
    created_at: '1',
  });
  const { body } = await call(s, { method: 'GET' });
  assert.equal(body.role, 'member');
  assert.deepEqual(body.plan, { tier_id: 'family', status: 'past_due', expires_at: FUTURE });
  assert.deepEqual(body.founder, { member_id: F, email: 'founder@x.com' });
  assert.deepEqual(body.invites, []);
  assert.deepEqual(body.events, []);
  assert.equal(body.people.length, 2);
});

test('GET: an invitee sees live invitations addressed to their login email only', async () => {
  const s = as(world(), I);
  s.auth.find((u) => u.id === I).email = 'Invitee@X.com';
  const live = invite(s);
  invite(s, { expires_at: PAST, member_id: I });
  invite(s, { email: 'someone-else@x.com' });
  const { body } = await call(s, { method: 'GET' });
  assert.equal(body.role, 'none');
  assert.deepEqual(body.invitations_for_me, [
    { id: live.id, household_name: HOSTILE, founder_email: 'founder@x.com', expires_at: FUTURE },
  ]);
});

test('GET: a legacy admin-made family with no founder uses the household plan', async () => {
  const s = as(world(), M);
  Object.assign(s.households[0], { founder_member_id: null, status: 'active', expires_at: PAST });
  const { body } = await call(s, { method: 'GET' });
  assert.equal(body.role, 'member');
  assert.equal(body.founder, null);
  assert.deepEqual(body.plan, { tier_id: 'family', status: 'active', expires_at: PAST });
});

// ---------------------------------------------------------------- invite

test('invite: a new address gets a GoTrue invite carrying only the founder login email', async () => {
  const s = world();
  const { status, body } = await call(s, {
    body: { action: 'invite', email: ' New@X.com ', full_name: HOSTILE, relationship: 'child' },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.delivered, 'invite');
  assert.equal(body.invite.email, 'new@x.com');
  assert.equal(body.invite.status, 'pending');
  assert.equal(body.invite.person_id, null);

  const [send] = ofKind(s, 'invite');
  assert.equal(ofKind(s, 'invite').length, 1);
  assert.equal(ofKind(s, 'otp').length, 0);
  const redirect = new URL(send.redirect_to);
  assert.equal(redirect.origin + redirect.pathname, 'https://caaci.example/account/');
  assert.equal(redirect.searchParams.get('family_invite'), body.invite.id);
  assert.deepEqual(send.body, {
    email: 'new@x.com',
    data: { family_invite_from: 'founder@x.com' },
  });

  // the created user's flag is cleared once the email has been rendered
  const created = s.auth.find((u) => u.email === 'new@x.com');
  assert.deepEqual(created.user_metadata, {});
  assert.equal(s.household_invites[0].member_id, created.id);
  assert.equal(eventsOf(s, 'invite_sent').length, 1);
  assert.equal(eventsOf(s, 'invite_sent')[0].subject_email, 'new@x.com');
});

test('invite: an existing confirmed login gets flag, then magic link, then the flag cleared', async () => {
  const s = world();
  const { status, body } = await call(s, { body: { action: 'invite', email: 'invitee@x.com' } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.delivered, 'magic_link');
  assert.equal(ofKind(s, 'invite').length, 0);
  const auth = s.log.filter((c) => ['metadata', 'otp', 'invite'].includes(c.kind));
  assert.deepEqual(
    auth.map((c) => [c.kind, c.id ?? null, c.patch ?? null]),
    [
      ['metadata', I, { family_invite_from: 'founder@x.com' }],
      ['otp', null, null],
      ['metadata', I, { family_invite_from: null }],
    ],
  );
  const otp = auth[1];
  assert.deepEqual(otp.body, { email: 'invitee@x.com', create_user: false });
  assert.equal(new URL(otp.redirect_to).searchParams.get('family_invite'), body.invite.id);
  assert.deepEqual(otp.metadata, { family_invite_from: 'founder@x.com' }, 'flag set at send time');
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
});

test('invite: an existing unconfirmed login is re-invited (GoTrue sends it the Invite template)', async () => {
  const s = world();
  s.auth.find((u) => u.id === I).email_confirmed_at = null;
  const { body } = await call(s, { body: { action: 'invite', email: 'invitee@x.com' } });
  assert.equal(body.delivered, 'invite');
  const [send] = ofKind(s, 'invite');
  assert.deepEqual(send.body, { email: 'invitee@x.com' });
  assert.deepEqual(send.metadata, { family_invite_from: 'founder@x.com' });
  assert.equal(ofKind(s, 'otp').length, 0);
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
});

test('invite: seat-taking inserts go through the RPC, never a direct insert', async () => {
  const s = as(world(), I);
  s.members.find((m) => m.id === I).tier_id = 'family';
  const r1 = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await call(s, { body: { action: 'add_person', full_name: 'Kid' } });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.deepEqual(
    ofKind(s, 'rpc').map((c) => c.fn),
    ['family_create_household', 'family_create_invite', 'family_add_person'],
  );
  const inserts = ofKind(s, 'insert').map((c) => c.table);
  assert.deepEqual([...new Set(inserts)], ['household_events']);
  // the new family is named from the founder's login email, never typed text
  assert.equal(s.households.at(-1).name, "invitee@x.com's family");
  assert.equal(s.households.at(-1).founder_member_id, I);
});

test('invite: the cap counts accounts, name-only people and pending invitations', async () => {
  for (const fill of ['name_only', 'pending']) {
    const s = world();
    if (fill === 'name_only') nameOnly(s);
    else invite(s, { email: 'waiting@x.com' });
    const { status, body } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
    assert.equal(status, 409, fill);
    assert.match(body.error, /full.*3 people/i, fill);
    assert.equal(ofKind(s, 'invite').length + ofKind(s, 'otp').length, 0, fill);
  }
  // an expired invitation frees its seat
  const s = world();
  invite(s, { email: 'waiting@x.com', expires_at: PAST });
  assert.equal((await call(s, { body: { action: 'invite', email: 'new@x.com' } })).status, 200);
});

test('invite: the RPC refusal alone decides "family is full"', async () => {
  const s = world();
  s.members.find((m) => m.id === M).household_id = null; // plenty of room as far as the Worker could tell
  s.rpc.family_create_invite = () => ({ ok: false, reason: 'family_full' });
  const { status, body } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
  assert.equal(status, 409);
  assert.match(body.error, /full/i);
  assert.equal(s.household_invites.length, 0);
  assert.equal(ofKind(s, 'insert').length, 0);
});

test('invite: a duplicate pending invitation -> 409', async () => {
  const s = world();
  invite(s, { email: 'new@x.com' });
  const { status, body } = await call(s, { body: { action: 'invite', email: 'NEW@x.com' } });
  assert.equal(status, 409);
  assert.match(body.error, /pending invitation/i);
});

test('invite: someone already in another family -> 409, nothing sent', async () => {
  const s = world();
  s.households.push({ id: uid(101), name: 'Other', status: 'active', founder_member_id: null });
  s.members.find((m) => m.id === I).household_id = uid(101);
  const { status } = await call(s, { body: { action: 'invite', email: 'invitee@x.com' } });
  assert.equal(status, 409);
  assert.equal(ofKind(s, 'rpc').length, 0);
  assert.equal(ofKind(s, 'otp').length, 0);
});

test('invite: own email -> 400; bad email or relationship -> 400', async () => {
  const s = world();
  for (const body of [
    { action: 'invite', email: 'FOUNDER@x.com' },
    { action: 'invite', email: 'not-an-email' },
    { action: 'invite', email: 'a@b.com', relationship: 'boss' },
  ]) {
    assert.equal((await call(s, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal(ofKind(s, 'rpc').length, 0);
});

test('invite: a founder whose plan is not active -> 403', async () => {
  for (const patch of [{ status: 'past_due' }, { status: 'active', expires_at: PAST }]) {
    const s = world();
    Object.assign(
      s.members.find((m) => m.id === F),
      patch,
    );
    const { status } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
    assert.equal(status, 403, JSON.stringify(patch));
    assert.equal(ofKind(s, 'rpc').length, 0);
  }
});

test('invite: a member without the family plan cannot start a family', async () => {
  const s = as(world(), I);
  const { status } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
  assert.equal(status, 403);
  assert.equal(s.households.length, 1);
});

// ---------------------------------------------------------------- invite a name-only person

test('invite by person_id: a full family gives a name-only person a login without a new seat', async () => {
  const { s, kids } = founderWithKids(2); // founder + 2 name-only = 3
  const [kid] = kids;

  const full = await call(s, { body: { action: 'invite', email: 'invitee@x.com' } });
  assert.equal(full.status, 409, 'without person_id the same invitation needs a seat');
  assert.match(full.body.error, /full/i);

  const r = await call(s, {
    body: { action: 'invite', email: 'invitee@x.com', person_id: kid.id },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invite.person_id, kid.id);
  assert.equal(r.body.invite.full_name, HOSTILE, "defaults to the person's name");
  assert.equal(ofKind(s, 'rpc').at(-1).args.p_person_id, kid.id);
  assert.equal((await call(s, { method: 'GET' })).body.seats.used, 3);

  as(s, I);
  const accepted = await call(s, {
    body: { action: 'accept_invite', invite_id: r.body.invite.id },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  // the existing row is linked, not duplicated
  assert.equal(s.household_members.filter((p) => p.household_id === H).length, 3);
  assert.deepEqual(
    [kid.member_id, kid.email, kid.full_name, kid.relationship],
    [I, 'invitee@x.com', HOSTILE, 'child'],
  );
  assert.equal(s.members.find((m) => m.id === I).household_id, H);

  as(s, F);
  const after = (await call(s, { method: 'GET' })).body;
  assert.equal(after.seats.used, 3);
  assert.deepEqual(
    after.people.filter((p) => p.id === kid.id).map((p) => [p.kind, p.member_id, p.linked]),
    [['account', I, true]],
  );
});

test('invite by person_id: refuses a person who is not name-only in this family', async () => {
  const { s } = founderWithKids(1);
  s.households.push({ id: uid(101), name: 'Other', status: 'active', founder_member_id: null });
  const elsewhere = nameOnly(s, 1, { household_id: uid(101) })[0];
  const cases = [
    [uid(201), 400], // the founder's own linked row
    [uid(999), 404], // no such person
    [elsewhere.id, 404], // another family's person
    ['not-a-uuid', 400],
  ];
  for (const [person_id, want] of cases) {
    const { status } = await call(s, {
      body: { action: 'invite', email: 'invitee@x.com', person_id },
    });
    assert.equal(status, want, person_id);
  }
  assert.equal(ofKind(s, 'rpc').length, 0);
  assert.equal(ofKind(s, 'otp').length + ofKind(s, 'invite').length, 0);
});

test('invite by person_id: a person with a live pending invitation -> 409; an expired one does not block', async () => {
  const { s, kids } = founderWithKids(2);
  const first = invite(s, { email: 'first@x.com', person_id: kids[0].id });
  const { status, body } = await call(s, {
    body: { action: 'invite', email: 'invitee@x.com', person_id: kids[0].id },
  });
  assert.equal(status, 409);
  assert.equal(body.error, 'This person already has a pending invitation.');
  assert.equal(ofKind(s, 'otp').length + ofKind(s, 'invite').length, 0);

  first.expires_at = PAST;
  const again = await call(s, {
    body: { action: 'invite', email: 'invitee@x.com', person_id: kids[0].id },
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(first.status, 'expired');
  // GET lists the live one, tied to its person
  const { body: view } = await call(s, { method: 'GET' });
  assert.deepEqual(
    view.invites.map((i) => [i.email, i.person_id]),
    [['invitee@x.com', kids[0].id]],
  );
});

test('accept_invite: a person row removed since the invitation falls back to a seat of its own', async () => {
  // Room: founder + one kid + the invitation (now seat-taking) = 3.
  const { s, kids } = founderWithKids(2);
  const inv = invite(s, { person_id: kids[0].id, full_name: null });
  deletePeople(s, [kids[0]]);
  as(s, I);
  const ok = await call(s, { body: { action: 'accept_invite', invite_id: inv.id } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(
    s.household_members.filter((p) => p.member_id === I).length,
    1,
    'a new row was added',
  );

  // No room: founder + two kids, and the invitation's person is gone.
  const full = founderWithKids(3);
  const inv2 = invite(full.s, { person_id: full.kids[0].id });
  deletePeople(full.s, [full.kids[0]]);
  as(full.s, I);
  const refused = await call(full.s, { body: { action: 'accept_invite', invite_id: inv2.id } });
  assert.equal(refused.status, 409);
  assert.equal(full.s.members.find((m) => m.id === I).household_id, null);
});

test('remove_person: removing a name-only person cancels the invitation riding on them', async () => {
  const { s, kids } = founderWithKids(2);
  const inv = invite(s, { person_id: kids[0].id, member_id: I });
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  const { status } = await call(s, { body: { action: 'remove_person', person_id: kids[0].id } });
  assert.equal(status, 200);
  assert.equal(inv.status, 'cancelled');
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
  assert.equal(eventsOf(s, 'invite_cancelled').length, 1);
});

test('founder-only actions refuse a joined member with 403', async () => {
  const s = world();
  const inv = invite(s, { email: 'new@x.com' });
  nameOnly(s);
  as(s, M);
  for (const body of [
    { action: 'invite', email: 'new2@x.com' },
    { action: 'invite', email: 'new2@x.com', person_id: s.household_members.at(-1).id },
    { action: 'cancel_invite', invite_id: inv.id },
    { action: 'resend_invite', invite_id: inv.id },
    { action: 'add_person', full_name: 'Kid' },
    { action: 'remove_person', person_id: s.household_members.at(-1).id },
    { action: 'dissolve' },
  ]) {
    const { status } = await call(s, { body });
    assert.equal(status, 403, body.action);
  }
  assert.equal(s.households[0].status, 'active');
  assert.equal(inv.status, 'pending');
  assert.equal(ofKind(s, 'rpc').length + ofKind(s, 'otp').length + ofKind(s, 'invite').length, 0);
});

test('an unknown action -> 400', async () => {
  for (const action of ['nope', 'toString', undefined]) {
    assert.equal((await call(world(), { body: { action } })).status, 400);
  }
});

// ---------------------------------------------------------------- cancel / resend

test('cancel_invite: cancels, clears the invitee flag and logs it', async () => {
  const s = world();
  const inv = invite(s, { member_id: I });
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  const { status, body } = await call(s, { body: { action: 'cancel_invite', invite_id: inv.id } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(inv.status, 'cancelled');
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
  assert.equal(eventsOf(s, 'invite_cancelled').length, 1);
});

test('resend_invite: a GoTrue rate limit -> 429, with retry_after only when GoTrue says how long', async () => {
  const s = world();
  const inv = invite(s, { member_id: I });
  s.responses.otp = {
    status: 429,
    body: {
      code: 429,
      error_code: 'over_email_send_rate_limit',
      msg: 'For security purposes, you can only request this after 42 seconds.',
    },
  };
  const timed = await call(s, { body: { action: 'resend_invite', invite_id: inv.id } });
  assert.equal(timed.status, 429);
  assert.match(timed.body.error, /wait/i);
  assert.equal(timed.body.retry_after, 42);
  assert.equal(timed.headers.get('retry-after'), '42');
  assert.equal(inv.status, 'pending', 'a failed resend keeps the invitation');
  assert.deepEqual(
    s.auth.find((u) => u.id === I).user_metadata,
    {},
    'flag cleared after a failed send',
  );

  s.responses.otp = {
    status: 429,
    body: { error_code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' },
  };
  const untimed = await call(s, { body: { action: 'resend_invite', invite_id: inv.id } });
  assert.equal(untimed.status, 429);
  assert.equal('retry_after' in untimed.body, false);
  assert.equal(untimed.headers.get('retry-after'), null);
});

test('invite: a failed first send frees the seat', async () => {
  const s = world();
  s.responses.invite = { status: 500, body: { msg: 'boom' } };
  const { status } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
  assert.equal(status, 502);
  assert.equal(s.household_invites[0].status, 'cancelled');
});

// ---------------------------------------------------------------- accept / decline

test('accept_invite: signed in with a different email -> 403, nothing linked', async () => {
  const s = world();
  const inv = invite(s, { email: 'someone-else@x.com' });
  as(s, I);
  const { status } = await call(s, { body: { action: 'accept_invite', invite_id: inv.id } });
  assert.equal(status, 403);
  assert.equal(s.members.find((m) => m.id === I).household_id, null);
  assert.equal(inv.status, 'pending');
  assert.equal(ofKind(s, 'rpc').length, 0);
});

test('accept_invite: links the account, adds a household_members row, logs and emails the founder', async () => {
  const s = world();
  const inv = invite(s, { member_id: I });
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  as(s, I);
  const { status, body } = await call(s, {
    body: { action: 'accept_invite', invite_id: inv.id },
    env: EMAIL_ON,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.notified, true);
  assert.equal(s.members.find((m) => m.id === I).household_id, H);
  const row = s.household_members.find((p) => p.member_id === I);
  assert.equal(row.household_id, H);
  assert.equal(row.relationship, 'child');
  assert.equal(row.email, 'invitee@x.com');
  assert.equal(inv.status, 'accepted');
  assert.deepEqual(
    eventsOf(s, 'joined').map((e) => [e.actor_member_id, e.subject_member_id, e.subject_email]),
    [[I, I, 'invitee@x.com']],
  );
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
  assert.equal(s.emails.length, 1);
  assert.equal(s.emails[0].to, 'founder@x.com');
  assert.match(s.emails[0].html, /invitee@x\.com/);
  // the invitee's own paid plan is left alone
  assert.equal(s.members.find((m) => m.id === I).tier_id, 'individual');
});

test('accept_invite: re-checks the cap (a seat filled since the invitation was sent)', async () => {
  const s = world();
  const inv = invite(s);
  nameOnly(s); // founder + member + name-only = 3 without the invitation
  as(s, I);
  const { status, body } = await call(s, { body: { action: 'accept_invite', invite_id: inv.id } });
  assert.equal(status, 409);
  assert.match(body.error, /full/i);
  assert.equal(s.members.find((m) => m.id === I).household_id, null);
  assert.equal(inv.status, 'pending');
  assert.equal(eventsOf(s, 'joined').length, 0);
});

test('accept_invite: the invitation being accepted does not count twice', async () => {
  const s = world();
  const inv = invite(s); // founder + member + this invitation = 3
  as(s, I);
  assert.equal(
    (await call(s, { body: { action: 'accept_invite', invite_id: inv.id } })).status,
    200,
  );
});

test('accept_invite: expired -> 409, written back as expired, flag cleared', async () => {
  const s = world();
  const inv = invite(s, { expires_at: PAST, member_id: I });
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  as(s, I);
  const { status, body } = await call(s, { body: { action: 'accept_invite', invite_id: inv.id } });
  assert.equal(status, 409);
  assert.match(body.error, /expired/i);
  assert.equal(inv.status, 'expired');
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
});

test('accept_invite: the founder plan lapsed -> 403; already in a family -> 409', async () => {
  const s = world();
  const inv = invite(s);
  s.members.find((m) => m.id === F).status = 'expired';
  as(s, I);
  assert.equal(
    (await call(s, { body: { action: 'accept_invite', invite_id: inv.id } })).status,
    403,
  );
  s.members.find((m) => m.id === F).status = 'active';
  s.members.find((m) => m.id === I).household_id = uid(101);
  s.households.push({ id: uid(101), name: 'Other', status: 'active' });
  assert.equal(
    (await call(s, { body: { action: 'accept_invite', invite_id: inv.id } })).status,
    409,
  );
  assert.equal(ofKind(s, 'rpc').length, 0);
});

test('decline_invite: declines, clears the flag and logs it', async () => {
  const s = world();
  const inv = invite(s);
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  as(s, I);
  const { status } = await call(s, { body: { action: 'decline_invite', invite_id: inv.id } });
  assert.equal(status, 200);
  assert.equal(inv.status, 'declined');
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
  assert.equal(eventsOf(s, 'invite_declined')[0].subject_email, 'invitee@x.com');
});

// ---------------------------------------------------------------- people

test('add_person: a name-only person takes a seat through the RPC', async () => {
  const s = world();
  const { status, body } = await call(s, {
    body: { action: 'add_person', full_name: ' Little One ', relationship: 'child' },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.person, {
    id: body.person.id,
    kind: 'name_only',
    member_id: null,
    full_name: 'Little One',
    relationship: 'child',
    is_founder: false,
    linked: false,
  });
  assert.equal(eventsOf(s, 'person_added').length, 1);
  const again = await call(s, { body: { action: 'add_person', full_name: 'Too many' } });
  assert.equal(again.status, 409);
});

test('events: name-only people added and removed carry subject_name in the on-site history', async () => {
  const s = world();
  const added = await call(s, { body: { action: 'add_person', full_name: 'Little One' } });
  assert.equal(added.status, 200);
  const removed = await call(s, {
    body: { action: 'remove_person', person_id: added.body.person.id },
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(
    s.household_events.map((e) => [e.type, e.subject_name]),
    [
      ['person_added', 'Little One'],
      ['person_removed', 'Little One'],
    ],
  );
  const { body } = await call(s, { method: 'GET' });
  assert.deepEqual(body.events.map((e) => [e.type, e.subject_name]).sort(), [
    ['person_added', 'Little One'],
    ['person_removed', 'Little One'],
  ]);
  assert.equal(ofKind(s, 'resend').length, 0);
});

test('remove_person: the last non-founder person is refused with "dissolve instead"', async () => {
  const s = world();
  const { status, body } = await call(s, { body: { action: 'remove_person', person_id: M } });
  assert.equal(status, 409);
  assert.match(body.error, /dissolve/i);
  assert.equal(s.members.find((m) => m.id === M).household_id, H);
  const self = await call(s, { body: { action: 'remove_person', person_id: uid(201) } });
  assert.equal(self.status, 409);
});

test('remove_person: the last-person rule counts accounts and name-only people, never pending invitations', async () => {
  // founder + one name-only person + a pending invitation: still the last person
  const lone = founderWithKids(1);
  invite(lone.s, { email: 'waiting@x.com' });
  const refused = await call(lone.s, {
    body: { action: 'remove_person', person_id: lone.kids[0].id },
  });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /dissolve/i);

  // founder + a linked account + a name-only person: either may go
  for (const pick of ['kid', 'member']) {
    const s = world();
    const [kid] = nameOnly(s);
    const person_id = pick === 'kid' ? kid.id : M;
    const { status } = await call(s, { body: { action: 'remove_person', person_id } });
    assert.equal(status, 200, pick);
  }

  // founder + two name-only people: one may go
  const two = founderWithKids(2);
  const ok = await call(two.s, { body: { action: 'remove_person', person_id: two.kids[0].id } });
  assert.equal(ok.status, 200);
});

test('remove_person: a name-only person is deleted and logged', async () => {
  const s = world();
  const [kid] = nameOnly(s);
  const { status } = await call(s, { body: { action: 'remove_person', person_id: kid.id } });
  assert.equal(status, 200);
  assert.equal(
    s.household_members.some((p) => p.id === kid.id),
    false,
  );
  assert.equal(eventsOf(s, 'person_removed').length, 1);
});

test('remove_person: a linked account is unlinked, logged and told by email', async () => {
  const s = world();
  nameOnly(s);
  const { status, body } = await call(s, {
    body: { action: 'remove_person', person_id: uid(202) },
    env: EMAIL_ON,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.notified, true);
  assert.equal(s.members.find((m) => m.id === M).household_id, null);
  assert.equal(
    s.household_members.some((p) => p.member_id === M),
    false,
  );
  assert.equal(eventsOf(s, 'member_removed')[0].subject_email, 'member@x.com');
  assert.deepEqual(
    s.emails.map((e) => e.to),
    ['member@x.com'],
  );
});

test('leave: a member leaves, it is logged, and the founder is emailed when email is configured', async () => {
  const s = as(world(), M);
  const { status, body } = await call(s, { body: { action: 'leave' }, env: EMAIL_ON });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, notified: true });
  assert.equal(s.members.find((m) => m.id === M).household_id, null);
  assert.equal(eventsOf(s, 'left')[0].subject_member_id, M);
  assert.deepEqual(
    s.emails.map((e) => e.to),
    ['founder@x.com'],
  );
});

test('leave: without Resend configured it still succeeds with notified: false', async () => {
  const s = as(world(), M);
  const { status, body } = await call(s, { body: { action: 'leave' } });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, notified: false });
  assert.equal(eventsOf(s, 'left').length, 1);
  assert.equal(ofKind(s, 'resend').length, 0);
});

test('leave: a failing Resend call does not fail the leave', async () => {
  const s = as(world(), M);
  const fetch = mockFetch(async (url, options) =>
    url.includes('resend.com') ? { status: 500, body: 'down' } : backend(s)(url, options),
  );
  try {
    const request = fakeRequest({
      url: 'https://caaci.example/api/family',
      headers: { authorization: 'Bearer tok' },
      body: { action: 'leave' },
    });
    const r = await onRequestPost({ request, env: fakeEnv(EMAIL_ON) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).notified, false);
  } finally {
    fetch.restore();
  }
});

test('leave: the founder cannot leave; someone in no family gets 409', async () => {
  assert.equal((await call(world(), { body: { action: 'leave' } })).status, 403);
  assert.equal((await call(as(world(), I), { body: { action: 'leave' } })).status, 409);
});

test('dissolve: unlinks everyone, deletes people, cancels invitations and keeps the history', async () => {
  const s = world();
  nameOnly(s);
  const inv = invite(s, { member_id: I });
  s.auth.find((u) => u.id === I).user_metadata.family_invite_from = 'founder@x.com';
  s.household_events.push({
    id: uid(900),
    household_id: H,
    type: 'joined',
    actor_member_id: M,
    created_at: '1',
  });
  const { status, body } = await call(s, { body: { action: 'dissolve' } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(s.members.filter((m) => m.household_id === H).length, 0, 'founder included');
  assert.equal(s.household_members.filter((p) => p.household_id === H).length, 0);
  assert.equal(inv.status, 'cancelled');
  assert.equal(s.households[0].status, 'cancelled');
  assert.deepEqual(
    s.household_events.map((e) => e.type),
    ['joined', 'dissolved'],
  );
  assert.deepEqual(s.auth.find((u) => u.id === I).user_metadata, {});
});

// ---------------------------------------------------------------- email content

test('notification emails carry fixed copy and login emails, never member-typed text', async () => {
  const s = world();
  const [kid] = nameOnly(s, 1, { full_name: HOSTILE });
  const inv = invite(s, { member_id: I, person_id: kid.id });
  const statuses = [];
  as(s, I);
  statuses.push(
    (await call(s, { body: { action: 'accept_invite', invite_id: inv.id }, env: EMAIL_ON })).status,
  );
  as(s, F);
  statuses.push(
    (await call(s, { body: { action: 'remove_person', person_id: I }, env: EMAIL_ON })).status,
  );
  as(s, M);
  statuses.push((await call(s, { body: { action: 'leave' }, env: EMAIL_ON })).status);
  assert.deepEqual(statuses, [200, 200, 200]);
  assert.deepEqual(
    s.emails.map((e) => e.to),
    ['founder@x.com', 'invitee@x.com', 'founder@x.com'],
  );
  for (const e of s.emails) {
    const all = `${e.subject}\n${e.html}\n${e.text}`;
    assert.equal(all.includes('evil.example'), false, all);
    assert.equal(all.includes('汇款'), false, all);
    assert.match(e.subject, /\p{Script=Han}/u);
    assert.match(e.subject, /CAACI family membership/);
  }
});

// ---------------------------------------------------------------- _lib helpers

test('authAdmin.findUserByEmail matches the whole login email, not the LIKE filter hit', async () => {
  const fetch = mockFetch(() => ({
    body: {
      users: [
        { id: 'a', email: 'xann@x.com' },
        { id: 'b', email: 'Ann@X.com' },
      ],
    },
  }));
  try {
    const found = await authAdmin(fakeEnv()).findUserByEmail(' ann@x.com ');
    assert.equal(found.id, 'b');
    const u = new URL(fetch.calls[0].url);
    assert.equal(u.pathname, '/auth/v1/admin/users');
    assert.equal(u.searchParams.get('filter'), 'ann@x.com');
    assert.equal(fetch.calls[0].options.headers.authorization, 'Bearer service-key');
  } finally {
    fetch.restore();
  }
});

test('authAdmin.findUserByEmail pages past a full page of substring hits, but not forever', async () => {
  const noise = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, email: `${i}xann@x.com` }));
  const fetch = mockFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page') || 1);
    if (page === 1) return { body: { users: noise } };
    if (page === 2) return { body: { users: [{ id: 'hit', email: 'Ann@x.com' }] } };
    return { body: { users: [] } };
  });
  try {
    const found = await authAdmin(fakeEnv()).findUserByEmail('ann@x.com');
    assert.equal(found?.id, 'hit');
    assert.deepEqual(
      fetch.calls.map((c) => new URL(c.url).searchParams.get('page')),
      ['1', '2'],
    );
  } finally {
    fetch.restore();
  }
  const endless = mockFetch(() => ({ body: { users: noise } }));
  try {
    assert.equal(await authAdmin(fakeEnv()).findUserByEmail('ann@x.com'), null);
    assert.equal(endless.calls.length, 20);
  } finally {
    endless.restore();
  }
});

// ---------------------------------------------------------------- review fixes

test('add_person: refused while the family plan is inactive or no longer the family tier', async () => {
  for (const patch of [{ status: 'expired' }, { expires_at: PAST }, { tier_id: 'individual' }]) {
    const s = world();
    Object.assign(
      s.members.find((m) => m.id === F),
      patch,
    );
    const { status } = await call(s, { body: { action: 'add_person', full_name: 'Kid' } });
    assert.equal(status, 403, JSON.stringify(patch));
    assert.equal(ofKind(s, 'rpc').length, 0, JSON.stringify(patch));
  }
  // a family-tier member whose plan lapsed never starts a family
  const s = as(world(), I);
  Object.assign(
    s.members.find((m) => m.id === I),
    { tier_id: 'family', status: 'expired' },
  );
  const { status } = await call(s, { body: { action: 'add_person', full_name: 'Kid' } });
  assert.equal(status, 403);
  assert.equal(s.households.length, 1);
  assert.equal(ofKind(s, 'rpc').length, 0);
});

test('a founder moved off the family tier cannot invite, resend, or have an invitation accepted', async () => {
  const s = world();
  const inv = invite(s, { member_id: I });
  s.members.find((m) => m.id === F).tier_id = 'individual';
  assert.equal((await call(s, { body: { action: 'invite', email: 'new@x.com' } })).status, 403);
  assert.equal(
    (await call(s, { body: { action: 'resend_invite', invite_id: inv.id } })).status,
    403,
  );
  as(s, I);
  assert.equal(
    (await call(s, { body: { action: 'accept_invite', invite_id: inv.id } })).status,
    403,
  );
  assert.equal(ofKind(s, 'rpc').length + ofKind(s, 'otp').length + ofKind(s, 'invite').length, 0);
  assert.equal(s.members.find((m) => m.id === I).household_id, null);
});

test('invite: a failed invite request still clears the flag on a user GoTrue already created', async () => {
  const s = world();
  s.responses.invite = (world2, body) => {
    world2.auth.push({ id: uid(++world2.seq), email: body.email, user_metadata: { ...body.data } });
    throw new TypeError('network connection lost');
  };
  const { status } = await call(s, { body: { action: 'invite', email: 'new@x.com' } });
  assert.equal(status, 502);
  assert.equal(s.household_invites[0].status, 'cancelled');
  const created = s.auth.find((u) => u.email === 'new@x.com');
  assert.ok(created, 'the fixture created the user');
  assert.deepEqual(created.user_metadata, {});
});

test('remove_person and leave change the family only through locked RPCs', async () => {
  const s = world();
  const [kid] = nameOnly(s);
  const removed = await call(s, { body: { action: 'remove_person', person_id: kid.id } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  as(s, M);
  const left = await call(s, { body: { action: 'leave' } });
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.deepEqual(
    ofKind(s, 'rpc').map((c) => c.fn),
    ['family_remove_person', 'family_leave'],
  );
  const writes = ofKind(s, 'write').filter((w) =>
    ['members', 'household_members'].includes(w.table),
  );
  assert.deepEqual(writes, []);
});

test('remove_person: two concurrent removals cannot leave the founder alone', async () => {
  const { s, kids } = founderWithKids(2);
  const fetch = mockFetch(backend(s));
  try {
    const remove = (person_id) =>
      onRequestPost({
        request: fakeRequest({
          url: 'https://caaci.example/api/family',
          headers: { authorization: 'Bearer tok' },
          body: { action: 'remove_person', person_id },
        }),
        env: fakeEnv(),
      }).then((r) => r.status);
    const statuses = await Promise.all(kids.map((k) => remove(k.id)));
    assert.deepEqual(statuses.sort(), [200, 409]);
  } finally {
    fetch.restore();
  }
  assert.equal(s.household_members.filter((p) => p.household_id === H && !p.member_id).length, 1);
});

test('authAdmin.updateUserMetadata PUTs only the given user_metadata keys', async () => {
  const fetch = mockFetch(() => ({ body: {} }));
  try {
    await authAdmin(fakeEnv()).updateUserMetadata('u 1', { family_invite_from: null });
    assert.equal(fetch.calls[0].url, 'https://db.example/auth/v1/admin/users/u%201');
    assert.equal(fetch.calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(fetch.calls[0].options.body), {
      user_metadata: { family_invite_from: null },
    });
  } finally {
    fetch.restore();
  }
});
