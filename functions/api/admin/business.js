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
  'id,name,name_zh,category,label,label_zh,description,description_zh,address,phone,' +
  'hours,hours_zh,website,image_url,verified,tags,tags_zh,sort_order,owner_id,approved,created_at';
// The filter ids on the public Business Services page (DIRECTORY_CATEGORIES in
// web/src/lib/directory.ts); migration 0022 mapped the old values onto these.
export const CATEGORIES = [
  'restaurant',
  'groceries',
  'dental',
  'financial',
  'realestate',
  'education_media',
  'services',
];
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;
const TEXT_FIELDS = [
  'name_zh',
  'label',
  'label_zh',
  'description',
  'description_zh',
  'address',
  'phone',
  'hours',
  'hours_zh',
  'website',
  'image_url',
];

// Free-text tags typed by staff: trimmed; blanks and case-insensitive repeats dropped.
function parseTags(raw) {
  if (raw === null) return { tags: [] };
  if (!Array.isArray(raw)) return { error: 'Tags must be a list.' };
  const seen = new Set();
  const tags = [];
  for (const item of raw) {
    const tag = String(item ?? '').trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) return { error: `Tag too long (max ${MAX_TAG_LENGTH}).` };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { error: `Too many tags (max ${MAX_TAGS}).` };
  return { tags };
}

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
  for (const f of TEXT_FIELDS) {
    if (b[f] !== undefined) patch[f] = String(b[f] || '').trim() || null;
  }
  for (const f of ['tags', 'tags_zh']) {
    if (b[f] === undefined) continue;
    const { tags, error } = parseTags(b[f]);
    if (error) return { error };
    patch[f] = tags;
  }
  if (b.sort_order !== undefined) {
    const n = b.sort_order === '' || b.sort_order === null ? 0 : Number(b.sort_order);
    if (!Number.isInteger(n) || Math.abs(n) > 1000000) return { error: 'Invalid sort order.' };
    patch.sort_order = n;
  }
  if (b.verified !== undefined) patch.verified = !!b.verified;
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
      order: 'sort_order.asc,name.asc', // the order the public page lists them in
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
