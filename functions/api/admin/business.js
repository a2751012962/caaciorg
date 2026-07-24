// /api/admin/business  (admin only)
//   GET    — list/search business-directory entries (paginated; filter by
//            approval state; includes a pending count for the stats tile).
//   PUT    — create an entry (admin-created entries are approved by default).
//   POST   — patch an entry, including the approve/unapprove toggle. Only
//            approved entries are publicly readable (biz_read RLS policy), so
//            flipping `approved` is what makes a listing official.
//   DELETE — remove an entry.
// Public submissions arrive unapproved via /api/business-listing; this is the
// review queue for them. Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const MAX_LIMIT = 50;
const COLUMNS =
  'id,name,category,description,address,phone,website,image_url,owner_id,approved,created_at';
const CATEGORIES = ['restaurant', 'bakery', 'supermarket', 'other'];

// Validate/normalize the patchable fields (shared by create + patch).
function parseFields(b) {
  const patch = {};
  if (b.name !== undefined) {
    const name = String(b.name || '').trim();
    if (!name) return { error: 'Name is required.' };
    patch.name = name;
  }
  if (b.category !== undefined) {
    if (b.category === null || b.category === '') {
      patch.category = null;
    } else if (!CATEGORIES.includes(b.category)) {
      return { error: 'Invalid category.' };
    } else {
      patch.category = b.category;
    }
  }
  if (b.description !== undefined) patch.description = String(b.description || '').trim() || null;
  if (b.address !== undefined) patch.address = String(b.address || '').trim() || null;
  if (b.phone !== undefined) patch.phone = String(b.phone || '').trim() || null;
  if (b.website !== undefined) patch.website = String(b.website || '').trim() || null;
  if (b.image_url !== undefined) patch.image_url = String(b.image_url || '').trim() || null;
  if (b.approved !== undefined) patch.approved = !!b.approved;
  return { patch };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const approved = url.searchParams.get('approved') || '';
  const category = url.searchParams.get('category') || '';
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const filters = [];
  if (approved === 'true' || approved === 'false') filters.push(`approved=eq.${approved}`);
  if (category && CATEGORIES.includes(category)) filters.push(`category=eq.${category}`);
  if (q) {
    const cleaned = q.replace(/[(),*]/g, ' ').trim(); // strip PostgREST meta chars
    if (cleaned) {
      const safe = cleaned.replace(/[\\%_]/g, (c) => `\\${c}`); // escape SQL LIKE wildcards
      filters.push(
        `or=(name.ilike.*${encodeURIComponent(safe)}*,description.ilike.*${encodeURIComponent(safe)}*)`,
      );
    }
  }

  try {
    const DB = sb(env);
    const { rows, total } = await DB.select('business_directory', {
      columns: COLUMNS,
      filters,
      order: 'created_at.desc',
      limit,
      offset,
      count: 'exact',
    });
    // Pending head-count for the review-queue stat tile (cheap, like payments).
    const pending = await DB.select('business_directory', {
      columns: 'id',
      filters: ['approved=eq.false'],
      limit: 1,
      count: 'exact',
    });
    return json({ rows, total, limit, offset, pending_total: pending.total });
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
  if (!String(b.name || '').trim()) return bad('Name is required.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);

  try {
    const rows = await sb(env).insert('business_directory', {
      ...patch,
      approved: patch.approved ?? true, // admin-created = already reviewed
    });
    return json({ ok: true, business: rows[0] });
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
  if (!b.id) return bad('Listing id is required.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('business_directory', { id: b.id }, patch);
    const row = await sb(env).selectOne('business_directory', { id: b.id }, COLUMNS);
    if (!row) return bad('Unknown listing.', 404);
    return json({ ok: true, business: row });
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
  if (!id) return bad('Listing id is required.');
  try {
    await sb(env).del('business_directory', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
