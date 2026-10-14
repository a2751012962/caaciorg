// The addresses of the column directory and article pages, exercised without
// a DOM: web/src/lib/articleRoutes.js is plain JS so node --test can import it
// on Node 20 (CI), where a .ts module would not load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTICLE_PATH,
  COLUMNS_PATH,
  articlePath,
  articleSlugFrom,
  articleTarget,
  columnFromSearch,
  columnsPath,
  isPlainClick,
  searchWithColumn,
} from '../web/src/lib/articleRoutes.js';

test('articleRoutes: the directory answers at /about/columns/, both languages, with or without the slash', () => {
  for (const p of ['/about/columns/', '/about/columns', '/zh/about/columns/', '/ZH/About/Columns'])
    assert.ok(COLUMNS_PATH.test(p), p);
  for (const p of ['/about/', '/columns/', '/about/columns/x/', '/en/about/columns/'])
    assert.equal(COLUMNS_PATH.test(p), false, p);
});

test('articleRoutes: an article address names its slug; anything else names none', () => {
  assert.equal(articleSlugFrom('/about/articles/spring-gala-2027/'), 'spring-gala-2027');
  assert.equal(articleSlugFrom('/about/articles/spring-gala-2027'), 'spring-gala-2027');
  assert.equal(articleSlugFrom('/zh/about/articles/spring-gala-2027/'), 'spring-gala-2027');
  assert.equal(articleSlugFrom('/about/articles/a%2Db/'), 'a-b');
  assert.equal(articleSlugFrom('/about/articles/%E0%A4%A/'), '', 'malformed escape');
  assert.equal(articleSlugFrom('/about/articles/'), '');
  assert.equal(articleSlugFrom('/about/articles/a/b/'), '');
  assert.equal(articleSlugFrom('/about/article/'), '', 'the rewrite target itself names nothing');
  assert.equal(articleSlugFrom(''), '');
  assert.ok(ARTICLE_PATH.test('/zh/about/articles/x'));
});

test('articleRoutes: ?c= picks the column and is rewritten without losing other parameters', () => {
  assert.equal(columnFromSearch('?c=news'), 'news');
  assert.equal(columnFromSearch('?c=%20news%20'), 'news');
  assert.equal(columnFromSearch(''), '');
  assert.equal(columnFromSearch('?x=1'), '');
  assert.equal(searchWithColumn('', 'news'), '?c=news');
  assert.equal(searchWithColumn('?c=news', 'members'), '?c=members');
  assert.equal(searchWithColumn('?c=news', ''), '');
  assert.equal(searchWithColumn('?cms_preview=1&c=news', ''), '?cms_preview=1');
  assert.equal(searchWithColumn('?cms_preview=1', 'news'), '?cms_preview=1&c=news');
});

test('articleRoutes: URLs match the contract (docs/content-management.md, lib/articles.ts)', () => {
  assert.equal(columnsPath('en'), '/about/columns/');
  assert.equal(columnsPath('zh'), '/zh/about/columns/');
  assert.equal(columnsPath('en', 'news'), '/about/columns/?c=news');
  assert.equal(columnsPath('zh', 'news'), '/zh/about/columns/?c=news');
  assert.equal(articlePath('en', 'hello'), '/about/articles/hello/');
  assert.equal(articlePath('zh', 'hello'), '/zh/about/articles/hello/');
  // What the page builds, the router reads back.
  assert.equal(articleSlugFrom(articlePath('zh', 'a-b-1')), 'a-b-1');
  assert.ok(COLUMNS_PATH.test(columnsPath('zh', 'news').split('?')[0]));
});

test('articleRoutes: navigation targets for the two pages', () => {
  assert.deepEqual(articleTarget('columns', 'en'), { page: 'columns', url: '/about/columns/' });
  assert.deepEqual(articleTarget('columns:news', 'zh'), {
    page: 'columns',
    url: '/zh/about/columns/?c=news',
  });
  assert.deepEqual(articleTarget('article:hello', 'en'), {
    page: 'article',
    url: '/about/articles/hello/',
  });
  assert.equal(articleTarget('article', 'en'), null, 'an article target needs a slug');
  assert.equal(articleTarget('article:', 'en'), null);
  // Every other page id is App's own business.
  for (const t of ['about', 'events#past', 'home', 'columnsx', 'articles:x', ''])
    assert.equal(articleTarget(t, 'en'), null, t);
});

test('articleRoutes: only a plain left click is handled in the page', () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  assert.equal(isPlainClick(click), true);
  assert.equal(isPlainClick({ ...click, button: 1 }), false, 'middle click opens a tab');
  assert.equal(isPlainClick({ ...click, ctrlKey: true }), false);
  assert.equal(isPlainClick({ ...click, metaKey: true }), false);
  assert.equal(isPlainClick({ ...click, shiftKey: true }), false);
  assert.equal(isPlainClick({ ...click, altKey: true }), false);
  assert.equal(isPlainClick({ ...click, defaultPrevented: true }), false);
});
