// The shared rules of the content endpoints (functions/api/_content.js): the
// HTML clean-up on save, slugs, the article field whitelist and limits, the
// publish stamp, and who may write in which column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanArticleHtml,
  slugify,
  randomSlug,
  slugOf,
  articleFields,
  stampPublished,
  canWriteColumn,
  canEditPages,
  publishedFilter,
  SLUG_RE,
} from '../functions/api/_content.js';

const COL = 'c0000000-0000-4000-8000-00000000000a';

test('cleanArticleHtml keeps the article format untouched', () => {
  const html =
    '<h2>Title</h2><p>Some <strong>bold</strong> and <a href="https://caaciorg.com/x" title="t">a link</a>.</p>' +
    '<figure><img src="/images/a.jpg" alt="A &gt; B" width="600"><figcaption>Cap</figcaption></figure>' +
    '<ul><li>one</li></ul><blockquote>q</blockquote><hr><a href="mailto:a@b.co">mail</a>';
  assert.equal(cleanArticleHtml(html), html);
});

test('cleanArticleHtml removes script-bearing elements with their content', () => {
  const out = cleanArticleHtml(
    '<p>a</p><script>alert(1)</script><style>p{color:red}</style>' +
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">' +
      '<form action="/x"><input name="q"></form><link rel="stylesheet" href="x.css">' +
      '<meta http-equiv="refresh" content="0;url=https://evil.example"><SCRIPT type="x">bad()</SCRIPT><p>b</p>',
  );
  assert.equal(out, '<p>a</p><p>b</p>');
});

