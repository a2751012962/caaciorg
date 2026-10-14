// /api/admin/content-editors  (admin only) — who besides the administrators
// may write articles or edit page copy (content_editors, 0040).
//   GET    → { rows: [{ member_id, full_name, email, all_columns, column_ids,
//            can_edit_pages, perms }] }, by name.
//   POST   { email, all_columns, column_ids, can_edit_pages, perms? }
//          → { ok, row }:
//          grant or change the access of the member that email belongs to
//          (an upsert on member_id). 404 when no account has that email —
//          they sign up on the site first, as for /api/admin/roles.
//   DELETE ?member_id= (or body { member_id }) → { ok }: take it away.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { UUID_RE, inList, PERMS } from '../_content.js';

// Known permission names only, each once; anything else is dropped.
const cleanPerms = (v) =>
  Array.isArray(v) ? [...new Set(v.map(String))].filter((p) => PERMS.includes(p)) : [];

// '*': perms (0041) may not exist yet on a project with only 0040.
const COLS = '*';
const MAX_COLUMNS = 200;

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

// Names and emails for a set of member ids. A separate lookup rather than an
// embed: content_editors has two foreign keys to members (member_id and
// updated_by), which makes `members(...)` ambiguous to PostgREST.
async function people(DB, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { rows } = await DB.select('members', {
    columns: 'id,full_name,email',
    filters: [`id=in.${inList(unique)}`],
    limit: unique.length,
  });
  return new Map(rows.map((m) => [m.id, m]));
}

const withPerson = (row, who) => ({
  member_id: row.member_id,
  full_name: who?.full_name ?? '',
  email: who?.email ?? '',
  all_columns: row.all_columns === true,
  column_ids: Array.isArray(row.column_ids) ? row.column_ids : [],
  can_edit_pages: row.can_edit_pages === true,
  perms: Array.isArray(row.perms) ? row.perms : [],
});

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const DB = sb(env);
    const { rows } = await DB.select('content_editors', { columns: COLS, limit: 500 });
    const who = await people(
      DB,
      rows.map((r) => r.member_id),
    );
    const out = rows
      .map((r) => withPerson(r, who.get(r.member_id)))
      .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
    return json({ rows: out });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  const email = String(b.email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@*%(),\\]+@[^\s@*%(),\\]+\.[^\s@*%(),\\]+$/.test(email))
    return bad('Enter the email of their CAACI account.');
  for (const key of ['all_columns', 'can_edit_pages']) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') return bad(`${key} is true or false.`);
  }
  const raw = b.column_ids ?? [];
  if (!Array.isArray(raw)) return bad('column_ids is a list of column ids.');
  const columnIds = [...new Set(raw.map(String))];
  if (columnIds.length > MAX_COLUMNS) return bad('Too many columns.');
  if (columnIds.some((c) => !UUID_RE.test(c))) return bad('Unknown column.');

  try {
    const DB = sb(env);
    const { rows: found } = await DB.select('members', {
      columns: 'id,full_name,email',
      filters: [`email=ilike.${encodeURIComponent(email.replace(/_/g, '\\_'))}`],
      limit: 2,
    });
    if (found.length !== 1)
      return bad('No CAACI account matches. They need to sign up on the site first.', 404);
    const target = found[0];

    if (columnIds.length) {
      const { rows: known } = await DB.select('article_columns', {
        columns: 'id',
        filters: [`id=in.${inList(columnIds)}`],
        limit: columnIds.length,
      });
      if (known.length !== columnIds.length) return bad('Unknown column.');
    }

    const rows = await DB.upsert(
      'content_editors',
      {
        member_id: target.id,
        all_columns: b.all_columns === true,
        column_ids: columnIds,
        can_edit_pages: b.can_edit_pages === true,
        // Sent only when given, so a caller that predates 0041 never names a
        // column the table may not have yet.
        ...(b.perms !== undefined ? { perms: cleanPerms(b.perms) } : {}),
        updated_by: gate.member.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'member_id' },
    );
    return json({ ok: true, row: withPerson(rows[0], target) });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let id = new URL(request.url).searchParams.get('member_id') || '';
  if (!id) id = (await readBody(request))?.member_id || '';
  id = String(id);
  if (!id) return bad('member_id is required.');
  if (!UUID_RE.test(id)) return bad('Editor not found.', 404);
  try {
    const DB = sb(env);
    const row = await DB.selectOne('content_editors', { member_id: id }, 'member_id');
    if (!row) return bad('Editor not found.', 404);
    await DB.del('content_editors', { member_id: id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
