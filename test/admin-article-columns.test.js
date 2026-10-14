// /api/admin/article-columns — every content staff member reads the columns;
// only an administrator creates, renames or deletes one. A slug is unique and
// a column is not deleted while it still holds articles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPost,
  onRequestPatch,
  onRequestDelete,
} from '../functions/api/admin/article-columns.js';
import { fakeRequest, mockFetch, fakeEnv, asUser } from './helpers.js';
import {
  contentDb,
  ADMIN,
  EDITOR_A,
  EDITOR_ALL,
  STRANGER,
  COL_A,
  COL_B,
} from './content-fake-db.js';

const call = (handler, who, { qs = '', body } = {}) =>
  handler({
    request: fakeRequest({
      url: `https://caaci.example/api/admin/article-columns${qs}`,
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

test('read: staff see every column in sort order; others are refused', async () => {
  await withDb(async () => {
    assert.equal((await call(onRequestGet, null)).status, 401);
    assert.equal((await call(onRequestGet, STRANGER)).status, 403);
    const r = await call(onRequestGet, EDITOR_A);
    assert.equal(r.status, 200);
    assert.deepEqual(
      (await r.json()).rows.map((c) => c.slug),
      ['news', 'community'],
    );
  });
});

test('writes are admin only, even for an editor of every column', async () => {
  await withDb(async (db) => {
    for (const who of [EDITOR_A, EDITOR_ALL]) {
      assert.equal(
        (await call(onRequestPost, who, { body: { slug: 'x', name_en: 'X' } })).status,
        403,
      );
      assert.equal(
        (await call(onRequestPatch, who, { body: { id: COL_A, name_en: 'Mine' } })).status,
        403,
      );
      assert.equal((await call(onRequestDelete, who, { qs: `?id=${COL_B}` })).status, 403);
    }
    assert.equal(db.tables.article_columns.length, 2);
    assert.equal(db.tables.article_columns[0].name_en, 'CAACI News');
  });
});

test('create: validates the slug and name, refuses a clash with 409', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPost, ADMIN, {
      body: { slug: ' Arts ', name_en: ' Arts ', name_zh: '艺术', sort_order: 40 },
    });
    assert.equal(r.status, 200);
    const { column } = await r.json();
    assert.deepEqual(
      [column.slug, column.name_en, column.name_zh, column.sort_order],
      ['arts', 'Arts', '艺术', 40],
    );
    assert.equal(db.tables.article_columns.length, 3);

    const clash = await call(onRequestPost, ADMIN, { body: { slug: 'news', name_en: 'News 2' } });
    assert.equal(clash.status, 409);
    assert.match((await clash.json()).error, /"news"/);

    assert.equal(
      (await call(onRequestPost, ADMIN, { body: { slug: 'bad slug', name_en: 'x' } })).status,
      400,
    );
    assert.equal((await call(onRequestPost, ADMIN, { body: { slug: 'nameless' } })).status, 400);
    assert.equal((await call(onRequestPost, ADMIN, { body: { name_en: 'No slug' } })).status, 400);
    assert.equal(
      (await call(onRequestPost, ADMIN, { body: { slug: 'x', name_en: 'X', sort_order: 1.5 } }))
        .status,
      400,
    );
  });
});

test('edit: renames, and a slug clash is 409', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPatch, ADMIN, {
      body: { id: COL_A, name_en: 'Association News', description_zh: '最新消息' },
    });
    assert.equal(r.status, 200);
    const { column } = await r.json();
    assert.equal(column.name_en, 'Association News');
    assert.equal(column.description_zh, '最新消息');

    const clash = await call(onRequestPatch, ADMIN, { body: { id: COL_A, slug: 'community' } });
    assert.equal(clash.status, 409);
    assert.equal(db.tables.article_columns.find((c) => c.id === COL_A).slug, 'news');

    assert.equal(
      (await call(onRequestPatch, ADMIN, { body: { id: COL_A, name_en: '', name_zh: '' } })).status,
      400,
    );
  });
});

test('delete: 409 while articles remain; an empty column goes, and editors lose the grant', async () => {
  await withDb(async (db) => {
    const busy = await call(onRequestDelete, ADMIN, { qs: `?id=${COL_A}` });
    assert.equal(busy.status, 409);
    assert.match((await busy.json()).error, /still has 2 articles/);
    assert.ok(db.tables.article_columns.some((c) => c.id === COL_A));

    // empty column A, then delete it
    for (const a of db.tables.articles.filter((x) => x.column_id === COL_A)) a.column_id = COL_B;
    const ok = await call(onRequestDelete, ADMIN, { qs: `?id=${COL_A}` });
    assert.equal(ok.status, 200);
    assert.ok(!db.tables.article_columns.some((c) => c.id === COL_A));
    const ed = db.tables.content_editors.find((e) => e.member_id === EDITOR_A);
    assert.deepEqual(ed.column_ids, []);

    assert.equal((await call(onRequestDelete, ADMIN, { qs: `?id=${COL_A}` })).status, 404);
  });
});
