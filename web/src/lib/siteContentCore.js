// The rules behind page copy overrides (docs/content-management.md, "Override
// keys"), lifted out of siteContent.ts so they can be tested without a DOM or
// a bundler: how a data object is walked into editable fields, how a saved
// override is written into the live object, and how the admin's draft turns
// into the PUT body.
//
// Plain JS on purpose: test/site-content.test.js imports this file directly
// with node --test (CI is Node 20 and cannot load TypeScript).

/** A key as the site_content table allows it. */
export const KEY_RE = /^[A-Za-z0-9_.-]+$/;

/** Keys inside list items that the editor never shows (made up for new items). */
export const HIDDEN_ITEM_KEYS = ['id'];

const LANGS = /** @type {const} */ (['en', 'zh']);

/** @param {unknown} v */
export function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** JSON-shaped equality: strings, numbers, booleans, null, arrays, plain objects. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** A JSON-safe deep copy (the values here are all JSON). */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ------------------------------------------------------------------ fields

const IMAGE_URL = /^https?:\/\/\S+\.(?:png|jpe?g|webp|gif|svg|avif)(?:[?#]\S*)?$/i;

/**
 * Whether a string field holds a photo: its name ends in Image/image (the
 * contract's rule), or its value is a /images/… path or an https image URL.
 * @param {string} key
 * @param {unknown[]} values
 */
export function looksLikeImage(key, values) {
  if (/(?:^i|I)mage$/.test(key)) return true;
  return values.some(
    (v) => typeof v === 'string' && (v.startsWith('/images/') || IMAGE_URL.test(v.trim())),
  );
}

/**
 * The editor for a string: 'image', 'longtext' (a textarea: more than 80
 * characters or a line break in either language) or 'text'.
 * @param {string} key
 * @param {unknown[]} values
 * @returns {'image'|'longtext'|'text'}
 */
export function leafKind(key, values) {
  if (looksLikeImage(key, values)) return 'image';
  const long = values.some((v) => typeof v === 'string' && (v.length > 80 || v.includes('\n')));
  return long ? 'longtext' : 'text';
}

/**
 * Whether `path` is one of the excluded paths or inside one. A pattern segment
 * `*` matches any one key (`tiers.*.features`).
 * @param {string} path
 * @param {string[]} [patterns]
 */
export function isExcluded(path, patterns = []) {
  const segs = path.split('.');
  return patterns.some((p) => {
    const ps = p.split('.');
    if (ps.length > segs.length) return false;
    return ps.every((s, i) => s === '*' || s === segs[i]);
  });
}

/**
 * What one item of a list looks like, from every default item in both
 * languages: a list of strings, or objects whose keys each have an editor.
 * `required` keys are in every default item (a new or normalised item gets
 * them); the rest are optional and stay absent unless typed in. Number and
 * boolean keys are kept but not shown; a nested list of strings is edited as
 * one line per entry ('lines').
 * @param {unknown[]} en
 * @param {unknown[]} zh
 */
export function itemShape(en, zh) {
  const all = [...(Array.isArray(en) ? en : []), ...(Array.isArray(zh) ? zh : [])];
  if (!all.length) return null;
  if (all.every((x) => typeof x === 'string')) {
    return { type: 'string', kind: leafKind('', all) };
  }
  if (!all.every(isPlainObject)) return null;
  /** @type {Map<string, {key: string, kind: string, required: boolean, sample: unknown}>} */
  const keys = new Map();
  for (const item of all) {
    for (const [k, v] of Object.entries(item)) {
      if (v === undefined || keys.has(k)) continue;
      const values = all.map((x) => x[k]);
      let kind = 'keep';
      if (typeof v === 'string') kind = leafKind(k, values);
      else if (Array.isArray(v) && v.every((s) => typeof s === 'string')) kind = 'lines';
      const required = all.every((x) => x[k] !== undefined);
      keys.set(k, { key: k, kind, required, sample: v });
    }
  }
  return { type: 'object', keys: [...keys.values()] };
}

/**
 * Walks an EN/ZH pair into the fields an editor can change. Paths never point
 * inside an array: a list is one field, edited (and overridden) as a whole.
 * Numbers and booleans are not editable and are skipped.
 * @param {object} en
 * @param {object} zh
 * @param {string[]} [exclude]
 * @param {string} [prefix]
 * @returns {Array<{path: string, key: string, kind: string, shape?: any}>}
 */
export function walkFields(en, zh, exclude = [], prefix = '') {
  /** @type {Array<{path: string, key: string, kind: string, shape?: any}>} */
  const out = [];
  const keys = [...Object.keys(en ?? {})];
  for (const k of Object.keys(zh ?? {})) if (!keys.includes(k)) keys.push(k);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isExcluded(path, exclude)) continue;
    const a = en?.[key];
    const b = zh?.[key];
    if (typeof a === 'string' || typeof b === 'string') {
      out.push({ path, key, kind: leafKind(key, [a, b]) });
    } else if (Array.isArray(a) || Array.isArray(b)) {
      const shape = itemShape(a, b);
      if (shape) out.push({ path, key, kind: 'list', shape });
    } else if (isPlainObject(a) || isPlainObject(b)) {
      out.push(...walkFields(a ?? {}, b ?? {}, exclude, path));
    }
  }
  return out;
}

