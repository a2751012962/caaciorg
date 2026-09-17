// /api/admin/roles  (root only)
//   GET  — who holds admin (and root).
//   POST { email | member_id, is_admin } — appoint or remove an admin.
// With tokens on, an admin can create money CAACI owes (within the caps), so
// appointing one is root's decision, not any admin's. Root itself is never set
// here or anywhere in the API: a database trigger (0024) refuses it, and it is
// changed from the Supabase SQL editor only.
import { json, bad, sb } from '../_lib.js';
import { tokensEnabled, tokensOff, requireRoot, UUID_RE } from '../_tokens.js';

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireRoot(request, env);
  if (gate.error) return gate.error;
  try {
    const { rows } = await sb(env).select('members', {
      columns: 'id,full_name,email,is_admin,is_root',
      filters: ['or=(is_admin.eq.true,is_root.eq.true)'],
      order: 'full_name.asc',
      limit: 100,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireRoot(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (typeof b.is_admin !== 'boolean') return bad('Pass is_admin: true or false.');

  try {
    let target = null;
    if (UUID_RE.test(b.member_id || '')) {
      target = await DB.selectOne(
        'members',
        { id: b.member_id },
        'id,full_name,email,is_admin,is_root',
      );
    } else {
      const email = String(b.email || '')
        .trim()
        .toLowerCase();
      if (!/^[^\s@*%(),\\]+@[^\s@*%(),\\]+\.[^\s@*%(),\\]+$/.test(email))
        return bad('Enter the email of their CAACI account.');
      const { rows } = await DB.select('members', {
        columns: 'id,full_name,email,is_admin,is_root',
        filters: [`email=ilike.${encodeURIComponent(email.replace(/_/g, '\\_'))}`],
        limit: 2,
      });
      if (rows.length === 1) target = rows[0];
    }
    if (!target)
      return bad('No CAACI account matches. They need to sign up on the site first.', 404);
    if (target.is_root && !b.is_admin) return bad('Root keeps admin access.', 409);

    await DB.update('members', { id: target.id }, { is_admin: b.is_admin });
    return json({ ok: true, member: { ...target, is_admin: b.is_admin } });
  } catch (e) {
    return bad(e.message, 500);
  }
}
