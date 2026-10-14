// /api/admin/articles — content staff write articles. An administrator writes
// in every column; an editor only in the columns of their content_editors row,
// and nothing — not a read, an edit, a delete or a move — reaches past it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPost,
  onRequestPatch,
  onRequestDelete,
} from '../functions/api/admin/articles.js';
import { onRequestGet as contentMe } from '../functions/api/admin/content-me.js';
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
  ART_A,
  ART_B,
  DRAFT_A,
} from './content-fake-db.js';

const URL_BASE = 'https://caaci.example/api/admin/articles';
const call = (handler, who, { qs = '', body } = {}) =>
  handler({
    request: fakeRequest({ url: `${URL_BASE}${qs}`, headers: who ? asUser(who) : {}, body }),
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
const row = (db, id) => db.tables.articles.find((a) => a.id === id);

test('no token is 401; a member who is not staff is 403', async () => {
  await withDb(async () => {
    assert.equal((await call(onRequestGet, null)).status, 401);
    const r = await call(onRequestGet, STRANGER);
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /Content editor access required/);
    assert.equal((await call(onRequestPost, STRANGER, { body: {} })).status, 403);
    assert.equal((await call(contentMe, STRANGER)).status, 403);
  });
});

test('content-me answers each role', async () => {
  await withDb(async () => {
    assert.deepEqual(await (await call(contentMe, ADMIN)).json(), {
      is_admin: true,
      all_columns: true,
      column_ids: [],
      can_edit_pages: true,
      perms: ['events', 'news', 'invites', 'plans', 'directory'],
    });
    assert.deepEqual(await (await call(contentMe, EDITOR_A)).json(), {
      is_admin: false,
      all_columns: false,
      column_ids: [COL_A],
      can_edit_pages: false,
      perms: [],
    });
    assert.deepEqual(await (await call(contentMe, PAGES)).json(), {
      is_admin: false,
      all_columns: false,
      column_ids: [],
      can_edit_pages: true,
      perms: [],
    });
  });
});

test('list: an admin sees every column, an editor only theirs, without bodies', async () => {
  await withDb(async () => {
    const all = await (await call(onRequestGet, ADMIN)).json();
    assert.equal(all.total, 3);
    assert.equal(all.rows[0].body_en, undefined);
    assert.ok(all.rows.every((r) => 'status' in r && 'updated_at' in r));

    const mine = await (await call(onRequestGet, EDITOR_A)).json();
    assert.deepEqual(mine.rows.map((r) => r.id).sort(), [ART_A, DRAFT_A].sort());

    // asking for column B by name still returns nothing
    const theirs = await (await call(onRequestGet, EDITOR_A, { qs: `?column_id=${COL_B}` })).json();
    assert.deepEqual(theirs, { rows: [], total: 0 });

    // the page-copy editor has no column at all
    const none = await (await call(onRequestGet, PAGES)).json();
    assert.deepEqual(none, { rows: [], total: 0 });

    const everything = await (await call(onRequestGet, EDITOR_ALL)).json();
    assert.equal(everything.total, 3);
  });
});

test('list: status and search filters', async () => {
  await withDb(async () => {
    const drafts = await (await call(onRequestGet, ADMIN, { qs: '?status=draft' })).json();
    assert.deepEqual(
      drafts.rows.map((r) => r.id),
      [DRAFT_A],
    );
    const found = await (await call(onRequestGet, ADMIN, { qs: '?q=river' })).json();
    assert.deepEqual(
      found.rows.map((r) => r.id),
      [ART_B],
    );
    assert.equal((await call(onRequestGet, ADMIN, { qs: '?status=live' })).status, 400);
  });
});

test('one article: the full row in your column, 403 in another, 404 when missing', async () => {
  await withDb(async () => {
    const r = await call(onRequestGet, EDITOR_A, { qs: `?id=${ART_A}` });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).article.body_en, '<p>Gala body</p>');
    assert.equal((await call(onRequestGet, EDITOR_A, { qs: `?id=${ART_B}` })).status, 403);
    assert.equal(
      (await call(onRequestGet, ADMIN, { qs: '?id=d0000000-0000-4000-8000-0000000000ff' })).status,
      404,
    );
    assert.equal((await call(onRequestGet, ADMIN, { qs: '?id=nope' })).status, 404);
  });
});

test('create: a slug from the English title, cleaned body, the author stamped', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPost, EDITOR_A, {
      body: {
        column_id: COL_A,
        title_en: 'Moon Festival Recap!',
        body_en: '<p onclick="x()">Hi</p><script>steal()</script><iframe src="x"></iframe>',
        created_by: ADMIN, // ignored: the caller is the author
      },
    });
    assert.equal(r.status, 200);
    const { article } = await r.json();
    assert.equal(article.slug, 'moon-festival-recap');
    assert.equal(article.body_en, '<p>Hi</p>');
    assert.equal(article.status, 'draft');
    assert.equal(article.published_at, null);
    assert.equal(article.created_by, EDITOR_A);
    assert.equal(article.updated_by, EDITOR_A);
    assert.equal(row(db, article.id).body_en, '<p>Hi</p>');
  });
});

