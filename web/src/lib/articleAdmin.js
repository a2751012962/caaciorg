// The rules behind the admin console's article editor (pages/admin/tabs/
// ArticlesTab.tsx): the address an English title turns into, the status an
// article shows (a published article with a future date is scheduled), the
// form ⇄ API body round trip, and the unsaved-changes check.
//
// Plain JS on purpose: test/web-article-admin.test.js imports this file
// directly with node --test (CI is Node 20 and cannot load TypeScript).
// Contract: docs/content-management.md.

/** The slug pattern the database checks (article_columns.slug, articles.slug). */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A summary longer than this still saves; the counter turns amber as a nudge. */
export const SUMMARY_SOFT_LIMIT = 200;

const SLUG_MAX = 80;

/**
 * An address from a title: lower-case Latin letters and digits joined by
 * single hyphens, accents dropped, at most 80 characters (cut at a hyphen).
 * '' when nothing Latin is left (a Chinese-only title); the API then makes a
 * short id.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function slugify(text) {
  const s = String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= SLUG_MAX) return s;
  const cut = s.slice(0, SLUG_MAX);
  const at = cut.lastIndexOf('-');
  return (at > 20 ? cut.slice(0, at) : cut).replace(/-+$/g, '');
}

/**
 * Tidies what someone typed into the slug box as they type: spaces and other
 * characters become hyphens, but a trailing hyphen is kept so a word can follow.
 * @param {string} text
 * @returns {string}
 */
export function slugInput(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/g, '');
}

/**
 * What the list and the editor call an article. Published with a date still
 * to come = scheduled: the public pages only show it from that moment
 * (status = 'published' and published_at <= now()).
 * @param {string|null|undefined} status
 * @param {string|null|undefined} publishedAt ISO time
 * @param {number} [now] ms since the epoch
 * @returns {'draft'|'scheduled'|'published'}
 */
