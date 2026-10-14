// /api/admin/staff — root, administrators and content managers in one list —
// and the events gate (0041): content managers given events reach the events
// endpoints, nobody else besides administrators does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/admin/staff.js';
import { onRequestGet as eventsGet } from '../functions/api/admin/events.js';
import { onRequestGet as volunteersGet } from '../functions/api/admin/event-volunteers.js';
import { onRequestGet as templatesGet } from '../functions/api/admin/form-templates.js';
import { onRequestGet as contentMe } from '../functions/api/admin/content-me.js';
import { fakeRequest, mockFetch, fakeEnv, asUser } from './helpers.js';
import {
  contentDb,
  seedContent,
  ADMIN,
  EDITOR_A,
  EDITOR_ALL,
  PAGES,
  STRANGER,
  COL_A,
} from './content-fake-db.js';

const ROOT = 'a0000000-0000-4000-8000-0000000000ff';
const EVENTS = 'a0000000-0000-4000-8000-0000000000ee'; // a content manager with events only

function seed() {
  const s = seedContent();
  s.members.push(
    {
      id: ROOT,
      full_name: 'Rita Root',
      email: 'rita.root@example.com',
      is_admin: true,
      is_root: true,
    },
    { id: EVENTS, full_name: 'Evan Events', email: 'evan.events@example.com', is_admin: false },
  );
  s.content_editors.push({
    member_id: EVENTS,
    all_columns: false,
    column_ids: [],
    can_edit_pages: false,
    perms: ['events'],
    updated_by: ADMIN,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  });
  s.events = [];
  s.form_templates = [];
  s.volunteers = [];
  return s;
}

const req = (path, who, body) =>
  fakeRequest({
    url: `https://caaci.example${path}`,
    headers: who ? asUser(who) : {},
    body,
  });
const get = (who) => onRequestGet({ request: req('/api/admin/staff', who), env: fakeEnv() });
const post = (who, body) =>
  onRequestPost({ request: req('/api/admin/staff', who, body), env: fakeEnv() });

async function withDb(fn) {
  const db = contentDb(seed());
  const fetch = mockFetch(db.route);
  try {
    return await fn(db);
  } finally {
    fetch.restore();
  }
}

const member = (db, id) => db.tables.members.find((m) => m.id === id);
const editorRow = (db, id) => db.tables.content_editors.find((e) => e.member_id === id);

test('staff: administrators only', async () => {
  await withDb(async () => {
    assert.equal((await get(null)).status, 401);
    for (const who of [EDITOR_A, EVENTS, STRANGER]) assert.equal((await get(who)).status, 403);
  });
});

test('staff: root sees every role; another admin sees content managers only', async () => {
  await withDb(async () => {
    const asRoot = await (await get(ROOT)).json();
    assert.equal(asRoot.caller_is_root, true);
    const roles = Object.fromEntries(asRoot.rows.map((r) => [r.member_id, r.role]));
    assert.equal(roles[ROOT], 'root');
    assert.equal(roles[ADMIN], 'admin');
    assert.equal(roles[EDITOR_A], 'content');
    assert.equal(roles[EVENTS], 'content');
    assert.equal(asRoot.rows[0].role, 'root', 'root first, then admins, then content managers');

    const asAdmin = await (await get(ADMIN)).json();
    assert.equal(asAdmin.caller_is_root, false);
    assert.ok(asAdmin.rows.length > 0);
    assert.ok(asAdmin.rows.every((r) => r.role === 'content'));
    assert.deepEqual(asAdmin.rows.find((r) => r.member_id === EVENTS).perms, ['events']);
  });
});

test('staff: an admin manages content managers but cannot appoint or touch an admin', async () => {
  await withDb(async (db) => {
    const add = await post(ADMIN, {
      email: 'sam.stranger@example.com',
      role: 'content',
      perms: ['events'],
    });
    assert.equal(add.status, 200);
    assert.equal((await add.json()).row.role, 'content');
    assert.deepEqual(editorRow(db, STRANGER).perms, ['events']);

    assert.equal((await post(ADMIN, { member_id: STRANGER, role: 'admin' })).status, 403);
    assert.equal(member(db, STRANGER).is_admin, false);
    assert.equal((await post(ADMIN, { member_id: ROOT, role: 'none' })).status, 409);
    assert.equal(member(db, ROOT).is_admin, true);
  });
});

test('staff: an admin cannot demote another admin; root can, keeping a content row', async () => {
  await withDb(async (db) => {
    const other = 'a0000000-0000-4000-8000-0000000000ad';
    db.tables.members.push({
      id: other,
      full_name: 'Al Two',
      email: 'al@example.com',
      is_admin: true,
    });

    const refused = await post(ADMIN, { member_id: other, role: 'content', all_columns: true });
    assert.equal(refused.status, 403);
    assert.equal(member(db, other).is_admin, true);
    assert.equal(editorRow(db, other), undefined);

    const ok = await post(ROOT, {
      member_id: other,
      role: 'content',
      all_columns: true,
      can_edit_pages: true,
      perms: ['events', 'news', 'invites', 'plans', 'directory'],
    });
    assert.equal(ok.status, 200);
    assert.equal(member(db, other).is_admin, false);
    const row = editorRow(db, other);
    assert.equal(row.all_columns, true);
    assert.equal(row.can_edit_pages, true);
    assert.deepEqual(row.perms, ['events', 'news', 'invites', 'plans', 'directory']);
  });
});

test('staff: making a content manager an admin keeps their content row', async () => {
  await withDb(async (db) => {
    const r = await post(ROOT, { member_id: EDITOR_A, role: 'admin' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).row.role, 'admin');
    assert.equal(member(db, EDITOR_A).is_admin, true);
    assert.deepEqual(editorRow(db, EDITOR_A).column_ids, [COL_A]);
  });
});