test('create: a Chinese-only title gets a short random slug; publishing stamps now', async () => {
  await withDb(async () => {
    const before = Date.now();
    const r = await call(onRequestPost, ADMIN, {
      body: { column_id: COL_B, title_zh: '中秋晚会', status: 'published' },
    });
    assert.equal(r.status, 200);
    const { article } = await r.json();
    assert.match(article.slug, /^[0-9a-f]{8}$/);
    assert.ok(Date.parse(article.published_at) >= before - 1000);
  });
});

test('create: a made-up slug that is taken gets a tail; an explicit one is 409', async () => {
  await withDb(async () => {
    const auto = await call(onRequestPost, ADMIN, {
      body: { column_id: COL_A, title_en: 'Spring Gala' },
    });
    assert.equal(auto.status, 200);
    assert.match((await auto.json()).article.slug, /^spring-gala-[0-9a-f]{4}$/);

    const r = await call(onRequestPost, ADMIN, {
      body: { column_id: COL_A, title_en: 'Again', slug: 'spring-gala' },
    });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /already uses the address "spring-gala"/);
  });
});

test('create: refuses column B for an editor of A, a missing title, an unknown column', async () => {
  await withDb(async (db) => {
    const count = db.tables.articles.length;
    assert.equal(
      (await call(onRequestPost, EDITOR_A, { body: { column_id: COL_B, title_en: 'x' } })).status,
      403,
    );
    assert.equal((await call(onRequestPost, EDITOR_A, { body: { column_id: COL_A } })).status, 400);
    assert.equal(
      (
        await call(onRequestPost, ADMIN, {
          body: { column_id: 'c0000000-0000-4000-8000-0000000000ff', title_en: 'x' },
        })
      ).status,
      400,
    );
    assert.equal((await call(onRequestPost, ADMIN, { body: 'not json' })).status, 400);
    assert.equal(db.tables.articles.length, count, 'nothing was written');
  });
});

test('edit: an editor of A edits in A, but cannot edit, delete or move into B', async () => {
  await withDb(async (db) => {
    const ok = await call(onRequestPatch, EDITOR_A, {
      body: { id: ART_A, title_en: 'Spring Gala 2026', body_en: '<p style="color:red">x</p>' },
    });
    assert.equal(ok.status, 200);
    const { article } = await ok.json();
    assert.equal(article.title_en, 'Spring Gala 2026');
    assert.equal(article.body_en, '<p>x</p>');
    assert.equal(article.updated_by, EDITOR_A);

    const other = await call(onRequestPatch, EDITOR_A, { body: { id: ART_B, title_en: 'Mine' } });
    assert.equal(other.status, 403);
    assert.equal(row(db, ART_B).title_en, 'River Walk');

    const move = await call(onRequestPatch, EDITOR_A, { body: { id: ART_A, column_id: COL_B } });
    assert.equal(move.status, 403);
    assert.equal(row(db, ART_A).column_id, COL_A);

    const del = await call(onRequestDelete, EDITOR_A, { qs: `?id=${ART_B}` });
    assert.equal(del.status, 403);
    assert.ok(row(db, ART_B), 'still there');
  });
});

test('edit: an editor of every column, or an admin, may move an article', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPatch, EDITOR_ALL, { body: { id: ART_A, column_id: COL_B } });
    assert.equal(r.status, 200);
    assert.equal(row(db, ART_A).column_id, COL_B);
  });
});

test('edit: a slug clash is 409; emptying both titles is 400; nothing to change is 400', async () => {
  await withDb(async (db) => {
    const clash = await call(onRequestPatch, ADMIN, { body: { id: DRAFT_A, slug: 'river-walk' } });
    assert.equal(clash.status, 409);
    assert.equal(row(db, DRAFT_A).slug, 'unfinished');

    const untitled = await call(onRequestPatch, ADMIN, { body: { id: ART_A, title_en: '' } });
    assert.equal(untitled.status, 400);

    assert.equal((await call(onRequestPatch, ADMIN, { body: { id: ART_A } })).status, 400);
    assert.equal(
      (
        await call(onRequestPatch, ADMIN, {
          body: { id: 'd0000000-0000-4000-8000-0000000000ff', title_en: 'x' },
        })
      ).status,
      404,
    );
  });
});

test('edit: publishing a draft without a date stamps now; a scheduled date is kept', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPatch, EDITOR_A, { body: { id: DRAFT_A, status: 'published' } });
    assert.equal(r.status, 200);
    assert.ok(row(db, DRAFT_A).published_at);

    const later = '2030-01-01T00:00:00.000Z';
    await call(onRequestPatch, EDITOR_A, { body: { id: DRAFT_A, published_at: later } });
    assert.equal(row(db, DRAFT_A).published_at, later);
  });
});

test('delete: removes an article in your column', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestDelete, EDITOR_A, { qs: `?id=${DRAFT_A}` });
    assert.equal(r.status, 200);
    assert.equal(row(db, DRAFT_A), undefined);
    assert.equal((await call(onRequestDelete, ADMIN, { qs: `?id=${DRAFT_A}` })).status, 404);
  });
});
