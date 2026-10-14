// The rules behind page copy overrides (docs/content-management.md, "Override
// keys"), exercised without a DOM: web/src/lib/siteContentCore.js is plain JS
// so node --test can import it on Node 20 (CI), where a .ts module would not load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceValue,
  createApplier,
  currentValue,
  diffDraft,
  effectiveOverrides,
  focusNeedle,
  groupFields,
  humanize,
  isExcluded,
  itemShape,
  leafKind,
  newItem,
  normalizeItem,
  resolveKey,
  rowsToOverrides,
  walkFields,
} from '../web/src/lib/siteContentCore.js';

// A small page in the shape of web/src/data/pages/*.ts.
const makePage = () => ({
  en: {
    title: 'About Us',
    missionTitle: 'OUR MISSION',
    missionText:
      'Our Mission is to help members play a more active role in the community and to promote wellbeing.',
    heroImage: '/images/hero.jpg',
    count: 3,
    featured: true,
    values: [
      { title: 'United', desc: 'Together.' },
      { title: 'Inclusive', desc: 'Everyone.' },
    ],
    benefits: ['Lunch', 'Discounts'],
    hero: { title: 'Welcome', note: 'Line one\nLine two' },
    merchants: [{ id: 'a', name: 'Shop' }],
    tiers: { free: { period: 'no expiry', features: ['News'] } },
  },
  zh: {
    title: '关于我们',
    missionTitle: '我们的使命与宗旨',
    missionText: '我们的使命是帮助会员。',
    heroImage: '/images/hero.jpg',
    count: 3,
    featured: true,
    values: [
      { title: '团结', desc: '团结。' },
      { title: '包容', desc: '包容。' },
    ],
    benefits: ['午餐', '折扣'],
    hero: { title: '欢迎', note: '一\n二' },
    merchants: [{ id: 'a', name: '商店' }],
    tiers: { free: { period: '永不过期', features: ['资讯'] } },
  },
});

const setup = (exclude = ['merchants', 'tiers.*.features']) => {
  const page = makePage();
  const defaults = structuredClone(page);
  const applier = createApplier([{ id: 'about', en: page.en, zh: page.zh, defaults, exclude }]);
  return { page, defaults, applier };
};

test('field kinds: image by name or /images/ value, longtext past 80 chars or a newline', () => {
  assert.equal(leafKind('heroImage', ['https://x.org/a']), 'image');
  assert.equal(leafKind('image', ['']), 'image');
  assert.equal(leafKind('logo', ['/images/cal-uiuc.png']), 'image');
  assert.equal(leafKind('photo', ['https://cdn.example.com/p/a.webp?w=2']), 'image');
  assert.equal(leafKind('url', ['https://illinois.edu']), 'text');
  assert.equal(leafKind('note', ['a\nb']), 'longtext');
  assert.equal(leafKind('body', ['x'.repeat(81)]), 'longtext');
  assert.equal(leafKind('title', ['x'.repeat(80), '短']), 'text');
});

test('walkFields: paths, kinds, lists as one field, numbers and booleans skipped, exclusions', () => {
  const { page } = setup();
  const fields = walkFields(page.en, page.zh, ['merchants', 'tiers.*.features']);
  const byPath = Object.fromEntries(fields.map((f) => [f.path, f.kind]));
  assert.deepEqual(byPath, {
    title: 'text',
    missionTitle: 'text',
    missionText: 'longtext',
    heroImage: 'image',
    values: 'list',
    benefits: 'list',
    'hero.title': 'text',
    'hero.note': 'longtext',
    'tiers.free.period': 'text',
  });
  // No path ever points inside an array.
  assert.ok(fields.every((f) => !/\.\d+(\.|$)/.test(f.path)));
  const values = fields.find((f) => f.path === 'values');
  assert.equal(values.shape.type, 'object');
  assert.deepEqual(
    values.shape.keys.map((k) => [k.key, k.kind, k.required]),
    [
      ['title', 'text', true],
      ['desc', 'text', true],
    ],
  );
  assert.deepEqual(fields.find((f) => f.path === 'benefits').shape, {
    type: 'string',
    kind: 'text',
  });
});