export function articleState(status, publishedAt, now = Date.now()) {
  if (status !== 'published') return 'draft';
  const at = publishedAt ? Date.parse(publishedAt) : NaN;
  return Number.isFinite(at) && at > now ? 'scheduled' : 'published';
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * ISO time → the value of an <input type="datetime-local"> in the browser's
 * time zone ('' for none or a bad value).
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The value of a datetime-local input (the editor's wall clock) → ISO time,
 * or null when empty or unreadable.
 * @param {string|null|undefined} local
 * @returns {string|null}
 */
export function fromLocalInput(local) {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// An empty rich-text editor still holds "<p><br></p>" and the like.
const BLANK_HTML = /^(?:\s|&nbsp;| |<br\s*\/?>|<p>(?:\s|&nbsp;| |<br\s*\/?>)*<\/p>)*$/i;

/**
 * True when HTML shows nothing: '', whitespace, <br>s and empty paragraphs.
 * An image alone is not blank.
 * @param {string|null|undefined} html
 * @returns {boolean}
 */
export function isBlankHtml(html) {
  return BLANK_HTML.test(String(html || ''));
}

/**
 * HTML reduced to what changes what a reader sees, so the editor's own
 * reformatting (non-breaking spaces, empty paragraphs it adds, whitespace
 * between tags, attribute quotes) does not count as an unsaved change.
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function canonicalHtml(html) {
  if (isBlankHtml(html)) return '';
  return String(html)
    .replace(/[​﻿]/g, '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/<p>(?:\s|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @typedef {{
 *   column_id: string, slug: string,
 *   title_en: string, title_zh: string, summary_en: string, summary_zh: string,
 *   body_en: string, body_zh: string, cover_url: string,
 *   cover_alt_en: string, cover_alt_zh: string, author: string,
 *   published_at: string, pinned: boolean
 * }} ArticleForm
 * `published_at` is a datetime-local value; everything else is as the API has it.
 */

/**
 * A blank form for a new article.
 * @param {string} [columnId]
 * @returns {ArticleForm}
 */
export function emptyForm(columnId = '') {
  return {
    column_id: columnId,
    slug: '',
    title_en: '',
    title_zh: '',
    summary_en: '',
    summary_zh: '',
    body_en: '',
    body_zh: '',
    cover_url: '',
    cover_alt_en: '',
    cover_alt_zh: '',
    author: '',
    published_at: '',
    pinned: false,
  };
}

/**
 * The form for a saved article (GET /api/admin/articles?id= → article).
 * @param {Record<string, unknown>} a
 * @returns {ArticleForm}
 */
export function formFromArticle(a) {
  const s = (v) => (typeof v === 'string' ? v : '');
  return {
    column_id: s(a.column_id),
    slug: s(a.slug),
    title_en: s(a.title_en),
    title_zh: s(a.title_zh),
    summary_en: s(a.summary_en),
    summary_zh: s(a.summary_zh),
    body_en: s(a.body_en),
    body_zh: s(a.body_zh),
    cover_url: s(a.cover_url),
    cover_alt_en: s(a.cover_alt_en),
    cover_alt_zh: s(a.cover_alt_zh),
    author: s(a.author),
    published_at: toLocalInput(s(a.published_at) || null),
    pinned: a.pinned === true,
  };
}

/**
 * The fields POST / PATCH /api/admin/articles take, from the form. Text is
 * trimmed, a blank body is '' (not the editor's "<p><br></p>"), no cover is
 * null, and an empty slug is left out so the API makes one.
 * @param {ArticleForm} f
 */
export function formToBody(f) {
  /** @type {Record<string, unknown>} */
  const body = {
    column_id: f.column_id,
    title_en: f.title_en.trim(),
    title_zh: f.title_zh.trim(),
    summary_en: f.summary_en.trim(),
    summary_zh: f.summary_zh.trim(),
    body_en: isBlankHtml(f.body_en) ? '' : f.body_en,
    body_zh: isBlankHtml(f.body_zh) ? '' : f.body_zh,
    cover_url: f.cover_url.trim() || null,
    cover_alt_en: f.cover_alt_en.trim(),
    cover_alt_zh: f.cover_alt_zh.trim(),
    author: f.author.trim(),
    published_at: fromLocalInput(f.published_at),
    pinned: f.pinned,
  };
  const slug = f.slug.trim().replace(/-+$/g, '');
  if (slug) body.slug = slug;
  return body;
}

/**
 * True when two forms would save the same article (bodies compared by what a
 * reader sees, see canonicalHtml).
 * @param {ArticleForm} a
 * @param {ArticleForm} b
 */
export function sameForm(a, b) {
  const norm = (f) => {
    const x = formToBody(f);
    x.body_en = canonicalHtml(/** @type {string} */ (x.body_en));
    x.body_zh = canonicalHtml(/** @type {string} */ (x.body_zh));
    return JSON.stringify(x);
  };
  return norm(a) === norm(b);
}

/**
 * What stops a save, or null when nothing does. Messages are [en, zh].
 * @param {ArticleForm} f
 * @returns {[string, string] | null}
 */
export function formProblem(f) {
  if (!f.column_id) return ['Choose a column.', '请选择专栏。'];
  if (!f.title_en.trim() && !f.title_zh.trim())
    return ['Give the article a title in at least one language.', '请至少用一种语言填写标题。'];
  const slug = f.slug.trim().replace(/-+$/g, '');
  if (slug && !SLUG_RE.test(slug))
    return [
      'The address may only use lower-case letters, digits and single hyphens.',
      '网址只能使用小写英文字母、数字和单个连字符。',
    ];
  if (f.published_at && !fromLocalInput(f.published_at))
    return ['The publish date is not a valid date.', '发布时间无效。'];
  return null;
}

/**
 * The columns someone may write in, in sort order.
 * @template {{ id: string, sort_order?: number }} C
 * @param {C[]} columns
 * @param {{ is_admin: boolean, all_columns: boolean, column_ids: string[] }} role
 * @returns {C[]}
 */
export function writableColumns(columns, role) {
  const all = role.is_admin || role.all_columns;
  return columns
    .filter((c) => all || role.column_ids.includes(c.id))
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