test('cleanArticleHtml does not let a removed element rejoin into a new one', () => {
  const out = cleanArticleHtml('<scr<script>x</script>ipt>alert(1)</script><p>ok</p>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /<p>ok<\/p>/);
});

test('cleanArticleHtml strips on* handlers and style, also past a quoted ">"', () => {
  assert.equal(
    cleanArticleHtml('<img src="/a.jpg" onerror="alert(1)" style="position:fixed">'),
    '<img src="/a.jpg">',
  );
  assert.equal(
    cleanArticleHtml('<img alt=">" onerror=alert(1) src=/a.jpg>'),
    '<img alt=">" src=/a.jpg>',
  );
  assert.equal(cleanArticleHtml('<img/onerror=alert(1) src="/a.jpg">'), '<img src="/a.jpg">');
  assert.equal(cleanArticleHtml('<p ONCLICK="x()" title="onx=1">t</p>'), '<p title="onx=1">t</p>');
});

test('cleanArticleHtml drops javascript:, vbscript: and data: URLs, however disguised', () => {
  for (const href of [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript&colon;alert(1)',
    'jav&Tab;ascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
  ]) {
    assert.equal(cleanArticleHtml(`<a href="${href}">x</a>`), '<a>x</a>', href);
  }
  assert.equal(cleanArticleHtml('<img src="data:image/svg+xml,<svg onload=alert(1)>">'), '<img>');
  // a huge character reference is not a crash
  assert.equal(cleanArticleHtml('<a href="&#99999999;javascript:x">x</a>'), '<a>x</a>');
  // an ordinary link that mentions the word stays
  assert.equal(
    cleanArticleHtml('<a href="https://example.com/?q=javascript">x</a>'),
    '<a href="https://example.com/?q=javascript">x</a>',
  );
});

test('cleanArticleHtml removes comments and handles empty input', () => {
  assert.equal(
    cleanArticleHtml('<p>a</p><!--[if IE]><script>x</script><![endif]--><p>b</p>'),
    '<p>a</p><p>b</p>',
  );
  assert.equal(cleanArticleHtml(''), '');
  assert.equal(cleanArticleHtml(null), '');
});

test('slugify: lowercase ascii words joined by single hyphens, at most 60', () => {
  assert.equal(slugify('  Spring Gala 2026!  '), 'spring-gala-2026');
  assert.equal(slugify('Café --- Crème'), 'cafe-creme');
  assert.equal(slugify('中秋节 Mid-Autumn'), 'mid-autumn');
  assert.equal(slugify('中秋节'), '');
  const long = slugify('word '.repeat(40));
  assert.ok(long.length <= 60);
  assert.match(long, SLUG_RE);
});

test('randomSlug is a short valid slug', () => {
  const s = randomSlug();
  assert.match(s, /^[0-9a-f]{8}$/);
  assert.match(s, SLUG_RE);
});

test('slugOf normalises and checks an explicit slug', () => {
  assert.equal(slugOf(undefined), undefined);
  assert.equal(slugOf(' My-Post '), 'my-post');
  assert.ok(slugOf('my post').error);
  assert.ok(slugOf('a--b').error);
  assert.ok(slugOf('-a').error);
  assert.ok(slugOf('x'.repeat(61)).error);
});

test('articleFields keeps only the article fields and cleans the bodies', () => {
  const { fields, error } = articleFields({
    id: 'ignored',
    created_by: 'ignored',
    column_id: COL,
    title_en: '  Hello  ',
    body_en: '<p onclick="x()">hi</p><script>bad()</script>',
    cover_url: '/images/a.jpg',
    status: 'published',
    published_at: '2026-10-01T12:00:00Z',
    pinned: true,
  });
  assert.equal(error, undefined);
  assert.deepEqual(fields, {
    column_id: COL,
    title_en: 'Hello',
    body_en: '<p>hi</p>',
    cover_url: '/images/a.jpg',
    status: 'published',
    published_at: '2026-10-01T12:00:00.000Z',
    pinned: true,
  });
});

test('articleFields enforces the limits and formats', () => {
  const bad = (b) => articleFields(b).error;
  assert.ok(bad({ title_en: 'x'.repeat(201) }));
  assert.equal(bad({ title_en: 'x'.repeat(200) }), undefined);
  assert.ok(bad({ summary_zh: 'x'.repeat(601) }));
  assert.ok(bad({ body_en: 'x'.repeat(200_001) }));
  assert.ok(bad({ author: 'x'.repeat(121) }));
  assert.ok(bad({ title_en: 5 }));
  assert.ok(bad({ cover_url: 'http://example.com/a.jpg' }));
  assert.ok(bad({ cover_url: '//evil.example/a.jpg' }));
  assert.ok(bad({ cover_url: 'javascript:alert(1)' }));
  assert.equal(articleFields({ cover_url: '' }).fields.cover_url, null);
  assert.equal(
    articleFields({ cover_url: 'https://x.example/a.jpg' }).fields.cover_url,
    'https://x.example/a.jpg',
  );
  assert.ok(bad({ status: 'live' }));
  assert.ok(bad({ published_at: 'yesterday' }));
  assert.ok(bad({ published_at: '2026-13-45' }));
  assert.equal(articleFields({ published_at: null }).fields.published_at, null);
  assert.ok(bad({ pinned: 'yes' }));
  assert.ok(bad({ column_id: 'not-a-uuid' }));
  assert.ok(bad({ slug: 'Not A Slug!' }));
});

test('stampPublished: publishing without a date publishes now; a set date stays', () => {
  const now = '2026-10-14T00:00:00.000Z';
  assert.equal(stampPublished({ status: 'published' }, null, now).published_at, now);
  assert.equal(
    stampPublished({ status: 'published', published_at: '2026-12-01T00:00:00.000Z' }, null, now)
      .published_at,
    '2026-12-01T00:00:00.000Z',
  );
  // an edit of a published article keeps its stored date
  assert.equal(
    stampPublished({ title_en: 'x' }, { status: 'published', published_at: 'then' }, now)
      .published_at,
    undefined,
  );
  // clearing the date of a published article stamps now
  assert.equal(
    stampPublished({ published_at: null }, { status: 'published', published_at: 'then' }, now)
      .published_at,
    now,
  );
  // a draft gets no date
  assert.equal(stampPublished({ status: 'draft' }, null, now).published_at, undefined);
});

test('canWriteColumn and canEditPages follow the role', () => {
  const admin = { is_admin: true, all_columns: true, column_ids: [], can_edit_pages: true };
  const one = { is_admin: false, all_columns: false, column_ids: [COL], can_edit_pages: false };
  const all = { is_admin: false, all_columns: true, column_ids: [], can_edit_pages: false };
  const other = 'c0000000-0000-4000-8000-00000000000b';
  assert.equal(canWriteColumn(admin, other), true);
  assert.equal(canWriteColumn(all, other), true);
  assert.equal(canWriteColumn(one, COL), true);
  assert.equal(canWriteColumn(one, other), false);
  assert.equal(canWriteColumn(null, COL), false);
  assert.equal(canEditPages(admin), true);
  assert.equal(canEditPages(one), false);
  assert.equal(canEditPages({ ...one, can_edit_pages: true }), true);
});

test('publishedFilter quotes the timestamp inside the logic tree', () => {
  assert.equal(
    publishedFilter('2026-10-14T00:00:00.000Z'),
    'and=(status.eq.published,published_at.lte."2026-10-14T00%3A00%3A00.000Z")',
  );
});