test('staff: never your own role, never root, and a content manager needs a permission', async () => {
  await withDb(async (db) => {
    assert.equal((await post(ROOT, { member_id: ROOT, role: 'none' })).status, 409);
    assert.equal((await post(ADMIN, { member_id: ADMIN, role: 'none' })).status, 409);
    assert.equal(member(db, ADMIN).is_admin, true);
    const empty = await post(ADMIN, { member_id: STRANGER, role: 'content' });
    assert.equal(empty.status, 400);
    assert.equal(editorRow(db, STRANGER), undefined);
    assert.equal(
      (await post(ADMIN, { email: 'nobody@example.com', role: 'content', perms: ['events'] }))
        .status,
      404,
    );
    assert.equal((await post(ADMIN, { member_id: STRANGER, role: 'owner' })).status, 400);
  });
});

test('staff: none removes access entirely', async () => {
  await withDb(async (db) => {
    assert.equal((await post(ADMIN, { member_id: PAGES, role: 'none' })).status, 200);
    assert.equal(editorRow(db, PAGES), undefined);
    const other = 'a0000000-0000-4000-8000-0000000000ad';
    db.tables.members.push({
      id: other,
      full_name: 'Al Two',
      email: 'al@example.com',
      is_admin: true,
    });
    assert.equal((await post(ROOT, { member_id: other, role: 'none' })).status, 200);
    assert.equal(member(db, other).is_admin, false);
  });
});

test('events gate: admins and content managers with events; nobody else', async () => {
  await withDb(async () => {
    const env = fakeEnv();
    for (const [handler, path] of [
      [eventsGet, '/api/admin/events'],
      [volunteersGet, '/api/admin/event-volunteers'],
      [templatesGet, '/api/admin/form-templates'],
    ]) {
      assert.equal((await handler({ request: req(path, null), env })).status, 401, path);
      for (const who of [EDITOR_A, EDITOR_ALL, PAGES, STRANGER])
        assert.equal(
          (await handler({ request: req(path, who), env })).status,
          403,
          `${path} ${who}`,
        );
      for (const who of [ADMIN, EVENTS]) {
        const r = await handler({ request: req(path, who), env });
        assert.notEqual(r.status, 401, `${path} ${who}`);
        assert.notEqual(r.status, 403, `${path} ${who}`);
      }
    }
  });
});

test('news, invites, plans, directory: each opens to its own permission only', async () => {
  const db = contentDb(seed());
  // One content manager per permission, plus one with page copy only.
  const holders = {};
  for (const [i, p] of ['news', 'invites', 'plans', 'directory'].entries()) {
    const id = `b0000000-0000-4000-8000-00000000000${i}`;
    holders[p] = id;
    db.tables.members.push({ id, full_name: `P ${p}`, email: `${p}@example.com`, is_admin: false });
    db.tables.content_editors.push({
      member_id: id,
      all_columns: false,
      column_ids: [],
      can_edit_pages: false,
      perms: [p],
    });
  }
  for (const t of ['invites', 'membership_tiers', 'business_directory', 'news_sends'])
    db.tables[t] ??= [];
  const fetch = mockFetch(db.route);
  try {
    const env = fakeEnv();
    const endpoints = {
      news: [(await import('../functions/api/admin/news.js')).onRequestGet, '/api/admin/news'],
      invites: [
        (await import('../functions/api/admin/invites.js')).onRequestGet,
        '/api/admin/invites',
      ],
      plans: [(await import('../functions/api/admin/tiers.js')).onRequestGet, '/api/admin/tiers'],
      directory: [
        (await import('../functions/api/admin/business.js')).onRequestGet,
        '/api/admin/business',
      ],
    };
    for (const [perm, [handler, path]] of Object.entries(endpoints)) {
      for (const who of [EVENTS, PAGES, STRANGER, ...Object.values(holders)]) {
        const r = await handler({ request: req(path, who), env });
        if (who === holders[perm])
          assert.ok(![401, 403].includes(r.status), `${perm} holder → ${path}`);
        else assert.equal(r.status, 403, `${who} → ${path}`);
      }
      const r = await handler({ request: req(path, ADMIN), env });
      assert.ok(![401, 403].includes(r.status), `admin → ${path}`);
    }
    // The news tab lists events for its templates, so 'news' may read them.
    const evs = await eventsGet({ request: req('/api/admin/events', holders.news), env });
    assert.ok(![401, 403].includes(evs.status));
    const noEv = await eventsGet({ request: req('/api/admin/events', holders.plans), env });
    assert.equal(noEv.status, 403);
  } finally {
    fetch.restore();
  }
});

test('ilikeExact escapes the backslash first, then every pattern character', async () => {
  const { ilikeExact } = await import('../functions/api/_lib.js');
  assert.equal(decodeURIComponent(ilikeExact('a_b%c*d\\e@x.org')), 'a\\_b\\%c\\*d\\\\e@x.org');
  // Escaped, an underscore matches only itself: no other member is found.
  await withDb(async () => {
    const r = await post(ADMIN, {
      email: 'sam_stranger@example.com',
      role: 'content',
      perms: ['events'],
    });
    assert.equal(r.status, 404);
  });
});

test('content-me reports the permissions', async () => {
  await withDb(async () => {
    const me = async (who) =>
      (await contentMe({ request: req('/api/admin/content-me', who), env: fakeEnv() })).json();
    assert.deepEqual((await me(EVENTS)).perms, ['events']);
    assert.deepEqual((await me(EDITOR_A)).perms, []);
    assert.deepEqual((await me(ADMIN)).perms, ['events', 'news', 'invites', 'plans', 'directory']);
  });
});
