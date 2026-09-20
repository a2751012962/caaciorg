// The printable sheet behind /token-admin/ → Menu → QR code → Print.
//
// A bare QR tells a customer nothing: what it buys, what it costs, and that it
// belongs to CAACI at all have to be printed beside it, or the sticker is
// unusable. So the sheet is the deliverable, not the image — one page of
// identical stickers with cut lines.
//
// It is written into a window of its own rather than rendered into the back
// office, because printing part of a page means fighting that page's
// stylesheet; a separate document carries only the rules below (and no
// Tailwind, which is why the colours here are literal).
//
// Plain JS, like lib/registration.js: CI runs Node 20, where test/ cannot
// import a .ts module. The QR arrives as a data URL from the caller, so nothing
// here depends on the qrcode library either — PRINT_CELL says how big to draw
// it, because the screen's 8px cells would land at roughly 90dpi on paper.
//
// The typeface is the site's, reached the way every other surface reaches it:
// the Google Fonts request from caaci-shared.js and /assets/caaci-fonts.css,
// then var(--caaci-font-sans). No family is named here (test/fonts.test.js),
// and the sheet waits for document.fonts before printing, so the paper cannot
// come out in the fallback face because the web font was still loading.
import { googleFontLinks } from '../../../src/caaci-shared.js';

/**
 * @typedef {object} Sticker
 * @property {string} name
 * @property {string|null} name_zh
 * @property {number} tokens
 * @property {string} code           the printed code, e.g. K7M2PQ34
 * @property {string} url            what the QR encodes (…/pay/?c=<code>)
 * @property {number} rate           tokens per dollar, for the money line
 */

/** @typedef {'small'|'large'} SheetSize */

/** 12 to a page for a cup, 4 for a sign standing on the table. */
export const LAYOUT = {
  small: { columns: 3, perPage: 12, cell: 12, qr: '58%', name: '13pt', tokens: '30pt' },
  large: { columns: 2, perPage: 4, cell: 20, qr: '62%', name: '20pt', tokens: '52pt' },
};

/** The QR module size each sheet wants, for the caller's qrcode() call. */
export const PRINT_CELL = { small: LAYOUT.small.cell, large: LAYOUT.large.cell };

const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

const money = (tokens, rate) =>
  `$${(tokens / (rate || 10)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * The whole print document, as a string.
 * @param {Sticker} sticker
 * @param {SheetSize} size
 * @param {'en'|'zh'} lang   only the screen furniture; the sticker is bilingual
 * @param {string} qrSrc     a data: URL for the QR, drawn at PRINT_CELL[size]
 * @param {string} [origin]  where /assets/caaci-fonts.css is served from
 * @returns {string}
 */
export function paySheetHtml(sticker, size, lang, qrSrc, origin = '') {
  const l = LAYOUT[size] || LAYOUT.small;
  const zh = sticker.name_zh || sticker.name;
  const en = sticker.name_zh ? sticker.name : '';
  const t = (e, c) => (lang === 'zh' ? c : e);

  // Both languages on every sticker: the person scanning it could be either,
  // and a cup is not the place to make them pick.
  const one = `
    <div class="s">
      <p class="eyebrow">CAACI · 华协币</p>
      <img src="${esc(qrSrc)}" alt="" />
      <p class="name">${esc(zh)}</p>
      ${en ? `<p class="en">${esc(en)}</p>` : ''}
      <p class="tokens">${Number(sticker.tokens) || 0}</p>
      <p class="money">华协币 · ${money(Number(sticker.tokens) || 0, sticker.rate)}</p>
      <p class="how">手机相机扫码，用华协币支付<span>Scan to pay with CAACI tokens</span></p>
      <p class="code">${esc(sticker.code)}</p>
    </div>`;

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${esc(zh)} · ${Number(sticker.tokens) || 0} · ${esc(sticker.code)}</title>
${googleFontLinks()}
<link rel="stylesheet" href="${esc(origin)}/assets/caaci-fonts.css">
<style>
  @page { size: letter; margin: 0.4in; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0.4in; background: #f4f2ef; color: #300200;
    font-family: var(--caaci-font-sans);
  }
  .bar { max-width: 7.7in; margin: 0 auto 0.3in; display: flex; gap: 12px; align-items: center; }
  .bar p { margin: 0; font-size: 11pt; }
  .bar b { font-size: 9pt; color: #6b6460; font-weight: 400; display: block; }
  button {
    font: inherit; font-size: 10pt; font-weight: 600; padding: 8px 18px; border-radius: 999px;
    border: 0; background: #8e2e11; color: #fff; cursor: pointer;
  }
  .sheet {
    max-width: 7.7in; margin: 0 auto; background: #fff;
    display: grid; grid-template-columns: repeat(${l.columns}, 1fr);
  }
  .s {
    border: 1px dashed #c9c2bb; padding: 10px 8px 12px; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  .s p { margin: 0; }
  .eyebrow { font-size: 6.5pt; font-weight: 700; letter-spacing: 0.14em; color: #8e2e11; }
  .s img { width: ${l.qr}; height: auto; display: block; margin: 6px auto 8px; image-rendering: pixelated; }
  .name { font-size: ${l.name}; font-weight: 700; line-height: 1.15; }
  .en { font-size: 8pt; color: #6b6460; }
  .tokens { font-size: ${l.tokens}; font-weight: 700; color: #8e2e11; line-height: 1; margin-top: 4px; }
  .money { font-size: 7.5pt; color: #6b6460; }
  .how { font-size: 7.5pt; color: #4a423d; margin-top: 8px; line-height: 1.35; }
  .how span { display: block; color: #9a938d; }
  .code { font-size: 6.5pt; color: #b3aca6; letter-spacing: 0.18em; margin-top: 6px; font-family: var(--caaci-font-mono); }
  @media print {
    body { background: #fff; padding: 0; }
    .bar { display: none; }
    .sheet { max-width: none; }
  }
</style>
</head>
<body>
  <div class="bar">
    <button type="button" onclick="window.print()">${t('Print', '打印')}</button>
    <p>${esc(zh)} · ${Number(sticker.tokens) || 0} ${t('tokens', '币')} · ${l.perPage} ${t('per page', '枚一页')}
      <b>${t(
        'Cut along the dashed lines. Reprint whenever the price changes, or after “New code”.',
        '沿虚线剪开。改价之后、或点过「换新码」之后，都要重印。',
      )}</b></p>
  </div>
  <div class="sheet">${one.repeat(l.perPage)}</div>
  <script>
    // Print once the web font is in, or after a second if it never arrives —
    // paper set in the fallback face is a wasted sheet.
    window.addEventListener('load', function () {
      var go = function () { window.print(); };
      var done = false;
      var once = function () { if (!done) { done = true; go(); } };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(once);
      setTimeout(once, 1000);
    });
  <\/script>
</body>
</html>`;
}

/**
 * Opens the sheet in a new window and asks it to print. Returns false when the
 * browser blocked the window, so the caller can say so instead of looking like
 * nothing happened.
 * @param {Sticker} sticker
 * @param {SheetSize} size
 * @param {'en'|'zh'} lang
 * @param {string} qrSrc
 * @returns {boolean}
 */
export function openPaySheet(sticker, size, lang, qrSrc) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  // about:blank inherits this page's base URL, but the stylesheet link is
  // written out absolute so the sheet does not depend on that.
  w.document.write(paySheetHtml(sticker, size, lang, qrSrc, window.location.origin));
  w.document.close();
  return true;
}
