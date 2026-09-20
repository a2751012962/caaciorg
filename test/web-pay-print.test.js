// The printed sticker sheet (web/src/lib/payPrint.js), which is what a stall
// actually puts on a cup. A bare QR is unusable, so what has to survive every
// change is: the price, the name in both languages, the line that says what to
// do with it, and the code — on every sticker, the right number of times.
// Plain JS so node --test can import it on Node 20 (CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paySheetHtml, LAYOUT, PRINT_CELL } from '../web/src/lib/payPrint.js';

const JUICE = {
  name: 'Orange juice',
  name_zh: '橙汁',
  tokens: 30,
  code: 'K7M2PQ34',
  url: 'https://caaciorg.com/pay/?c=K7M2PQ34',
  rate: 10,
};
const QR = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

const count = (html, needle) => html.split(needle).length - 1;

test('a sheet is one page of identical stickers, cut lines and all', () => {
  for (const size of ['small', 'large']) {
    const html = paySheetHtml(JUICE, size, 'zh', QR);
    const l = LAYOUT[size];
    assert.equal(count(html, 'class="s"'), l.perPage, `${size}: sticker count`);
    assert.equal(count(html, QR), l.perPage, `${size}: every sticker carries the QR`);
    assert.match(html, /@page \{ size: letter/, `${size}: US paper`);
    assert.match(html, /border: 1px dashed/, `${size}: something to cut along`);
    assert.match(
      html,
      new RegExp(`grid-template-columns: repeat\\(${l.columns}, 1fr\\)`),
      `${size}: columns`,
    );
  }
});

test('every sticker says what it is, in both languages, and what it costs', () => {
  const html = paySheetHtml(JUICE, 'small', 'zh', QR);
  const per = LAYOUT.small.perPage;
  // The name is on every sticker, and twice more off the sheet: the window
  // title and the "what am I printing" line above it, neither of which prints.
  assert.equal(count(html, '橙汁'), per + 2, 'the Chinese name is on each one');
  assert.equal(count(html, 'Orange juice'), per, 'and the English one, on the stickers only');
  assert.equal(count(html, '>30<'), per, 'the price in tokens');
  assert.equal(count(html, '$3.00'), per, 'and in money, at the rate');
  assert.equal(count(html, 'Scan to pay with CAACI tokens'), per);
  assert.equal(count(html, '手机相机扫码，用华协币支付'), per);
  assert.equal(count(html, 'K7M2PQ34'), per + 1, 'the code, plus the document title');
});

test('the money line follows the rate, not a hard-coded ten', () => {
  assert.match(paySheetHtml({ ...JUICE, rate: 20 }, 'small', 'en', QR), /\$1\.50/);
  assert.match(paySheetHtml({ ...JUICE, tokens: 450, rate: 10 }, 'small', 'en', QR), /\$45\.00/);
  // A missing rate must not print $Infinity on a hundred stickers.
  assert.match(paySheetHtml({ ...JUICE, rate: 0 }, 'small', 'en', QR), /\$3\.00/);
});

test('an item name cannot break out of the sheet', () => {
  const html = paySheetHtml(
    { ...JUICE, name_zh: '<script>alert(1)</script>', name: 'a"b&c' },
    'small',
    'zh',
    QR,
  );
  assert.equal(html.includes('<script>alert(1)'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /a&quot;b&amp;c/);
  // The one script the sheet does carry is its own auto-print.
  assert.equal(count(html, '<script>'), 1);
});

test('the sheet uses the site’s one typeface, and waits for it before printing', () => {
  const html = paySheetHtml(JUICE, 'small', 'zh', QR, 'https://caaciorg.com');
  assert.match(html, /fonts\.googleapis\.com/, 'the shared Google Fonts request');
  assert.match(
    html,
    /<link rel="stylesheet" href="https:\/\/caaciorg\.com\/assets\/caaci-fonts\.css">/,
  );
  // Exactly this shape, no fallback list: test/fonts.test.js allows no other.
  assert.match(html, /font-family: var\(--caaci-font-sans\)/);
  assert.match(html, /font-family: var\(--caaci-font-mono\)/);
  // No family is named here; caaci-fonts.css is the only place that may.
  assert.doesNotMatch(html.replace(/https:\/\/fonts\.googleapis\.com[^"]*/g, ''), /Poppins/);
  assert.match(html, /document\.fonts\.ready/, 'never print in the fallback face');
});

test('an item with no Chinese name prints its English name once, not twice', () => {
  const html = paySheetHtml({ ...JUICE, name_zh: null }, 'small', 'en', QR);
  assert.equal(count(html, 'class="name"'), LAYOUT.small.perPage);
  assert.equal(count(html, 'class="en"'), 0);
  assert.equal(
    count(html, 'Orange juice'),
    LAYOUT.small.perPage + 2,
    'the stickers, plus the title and the line above the sheet',
  );
});

test('the print QR is drawn bigger than the screen one (8px cells ≈ 90dpi on paper)', () => {
  assert.ok(PRINT_CELL.small > 8);
  assert.ok(PRINT_CELL.large > PRINT_CELL.small);
});
