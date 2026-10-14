// /api/admin/staff — who may use the back office, in one list (My account →
// Back-office access). Three roles:
//   root    — members.is_root; set in the SQL editor only, never here.
//   admin   — members.is_admin; everything. Only root appoints or changes one,
//             since an admin can hand out tokens and refund payments.
//   content — a content_editors row (0040/0041): some or all article columns,
//             page copy, and any of PERMS (events, news, invites, plans,
//             directory) — whichever are ticked. Any admin manages these.
//
//   GET  → { rows: [{ member_id, full_name, email, role, all_columns,
//            column_ids, can_edit_pages, perms }], caller_is_root }
//          Root sees everyone; another admin sees the content managers only
//          (the admin list stays root's, as /api/admin/roles always was).
//   POST { email | member_id, role: 'admin' | 'content' | 'none',
//          all_columns, column_ids, can_edit_pages, perms }
//          → { ok, row }.
//
// Nothing is taken away on the side: making an admin a content manager writes
// the content row first and only then clears is_admin; making a content
// manager an admin keeps their content row (it simply stops mattering). Root
// and the caller's own role are never changed here.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { UUID_RE, inList, PERMS } from '../_content.js';

const MAX_COLUMNS = 200;
const PEOPLE = 'id,full_name,email,is_admin,is_root';
const EMAIL_RE = /^[^\s@*%(),\\]+@[^\s@*%(),\\]+\.[^\s@*%(),\\]+$/;

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

const roleOf = (m, editor) =>
  m?.is_root === true ? 'root' : m?.is_admin === true ? 'admin' : editor ? 'content' : 'none';

const shape = (m, editor) => ({
  member_id: m.id,
  full_name: m.full_name ?? '',
  email: m.email ?? '',
  role: roleOf(m, editor),
  all_columns: editor?.all_columns === true,
  column_ids: Array.isArray(editor?.column_ids) ? editor.column_ids : [],
  can_edit_pages: editor?.can_edit_pages === true,
  perms: Array.isArray(editor?.perms) ? editor.perms : [],
});

async function caller(DB, gate) {
  const me = await DB.selectOne('members', { id: gate.member.id }, PEOPLE);
  return { id: gate.member.id, is_root: me?.is_root === true };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const DB = sb(env);
    const me = await caller(DB, gate);
    const { rows: editors } = await DB.select('content_editors', { columns: '*', limit: 500 });
    const byMember = new Map(editors.map((e) => [e.member_id, e]));

    const people = new Map();
    if (editors.length) {
      const { rows } = await DB.select('members', {
        columns: PEOPLE,
        filters: [`id=in.${inList([...byMember.keys()])}`],
        limit: editors.length,
      });
      for (const m of rows) people.set(m.id, m);
    }
    if (me.is_root) {
      const { rows } = await DB.select('members', {
        columns: PEOPLE,
        filters: ['or=(is_admin.eq.true,is_root.eq.true)'],
        limit: 200,
      });
      for (const m of rows) people.set(m.id, m);
    }

    const order = { root: 0, admin: 1, content: 2, none: 3 };
    const out = [...people.values()]
      .map((m) => shape(m, byMember.get(m.id)))
      // An admin who also keeps a content row shows to a non-root admin only
      // as what they are: an admin, which that caller may not see or change.
      .filter((r) => me.is_root || r.role === 'content')
      .sort(
        (a, b) =>
          order[a.role] - order[b.role] ||
          (a.full_name || a.email).localeCompare(b.full_name || b.email),
      );
    return json({ rows: out, caller_is_root: me.is_root });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const b = await readBody(request);
  if (!b) return bad('invalid JSON');
  const role = b.role;
  if (!['admin', 'content', 'none'].includes(role)) return bad('role is admin, content or none.');
  for (const key of ['all_columns', 'can_edit_pages']) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') return bad(`${key} is true or false.`);
  }
  const raw = b.column_ids ?? [];
  if (!Array.isArray(raw)) return bad('column_ids is a list of column ids.');
  const columnIds = [...new Set(raw.map(String))];
  if (columnIds.length > MAX_COLUMNS) return bad('Too many columns.');
  if (columnIds.some((c) => !UUID_RE.test(c))) return bad('Unknown column.');
  const allColumns = b.all_columns === true;
  const pages = b.can_edit_pages === true;
  if (b.perms !== undefined && !Array.isArray(b.perms)) return bad('perms is a list.');
  const perms = [...new Set((b.perms || []).map(String))];
  if (perms.some((p) => !PERMS.includes(p))) return bad('Unknown permission.');
  if (role === 'content' && !allColumns && !columnIds.length && !pages && !perms.length)
    return bad('Give a content manager at least one permission.');

  try {
    const DB = sb(env);
    const me = await caller(DB, gate);

    let target = null;
    if (UUID_RE.test(String(b.member_id || ''))) {
      target = await DB.selectOne('members', { id: String(b.member_id) }, PEOPLE);
    } else {
      const email = String(b.email || '')
        .trim()
        .toLowerCase();
      if (!EMAIL_RE.test(email)) return bad('Enter the email of their CAACI account.');
      const { rows } = await DB.select('members', {
        columns: PEOPLE,
        filters: [`email=ilike.${encodeURIComponent(email.replace(/_/g, '\\_'))}`],
        limit: 2,
      });
      if (rows.length === 1) target = rows[0];
    }
    if (!target)
      return bad('No CAACI account matches. They need to sign up on the site first.', 404);

    if (target.is_root === true) return bad("Root's access is changed in the database only.", 409);
    if (target.id === me.id) return bad('You cannot change your own access.', 409);
    if ((role === 'admin' || target.is_admin === true) && !me.is_root)
      return bad('Only root appoints or changes an administrator.', 403);

    const now = new Date().toISOString();
    if (role === 'content') {
      if (columnIds.length) {
        const { rows: known } = await DB.select('article_columns', {
          columns: 'id',
          filters: [`id=in.${inList(columnIds)}`],
          limit: columnIds.length,
        });
        if (known.length !== columnIds.length) return bad('Unknown column.');
      }
      // The content row first: if clearing is_admin then fails, the person
      // still holds at least what they are meant to end up with.
      await DB.upsert(
        'content_editors',
        {
          member_id: target.id,
          all_columns: allColumns,
          column_ids: allColumns ? [] : columnIds,
          can_edit_pages: pages,
          perms,
          updated_by: me.id,
          updated_at: now,
        },
        { onConflict: 'member_id' },
      );
      if (target.is_admin === true)
        await DB.update('members', { id: target.id }, { is_admin: false });
    } else if (role === 'admin') {
      await DB.update('members', { id: target.id }, { is_admin: true });
    } else {
      if (target.is_admin === true)
        await DB.update('members', { id: target.id }, { is_admin: false });
      await DB.del('content_editors', { member_id: target.id });
    }

    const after = await DB.selectOne('members', { id: target.id }, PEOPLE);
    const editor = await DB.selectOne('content_editors', { member_id: target.id }, '*');
    return json({ ok: true, row: shape(after, editor) });
  } catch (e) {
    return bad(e.message, 500);
  }
}
