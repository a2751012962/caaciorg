// The language toggle fades text by text instead of cutting: App.tsx commits
// the new language through fadeLang, which fades the old wording out, flushes
// React, and rises the new wording in (opacity 0 → 1, drifting up). Only text
// elements animate, so layout and scroll stay put; reduced motion gets a swap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');

test('toggleLang sets the language inside fadeLang', async () => {
  const app = await read('App.tsx');
  assert.match(app, /import \{ fadeLang \} from '\.\/lib\/langFade'/);
  assert.match(app, /fadeLang\(\(\) => setLang\(nextLang\)\)/);
  assert.doesNotMatch(app, /^\s*setLang\(nextLang\);/m, 'a bare setLang cuts instead of fading');
});

test('fadeLang fades out, flushes React, then rises the new text in', async () => {
  const src = await read('lib/langFade.ts');
  assert.match(src, /import \{ flushSync \} from 'react-dom'/);
  assert.match(src, /flushSync\(update\)/);
  assert.match(src, /\{ opacity: 1 \}, \{ opacity: 0 \}/, 'old text fades out');
  assert.match(
    src,
    /\{ opacity: 0, transform: `translateY\(\$\{LANG_FADE\.rise\}px\)` \},\s*\{ opacity: 1, transform: 'none' \}/,
    'new text rises in from below',
  );
  assert.match(src, /fill: 'backwards'/, 'new text starts invisible before its first frame');
  assert.match(
    src,
    /for \(const a of fades\) a\.cancel\(\);\s*swap\(\);/,
    'fills dropped before swap',
  );
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /prefersReducedMotion\(\)\s*\)\s*\{\s*update\(\);\s*return;/);
});

test('only elements with their own text animate; nothing is keyed by lang', async () => {
  const src = await read('lib/langFade.ts');
  assert.match(src, /n\.nodeType === Node\.TEXT_NODE && n\.textContent\?\.trim\(\)/);
  const app = await read('App.tsx');
  assert.doesNotMatch(app, /key=\{lang\}/, 'keying by lang would remount the page');
});
