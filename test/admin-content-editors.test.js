// /api/admin/content-editors — only an administrator grants, changes or takes
// away content-editor access, by the email of an existing CAACI account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPost,
  onRequestDelete,
} from '../functions/api/admin/content-editors.js';
import { fakeRequest, mockFetch, fakeEnv, asUser } from './helpers.js';
import {
  contentDb,
  ADMIN,
  EDITOR_A,
  EDITOR_ALL,
  PAGES,
  STRANGER,
  COL_A,
  COL_B,
} from './content-fake-db.js';

const call = (handler, who, { qs = '', body } = {}) =>
  handler({
    request: fakeRequest({
      url: `https://caaci.example/api/admin/content-editors${qs}`,
      headers: who ? asUser(who) : {},
      body,
    }),
    env: fakeEnv(),
  });

async function withDb(fn) {
  const db = contentDb();
  const fetch = mockFetch(db.route);
  try {
    return await fn(db, fetch);
  } finally {
    fetch.restore();
  }
}

test('admin only: no token 401, editors and members 403', async () => {
  await withDb(async (db) => {
    assert.equal((await call(onRequestGet, null)).status, 401);
    for (const who of [EDITOR_A, EDITOR_ALL, PAGES, STRANGER]) {
      assert.equal((await call(onRequestGet, who)).status, 403);
      assert.equal(
        (
          await call(onRequestPost, who, {
            body: { email: 'sam.stranger@example.com', all_columns: true },
          })
        ).status,
        403,
      );
      assert.equal(
        (await call(onRequestDelete, who, { qs: `?member_id=${EDITOR_A}` })).status,
        403,
      );
    }
    assert.equal(db.tables.content_editors.length, 3);
  });
});

test('list: every editor with name and email', async () => {
  await withDb(async () => {
    const r = await call(onRequestGet, ADMIN);
    assert.equal(r.status, 200);
    const { rows } = await r.json();
    assert.deepEqual(
      rows.map((e) => e.full_name),
      ['Ed Column', 'Eve Everything', 'Paige Pages'],
    );
    assert.deepEqual(rows[0], {
      member_id: EDITOR_A,
      full_name: 'Ed Column',
      email: 'ed.column@example.com',
      all_columns: false,
      column_ids: [COL_A],
      can_edit_pages: false,
      perms: [],
    });
  });
});

test('grant: by account email, returns the saved row; changing it again updates in place', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPost, ADMIN, {
      body: {
        email: ' Sam.Stranger@Example.com ',
        column_ids: [COL_B, COL_B],
        can_edit_pages: true,
      },
    });
    assert.equal(r.status, 200);
    const { row } = await r.json();
    assert.deepEqual(row, {
      member_id: STRANGER,
      full_name: 'Sam Stranger',
      email: 'sam.stranger@example.com',
      all_columns: false,
      column_ids: [COL_B],
      can_edit_pages: true,
      perms: [],
    });
    const stored = db.tables.content_editors.find((e) => e.member_id === STRANGER);
    assert.equal(stored.updated_by, ADMIN);

    await call(onRequestPost, ADMIN, {
      body: { email: 'sam.stranger@example.com', all_columns: true, column_ids: [] },
    });
    const again = db.tables.content_editors.filter((e) => e.member_id === STRANGER);
    assert.equal(again.length, 1);
    assert.equal(again[0].all_columns, true);
    assert.equal(again[0].can_edit_pages, false);
  });
});

test('grant: 404 for an email with no account, 400 for unknown columns or a bad email', async () => {
  await withDb(async (db) => {
    const missing = await call(onRequestPost, ADMIN, {
      body: { email: 'nobody@example.com', all_columns: true },
    });
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /sign up/);

    const unknown = await call(onRequestPost, ADMIN, {
      body: {
        email: 'sam.stranger@example.com',
        column_ids: [COL_A, 'c0000000-0000-4000-8000-0000000000ff'],
      },
    });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).error, /Unknown column/);

    assert.equal(
      (await call(onRequestPost, ADMIN, { body: { email: 'x', column_ids: [] } })).status,
      400,
    );
    assert.equal(
      (
        await call(onRequestPost, ADMIN, {
          body: { email: 'sam.stranger@example.com', column_ids: ['not-a-uuid'] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(onRequestPost, ADMIN, {
          body: { email: 'sam.stranger@example.com', all_columns: 'yes' },
        })
      ).status,
      400,
    );
    assert.ok(!db.tables.content_editors.some((e) => e.member_id === STRANGER));
  });
});

test('revoke: removes the row; a second time is 404', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestDelete, ADMIN, { qs: `?member_id=${EDITOR_A}` });
    assert.equal(r.status, 200);
    assert.ok(!db.tables.content_editors.some((e) => e.member_id === EDITOR_A));
    assert.equal(
      (await call(onRequestDelete, ADMIN, { qs: `?member_id=${EDITOR_A}` })).status,
      404,
    );
  });
});
