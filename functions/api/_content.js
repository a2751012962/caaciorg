// Shared helpers for the content-management endpoints (columns, articles, page
// copy): who may do what, the HTML clean-up applied on save, slugs, and the
// article field rules. Contract: docs/content-management.md. Tables: 0040.
import { bad, sb, requireUser } from './_lib.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Column and article slugs: lowercase ascii words joined by single hyphens.
// The same pattern is a check constraint on both tables.
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG = 60;

// What a column and an article summary (a list row, no body) are made of in
// every answer, public and staff.
export const COLUMN_COLS = 'id,slug,name_en,name_zh,description_en,description_zh,sort_order';
export const SUMMARY_COLS =
  'id,slug,column_id,title_en,title_zh,summary_en,summary_zh,cover_url,cover_alt_en,cover_alt_zh,author,published_at,pinned';

// --- who is calling -------------------------------------------------------
// Content staff are administrators (members.is_admin, read with the
// service-role key exactly as requireAdmin does — never from the JWT) and
// members with a content_editors row. Returns { error: Response } or
// { user, member, role }, where role is what /api/admin/content-me answers:
// { is_admin, all_columns, column_ids, can_edit_pages, perms }.
// An administrator's role grants everything, so callers can test the flags
// without special-casing.
export async function contentRole(request, env) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  const { user } = gate;
  try {
    const DB = sb(env);
    const member = await DB.selectOne('members', { id: user.id }, 'id,email,full_name,is_admin');
    if (!member) return { error: bad('Content editor access required.', 403) };
    if (member.is_admin === true) {
      return {
        user,
        member,
        role: {
          is_admin: true,
          all_columns: true,
          column_ids: [],
          can_edit_pages: true,
          perms: [...PERMS],
        },
      };
    }
    // `*`, not a column list: perms arrives with 0041, and a
    // project that has 0040 but not yet 0041 must still let editors in.
    const row = await DB.selectOne('content_editors', { member_id: user.id }, '*');
    if (!row) return { error: bad('Content editor access required.', 403) };
    return {
      user,
      member,
      role: {
        is_admin: false,
        all_columns: row.all_columns === true,
        column_ids: Array.isArray(row.column_ids) ? row.column_ids : [],
        can_edit_pages: row.can_edit_pages === true,
        perms: Array.isArray(row.perms) ? row.perms.filter((p) => PERMS.includes(p)) : [],
      },
    };
  } catch (e) {
    return { error: bad(e.message, 500) };
  }
}

// What a content manager may be given beyond columns and page copy (0041;
// the same list is a check constraint on content_editors.perms):
//   events — Events tab, registrations, volunteers, form templates
//   news — Send news; invites — invitation codes; plans — membership plans;
//   directory — the business directory.
// Members, families, payments, refunds, discount codes, the dashboard and
// tokens are never on it: they stay with administrators.
export const PERMS = ['events', 'news', 'invites', 'plans', 'directory'];

export const hasPerm = (role, perm) =>
  !!role && (role.is_admin === true || (Array.isArray(role.perms) && role.perms.includes(perm)));

// The gate of an endpoint that belongs to one or more of PERMS: contentRole,
// then any one of `perms` (an administrator has them all).
export async function requirePerm(request, env, ...perms) {
  const gate = await contentRole(request, env);
  if (gate.error) return gate;
  if (!perms.some((p) => hasPerm(gate.role, p)))
    return { error: bad('You do not have access to this part of the console.', 403) };
  return gate;
}

// May this caller create, change or delete articles in `columnId`?
export const canWriteColumn = (role, columnId) =>
  !!role &&
  (role.is_admin === true ||
    role.all_columns === true ||
    (Array.isArray(role.column_ids) && role.column_ids.includes(columnId)));

// Page copy (site_content) is for administrators and editors given it.
export const canEditPages = (role) =>
  !!role && (role.is_admin === true || role.can_edit_pages === true);

// --- PostgREST filters ----------------------------------------------------
// "Published" = status published and published_at already reached; a future
// published_at is a scheduled article. Timestamps sit inside a logic tree
// quoted, the form memberStatusFilter in _lib.js verified against PostgREST:
// the quotes keep the ISO string's ':' and '.' out of the tree's grammar.
export const quotedTime = (iso) => `"${encodeURIComponent(iso)}"`;
export function publishedFilter(nowIso = new Date().toISOString(), extra = []) {
  return `and=(${['status.eq.published', `published_at.lte.${quotedTime(nowIso)}`, ...extra].join(',')})`;
}

