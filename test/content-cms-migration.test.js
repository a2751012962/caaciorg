// 0040 — columns, articles, content editors and page copy, run in PGlite: the
// tables and their checks, the seeded columns, a column that cannot be deleted
// while it holds articles, a second paste that changes nothing, and the four
// tables staying out of reach of the browser roles.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const OWN = new URL('../supabase/migrations/0040_content_cms.sql', import.meta.url);
const MEMBER = '00000000-0000-4000-8000-000000000001';
const TABLES = ['article_columns', 'articles', 'content_editors', 'site_content'];

let db;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const refuses = async (sql, params, pattern) =>
  assert.rejects(() => db.query(sql, params), pattern, sql);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.members (id uuid primary key, full_name text, email text,
      is_admin boolean not null default false);
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  const sql = await readFile(OWN, 'utf8');
  await db.exec(sql);
  await db.exec(`update public.article_columns set name_en = 'Renamed' where slug = 'news'`);
  // pasting it twice must be safe, and must not undo an edit
  await db.exec(sql);
  await db.query(`insert into public.members (id, full_name) values ($1, 'Ann')`, [MEMBER]);
});

test('the three columns are seeded once, and a re-paste keeps an edit', async () => {
  const rows = (
    await db.query('select slug, name_en, name_zh from public.article_columns order by sort_order')
  ).rows;
  assert.deepEqual(rows, [
    { slug: 'news', name_en: 'Renamed', name_zh: '协会动态' },
    { slug: 'community', name_en: 'Community Stories', name_zh: '社区故事' },
    { slug: 'members', name_en: 'Member Spotlight', name_zh: '会员风采' },
  ]);
});

test('articles: defaults, slug pattern, status and the title check', async () => {
  const col = (await one(`select id from public.article_columns where slug = 'news'`)).id;
  const a = await one(
    `insert into public.articles (column_id, slug, title_zh, created_by) values ($1, 'first-post', '标题', $2)
     returning status, published_at, pinned, body_en, cover_url, created_at, updated_at`,
    [col, MEMBER],
  );
  assert.equal(a.status, 'draft');
  assert.equal(a.published_at, null);
  assert.equal(a.pinned, false);
  assert.equal(a.body_en, '');
  assert.equal(a.cover_url, null);
  assert.ok(a.created_at && a.updated_at);

  await refuses(
    `insert into public.articles (column_id, slug, title_en) values ($1, 'Bad Slug', 'x')`,
    [col],
    /check/i,
  );
  await refuses(
    `insert into public.articles (column_id, slug, title_en) values ($1, 'first-post', 'x')`,
    [col],
    /duplicate key|unique/i,
  );
  await refuses(
    `insert into public.articles (column_id, slug) values ($1, 'no-title')`,
    [col],
    /check/i,
  );
  await refuses(
    `insert into public.articles (column_id, slug, title_en, status) values ($1, 'live', 'x', 'live')`,
    [col],
    /check/i,
  );
});

test('a column holding articles cannot be deleted; an empty one can', async () => {
  await refuses(`delete from public.article_columns where slug = 'news'`, [], /foreign key/i);
  await db.query(`delete from public.article_columns where slug = 'members'`);
  assert.equal(
    (await one(`select count(*)::int as n from public.article_columns where slug = 'members'`)).n,
    0,
  );
});

test('deleting a member clears their name from articles and removes their editor row', async () => {
  const other = '00000000-0000-4000-8000-000000000002';
  await db.query(`insert into public.members (id, full_name) values ($1, 'Bo')`, [other]);
  const col = (await one(`select id from public.article_columns where slug = 'community'`)).id;
  await db.query(
    `insert into public.articles (column_id, slug, title_en, created_by, updated_by) values ($1, 'by-bo', 'x', $2, $2)`,
    [col, other],
  );
  await db.query(
    `insert into public.content_editors (member_id, column_ids) values ($1, array[$2]::uuid[])`,
    [other, col],
  );
  await db.query(`delete from public.members where id = $1`, [other]);
  const a = await one(`select created_by, updated_by from public.articles where slug = 'by-bo'`);
  assert.deepEqual(a, { created_by: null, updated_by: null });
  assert.equal(
    (
      await one(`select count(*)::int as n from public.content_editors where member_id = $1`, [
        other,
      ])
    ).n,
    0,
  );
});

test('content_editors and site_content defaults and key pattern', async () => {
  const e = await one(
    `insert into public.content_editors (member_id) values ($1)
     returning all_columns, column_ids, can_edit_pages`,
    [MEMBER],
  );
  assert.deepEqual(e, { all_columns: false, column_ids: [], can_edit_pages: false });
  await db.query(
    `insert into public.site_content (key, value_en) values ('about.missionText', '"Hi"'::jsonb)`,
  );
  const s = await one(
    `select value_en, value_zh from public.site_content where key = 'about.missionText'`,
  );
  assert.deepEqual(s, { value_en: 'Hi', value_zh: null });
  await refuses(`insert into public.site_content (key) values ('bad key!')`, [], /check/i);
});

test('the four tables have RLS on, no policies, and no privileges for anon or authenticated', async () => {
  for (const t of TABLES) {
    const { rls } = await one(
      `select relrowsecurity as rls from pg_class where oid = ('public.' || $1)::regclass`,
      [t],
    );
    assert.equal(rls, true, `${t} has RLS`);
    const { n } = await one(
      `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = $1`,
      [t],
    );
    assert.equal(n, 0, `${t} has no policies`);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const { ok } = await one(`select has_table_privilege($1, $2, $3) as ok`, [
          role,
          `public.${t}`,
          priv,
        ]);
        assert.equal(ok, false, `${role} can ${priv} ${t}`);
      }
    }
  }
});
