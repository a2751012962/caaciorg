// /api/admin/article-columns — the columns (专栏) articles are filed under.
//   GET                → { rows }: every column, in sort order (content staff:
//                        an editor's column picker shows them all and greys
//                        out the ones they may not write in).
//   POST   { slug, name_en, name_zh, description_en?, description_zh?, sort_order? }
//                      → { column } (admin only).
//   PATCH  { id, …the same fields } → { column } (admin only).
//   DELETE ?id= (or body { id }) → { ok } (admin only). 409 while the column
//          still holds articles: they are moved or deleted first (the foreign
//          key is on delete restrict). Editors' grants of the column go too.
// A slug is lowercase ascii words joined by hyphens and is unique: a clash is 409.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import {
  contentRole,
  slugOf,
  isUniqueViolation,
  isForeignKeyViolation,
  UUID_RE,
} from '../_content.js';

const COLS =
  'id,slug,name_en,name_zh,description_en,description_zh,sort_order,created_at,updated_at';
const MAX_NAME = 80;
const MAX_DESCRIPTION = 600;
const clash = (slug) =>
  bad(`Another column already uses the address "${slug}". Choose a different slug.`, 409);

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

// The column fields that were sent, cleaned: { fields } or { error }.
function columnFields(b) {
  const fields = {};
  if (b.slug !== undefined) {
    const slug = slugOf(b.slug);
    if (slug.error) return { error: slug.error };
    fields.slug = slug;
  }
  const texts = {
    name_en: [MAX_NAME, 'The English name'],
    name_zh: [MAX_NAME, 'The Chinese name'],
    description_en: [MAX_DESCRIPTION, 'The English description'],
    description_zh: [MAX_DESCRIPTION, 'The Chinese description'],
  };
  for (const [key, [max, label]] of Object.entries(texts)) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && typeof b[key] !== 'string') return { error: `${label} must be text.` };
    const value = (b[key] ?? '').trim();
    if (value.length > max) return { error: `${label} is at most ${max} characters.` };
    fields[key] = value;
  }
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    if (!Number.isInteger(n) || Math.abs(n) > 1_000_000)
      return { error: 'Sort order is a whole number.' };
    fields.sort_order = n;
  }
  return { fields };
}

export async function onRequestGet({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  try {
    const { rows } = await sb(env).select('article_columns', {
      columns: COLS,
      order: 'sort_order.asc,name_en.asc',
      limit: 200,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  if (b.slug === undefined) return bad('Give the column a slug (its web address).');
  const { fields, error } = columnFields(b);
  if (error) return bad(error);
  if (!fields.name_en && !fields.name_zh) return bad('Give the column a name.');

  try {
    const DB = sb(env);
    if (await DB.selectOne('article_columns', { slug: fields.slug }, 'id'))
      return clash(fields.slug);
    const rows = await DB.insert('article_columns', fields);
    return json({ column: rows[0] });
  } catch (e) {
    if (isUniqueViolation(e)) return clash(fields.slug);
    return bad(e.message, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  const id = String(b.id || '');
  if (!id) return bad('Column id is required.');
  if (!UUID_RE.test(id)) return bad('Column not found.', 404);
  const { fields, error } = columnFields(b);
  if (error) return bad(error);
  if (!Object.keys(fields).length) return bad('Nothing to update.');

  try {
    const DB = sb(env);
    const current = await DB.selectOne('article_columns', { id }, COLS);
    if (!current) return bad('Column not found.', 404);
    const nameEn = fields.name_en ?? current.name_en;
    const nameZh = fields.name_zh ?? current.name_zh;
    if (!nameEn && !nameZh) return bad('Give the column a name.');
    if (fields.slug && fields.slug !== current.slug) {
      if (await DB.selectOne('article_columns', { slug: fields.slug }, 'id'))
        return clash(fields.slug);
    }
    await DB.update('article_columns', { id }, { ...fields, updated_at: new Date().toISOString() });
    const column = await DB.selectOne('article_columns', { id }, COLS);
    return json({ column });
  } catch (e) {
    if (isUniqueViolation(e)) return clash(fields.slug || 'this one');
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) id = (await readBody(request))?.id || '';
  id = String(id);
  if (!id) return bad('Column id is required.');
  if (!UUID_RE.test(id)) return bad('Column not found.', 404);

  try {
    const DB = sb(env);
    const current = await DB.selectOne('article_columns', { id }, 'id');
    if (!current) return bad('Column not found.', 404);
    const { total } = await DB.select('articles', {
      columns: 'id',
      filters: [`column_id=eq.${id}`],
      limit: 1,
      count: 'exact',
    });
    if (total > 0)
      return bad(
        `This column still has ${total} article${total === 1 ? '' : 's'}. Move or delete them first.`,
        409,
      );
    await DB.del('article_columns', { id });
    // Editors granted this column keep no dangling id for it.
    const { rows: editors } = await DB.select('content_editors', {
      columns: 'member_id,column_ids',
      filters: [`column_ids=cs.%7B${id}%7D`],
      limit: 500,
    });
    for (const ed of editors) {
      await DB.update(
        'content_editors',
        { member_id: ed.member_id },
        { column_ids: (ed.column_ids || []).filter((c) => c !== id) },
      );
    }
    return json({ ok: true });
  } catch (e) {
    if (isForeignKeyViolation(e))
      return bad('This column still has articles. Move or delete them first.', 409);
    return bad(e.message, 500);
  }
}
