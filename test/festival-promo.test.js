// The Mid-Autumn Festival promo src/caaci-app.js adds to the mirrored homepage
// (a Divi section) and events calendar (an upcoming-event row), run against
// the real mirror pages: where it lands, how it is built, its language and
// link, and that it is gone once the festival is over.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { wireFestivalPromo } from '../src/caaci-app.js';

const BEFORE = Date.parse('2026-09-20T12:00:00Z');
// 2:00–7:00 PM in Champaign (CDT = UTC-5) is 19:00Z on the 27th to 00:00Z on the 28th.
const LAST_HOUR = Date.parse('2026-09-27T23:30:00Z'); // 6:30 PM, still on
const AFTER = Date.parse('2026-09-28T00:00:01Z'); // just after 7:00 PM

const mirror = (file) => readFileSync(new URL(`../mirror/${file}`, import.meta.url), 'utf8');

function load(html, pathname) {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = { pathname, origin: 'https://caaci.example', href: '' };
}

afterEach(() => {
  for (const k of ['document', 'window']) delete globalThis[k];
  globalThis.location = { pathname: '/', origin: '', href: '' };
});

const cards = () => document.querySelectorAll('.caaci-promo');

test('festival promo: on the homepage it sits right after the hero, in English, linking to the English form', () => {
  load(mirror('index.html'), '/');
  wireFestivalPromo(BEFORE);
  assert.equal(cards().length, 1);
  const card = cards()[0];
  const hero = document.querySelector('.entry-content .et_pb_section_0');
  assert.match(hero.querySelector('h1').textContent, /Chinese American Association/);
  assert.equal(hero.nextElementSibling, card, 'directly below the hero');

  // A Divi section like the homepage's own, so Divi lays it out: a row of two
  // half columns. Numbered classes (et_pb_row_1 …) carry one-off rules for
  // those modules — the hero's row_1 has a -65px margin — so none are copied.
  assert.ok(card.matches('.et_pb_section.et_section_regular'));
  assert.equal(
    card.querySelectorAll(':scope > .et_pb_row > .et_pb_column.et_pb_column_1_2').length,
    2,
  );
  for (const node of [card, ...card.querySelectorAll('*')])
    assert.ok(![...node.classList].some((c) => /^et_pb_[a-z_]+_\d+$/.test(c)), node.className);

  assert.match(card.querySelector('.caaci-promo-eyebrow').textContent, /^Sun, Sept 27/);
  assert.equal(card.querySelector('h2').textContent, 'Mid-Autumn Festival registration is open');
  assert.match(card.querySelector('p').textContent, /by 2:00 PM Central Time on September 27/);
  const cta = card.querySelector('a.caaci-btn');
  assert.equal(cta.getAttribute('href'), '/mid_autumn_festival_form/?lang=en');
  assert.equal(cta.textContent, 'Register now →');

  wireFestivalPromo(BEFORE);
  assert.equal(cards().length, 1, 'a second run adds nothing');
});

test('festival promo: the Chinese homepage gets Chinese copy that TranslatePress is told to leave alone', () => {
  load(mirror('zh/index.html'), '/zh/');
  wireFestivalPromo(BEFORE);
  const [card] = cards();
  assert.equal(document.querySelector('.entry-content .et_pb_section_0').nextElementSibling, card);
  assert.equal(card.querySelector('h2').textContent, '中秋节活动报名中');
  assert.match(card.querySelector('p').textContent, /9月27日下午2点（美国中部时间）前报名/);
  assert.equal(card.querySelector('a').getAttribute('href'), '/mid_autumn_festival_form/?lang=zh');
  assert.equal(card.querySelector('a').textContent, '立即报名 →');
  for (const node of [card, ...card.querySelectorAll('*')])
    assert.ok(node.hasAttribute('data-no-dynamic-translation'), node.tagName);
});

const upcoming = () => document.querySelectorAll('.caaci-promo-upcoming');
const notices = () => document.querySelectorAll('.tribe-events-header__messages');