// A whole set of keys/ids as an in-list, each value quoted (keys hold dots).
export const inList = (values) =>
  `(${values.map((v) => `"${encodeURIComponent(String(v))}"`).join(',')})`;

// A PostgREST unique-violation, as sb() reports it in the thrown message.
export const isUniqueViolation = (e) => /23505|duplicate key/i.test(String(e?.message || ''));
// A foreign-key violation (a column still holding articles, on delete restrict).
export const isForeignKeyViolation = (e) => /23503|foreign key/i.test(String(e?.message || ''));

// DELETE every row whose `column` is in `values`. sb().del only matches with
// eq, and a delete per row would spend a Workers subrequest each.
export async function deleteIn(env, table, column, values) {
  if (!values.length) return;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${column}=in.${inList(values)}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      prefer: 'return=minimal',
    },
  });
  if (!r.ok) throw new Error(`supabase delete ${table}: ${r.status} ${await r.text()}`);
}

// --- article HTML ---------------------------------------------------------
// A defensive strip on save. The real gate is the render: every page passes
// the body through DOMPurify with the fixed tag set in web/src/lib/articles.ts.
// This keeps the stored HTML free of the obvious script vectors as well, so a
// copy that leaves the site some other way (an export, a future email) does
// not carry them. Regex-based on purpose — no parser is available here, and
// the client sanitiser is what the browser actually trusts.
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'noscript',
  'template',
  'svg',
  'math',
  'frameset',
  'applet',
];
const DROP_TAG = [...DROP_WITH_CONTENT, 'link', 'meta', 'base', 'frame', 'param'];
const URL_ATTRS = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'xlink:href',
  'poster',
  'background',
  'cite',
  'longdesc',
  'lowsrc',
  'dynsrc',
  'data',
]);

