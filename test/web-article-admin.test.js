// The rules behind the admin console's article editor, exercised without a
// DOM: web/src/lib/articleAdmin.js is plain JS so node --test can import it on
// Node 20 (CI), where a .ts module would not load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SLUG_RE,
  articleState,
  canonicalHtml,
  emptyForm,
  formFromArticle,
  formProblem,
  formToBody,
  fromLocalInput,
  isBlankHtml,
  sameForm,
  slugInput,
  slugify,
  toLocalInput,
  writableColumns,
} from '../web/src/lib/articleAdmin.js';

// ------------------------------------------------------------------ slugify

test('an English title becomes a hyphenated address', () => {
  assert.equal(
    slugify('Mid-Autumn Festival 2026: Photos & Thanks!'),
    'mid-autumn-festival-2026-photos-and-thanks',
  );
  assert.equal(slugify('  Café   Crème  '), 'cafe-creme');
  assert.equal(slugify("Members' Corner"), 'members-corner');
  assert.match(slugify('Hello World'), SLUG_RE);
});

test('a Chinese-only title gives no slug (the API makes a short id)', () => {
  assert.equal(slugify('中秋节晚会'), '');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify('中秋 Gala 晚会'), 'gala');
});

test('a long title is cut at a word boundary, at most 80 characters', () => {
  const s = slugify('word '.repeat(40));
  assert.ok(s.length <= 80, s);
  assert.match(s, SLUG_RE);
  assert.equal(s.endsWith('-'), false);
});

test('typing in the slug box keeps a trailing hyphen but nothing else odd', () => {
  assert.equal(slugInput('My Post'), 'my-post');
  assert.equal(slugInput('my-'), 'my-');
  assert.equal(slugInput('--a__b'), 'a-b');
  assert.equal(slugInput('ÜBER'), 'uber');
  assert.equal(slugInput('中秋'), '');
});

// ------------------------------------------------------------------ status

test('published with a future date is scheduled; anything else not published is a draft', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(articleState('draft', null, now), 'draft');
  assert.equal(articleState('draft', '2026-01-01T00:00:00Z', now), 'draft');
  assert.equal(articleState('published', '2026-10-14T11:59:00Z', now), 'published');
  assert.equal(articleState('published', '2026-10-14T12:00:00Z', now), 'published');
  assert.equal(articleState('published', '2026-10-15T00:00:00Z', now), 'scheduled');
  // No date yet: the API stamps it on publish, so it shows as published.
  assert.equal(articleState('published', null, now), 'published');
  assert.equal(articleState(undefined, null, now), 'draft');
});

// ------------------------------------------------------------------ dates

test('datetime-local values round-trip through ISO in the local zone', () => {
  assert.equal(toLocalInput(null), '');
  assert.equal(toLocalInput('not a date'), '');
  const local = '2026-10-14T09:30';
  const iso = fromLocalInput(local);
  assert.ok(iso);
  assert.equal(toLocalInput(iso), local);
  assert.equal(fromLocalInput(''), null);
  assert.equal(fromLocalInput('tomorrow'), null);
});

// ------------------------------------------------------------------ html

test('an editor left empty counts as no body', () => {
  for (const blank of ['', '   ', '<p><br></p>', '<p>&nbsp;</p>', '<br>', '<p></p><p><br/></p>'])
    assert.equal(isBlankHtml(blank), true, blank);
  assert.equal(isBlankHtml('<p>Hi</p>'), false);
  assert.equal(isBlankHtml('<figure><img src="/a.jpg" alt=""></figure>'), false);
});

test("the editor's own reformatting is not a change", () => {
  assert.equal(canonicalHtml('<p>a&nbsp;b</p>\n<p><br></p>'), canonicalHtml('<p>a b</p>'));
  assert.equal(canonicalHtml('<p>x<br/></p>'), canonicalHtml('<p>x<br></p>'));
  assert.notEqual(canonicalHtml('<p>a</p>'), canonicalHtml('<p>b</p>'));
  assert.notEqual(canonicalHtml('<p>a</p>'), canonicalHtml('<h2>a</h2>'));
});

// ------------------------------------------------------------------ form

const saved = {
  id: 'a1',
  column_id: 'c1',
  slug: 'hello',
  title_en: 'Hello',
  title_zh: '你好',
  summary_en: 'Short',
  summary_zh: '',
  body_en: '<p>Body</p>',
  body_zh: '',
  cover_url: null,
  cover_alt_en: '',
  cover_alt_zh: '',
  author: 'Ann',
  status: 'published',
  published_at: '2026-10-01T15:00:00.000Z',
  pinned: true,
};

test('a saved article fills the form and saves back unchanged', () => {
  const f = formFromArticle(saved);
  assert.equal(f.cover_url, '');
  assert.equal(f.pinned, true);
  const body = formToBody(f);
  assert.equal(body.cover_url, null);
  assert.equal(body.slug, 'hello');
  assert.equal(body.published_at, saved.published_at);
  assert.equal(body.body_zh, '');
  assert.equal('status' in body, false, 'status is set by the action buttons, not the form');
});

test('the body sent to the API trims text and leaves an empty slug to the API', () => {
  const f = { ...emptyForm('c1'), title_en: '  Hi  ', body_en: '<p><br></p>', slug: 'hi-' };
  const body = formToBody(f);
  assert.equal(body.title_en, 'Hi');
  assert.equal(body.body_en, '');
  assert.equal(body.slug, 'hi');
  assert.equal('slug' in formToBody(emptyForm('c1')), false);
  assert.equal(formToBody(emptyForm('c1')).published_at, null);
});

test('only real edits make the form dirty', () => {
  const a = formFromArticle(saved);
  assert.equal(sameForm(a, { ...a }), true);
  assert.equal(sameForm(a, { ...a, body_en: '<p>Body</p><p><br></p>' }), true);
  assert.equal(sameForm(a, { ...a, title_en: 'Hello ' }), true);
  assert.equal(sameForm(a, { ...a, title_en: 'Hello!' }), false);
  assert.equal(sameForm(a, { ...a, pinned: false }), false);
  assert.equal(sameForm(a, { ...a, body_en: '<p>Body 2</p>' }), false);
});

test('what stops a save', () => {
  assert.deepEqual(formProblem(emptyForm(''))?.[0], 'Choose a column.');
  assert.match(formProblem(emptyForm('c1'))?.[0] ?? '', /title/);
  assert.equal(formProblem({ ...emptyForm('c1'), title_zh: '标题' }), null);
  assert.match(
    formProblem({ ...emptyForm('c1'), title_en: 'x', slug: 'Bad Slug' })?.[0] ?? '',
    /address/,
  );
  assert.equal(formProblem({ ...emptyForm('c1'), title_en: 'x', slug: 'ok-slug-' }), null);
});

test('an editor writes only in their columns; admins and all-column editors in every one', () => {
  const cols = [
    { id: 'b', sort_order: 2 },
    { id: 'a', sort_order: 1 },
    { id: 'c', sort_order: 3 },
  ];
  const ids = (r) => writableColumns(cols, r).map((c) => c.id);
  assert.deepEqual(ids({ is_admin: true, all_columns: false, column_ids: [] }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ is_admin: false, all_columns: true, column_ids: [] }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ is_admin: false, all_columns: false, column_ids: ['c', 'a'] }), [
    'a',
    'c',
  ]);
  assert.deepEqual(ids({ is_admin: false, all_columns: false, column_ids: [] }), []);
  assert.deepEqual(
    cols.map((c) => c.id),
    ['b', 'a', 'c'],
    'the input is not reordered',
  );
});