test('isExcluded: exact, prefix and * segments', () => {
  assert.equal(isExcluded('merchants', ['merchants']), true);
  assert.equal(isExcluded('merchants.x', ['merchants']), true);
  assert.equal(isExcluded('merchantsTitle', ['merchants']), false);
  assert.equal(isExcluded('tiers.free.features', ['tiers.*.features']), true);
  assert.equal(isExcluded('tiers.free.period', ['tiers.*.features']), false);
});

test('itemShape: optional keys, nested string lists, kept non-text keys', () => {
  const shape = itemShape(
    [
      { id: 'a', title: 'A', features: ['x'], recommended: true },
      { id: 'b', title: 'B', features: [], extra: 'only here' },
    ],
    [],
  );
  const byKey = Object.fromEntries(shape.keys.map((k) => [k.key, k]));
  assert.equal(byKey.features.kind, 'lines');
  assert.equal(byKey.recommended.kind, 'keep');
  assert.equal(byKey.recommended.required, false);
  assert.equal(byKey.extra.required, false);
  assert.equal(byKey.title.required, true);
  assert.equal(itemShape([], []), null);
  assert.equal(itemShape([1, 2], []), null);
});

test('newItem and normalizeItem keep a list item in its shape', () => {
  const shape = itemShape([{ id: 'a', title: 'A', features: ['x'], on: true }], []);
  const item = newItem(shape);
  assert.match(item.id, /^item-[a-z0-9]+$/);
  assert.deepEqual({ ...item, id: '' }, { id: '', title: '', features: [], on: false });
  assert.deepEqual(normalizeItem({ title: 5, features: ['ok', 3], junk: 'x' }, shape), {
    id: '',
    title: '',
    features: [],
    on: false,
  });
  assert.equal(normalizeItem('a string', shape), undefined);
  assert.equal(newItem(itemShape(['a'], ['b'])), '');
});

test('resolveKey: unknown entries, stale paths, excluded and malformed keys are refused', () => {
  const { applier } = setup();
  const r = resolveKey(applier.byId, 'about.missionText');
  assert.equal(r.path, 'missionText');
  assert.equal(r.defaults.zh, '我们的使命是帮助会员。');
  for (const bad of [
    'nope.title',
    'about.gone',
    'about.merchants',
    'about.tiers.free.features',
    'about.count',
    'about.hero',
    'about.values.0.title',
    'about.__proto__',
    'about..title',
    'about',
    'about.title with space',
  ]) {
    assert.equal(resolveKey(applier.byId, bad), null, bad);
  }
  assert.ok(resolveKey(applier.byId, 'about.tiers.free.period'));
});

test('applyOverrides writes strings in place and leaves other keys alone', () => {
  const { page, applier } = setup();
  const en = page.en;
  applier.apply({ 'about.missionTitle': { zh: '使命' }, 'about.hero.title': { en: 'Hi' } });
  assert.equal(page.en, en, 'the object itself is never replaced');
  assert.equal(page.zh.missionTitle, '使命');
  assert.equal(page.en.missionTitle, 'OUR MISSION');
  assert.equal(page.en.hero.title, 'Hi');
  assert.equal(page.zh.hero.title, '欢迎');
});

test('applyOverrides splices lists: held references see new items, the parent gets a new identity', () => {
  const { page, applier } = setup();
  const held = page.en.values;
  applier.apply({
    'about.values': {
      en: [{ title: 'One', desc: 'First' }, { title: 'Two', desc: 'Second' }, { title: 'Three' }],
    },
  });
  assert.deepEqual(
    held.map((v) => v.title),
    ['One', 'Two', 'Three'],
  );
  assert.deepEqual(held[2], { title: 'Three', desc: '' }, 'a missing required key is filled');
  assert.notEqual(page.en.values, held, 'a useMemo keyed on the list sees a change');
  assert.deepEqual(page.en.values, held);
  assert.equal(page.zh.values.length, 2);

  applier.apply({});
  assert.equal(page.en.values, held, 'back to the original array');
  assert.deepEqual(
    held.map((v) => v.title),
    ['United', 'Inclusive'],
  );
});