// The element regexes. A tag is matched with its quoted attribute values
// taken whole, so a '>' inside alt=">" does not end it early.
const PAIRED = new RegExp(
  `<(${DROP_WITH_CONTENT.join('|')})\\b(?:"[^"]*"|'[^']*'|[^'">])*>[\\s\\S]*?<\\/\\1\\s*>`,
  'gi',
);
const LONE = new RegExp(`<\\/?(?:${DROP_TAG.join('|')})\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

// Enough entity decoding to see a scheme hidden as &#106;avascript: or
// java&Tab;script:, then without the whitespace and control characters a
// browser ignores inside a URL.
const NAMED = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/' };
// An out-of-range reference (&#99999999;) is a space, not a RangeError.
const codePoint = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ');
const ignoredInUrl = (ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) === 0x7f || /\s/.test(ch);
function urlShape(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => codePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .split('')
    .filter((ch) => !ignoredInUrl(ch))
    .join('')
    .toLowerCase();
}
const BAD_SCHEME = /(?:^|,)(?:javascript|vbscript|data):/;

function cleanAttrs(raw) {
  const kept = [];
  for (const m of raw.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (name.startsWith('on') || name === 'style') continue;
    if (URL_ATTRS.has(name) && m[2] !== undefined) {
      const value = m[2].replace(/^["']|["']$/g, '');
      if (BAD_SCHEME.test(urlShape(value))) continue;
    }
    kept.push(m[0]);
  }
  return kept;
}

export function cleanArticleHtml(html) {
  let out = String(html ?? '');
  // Comments, CDATA, doctype and processing instructions carry nothing an
  // article needs (and old IE ran conditional comments).
  out = out.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<[!?][^>]*>/g, '');
  // Repeat until nothing changes: removing one element can join the halves
  // of another around it (<scr<script></script>ipt>).
  for (let i = 0; i < 10; i++) {
    const next = out.replace(PAIRED, '').replace(LONE, '');
    if (next === out) break;
    out = next;
  }
  return out.replace(OPEN_TAG, (whole, name, attrs) => {
    const selfClosing = /\/\s*$/.test(attrs);
    const kept = cleanAttrs(attrs);
    return `<${name}${kept.map((a) => ` ${a}`).join('')}${selfClosing ? ' /' : ''}>`;
  });
}

// --- slugs ----------------------------------------------------------------
// The English title as a slug: lowercase ascii letters and digits joined by
// single hyphens, at most 60 characters. Empty when the title has no ascii
// letter or digit (a Chinese-only title), and the caller falls back to
// randomSlug().
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

// Eight random hex characters: a short id that is always a valid slug.
export function randomSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// An explicitly sent slug as stored: trimmed, lowercased, then checked.
// undefined when not sent, { error } when unusable.
export function slugOf(value) {
  if (value === undefined) return undefined;
  const slug = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!slug || slug.length > MAX_SLUG || !SLUG_RE.test(slug))
    return {
      error: `A slug is lowercase letters, digits and single hyphens, at most ${MAX_SLUG} characters.`,
    };
  return slug;
}

// --- article fields -------------------------------------------------------
const TEXT_LIMITS = {
  title_en: 200,
  title_zh: 200,
  summary_en: 600,
  summary_zh: 600,
  body_en: 200_000,
  body_zh: 200_000,
  cover_alt_en: 300,
  cover_alt_zh: 300,
  author: 120,
};
const BODIES = new Set(['body_en', 'body_zh']);
const LABELS = {
  title_en: 'The English title',
  title_zh: 'The Chinese title',
  summary_en: 'The English summary',
  summary_zh: 'The Chinese summary',
  body_en: 'The English article',
  body_zh: 'The Chinese article',
  cover_alt_en: 'The English image description',
  cover_alt_zh: 'The Chinese image description',
  author: 'The author',
};
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// The article fields a staff body may set — everything else in the body (id,
// created_by, timestamps …) is ignored. Returns { fields } with only the
// fields that were sent, cleaned, or { error }. Bodies pass cleanArticleHtml.
export function articleFields(b) {
  const fields = {};
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && typeof b[key] !== 'string')
      return { error: `${LABELS[key]} must be text.` };
    const raw = b[key] ?? '';
    const value = BODIES.has(key) ? cleanArticleHtml(raw) : raw.trim();
    if (value.length > max) return { error: `${LABELS[key]} is at most ${max} characters.` };
    fields[key] = value;
  }
  if (b.column_id !== undefined) {
    if (!UUID_RE.test(String(b.column_id || ''))) return { error: 'Choose a column.' };
    fields.column_id = String(b.column_id);
  }
  if (b.slug !== undefined && b.slug !== null && b.slug !== '') {
    const slug = slugOf(b.slug);
    if (slug.error) return { error: slug.error };
    fields.slug = slug;
  }
  if (b.cover_url !== undefined) {
    const url = String(b.cover_url ?? '').trim();
    if (!url) fields.cover_url = null;
    else if (url.length > 2000) return { error: 'The cover image address is too long.' };
    else if (!/^https:\/\/[^\s]+$/i.test(url) && !/^\/(?!\/)[^\s]*$/.test(url))
      return { error: 'The cover image must be an https:// address or a /path on this site.' };
    else fields.cover_url = url;
  }
  if (b.status !== undefined) {
    if (b.status !== 'draft' && b.status !== 'published')
      return { error: 'Status is draft or published.' };
    fields.status = b.status;
  }
  if (b.published_at !== undefined) {
    if (b.published_at === null || b.published_at === '') fields.published_at = null;
    else {
      const s = String(b.published_at).trim();
      const t = ISO_RE.test(s) ? Date.parse(s) : NaN;
      if (!Number.isFinite(t)) return { error: 'The publish date is not a valid date.' };
      fields.published_at = new Date(t).toISOString();
    }
  }
  if (b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') return { error: 'Pinned is true or false.' };
    fields.pinned = b.pinned;
  }
  return { fields };
}

// Publishing with no date publishes now. `current` is the stored row on an
// edit (null on create); fields is changed in place.
export function stampPublished(fields, current = null, nowIso = new Date().toISOString()) {
  const status = fields.status ?? current?.status ?? 'draft';
  const at =
    fields.published_at !== undefined ? fields.published_at : (current?.published_at ?? null);
  if (status === 'published' && !at) fields.published_at = nowIso;
  return fields;
}
