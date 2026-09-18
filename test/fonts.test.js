// One typeface system for the whole site. The family stacks are declared once,
// in src/caaci-fonts.css, and the Google Fonts request once, GOOGLE_FONTS_URL in
// src/caaci-shared.js. Every other file reaches them through the --caaci-font-*
// variables, the Tailwind font-* utilities or the <!--CAACI_FONTS--> marker, so
// a page cannot drift onto fonts of its own again (as /admin/ had: Saira Extra
// Condensed buttons, a system-sans body because Poppins was never loaded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOOGLE_FONTS_URL, googleFontLinks } from '../src/caaci-shared.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFile(join(ROOT, p), 'utf8'); // repo-relative
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const readAbs = (f) => readFile(f, 'utf8'); // a walked (absolute) path

const SKIP = new Set(['node_modules', 'vendor', 'dist']);
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(css|html|tsx?|m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Comments may explain the system by name; code may not.
const uncommented = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

// Where a page or a stylesheet could name a font.
const sources = [
  ...(await walk(join(ROOT, 'src'))),
  ...(await walk(join(ROOT, 'web', 'src'))),
  ...(await walk(join(ROOT, 'member-src'))),
  ...(await walk(join(ROOT, 'admin-src'))),
  ...(await walk(join(ROOT, 'functions'))),
  join(ROOT, 'web', 'index.html'),
  join(ROOT, 'web', 'vite.config.ts'),
  join(ROOT, 'build.mjs'),
];
const FONTS_CSS = 'src/caaci-fonts.css';
const SHARED_JS = 'src/caaci-shared.js';
const SYSTEM_JS = 'functions/api/_fonts.js';

test('caaci-fonts.css declares one family for text and one for data', async () => {
  const css = await read(FONTS_CSS);
  for (const v of ['sans', 'mono'])
    assert.match(css, new RegExp(`--caaci-font-${v}:`), `missing --caaci-font-${v}`);
  assert.match(css, /--caaci-font-sans:\s*'Poppins', 'Microsoft YaHei', 'PingFang SC'/);
  assert.doesNotMatch(uncommented(css), /serif'|Playfair|Noto Serif/, 'no second family');
});

test('the web font families are named only in caaci-fonts.css', async () => {
  const hits = [];
  for (const f of sources) {
    const p = rel(f);
    if (p === FONTS_CSS) continue;
    const code = uncommented(await readAbs(f));
    for (const m of code.matchAll(/Poppins|Playfair|Noto Serif|Noto Sans|Saira|cwTeXFangSong/g))
      if (!(p === SHARED_JS && m.index > code.indexOf('GOOGLE_FONTS_URL')))
        hits.push(`${p}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], 'use var(--caaci-font-*) / a font-* utility instead');
});

test('every font-family outside caaci-fonts.css is a variable', async () => {
  const hits = [];
  for (const f of sources) {
    const p = rel(f);
    if (p === FONTS_CSS || p === SYSTEM_JS) continue;
    const code = uncommented(await readAbs(f));
    for (const m of code.matchAll(/font-family\s*:\s*([^;"'`\n]+)/g)) {
      const value = m[1].trim();
      if (/^(var\(--(caaci-font|font)-[\w-]+\)|inherit|\$\{SYSTEM_FONT_STACK\})$/.test(value))
        continue;
      hits.push(`${p}: font-family: ${value}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the Google Fonts request is one constant and every page head takes it from the marker', async () => {
  const hits = [];
  for (const f of sources) {
    const p = rel(f);
    if (p === SHARED_JS) continue;
    if (/fonts\.googleapis|fonts\.gstatic/.test(await readAbs(f))) hits.push(p);
  }
  assert.deepEqual(hits, [], 'link Google Fonts through <!--CAACI_FONTS--> (googleFontLinks)');
  for (const p of [
    'web/index.html',
    'member-src/login.html',
    'member-src/privacy.html',
    'admin-src/index.html',
  ])
    assert.match(await read(p), /<!--CAACI_FONTS-->/, `${p}: missing <!--CAACI_FONTS-->`);
  assert.ok(GOOGLE_FONTS_URL.includes('family=Poppins:'), 'Poppins not requested');
  assert.equal(GOOGLE_FONTS_URL.match(/family=/g).length, 1, 'one family only');
  const links = googleFontLinks();
  assert.match(links, /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/);
  assert.ok(links.includes(`href="${GOOGLE_FONTS_URL}" rel="stylesheet"`));
});

test('React components use the font-sans / font-mono utilities only', async () => {
  const hits = [];
  for (const f of sources) {
    const p = rel(f);
    if (!p.startsWith('web/src/') || !/\.tsx?$/.test(p)) continue;
    const s = await readAbs(f);
    if (/fontFamily/.test(s)) hits.push(`${p}: style fontFamily — use font-sans / font-mono`);
    for (const m of s.matchAll(/\bfont-(serif-caaci|poppins|serif|display(-zh)?)\b(?!-)/g))
      hits.push(`${p}: ${m[0]} — one family: font-sans (weight/size make a heading)`);
  }
  assert.deepEqual(hits, []);
});

test('web/src/index.css maps the Tailwind font utilities onto the shared stacks', async () => {
  const css = await read('web/src/index.css');
  assert.match(css, /@import '\.\.\/\.\.\/src\/caaci-fonts\.css';/);
  assert.match(css, /--font-sans: var\(--caaci-font-sans\);/);
  assert.match(css, /--font-mono: var\(--caaci-font-mono\);/);
  assert.doesNotMatch(css, /--font-display|--font-serif/, 'one family: no display token');
});

test('the Tabler skin takes body and monospace from the shared stacks and imports no fonts', async () => {
  const theme = await read('src/caaci-theme.css');
  assert.doesNotMatch(theme, /^@import/m, 'caaci-theme.css loads no fonts of its own');
  assert.match(theme, /--tblr-font-sans-serif: var\(--caaci-font-body\);/);
  assert.match(theme, /--tblr-font-monospace: var\(--caaci-font-mono\);/);
  const ui = await read('src/caaci-ui.css');
  assert.match(ui, /--caaci-font-body: var\(--caaci-font-sans\);/);
  assert.match(ui, /--caaci-font-display: var\(--caaci-font-sans\);/);
  assert.match(ui, /--caaci-font-button: var\(--caaci-font-sans\);/);
});