/**
 * Sections for the editor, in the order they first appear. A nested field
 * belongs to its top-level object (`hero.title` → hero) and a top-level list
 * to itself. A top-level string joins the list or object it is named after
 * (`valuesTitle` → values), or `extra[path]`, else the page's general text
 * ('_page').
 * @param {Array<{path: string, kind: string}>} fields
 * @param {Record<string, string>} [extra]
 * @returns {Array<{id: string, fields: Array<{path: string, kind: string}>}>}
 */
export function groupFields(fields, extra = {}) {
  const containers = new Set(
    fields.map((f) => (f.path.includes('.') || f.kind === 'list' ? f.path.split('.')[0] : null)),
  );
  containers.delete(null);
  /** @type {Map<string, Array<{path: string, kind: string}>>} */
  const groups = new Map();
  for (const f of fields) {
    let id = f.path.split('.')[0];
    if (!f.path.includes('.') && f.kind !== 'list') {
      const owner = [...containers].find(
        (c) => f.path.startsWith(c) && /^[A-Z]/.test(f.path.slice(c.length)),
      );
      id = extra[f.path] ?? owner ?? '_page';
    }
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)?.push(f);
  }
  return [...groups].map(([id, fs]) => ({ id, fields: fs }));
}

const WORD_FIXES = { btn: 'button', desc: 'description', img: 'image', cta: 'CTA', zh: 'ZH' };

/** `missionText` → "Mission text", `btnDonation` → "Button donation". */
export function humanize(key) {
  const words = String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => WORD_FIXES[w.toLowerCase()] ?? (/^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase()));
  const s = words.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------ items

/** An empty value of the same type: '' for a string, [] for a list, false, 0. */
export function blankLike(v) {
  if (typeof v === 'string') return '';
  if (Array.isArray(v)) return [];
  if (typeof v === 'boolean') return false;
  if (typeof v === 'number') return 0;
  if (isPlainObject(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
  }
  return v;
}

/**
 * A new list item: every required key empty, and a fresh id when items have one.
 * @param {any} shape  itemShape() of the list
 */
export function newItem(shape) {
  if (!shape) return '';
  if (shape.type === 'string') return '';
  /** @type {Record<string, unknown>} */
  const item = {};
  for (const k of shape.keys) if (k.required) item[k.key] = blankLike(k.sample);
  if (typeof item.id === 'string') item.id = `item-${Math.random().toString(36).slice(2, 8)}`;
  return item;
}

/**
 * Coerces one saved list item to the list's shape so a page never meets a
 * missing or mistyped key: required keys are filled with an empty value of the
 * right type, optional keys are kept only when the type matches, unknown keys
 * are dropped. Returns undefined when the item is of the wrong kind entirely.
 */
export function normalizeItem(item, shape) {
  if (!shape) return undefined;
  if (shape.type === 'string') return typeof item === 'string' ? item : undefined;
  if (!isPlainObject(item)) return undefined;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of shape.keys) {
    const v = item[k.key];
    const s = k.sample;
    const sameType =
      v !== undefined &&
      (Array.isArray(s)
        ? Array.isArray(v) && (k.kind !== 'lines' || v.every((x) => typeof x === 'string'))
        : isPlainObject(s)
          ? isPlainObject(v)
          : typeof v === typeof s);
    if (sameType) out[k.key] = v;
    else if (k.required) out[k.key] = blankLike(s);
  }
  return out;
}

