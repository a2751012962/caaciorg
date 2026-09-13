// The Mid-Autumn Festival card src/caaci-app.js adds to the mirrored homepage
// and events calendar, run against the real mirror pages: where it lands, its
// language and link, and that it is gone once the festival is over.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { wireFestivalPromo } from '../src/caaci-app.js';

const BEFORE = Date.parse('2026-09-20T12:00:00Z');
const AFTER = Date.parse('2026-09-28T00:00:00Z'); // the festival ended at 23:00Z on the 27th

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

test('festival promo: on the events page it opens the calendar, above "no upcoming events"', () => {
  for (const [file, path, title] of [
    ['events/index.html', '/events/', 'Mid-Autumn Festival registration is open'],
    ['zh/events/index.html', '/zh/events/', '中秋节活动报名中'],
  ]) {
    load(mirror(file), path);
    wireFestivalPromo(BEFORE);
    assert.equal(cards().length, 1, path);
    const [card] = cards();
    const calendar = document.querySelector('.tribe-events-l-container');
    assert.equal(calendar.firstElementChild, card, `${path}: first in the calendar`);
    const header = calendar.querySelector('.tribe-events-header');
    assert.ok(
      card.compareDocumentPosition(header) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      `${path}: before the calendar header`,
    );
    assert.equal(card.querySelector('h2').textContent, title);
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
    assert.equal(cards().length, 0, `${file} at ${path}`);
  }

  load(mirror('index.html'), '/');
  wireFestivalPromo(AFTER);
  assert.equal(cards().length, 0, 'gone once the festival is over');

  load('<!doctype html><body><p>no hero here</p></body>', '/');
  assert.doesNotThrow(() => wireFestivalPromo(BEFORE));
  assert.equal(cards().length, 0);
});
