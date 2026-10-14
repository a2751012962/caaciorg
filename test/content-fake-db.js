// An in-memory stand-in for the Supabase calls the content endpoints make
// (columns, articles, content editors, page copy — 0040), so their tests can
// check what ends up stored rather than which URL was hit. It understands the
// PostgREST shapes those endpoints use and no more: eq / in / ilike / cs / lt /
// lte / gt / gte filters, and=(…) and or=(…) trees with quoted timestamps,
// select, order, limit, offset, count, insert, upsert (on_conflict), patch and
// delete, plus the unique and foreign-key refusals the tables would give.
// Anything else answers 400, so an endpoint drifting to a new shape fails loudly.
//
//   const db = contentDb(seedContent());
//   const fetch = mockFetch(db.route);   // db.tables.articles … after the call
//
// The Auth lookup is answered too: `Bearer session-<id>` (asUser in helpers.js)
// signs in as <id>; no or another token is a 401.

export const ADMIN = 'a0000000-0000-4000-8000-000000000001';
export const EDITOR_A = 'a0000000-0000-4000-8000-000000000002'; // column A only
export const EDITOR_ALL = 'a0000000-0000-4000-8000-000000000003'; // every column
export const PAGES = 'a0000000-0000-4000-8000-000000000004'; // page copy only
export const STRANGER = 'a0000000-0000-4000-8000-000000000005'; // a plain member
export const COL_A = 'c0000000-0000-4000-8000-00000000000a';
export const COL_B = 'c0000000-0000-4000-8000-00000000000b';
export const ART_A = 'd0000000-0000-4000-8000-00000000000a'; // published, column A
export const ART_B = 'd0000000-0000-4000-8000-00000000000b'; // published, column B
export const DRAFT_A = 'd0000000-0000-4000-8000-0000000000da'; // draft, column A

const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const article = (over) => ({
  title_en: '',
  title_zh: '',
  summary_en: '',
  summary_zh: '',
  body_en: '',
  body_zh: '',
  cover_alt_en: '',
  cover_alt_zh: '',
  author: '',
  cover_url: null,
  status: 'draft',
  published_at: null,
  pinned: false,
  created_by: null,
  updated_by: null,
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...over,
});

