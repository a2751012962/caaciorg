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

// Motion numbers live in web/src/lib/motion.ts. Components compose rise(),
// listItem(), hoverLift, reveal() ... instead of retyping curves and durations.
// StackedCardsSection is a bespoke scrubbed timeline and keeps its own numbers.
const MOTION_EXEMPT = ['lib\\motion.ts', 'lib/motion.ts', 'StackedCardsSection.tsx', 'Hero.tsx'];
// Hero.tsx stays exempt: its banners run a bespoke GSAP entrance sequence.
const MOTION_LITERALS = [
  [
    /ease: \[0\.22, 1, 0\.36, 1\]/,
    'ease: [0.22, 1, 0.36, 1] — use rise()/mountIn/listItem() from lib/motion',
  ],
  [/toggleActions:/, 'toggleActions — use reveal() from lib/motion (reveals run once)'],
  [
    /ease: 'power\d\.(out|in|inOut)'|ease: 'back\.out/,
    'GSAP ease string — use reveal() or MOTION.easeGsap',
  ],
  [/whileHover=\{\{/, 'whileHover literal — use hoverLift or hoverScale'],
  [/whileTap=\{\{/, 'whileTap literal — use tap'],
  [/viewport=\{\{/, 'viewport literal — use inView'],
];

test('motion numbers come from lib/motion.ts', async () => {
  const hits = [];
  for (const f of files) {
    if (MOTION_EXEMPT.some((x) => f.endsWith(x))) continue;
    const s = await readFile(f, 'utf8');
    for (const [re, why] of MOTION_LITERALS) {
      if (re.test(s)) hits.push(`${f}: ${why}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('tabs and segmented controls go through FluidTabs', async () => {
  const hits = [];
  for (const f of files) {
    if (f.endsWith('FluidTabs.tsx')) continue;
    const s = await readFile(f, 'utf8');
    if (/h-10 p-1 rounded-full bg-neutral-100/.test(s)) {
      hits.push(`${f}: hand-rolled segmented track — use <FluidTabs> (DESIGN_SYSTEM.md §5.5)`);
    }
  }
  assert.deepEqual(hits, []);
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