// ------------------------------------------------------------------ keys

/**
 * @typedef {{ id: string, en: object, zh: object, defaults: { en: object, zh: object }, exclude?: string[] }} Entry
 */

/** Reads `a.b.c` from an object, never into arrays. */
export function getPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * What an override key points at: the entry, the path inside it, and the
 * default values (strings or lists only). Null for a malformed, unknown,
 * excluded or stale key.
 * @param {Map<string, Entry>} byId
 * @param {string} key
 */
export function resolveKey(byId, key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null;
  const dot = key.indexOf('.');
  if (dot < 1) return null;
  const entry = byId.get(key.slice(0, dot));
  const path = key.slice(dot + 1);
  if (!entry || !path || path.split('.').some((s) => !s)) return null;
  if (isExcluded(path, entry.exclude)) return null;
  const en = getPath(entry.defaults.en, path);
  const zh = getPath(entry.defaults.zh, path);
  const ok = (v) => typeof v === 'string' || Array.isArray(v);
  if (!ok(en) && !ok(zh)) return null;
  return { entry, path, defaults: { en, zh } };
}

/**
 * An override value made safe for the default it replaces: a string for a
 * string, a list (each item coerced to the list's shape) for a list. Undefined
 * when it does not fit — the default stays.
 */
export function coerceValue(value, defEn, defZh, lang) {
  const def = lang === 'en' ? defEn : defZh;
  if (typeof def === 'string') return typeof value === 'string' ? value : undefined;
  if (!Array.isArray(def) || !Array.isArray(value)) return undefined;
  const shape = itemShape(defEn, defZh);
  if (!shape) {
    return value.every((x) => typeof x === 'string' || isPlainObject(x)) ? clone(value) : undefined;
  }
  const items = value.map((x) => normalizeItem(x, shape));
  return items.some((x) => x === undefined) ? undefined : clone(items);
}

/**
 * Writes saved overrides into the live data objects, in place, so the pages
 * that import them need no changes. Returns `apply(overrides)`; each call is
 * the complete set: a key (or language) that was applied before and is not in
 * the new set goes back to its default, so removing a draft or a reset
 * reverts the page.
 *
 * Strings are assigned. A list's original array is spliced in place (a
 * reference to it held anywhere keeps seeing current items) and its parent
 * gets a fresh copy while overridden, so a useMemo keyed on the list
 * recomputes; going back to the default puts the original array back.
 * @param {Entry[]} entries
 */
export function createApplier(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  /** @type {Map<string, unknown[]>} live arrays as they were at start, by `<lang>:<key>` */
  const originals = new Map();
  /** @type {Set<string>} */
  let applied = new Set();

  const write = (entry, lang, path, value, isDefault) => {
    const segs = path.split('.');
    const last = segs.pop();
    let parent = entry[lang];
    for (const s of segs) {
      if (!isPlainObject(parent?.[s])) return;
      parent = parent[s];
    }
    if (!isPlainObject(parent) || last === undefined) return;
    if (typeof value === 'string') {
      parent[last] = value;
      return;
    }
    if (!Array.isArray(value)) return;
    const id = `${lang}:${entry.id}.${path}`;
    if (!originals.has(id) && Array.isArray(parent[last])) originals.set(id, parent[last]);
    const orig = originals.get(id);
    if (!orig) return;
    orig.splice(0, orig.length, ...clone(value));
    parent[last] = isDefault ? orig : orig.slice();
  };

  /** @param {Record<string, any>} overrides */
  function apply(overrides) {
    /** @type {Map<string, ReturnType<typeof resolveKey>>} */
    const next = new Map();
    if (isPlainObject(overrides)) {
      for (const [key, val] of Object.entries(overrides)) {
        const r = resolveKey(byId, key);
        if (r && isPlainObject(val)) next.set(key, r);
      }
    }
    const touched = new Set([...applied, ...next.keys()]);
    /** @type {Set<string>} */
    const now = new Set();
    for (const key of touched) {
      const r = next.get(key) ?? resolveKey(byId, key);
      if (!r) continue;
      const val = next.has(key) ? overrides[key] : {};
      for (const lang of LANGS) {
        const def = r.defaults[lang];
        const v =
          val[lang] === undefined || val[lang] === null
            ? undefined
            : coerceValue(val[lang], r.defaults.en, r.defaults.zh, lang);
        if (v !== undefined) now.add(key);
        write(r.entry, lang, r.path, v !== undefined ? v : clone(def), v === undefined);
      }
    }
    applied = now;
  }

  return { apply, byId };
}

