// /api/admin/households  (admin only)
//   GET    — list families, each with its linked login accounts + family members.
//   PUT    — create a family.
//   POST   — update a family (body.id required).
//   DELETE — delete a family (its family members go too; linked accounts are kept).
// Every request is gated by requireAdmin (validates session + is_admin).
import { json, bad, sb, requireAdmin } from '../_lib.js';

const STATUSES = ['pending', 'active', 'expired', 'cancelled'];
const COLUMNS = '*,accounts:members(id,full_name,email,status,tier_id),people:household_members(*)';

// Build a households patch from the request body. Returns { patch } or { error }.
async function buildPatch(b, env, { requireName }) {
  const patch = {};
  if (requireName || b.name !== undefined) {
    if (!b.name || !b.name.trim()) return { error: bad('Family name is required.') };
    patch.name = b.name.trim();
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return { error: bad('Invalid status.') };
    patch.status = b.status;
  } else if (requireName) {
    patch.status = 'active';
  }
  if (b.tier_id !== undefined) {
    if (!b.tier_id) {
      patch.tier_id = null;
    } else {
      const tier = await sb(env).selectOne('membership_tiers', { id: b.tier_id }, 'id');
      if (!tier) return { error: bad('Unknown membership tier.') };
      patch.tier_id = b.tier_id;
    }
  }
  for (const f of ['member_since', 'expires_at']) {
    if (b[f] === undefined) continue;
    if (b[f] === null || b[f] === '') {
      patch[f] = null;
    } else {
      const d = new Date(b[f]);
      if (isNaN(d.getTime())) return { error: bad(`Invalid ${f.replace('_', ' ')}.`) };
      patch[f] = d.toISOString();
    }
  }
  if (b.notes !== undefined) patch.notes = b.notes || null;
  return { patch };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const { rows } = await sb(env).select('households', {
      columns: COLUMNS,
      order: 'created_at.desc',
      limit: 500,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
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
  const built = await buildPatch(b, env, { requireName: true });
  if (built.error) return built.error;

  try {
    const [row] = await sb(env).insert('households', built.patch);
    return json({ ok: true, household: row });
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
  if (!b.id) return bad('Family id is required.');
  const built = await buildPatch(b, env, { requireName: false });
  if (built.error) return built.error;
  if (Object.keys(built.patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('households', { id: b.id }, built.patch);
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
  if (!id) return bad('Family id is required.');

  try {
    await sb(env).del('households', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