test('applyOverrides ignores stale keys and wrong types', () => {
  const { page, defaults, applier } = setup();
  applier.apply({
    'about.gone': { en: 'x' },
    'other.title': { en: 'x' },
    'about.title': { en: ['not', 'a', 'string'], zh: 7 },
    'about.values': { en: 'not a list', zh: ['strings', 'not', 'objects'] },
    'about.benefits': { en: [{ wrong: 'kind' }] },
    'about.merchants': { en: [] },
    'about.missionText': 'not an object',
  });
  assert.deepEqual(page, defaults);
});

test('applyOverrides restores defaults for keys (and languages) no longer present', () => {
  const { page, defaults, applier } = setup();
  applier.apply({
    'about.title': { en: 'A', zh: 'B' },
    'about.benefits': { en: ['Only one'] },
    'about.heroImage': { en: '/images/new.jpg', zh: '/images/new.jpg' },
  });
  assert.equal(page.zh.title, 'B');
  assert.deepEqual(page.en.benefits, ['Only one']);

  // The draft dropped the Chinese title and the image: those revert, the rest stays.
  applier.apply({ 'about.title': { en: 'A' }, 'about.benefits': { en: ['Only one'] } });
  assert.equal(page.en.title, 'A');
  assert.equal(page.zh.title, defaults.zh.title);
  assert.equal(page.en.heroImage, defaults.en.heroImage);

  // A null language (cleared in the database) is the default too.
  applier.apply({ 'about.title': { en: null, zh: 'B' } });
  assert.equal(page.en.title, defaults.en.title);
  assert.deepEqual(page.en.benefits, defaults.en.benefits);

  applier.apply(null);
  assert.deepEqual(page, defaults);
});

test('applied lists are copies: editing the override object later does not leak in', () => {
  const { page, applier } = setup();
  const value = ['A', 'B'];
  applier.apply({ 'about.benefits': { en: value } });
  value.push('C');
  assert.deepEqual(page.en.benefits, ['A', 'B']);
});

test('coerceValue: string for string, shaped list for list', () => {
  const d = makePage();
  assert.equal(coerceValue('x', d.en.title, d.zh.title, 'en'), 'x');
  assert.equal(coerceValue(['x'], d.en.title, d.zh.title, 'en'), undefined);
  assert.deepEqual(coerceValue(['x', 'y'], d.en.benefits, d.zh.benefits, 'zh'), ['x', 'y']);
  assert.equal(coerceValue(['x', 1], d.en.benefits, d.zh.benefits, 'zh'), undefined);
});

// ---------------------------------------------------------------- drafts

const DEFAULTS = makePage();
const defaultOf = (key, lang) => {
  const path = key.split('.').slice(1);
  let cur = DEFAULTS[lang];
  for (const s of path) cur = cur?.[s];
  return cur;
};

test('diffDraft sends only changed keys and languages', () => {
  const saved = { 'about.title': { en: 'Saved title' } };
  const draft = {
    'about.title': { en: 'Saved title', zh: '新标题' }, // en unchanged, zh new
    'about.missionTitle': { en: 'OUR MISSION' }, // equal to the default, nothing saved
    'about.benefits': { en: ['Lunch', 'Discounts', 'More'], zh: ['午餐', '折扣', '更多'] },
  };
  assert.deepEqual(diffDraft(saved, draft, defaultOf), [
    { key: 'about.title', zh: '新标题' },
    { key: 'about.benefits', en: ['Lunch', 'Discounts', 'More'], zh: ['午餐', '折扣', '更多'] },
  ]);
});