// ------------------------------------------------------------------ drafts

/**
 * @typedef {Record<string, { en?: unknown, zh?: unknown }>} OverrideSet
 * @typedef {(key: string, lang: 'en'|'zh') => unknown} DefaultOf
 */

/**
 * The value a field shows: the draft, else the saved override, else the default.
 * @param {OverrideSet} saved
 * @param {OverrideSet} draft
 * @param {DefaultOf} defaultOf
 * @param {string} key
 * @param {'en'|'zh'} lang
 */
export function currentValue(saved, draft, defaultOf, key, lang) {
  const d = draft[key];
  if (d && Object.prototype.hasOwnProperty.call(d, lang)) return d[lang];
  const s = saved[key]?.[lang];
  return s !== undefined && s !== null ? s : defaultOf(key, lang);
}

/**
 * The PUT body's `changes`: only keys whose value differs from what is saved,
 * only the languages that differ, and null for a language set back to its
 * default (which clears the saved override).
 * @param {OverrideSet} saved
 * @param {OverrideSet} draft
 * @param {DefaultOf} defaultOf
 */
export function diffDraft(saved, draft, defaultOf) {
  /** @type {Array<{ key: string, en?: unknown, zh?: unknown }>} */
  const changes = [];
  for (const [key, d] of Object.entries(draft)) {
    /** @type {{ key: string, en?: unknown, zh?: unknown }} */
    const change = { key };
    let any = false;
    for (const lang of LANGS) {
      if (!d || !Object.prototype.hasOwnProperty.call(d, lang)) continue;
      const def = defaultOf(key, lang);
      const s = saved[key]?.[lang];
      const before = s !== undefined && s !== null ? s : def;
      if (deepEqual(d[lang], before)) continue;
      change[lang] = deepEqual(d[lang], def) ? null : clone(d[lang]);
      any = true;
    }
    if (any) changes.push(change);
  }
  return changes;
}

/**
 * Saved overrides with the draft laid over them, minus anything equal to its
 * default: the complete set the preview page applies.
 * @param {OverrideSet} saved
 * @param {OverrideSet} draft
 * @param {DefaultOf} defaultOf
 * @returns {OverrideSet}
 */
export function effectiveOverrides(saved, draft, defaultOf) {
  /** @type {OverrideSet} */
  const out = {};
  for (const key of new Set([...Object.keys(saved), ...Object.keys(draft)])) {
    /** @type {{ en?: unknown, zh?: unknown }} */
    const val = {};
    for (const lang of LANGS) {
      const v = currentValue(saved, draft, defaultOf, key, lang);
      if (v === undefined || v === null || deepEqual(v, defaultOf(key, lang))) continue;
      val[lang] = v;
    }
    if (Object.keys(val).length) out[key] = val;
  }
  return out;
}

/**
 * The admin GET's rows as an override set (only the languages that are set).
 * @param {Array<{ key: string, value_en?: unknown, value_zh?: unknown }>} rows
 * @returns {OverrideSet}
 */
export function rowsToOverrides(rows) {
  /** @type {OverrideSet} */
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.key !== 'string') continue;
    /** @type {{ en?: unknown, zh?: unknown }} */
    const val = {};
    if (r.value_en !== null && r.value_en !== undefined) val.en = r.value_en;
    if (r.value_zh !== null && r.value_zh !== undefined) val.zh = r.value_zh;
    if (Object.keys(val).length) out[r.key] = val;
  }
  return out;
}

// ------------------------------------------------------------------ search

/** Lower case, runs of white space as one space. */
export const normalizeText = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Every string inside a value (a list's items included), for search. */
export function textsOf(v) {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(textsOf);
  if (isPlainObject(v)) return Object.values(v).flatMap(textsOf);
  return [];
}

/**
 * The words to look for on the page for a field's text: a template's longest
 * literal run (`'{count} events'` → `events`), white space collapsed.
 */
export function focusNeedle(text) {
  const parts = String(text ?? '')
    .split(/\{[a-zA-Z0-9_]+\}/)
    .map((p) => p.replace(/\s+/g, ' ').trim());
  return parts.reduce((a, b) => (b.length > a.length ? b : a), '');
}