export function seedContent() {
  const person = (id, full_name, is_admin = false) => ({
    id,
    full_name,
    email: `${full_name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    is_admin,
  });
  const editor = (member_id, over) => ({
    member_id,
    all_columns: false,
    column_ids: [],
    can_edit_pages: false,
    updated_by: ADMIN,
    created_at: daysAgo(10),
    updated_at: daysAgo(10),
    ...over,
  });
  const column = (id, slug, name_en, name_zh, sort_order) => ({
    id,
    slug,
    name_en,
    name_zh,
    description_en: '',
    description_zh: '',
    sort_order,
    created_at: daysAgo(40),
    updated_at: daysAgo(40),
  });
  return {
    members: [
      person(ADMIN, 'Ada Admin', true),
      person(EDITOR_A, 'Ed Column'),
      person(EDITOR_ALL, 'Eve Everything'),
      person(PAGES, 'Paige Pages'),
      person(STRANGER, 'Sam Stranger'),
    ],
    content_editors: [
      editor(EDITOR_A, { column_ids: [COL_A] }),
      editor(EDITOR_ALL, { all_columns: true }),
      editor(PAGES, { can_edit_pages: true }),
    ],
    article_columns: [
      column(COL_A, 'news', 'CAACI News', '协会动态', 10),
      column(COL_B, 'community', 'Community Stories', '社区故事', 20),
    ],
    articles: [
      article({
        id: ART_A,
        column_id: COL_A,
        slug: 'spring-gala',
        title_en: 'Spring Gala',
        body_en: '<p>Gala body</p>',
        status: 'published',
        published_at: daysAgo(5),
      }),
      article({
        id: ART_B,
        column_id: COL_B,
        slug: 'river-walk',
        title_en: 'River Walk',
        body_en: '<p>Walk body</p>',
        status: 'published',
        published_at: daysAgo(4),
      }),
      article({
        id: DRAFT_A,
        column_id: COL_A,
        slug: 'unfinished',
        title_en: 'Unfinished',
        body_en: '<p>Not yet</p>',
      }),
    ],
    site_content: [],
  };
}

// Column defaults as the 0040 tables declare them.
const DEFAULTS = {
  article_columns: () => ({
    id: crypto.randomUUID(),
    name_en: '',
    name_zh: '',
    description_en: '',
    description_zh: '',
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  articles: () =>
    article({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  content_editors: () => ({
    all_columns: false,
    column_ids: [],
    can_edit_pages: false,
    updated_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }),
  site_content: () => ({
    value_en: null,
    value_zh: null,
    updated_by: null,
    updated_at: new Date().toISOString(),
  }),
};
const UNIQUE = {
  article_columns: ['slug'],
  articles: ['slug'],
  content_editors: ['member_id'],
  site_content: ['key'],
};

// Split "a,b,(c,d),"e,f"" on top-level commas.
function splitTop(s) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);

function compare(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (typeof a === 'string' && Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// One "op.value" test against a row's value.
function check(value, op, raw) {
  switch (op) {
    case 'eq':
      return String(value) === raw;
    case 'neq':
      return String(value) !== raw;
    case 'in': {
      const list = splitTop(raw.replace(/^\(|\)$/g, '')).map(unquote);
      return list.includes(String(value));
    }
    case 'ilike': {
      if (!raw.includes('*'))
        return String(value ?? '').toLowerCase() === raw.replace(/\\(.)/g, '$1').toLowerCase();
      const needle = raw
        .replace(/^\*|\*$/g, '')
        .replace(/\\(.)/g, '$1')
        .toLowerCase();
      return String(value ?? '')
        .toLowerCase()
        .includes(needle);
    }
    case 'cs': {
      const want = raw
        .replace(/^\{|\}$/g, '')
        .split(',')
        .filter(Boolean);
      return Array.isArray(value) && want.every((w) => value.includes(w));
    }
    case 'is':
      return raw === 'null' ? value === null || value === undefined : String(value) === raw;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (value === null || value === undefined) return false;
      const c = compare(value, unquote(raw));
      return { lt: c < 0, lte: c <= 0, gt: c > 0, gte: c >= 0 }[op];
    }
    default:
      throw new Error(`fake db: unknown operator ${op}`);
  }
}

// "col.op.value" inside a logic tree.
function term(row, t) {
  if (t.startsWith('and(')) return splitTop(t.slice(4, -1)).every((x) => term(row, x));
  if (t.startsWith('or(')) return splitTop(t.slice(3, -1)).some((x) => term(row, x));
  const [col, op, ...rest] = t.split('.');
  return check(row[col], op, rest.join('.'));
}

const RESERVED = new Set(['select', 'limit', 'offset', 'order', 'on_conflict']);

function matcher(params) {
  const checks = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === 'and' || key === 'or') {
      const terms = splitTop(value.replace(/^\(|\)$/g, ''));
      checks.push((row) =>
        key === 'and' ? terms.every((t) => term(row, t)) : terms.some((t) => term(row, t)),
      );
    } else {
      const dot = value.indexOf('.');
      const op = value.slice(0, dot);
      const raw = value.slice(dot + 1);
      checks.push((row) => check(row[key], op, raw));
    }
  }
  return (row) => checks.every((c) => c(row));
}

function project(row, select) {
  if (!select || select === '*') return { ...row };
  return Object.fromEntries(select.split(',').map((c) => [c, row[c] ?? null]));
}

function sortRows(rows, order) {
  if (!order) return rows;
  const keys = order.split(',').map((o) => o.split('.'));
  return [...rows].sort((a, b) => {
    for (const [col, dir] of keys) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      // PostgREST puts nulls last ascending and first descending.
      if (av === null || av === undefined) return dir === 'desc' ? -1 : 1;
      if (bv === null || bv === undefined) return dir === 'desc' ? 1 : -1;
      const c = typeof av === 'boolean' ? Number(av) - Number(bv) : compare(av, bv);
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

const conflict = (code, message) => ({ status: 409, body: { code, message } });

export function contentDb(seed = seedContent()) {
  const tables = structuredClone(seed);
  const clash = (table, row, except) =>
    (UNIQUE[table] || []).find((col) =>
      tables[table].some((r) => r !== except && row[col] !== undefined && r[col] === row[col]),
    );

  const route = (url, options = {}) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const token = String(options.headers?.authorization || '');
      const m = token.match(/^Bearer session-(.+)$/);
      return m ? { body: { id: m[1] } } : { status: 401, body: { msg: 'invalid token' } };
    }
    const path = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!path) return null;
    const table = path[1];
    if (!tables[table]) return { status: 404, body: { message: `no table ${table}` } };
    const rows = tables[table];
    const method = options.method || 'GET';
    const params = [...u.searchParams.entries()];
    const get = (k) => u.searchParams.get(k);
    let match;
    try {
      match = matcher(params);
    } catch (e) {
      return { status: 400, body: { message: e.message } };
    }

    if (method === 'GET') {
      const hits = sortRows(rows.filter(match), get('order'));
      const offset = Number(get('offset') || 0);
      const limit = Number(get('limit') || hits.length);
      const page = hits.slice(offset, offset + limit).map((r) => project(r, get('select')));
      const headers = {};
      if (/count=/.test(options.headers?.prefer || ''))
        headers['content-range'] = `${offset}-${offset + page.length - 1}/${hits.length}`;
      return { body: page, headers };
    }

    const body = options.body ? JSON.parse(options.body) : null;
    if (method === 'POST') {
      const onConflict = get('on_conflict');
      const out = [];
      for (const incoming of Array.isArray(body) ? body : [body]) {
        const existing = onConflict && rows.find((r) => r[onConflict] === incoming[onConflict]);
        if (existing) {
          Object.assign(existing, incoming);
          out.push({ ...existing });
          continue;
        }
        const row = { ...DEFAULTS[table](), ...incoming };
        if (table === 'articles' && !tables.article_columns.some((c) => c.id === row.column_id))
          return conflict('23503', 'insert violates foreign key constraint');
        const col = clash(table, row);
        if (col)
          return conflict('23505', `duplicate key value violates unique constraint (${col})`);
        rows.push(row);
        out.push({ ...row });
      }
      return { status: 201, body: out };
    }
    if (method === 'PATCH') {
      for (const row of rows.filter(match)) {
        const next = { ...row, ...body };
        const col = clash(table, next, row);
        if (col)
          return conflict('23505', `duplicate key value violates unique constraint (${col})`);
        Object.assign(row, body);
      }
      return { status: 204, body: '' };
    }
    if (method === 'DELETE') {
      const gone = rows.filter(match);
      if (
        table === 'article_columns' &&
        gone.some((c) => tables.articles.some((a) => a.column_id === c.id))
      )
        return conflict('23503', 'update or delete violates foreign key constraint');
      tables[table] = rows.filter((r) => !gone.includes(r));
      return { status: 204, body: '' };
    }
    return { status: 405, body: { message: method } };
  };

  return { tables: new Proxy({}, { get: (_, k) => tables[k] }), route };
}