test('diffDraft: a field set back to its default sends null to clear the saved value', () => {
  const saved = { 'about.title': { en: 'Saved', zh: '已保存' }, 'about.benefits': { en: ['x'] } };
  const draft = {
    'about.title': { en: 'About Us', zh: '已保存' },
    'about.benefits': { en: ['Lunch', 'Discounts'], zh: ['午餐', '折扣'] },
  };
  assert.deepEqual(diffDraft(saved, draft, defaultOf), [
    { key: 'about.title', en: null },
    { key: 'about.benefits', en: null },
  ]);
  assert.deepEqual(diffDraft(saved, {}, defaultOf), []);
});

test('currentValue: draft, else saved, else default', () => {
  const saved = { 'about.title': { en: 'Saved' } };
  const draft = { 'about.title': { zh: '草稿' } };
  assert.equal(currentValue(saved, draft, defaultOf, 'about.title', 'en'), 'Saved');
  assert.equal(currentValue(saved, draft, defaultOf, 'about.title', 'zh'), '草稿');
  assert.equal(currentValue(saved, draft, defaultOf, 'about.missionTitle', 'en'), 'OUR MISSION');
});

test('effectiveOverrides: saved with the draft laid over, defaults left out', () => {
  const saved = { 'about.title': { en: 'Saved', zh: '已保存' }, 'about.missionTitle': { en: 'M' } };
  const draft = { 'about.title': { en: 'About Us' }, 'about.hero.title': { zh: '你好' } };
  assert.deepEqual(effectiveOverrides(saved, draft, defaultOf), {
    'about.title': { zh: '已保存' },
    'about.missionTitle': { en: 'M' },
    'about.hero.title': { zh: '你好' },
  });
});

test('rowsToOverrides keeps only the languages that are set', () => {
  assert.deepEqual(
    rowsToOverrides([
      { key: 'about.title', value_en: 'A', value_zh: null },
      { key: 'about.benefits', value_en: ['x'], value_zh: ['y'] },
      { key: 'about.none', value_en: null, value_zh: null },
      null,
    ]),
    { 'about.title': { en: 'A' }, 'about.benefits': { en: ['x'], zh: ['y'] } },
  );
  assert.deepEqual(rowsToOverrides(undefined), {});
});

// ---------------------------------------------------------------- labels, grouping

test('humanize turns keys into words', () => {
  assert.equal(humanize('missionText'), 'Mission text');
  assert.equal(humanize('btnDonation'), 'Button donation');
  assert.equal(humanize('rsvpUrl'), 'Rsvp url');
  assert.equal(humanize('title'), 'Title');
});

test('groupFields: nested fields by section, titles join the list they name', () => {
  const { page } = setup();
  const fields = walkFields(page.en, page.zh, ['merchants']);
  const groups = groupFields(fields, { missionText: 'mission', missionTitle: 'mission' });
  assert.deepEqual(
    groups.map((g) => [g.id, g.fields.map((f) => f.path)]),
    [
      ['_page', ['title']],
      ['mission', ['missionTitle', 'missionText']],
      // heroImage is named after the hero section, so it is edited there.
      ['hero', ['heroImage', 'hero.title', 'hero.note']],
      ['values', ['values']],
      ['benefits', ['benefits']],
      ['tiers', ['tiers.free.period', 'tiers.free.features']],
    ],
  );
  const named = groupFields(walkFields({ valuesTitle: 'V', values: ['a'] }, {}));
  assert.deepEqual(
    named.map((g) => [g.id, g.fields.map((f) => f.path)]),
    [['values', ['valuesTitle', 'values']]],
  );
});

test('focusNeedle: the longest literal run of a template', () => {
  assert.equal(
    focusNeedle('{count} Verified  Directory Merchants'),
    'Verified Directory Merchants',
  );
  assert.equal(focusNeedle('{price}/yr'), '/yr');
  assert.equal(focusNeedle('  plain   text '), 'plain text');
});
