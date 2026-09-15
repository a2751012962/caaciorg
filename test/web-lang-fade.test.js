// The language toggle cross-fades instead of cutting: App.tsx commits the new
// language inside a view transition, and index.css gives the root snapshot
// pair a duration and curve, switched off when the user asks for less motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');

test('toggleLang sets the language inside withViewTransition', async () => {
  const app = await read('App.tsx');
  assert.match(app, /import \{ withViewTransition \} from '\.\/lib\/viewTransition'/);
  assert.match(app, /withViewTransition\(\(\) => setLang\(nextLang\)\)/);
  assert.doesNotMatch(app, /^\s*setLang\(nextLang\);/m, 'a bare setLang cuts instead of fading');
});

test('withViewTransition flushes React synchronously and skips reduced motion', async () => {
  const src = await read('lib/viewTransition.ts');
  assert.match(src, /import \{ flushSync \} from 'react-dom'/);
  assert.match(src, /startViewTransition\(\(\) => flushSync\(update\)\)/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(
    src,
    /if \(!doc\?\.startViewTransition \|\| prefersReducedMotion\(\)\) \{\s*update\(\);/,
  );
});

test('index.css times the root cross-fade and disables it for reduced motion', async () => {
  const css = await read('index.css');
  const rule = css.match(
    /::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{([^}]*)\}/,
  );
  assert.ok(rule, 'missing ::view-transition-old/new(root) rule');
  assert.match(rule[1], /animation-duration:\s*\d+ms/);
  assert.match(rule[1], /animation-timing-function:\s*cubic-bezier/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce\)\s*\{\s*::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{\s*animation:\s*none;/,
  );
});
