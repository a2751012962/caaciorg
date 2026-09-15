// Pins web/DESIGN_SYSTEM.md to the React source: brand and surface colours are
// Tailwind @theme tokens in web/src/index.css (bg-brick, text-ink, ...), never a
// hex written into a className or a style prop. DigitalMemberCard draws on a
// <canvas>, which has no classes, so it is the one file allowed to hold hexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../web/src/', import.meta.url);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name)) yield p;
  }
}

const files = [];
for await (const f of walk(ROOT.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) files.push(f);

const TOKENS = [
  'brick',
  'brick-hover',
  'brick-pressed',
  'brick-deep',
  'maroon',
  'rust',
  'gold',
  'tan',
  'ink',
  'surface-2',
  'surface-3',
];

test('index.css declares every documented colour token', async () => {
  const css = await readFile(new URL('index.css', ROOT), 'utf8');
  for (const t of TOKENS) assert.match(css, new RegExp(`--color-${t}:`), `missing --color-${t}`);
  assert.match(css, /@keyframes fadeIn/);
  assert.match(css, /\.animate-fadeIn/);
});

test('no hex colour inside a Tailwind arbitrary value', async () => {
  const hits = [];
  for (const f of files) {
    const s = await readFile(f, 'utf8');
    for (const m of s.matchAll(/\[#[0-9a-fA-F]{3,8}\]/g)) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], 'use a token class (bg-brick, text-ink, ...) instead');
});

test('no inline backgroundColor/color hex outside the canvas card', async () => {
  const hits = [];
  for (const f of files) {
    if (f.endsWith('DigitalMemberCard.tsx')) continue;
    const s = await readFile(f, 'utf8');
    for (const m of s.matchAll(/(backgroundColor|color|borderColor):\s*'#[0-9a-fA-F]{3,8}'/g)) {
      hits.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], 'use a token class instead of a style prop');
});
