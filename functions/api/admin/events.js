// /api/admin/events  (admin only)
//   GET    — list/search events (paginated; filter by published state).
//   PUT    — create an event (title + start required; slug auto-derived).
//   POST   — patch an event, including the publish/unpublish toggle. Only
//            published events are publicly readable (events_read RLS policy),
//            so flipping `published` is what makes an event official.
//   DELETE — remove an event (its RSVPs cascade — see 0001_init.sql).
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const MAX_LIMIT = 50;
const COLUMNS =
  'id,title,slug,description,starts_at,ends_at,location,image_url,published,created_at';

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

// Validate/normalize the patchable fields (shared by create + patch).
function parseFields(b) {
  const patch = {};
  if (b.title !== undefined) {
    const title = String(b.title || '').trim();
    if (!title) return { error: 'Title is required.' };
    patch.title = title;
  }
  if (b.starts_at !== undefined) {
    const d = new Date(b.starts_at);
    if (isNaN(d.getTime())) return { error: 'Invalid start date.' };
    patch.starts_at = d.toISOString();
  }
  if (b.ends_at !== undefined) {
    if (b.ends_at === null || b.ends_at === '') {
      patch.ends_at = null;
    } else {
      const d = new Date(b.ends_at);
      if (isNaN(d.getTime())) return { error: 'Invalid end date.' };
      patch.ends_at = d.toISOString();
    }
  }
  if (patch.starts_at && patch.ends_at && patch.ends_at < patch.starts_at)
    return { error: 'End must be after start.' };
  if (b.description !== undefined) patch.description = String(b.description || '').trim() || null;
  if (b.location !== undefined) patch.location = String(b.location || '').trim() || null;
  if (b.image_url !== undefined) patch.image_url = String(b.image_url || '').trim() || null;
  if (b.published !== undefined) patch.published = !!b.published;
  return { patch };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const published = url.searchParams.get('published') || '';
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const filters = [];
  if (published === 'true' || published === 'false') filters.push(`published=eq.${published}`);
  if (q) {
    const cleaned = q.replace(/[(),*]/g, ' ').trim(); // strip PostgREST meta chars
    if (cleaned) {
      const safe = cleaned.replace(/[\\%_]/g, (c) => `\\${c}`); // escape SQL LIKE wildcards
      filters.push(
        `or=(title.ilike.*${encodeURIComponent(safe)}*,location.ilike.*${encodeURIComponent(safe)}*)`,
      );
    }
  }

  try {
    const { rows, total } = await sb(env).select('events', {
      columns: COLUMNS,
      filters,
      order: 'starts_at.desc',
      limit,
      offset,
      count: 'exact',
    });
    return json({ rows, total, limit, offset });
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
  if (!String(b.title || '').trim()) return bad('Title is required.');
  if (!b.starts_at) return bad('Start date is required.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);

  try {
    const DB = sb(env);
    // slug is unique — derive from the title and defuse collisions.
    let slug = slugify(b.slug || patch.title);
    if (slug && (await DB.selectOne('events', { slug }, 'id')))
      slug = `${slug}-${Date.now().toString(36)}`;
    const rows = await DB.insert('events', {
      ...patch,
      slug: slug || null,
      published: patch.published ?? true,
    });
    return json({ ok: true, event: rows[0] });
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
  if (!b.id) return bad('Event id is required.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('events', { id: b.id }, patch);
    const row = await sb(env).selectOne('events', { id: b.id }, COLUMNS);
    if (!row) return bad('Unknown event.', 404);
    return json({ ok: true, event: row });
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
  if (!id) return bad('Event id is required.');
  try {
    await sb(env).del('events', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