test('festival promo: on the events page it is an upcoming event above, and built like, the past events', () => {
  for (const [file, path, lang, heading, title, month, perk] of [
    [
      'events/index.html',
      '/events/',
      'en',
      'Upcoming Events',
      'Mid-Autumn Festival',
      'Sep',
      /free mooncake/,
    ],
    [
      'zh/events/index.html',
      '/zh/events/',
      'zh',
      '即将举行的活动',
      '中秋节活动',
      '9 月',
      /免费领一份月饼/,
    ],
  ]) {
    load(mirror(file), path);
    wireFestivalPromo(BEFORE);
    assert.equal(cards().length, 0, `${path}: no card at the top of the calendar`);
    assert.equal(upcoming().length, 1, path);
    const [section] = upcoming();
    const past = [...document.querySelectorAll('.tribe-events-calendar-latest-past')].find(
      (n) => n !== section,
    );
    assert.equal(section.nextElementSibling, past, `${path}: directly above Latest Past Events`);

    // The calendar's own CSS styles the row only if it carries the same
    // classes as the past-event rows, so compare against a real one.
    const p = '.tribe-events-calendar-latest-past';
    const pastRow = past.querySelector(`${p}__event-row`);
    const row = section.querySelector(`${p}__event-row`);
    assert.equal(
      section.querySelector(`${p}__heading`).className,
      past.querySelector(`${p}__heading`).className,
    );
    assert.equal(row.className, pastRow.className, `${path}: row`);
    for (const part of [
      'date-tag',
      'date-tag-month',
      'date-tag-daynum',
      'date-tag-year',
      'datetime',
      'title-link',
    ])
      assert.equal(
        row.querySelector(`${p}__event-${part}`).className,
        pastRow.querySelector(`${p}__event-${part}`).className,
        `${path}: ${part}`,
      );

    assert.equal(section.querySelector(`${p}__heading`).textContent, heading);
    assert.equal(row.querySelector(`${p}__event-date-tag-month`).textContent, month);
    assert.equal(row.querySelector(`${p}__event-date-tag-daynum`).textContent, '27');
    assert.equal(row.querySelector(`${p}__event-date-tag-year`).textContent, '2026');
    const href = `/mid_autumn_festival_form/?lang=${lang}`;
    const titleLink = row.querySelector(`${p}__event-title-link`);
    assert.equal(titleLink.textContent, title);
    assert.equal(titleLink.getAttribute('href'), href);
    assert.equal(row.querySelector('a.tribe-common-c-btn').getAttribute('href'), href);
    // The past rows' descriptions are hidden on phones; the mooncake rule must not be.
    const description = row.querySelector(`${p}__event-description`);
    assert.match(description.textContent, perk);
    assert.ok(
      !description.classList.contains('tribe-common-a11y-hidden'),
      `${path}: description always visible`,
    );

    assert.ok(notices().length > 0, `${path}: the mirror has the notice`);
    for (const notice of notices())
      assert.equal(notice.style.display, 'none', `${path}: "no upcoming events" hidden`);
    for (const node of [section, ...section.querySelectorAll('*')])
      assert.ok(node.hasAttribute('data-no-dynamic-translation'), `${path}: ${node.tagName}`);

    wireFestivalPromo(BEFORE);
    assert.equal(upcoming().length, 1, `${path}: a second run adds nothing`);
  }
});

test('festival promo: nowhere else, and not after the festival', () => {
  for (const [file, path] of [
    ['index.html', '/about/'],
    ['events/index.html', '/past-events/'],
    ['index.html', '/events/'], // the events path, but no calendar on the page
  ]) {
    load(mirror(file), path);
    wireFestivalPromo(BEFORE);
    assert.equal(cards().length + upcoming().length, 0, `${file} at ${path}`);
  }

  load(mirror('index.html'), '/');
  wireFestivalPromo(LAST_HOUR);
  assert.equal(cards().length, 1, 'still there between 6 and 7 PM');

  load(mirror('index.html'), '/');
  wireFestivalPromo(AFTER);
  assert.equal(cards().length, 0, 'gone once the festival is over');

  load(mirror('events/index.html'), '/events/');
  wireFestivalPromo(AFTER);
  assert.equal(upcoming().length, 0, 'no upcoming event once the festival is over');
  for (const notice of notices())
    assert.notEqual(notice.style.display, 'none', 'the calendar notice is back');

  load('<!doctype html><body><p>no hero here</p></body>', '/');
  assert.doesNotThrow(() => wireFestivalPromo(BEFORE));
  assert.equal(cards().length, 0);
});
