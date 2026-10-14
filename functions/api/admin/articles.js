// /api/admin/articles  (content staff) — write and manage articles.
//   GET    ?column_id=&status=&q=&limit=&offset= → { rows, total }: articles
//          without their bodies, newest edit first, only in the columns the
//          caller may write in.
//   GET    ?id= → { article }: the full row.
//   POST   { column_id, title_en | title_zh, …fields } → { article }. slug is
//          optional: made from the English title, else a short random id.
//   PATCH  { id, …fields } → { article }. Moving an article to another column
//          needs write access to both columns.
//   DELETE ?id= (or body { id }) → { ok }.
// An administrator writes in every column; a content editor only in the
// columns of their content_editors row (or all of them). Everything else is
// 403, including reading an article in someone else's column. The fields and
// their limits are articleFields in _content.js; the bodies are cleaned of
// script on the way in, and again by DOMPurify on every render.
import { json, bad, sb } from '../_lib.js';
import {
  contentRole,
  canWriteColumn,
  articleFields,
  stampPublished,
  slugify,
  randomSlug,
  isUniqueViolation,
  UUID_RE,
  MAX_SLUG,
  SUMMARY_COLS,
} from '../_content.js';

const LIST_COLS = `${SUMMARY_COLS},status,created_at,updated_at`;
const FULL_COLS = `${LIST_COLS},body_en,body_zh,created_by,updated_by`;
const MAX_LIMIT = 100;
const NOT_YOURS = 'You do not have access to articles in this column.';
const clash = (slug) =>
  bad(`Another article already uses the address "${slug}". Choose a different slug.`, 409);

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

async function idFrom(request) {
  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) id = (await readBody(request))?.id || '';
  return String(id);
}

export async function onRequestGet({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  const { role } = gate;
  const url = new URL(request.url);
  const DB = sb(env);

  try {
    if (url.searchParams.has('id')) {
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return bad('Article not found.', 404);
      const article = await DB.selectOne('articles', { id }, FULL_COLS);
      if (!article) return bad('Article not found.', 404);
      if (!canWriteColumn(role, article.column_id)) return bad(NOT_YOURS, 403);
      return json({ article });
    }

    const filters = [];
    // An editor's list is limited to their columns before any other filter,
    // so no combination of parameters reaches past it.
    if (!role.is_admin && !role.all_columns) {
      const ids = role.column_ids.filter((c) => UUID_RE.test(c));
      if (!ids.length) return json({ rows: [], total: 0 });
      filters.push(`column_id=in.(${ids.join(',')})`);
    }
    const columnId = (url.searchParams.get('column_id') || '').trim();
    if (columnId) {
      if (!UUID_RE.test(columnId)) return bad('Unknown column.');
      if (!canWriteColumn(role, columnId)) return json({ rows: [], total: 0 });
      filters.push(`column_id=eq.${columnId}`);
    }
    const status = (url.searchParams.get('status') || '').trim();
    if (status) {
      if (status !== 'draft' && status !== 'published') return bad('Status is draft or published.');
      filters.push(`status=eq.${status}`);
    }
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      const cleaned = q.replace(/[(),*"]/g, ' ').trim(); // strip PostgREST meta chars
      if (cleaned) {
        const safe = encodeURIComponent(cleaned.replace(/[\\%_]/g, (c) => `\\${c}`));
        filters.push(`or=(title_en.ilike.*${safe}*,title_zh.ilike.*${safe}*,slug.ilike.*${safe}*)`);
      }
    }
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1),
      MAX_LIMIT,
    );
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const { rows, total } = await DB.select('articles', {
      columns: LIST_COLS,
      filters,
      order: 'updated_at.desc,id.asc',
      limit,
      offset,
      count: 'exact',
    });
    return json({ rows, total });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  const { role, member } = gate;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  const { fields, error } = articleFields(b);
  if (error) return bad(error);
  if (!fields.column_id) return bad('Choose a column.');
  if (!fields.title_en && !fields.title_zh)
    return bad('Give the article a title in English or Chinese.');
  if (!canWriteColumn(role, fields.column_id)) return bad(NOT_YOURS, 403);

  try {
    const DB = sb(env);
    const column = await DB.selectOne('article_columns', { id: fields.column_id }, 'id');
    if (!column) return bad('That column does not exist.');

    let slug = fields.slug;
    if (slug) {
      if (await DB.selectOne('articles', { slug }, 'id')) return clash(slug);
    } else {
      // Made up here, so a clash is ours to resolve: add a short random tail.
      slug = slugify(fields.title_en) || randomSlug();
      if (await DB.selectOne('articles', { slug }, 'id'))
        slug = `${slug.slice(0, MAX_SLUG - 5).replace(/-+$/, '')}-${randomSlug().slice(0, 4)}`;
    }
    stampPublished(fields, null);
    const rows = await DB.insert('articles', {
      ...fields,
      slug,
      created_by: member.id,
      updated_by: member.id,
    });
    return json({ article: rows[0] });
  } catch (e) {
    if (isUniqueViolation(e)) return clash(fields.slug || 'this one');
    return bad(e.message, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  const { role, member } = gate;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  const id = String(b.id || '');
  if (!id) return bad('Article id is required.');
  if (!UUID_RE.test(id)) return bad('Article not found.', 404);
  const { fields, error } = articleFields(b);
  if (error) return bad(error);
  if (!Object.keys(fields).length) return bad('Nothing to update.');

  try {
    const DB = sb(env);
    const current = await DB.selectOne('articles', { id }, FULL_COLS);
    if (!current) return bad('Article not found.', 404);
    if (!canWriteColumn(role, current.column_id)) return bad(NOT_YOURS, 403);
    if (fields.column_id && fields.column_id !== current.column_id) {
      if (!canWriteColumn(role, fields.column_id))
        return bad('You can only move an article into a column you write in.', 403);
      const column = await DB.selectOne('article_columns', { id: fields.column_id }, 'id');
      if (!column) return bad('That column does not exist.');
    }
    const titleEn = fields.title_en ?? current.title_en;
    const titleZh = fields.title_zh ?? current.title_zh;
    if (!titleEn && !titleZh) return bad('Give the article a title in English or Chinese.');
    if (fields.slug && fields.slug !== current.slug) {
      if (await DB.selectOne('articles', { slug: fields.slug }, 'id')) return clash(fields.slug);
    }
    stampPublished(fields, current);
    await DB.update(
      'articles',
      { id },
      { ...fields, updated_by: member.id, updated_at: new Date().toISOString() },
    );
    const article = await DB.selectOne('articles', { id }, FULL_COLS);
    return json({ article });
  } catch (e) {
    if (isUniqueViolation(e)) return clash(fields.slug || 'this one');
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  const { role } = gate;

  const id = await idFrom(request);
  if (!id) return bad('Article id is required.');
  if (!UUID_RE.test(id)) return bad('Article not found.', 404);
  try {
    const DB = sb(env);
    const current = await DB.selectOne('articles', { id }, 'id,column_id');
    if (!current) return bad('Article not found.', 404);
    if (!canWriteColumn(role, current.column_id)) return bad(NOT_YOURS, 403);
    await DB.del('articles', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
