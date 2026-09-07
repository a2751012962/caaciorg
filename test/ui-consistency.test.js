// Pins the "one source of truth" rules from UI_GUIDELINE.md so the pages cannot
// drift apart again the way they had: four member pages each carried a private
// <style> block with the same nav/hero CSS and hard-coded brand hexes, the
// admin panel ran on Tabler's default blue, and caaci-ui.css kept 40 component
// classes nothing referenced. Every check here reads the real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), 'utf8');

const HEX = /#[0-9a-f]{3,8}\b/gi;
// Comments may quote a value they are explaining; only declarations count.
const uncommented = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The Tabler pages: hand-authored, served at their own routes.
const memberPages = (await readdir(new URL('member-src/', ROOT))).filter((f) =>
  f.endsWith('.html'),
);
const pages = ['admin-src/index.html', ...memberPages.map((f) => `member-src/${f}`)];
const html = Object.fromEntries(await Promise.all(pages.map(async (p) => [p, await read(p)])));

const uiCss = await read('src/caaci-ui.css');
const themeCss = await read('src/caaci-theme.css');

test('Tabler pages carry no page-local styling', () => {
  for (const [p, s] of Object.entries(html)) {
    assert.equal(s.includes('<style'), false, `${p}: <style> block — move it to caaci-theme.css`);
    assert.equal(/\sstyle=/.test(s), false, `${p}: style="" attribute — use a class`);
    assert.deepEqual(s.match(HEX) ?? [], [], `${p}: hex literal — use a --caaci-* token`);
  }
});

test('every Tabler page loads tabler → tokens → theme, in that order', () => {
  for (const [p, s] of Object.entries(html)) {
    if (p.endsWith('/_nav.html')) continue; // a partial, no <head>
    const at = (asset) => {
      const i = s.indexOf(`href="/assets/${asset}"`);
      assert.notEqual(i, -1, `${p}: does not link ${asset}`);
      return i;
    };
    const tabler = at('tabler.min.css');
    const tokens = at('caaci-ui.css');
    const theme = at('caaci-theme.css');
    assert.ok(tabler < tokens && tokens < theme, `${p}: stylesheet order`);
  }
});

test('caaci-theme.css is written in tokens only', () => {
  assert.deepEqual(uncommented(themeCss).match(HEX) ?? [], [], 'hex literal in caaci-theme.css');
});

test('caaci-ui.css keeps hex values inside the :root token block', () => {
  const rootEnd = uiCss.indexOf('\n}', uiCss.indexOf(':root {'));
  assert.notEqual(rootEnd, -1);
  const components = uncommented(uiCss.slice(rootEnd));
  assert.deepEqual(components.match(HEX) ?? [], [], 'hex literal outside :root in caaci-ui.css');
});

test('--tblr-* variables are overridden only in caaci-theme.css', () => {
  const define = /--tblr-[\w-]+\s*:/;
  assert.equal(define.test(uiCss), false, 'caaci-ui.css defines a --tblr-* variable');
  for (const [p, s] of Object.entries(html))
    assert.equal(define.test(s), false, `${p} defines --tblr-*`);
});

test('every .caaci-* class in the stylesheets is referenced by markup or a client module', async () => {
  const defined = new Set();
  for (const css of [uiCss, themeCss])
    for (const m of css.matchAll(/\.(caaci-[\w-]+)/g)) defined.add(m[1]);

  const modules = await Promise.all(
    ['caaci-app.js', 'caaci-member.js', 'caaci-admin.js', 'caaci-shared.js'].map((f) =>
      read(`src/${f}`),
    ),
  );
  // An id="caaci-…" or a #caaci-… selector is not a class reference; strip
  // those so a class that survives only because an element shares its name as
  // an id (the old .caaci-media-grid) is still reported.
  const corpus = [...modules, ...Object.values(html)]
    .join('\n')
    .replace(/\bid=["']caaci-[\w-]+["']/g, '')
    .replace(/#caaci-[\w-]+/g, '');

  const dead = [...defined].filter((c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(corpus));
  assert.deepEqual(dead, [], 'classes defined in CSS but referenced nowhere');
});
