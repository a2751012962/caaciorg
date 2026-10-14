// Addresses of the column directory (/about/columns/, ?c=<column>) and of one
// article (/about/articles/<slug>/), each with or without the /zh/ prefix: how
// App.tsx recognises them, how a page asks App to go to one, and how a click
// on an article link is told apart from a "open in new tab" click.
//
// Plain JS on purpose: test/web-article-routes.test.js imports this file
// directly with node --test (CI is Node 20 and cannot load TypeScript). App.tsx
// imports it rather than lib/articles.ts, whose DOMPurify import would
// otherwise land in the main bundle; the two build the same URLs
// (docs/content-management.md).

/** /about/columns/ — the directory. Its column choice lives in ?c=. */
export const COLUMNS_PATH = /^\/(?:zh\/)?about\/columns\/?$/i;
/** /about/articles/<slug>/ — served by a _redirects rewrite to /about/article/. */
export const ARTICLE_PATH = /^\/(?:zh\/)?about\/articles\/([^/]+)\/?$/i;

/**
 * The article slug the address names, '' when it names none.
 * @param {string} pathname
 * @returns {string}
 */
export function articleSlugFrom(pathname) {
  const m = ARTICLE_PATH.exec(pathname || '');
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return ''; // a malformed escape names no article
  }
}

/**
 * The column slug in ?c=, '' for all columns.
 * @param {string} search
 * @returns {string}
 */
export function columnFromSearch(search) {
  try {
    return (new URLSearchParams(search || '').get('c') || '').trim();
  } catch {
    return '';
  }
}

/**
 * `search` with ?c= set to `column`, or removed for all columns; every other
 * parameter is kept. Returns '' or a string starting with '?'.
 * @param {string} search
 * @param {string} column
 * @returns {string}
 */
export function searchWithColumn(search, column) {
  const params = new URLSearchParams(search || '');
  if (column) params.set('c', column);
  else params.delete('c');
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * @param {'en'|'zh'} lang
 * @param {string} [column]
 * @returns {string}
 */
export function columnsPath(lang, column = '') {
  const prefix = lang === 'zh' ? '/zh' : '';
  return `${prefix}/about/columns/${column ? `?c=${encodeURIComponent(column)}` : ''}`;
}

/**
 * @param {'en'|'zh'} lang
 * @param {string} slug
 * @returns {string}
 */
export function articlePath(lang, slug) {
  const prefix = lang === 'zh' ? '/zh' : '';
  return `${prefix}/about/articles/${encodeURIComponent(slug)}/`;
}

/**
 * Pages navigate with a string (App's navigateTo). These two take an argument:
 * 'columns' or 'columns:<column>' opens the directory (on that column), and
 * 'article:<slug>' one article. Anything else is not ours: null.
 * @param {string} target
 * @param {'en'|'zh'} lang
 * @returns {{ page: 'columns' | 'article', url: string } | null}
 */
export function articleTarget(target, lang) {
  const m = /^(columns|article)(?::(.*))?$/.exec(target || '');
  if (!m) return null;
  const arg = (m[2] || '').trim();
  if (m[1] === 'columns') return { page: 'columns', url: columnsPath(lang, arg) };
  return arg ? { page: 'article', url: articlePath(lang, arg) } : null;
}

/**
 * A click the page should handle itself: the main button with no modifier key.
 * Middle-click, Ctrl/Cmd-click and Shift-click are left to the browser, so an
 * article still opens in a new tab or window from its real href.
 * @param {{ button: number, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, defaultPrevented: boolean }} e
 * @returns {boolean}
 */
export function isPlainClick(e) {
  return (
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}
