// /api/admin/household-members  (admin only)
// People inside a family who may NOT have their own login (children, a spouse).
//   PUT    — add a person to a family (body.household_id + full_name required).
//   POST   — update a person (body.id required).
//   DELETE — remove a person (body.id or ?id=).
// They are read back embedded in GET /api/admin/households, so there's no GET here.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const RELATIONSHIPS = ['head', 'spouse', 'child', 'parent', 'other'];

function buildPatch(b, { requireCore }) {
  const patch = {};
  if (requireCore) {
    if (!b.household_id) return { error: bad('household_id is required.') };
    if (!b.full_name || !b.full_name.trim()) return { error: bad('Full name is required.') };
    patch.household_id = b.household_id;
  }
  if (b.full_name !== undefined) {
    if (!b.full_name || !b.full_name.trim()) return { error: bad('Full name is required.') };
    patch.full_name = b.full_name.trim();
  }
  if (b.relationship !== undefined) {
    patch.relationship =
      b.relationship && RELATIONSHIPS.includes(b.relationship) ? b.relationship : null;
  }
  if (b.email !== undefined) patch.email = b.email || null;
  if (b.phone !== undefined) patch.phone = b.phone || null;
  if (b.member_id !== undefined) patch.member_id = b.member_id || null;
  if (b.is_primary !== undefined) patch.is_primary = !!b.is_primary;
  return { patch };
}

export async function onRequestPut({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const built = buildPatch(b, { requireCore: true });
  if (built.error) return built.error;

  try {
    const [row] = await sb(env).insert('household_members', built.patch);
    return json({ ok: true, person: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b.id) return bad('Person id is required.');
  const built = buildPatch(b, { requireCore: false });
  if (built.error) return built.error;
  if (Object.keys(built.patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('household_members', { id: b.id }, built.patch);
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) {
    try {
      id = (await request.json()).id || '';
    } catch {
      /* no body */
    }
  }
  if (!id) return bad('Person id is required.');

  try {
    await sb(env).del('household_members', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
