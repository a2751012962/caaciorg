// /api/admin/site-content  (administrators, and editors with can_edit_pages)
// — the page-copy overrides behind the Page content tab (site_content, 0040).
//   GET → { rows: [{ key, value_en, value_zh, updated_at, updated_by_name }] }
//   PUT { changes: [{ key, en?: json | null, zh?: json | null }] } → { ok, saved, deleted }
//       A language left out is unchanged; null clears it (the page goes back
//       to the code's default for that language). A key whose two values both
//       end up null is deleted. Several changes to one key merge in order.
// Keys are '<object id>.<path>' (docs/content-management.md); values are JSON,
// at most 100 KB each, and a PUT carries at most 500 changes.
import { json, bad, sb } from '../_lib.js';
import { contentRole, canEditPages, deleteIn, inList } from '../_content.js';

const KEY_RE = /^[A-Za-z0-9_.-]+$/;
const MAX_KEY = 200;
const MAX_CHANGES = 500;
const MAX_VALUE_BYTES = 100 * 1024;
const MAX_ROWS = 5000;
const CHUNK = 100; // keys per lookup / delete, so a URL stays short
const NO_PAGES = 'Page content access required.';

const chunks = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

export async function onRequestGet({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  if (!canEditPages(gate.role)) return bad(NO_PAGES, 403);
  try {
    const DB = sb(env);
    const { rows } = await DB.select('site_content', {
      columns: 'key,value_en,value_zh,updated_at,updated_by',
      order: 'key.asc',
      limit: MAX_ROWS,
    });
    // Names in a separate lookup: one select for every editor on the page.
    const ids = [...new Set(rows.map((r) => r.updated_by).filter(Boolean))];
    const names = new Map();
    for (const part of chunks(ids)) {
      const { rows: people } = await DB.select('members', {
        columns: 'id,full_name,email',
        filters: [`id=in.${inList(part)}`],
        limit: part.length,
      });
      for (const p of people) names.set(p.id, p.full_name || p.email || '');
    }
    return json({
      rows: rows.map((r) => ({
        key: r.key,
        value_en: r.value_en ?? null,
        value_zh: r.value_zh ?? null,
        updated_at: r.updated_at,
        updated_by_name: (r.updated_by && names.get(r.updated_by)) || '',
      })),
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

// The size of a value as stored (its JSON text, in bytes).
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export async function onRequestPut({ request, env }) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate.error;
  if (!canEditPages(gate.role)) return bad(NO_PAGES, 403);

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const changes = b?.changes;
  if (!Array.isArray(changes) || !changes.length) return bad('Send at least one change.');
  if (changes.length > MAX_CHANGES)
    return bad(`At most ${MAX_CHANGES} changes can be saved at once.`);

  // Validate everything before writing anything, merging repeats of a key.
  const wanted = new Map(); // key → { en?, zh? } (undefined = leave as stored)
  for (const c of changes) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return bad('Each change is an object.');
    const key = typeof c.key === 'string' ? c.key : '';
    if (!key || key.length > MAX_KEY || !KEY_RE.test(key))
      return bad(`"${String(c.key).slice(0, 60)}" is not a valid content key.`);
    const entry = wanted.get(key) || {};
    for (const lang of ['en', 'zh']) {
      if (!Object.hasOwn(c, lang)) continue;
      const value = c[lang];
      if (value === undefined) continue;
      if (value !== null && bytes(value) > MAX_VALUE_BYTES)
        return bad(`The ${lang} value of ${key} is larger than 100 KB.`);
      entry[lang] = value;
    }
    wanted.set(key, entry);
  }

  try {
    const DB = sb(env);
    const keys = [...wanted.keys()];
    const stored = new Map();
    for (const part of chunks(keys)) {
      const { rows } = await DB.select('site_content', {
        columns: 'key,value_en,value_zh',
        filters: [`key=in.${inList(part)}`],
        limit: part.length,
      });
      for (const r of rows) stored.set(r.key, r);
    }

    const now = new Date().toISOString();
    const upserts = [];
    const deletes = [];
    for (const [key, entry] of wanted) {
      const was = stored.get(key);
      const en = entry.en !== undefined ? entry.en : (was?.value_en ?? null);
      const zh = entry.zh !== undefined ? entry.zh : (was?.value_zh ?? null);
      if (en === null && zh === null) {
        if (was) deletes.push(key);
        continue;
      }
      upserts.push({
        key,
        value_en: en,
        value_zh: zh,
        updated_by: gate.member.id,
        updated_at: now,
      });
    }

    if (upserts.length) await DB.upsert('site_content', upserts, { onConflict: 'key' });
    for (const part of chunks(deletes)) await deleteIn(env, 'site_content', 'key', part);
    return json({ ok: true, saved: upserts.length, deleted: deletes.length });
  } catch (e) {
    return bad(e.message, 500);
  }
}
