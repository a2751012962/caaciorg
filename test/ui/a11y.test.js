// Accessibility, scoped to the layer this repo is allowed to change.
//
// UI_GUIDELINE.md draws the line: the public site is a byte-for-byte mirror of
// the WordPress/Divi original and "its look is therefore fixed — we do not
// restyle it". A Divi accessibility violation is not a bug anybody here can
// fix, and a report full of them is a report nobody reads. So:
//
//   React routes (web/src/pages/)  — audited whole. Every line is ours.
//   mirror pages                   — audited only inside the .caaci-* subtree
//                                    that src/caaci-app.js injects: the form
//                                    notices, the donation checkout, the
//                                    accessibility repairs. Divi's own markup
//                                    is left alone.
//
// Only serious and critical violations fail. WCAG 2 A/AA rules only, so the
// bar is a standard rather than a preference.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  pages,
  serve,
  stubNetwork,
  gotoSettled,
  axeViolations,
  axeAvailable,
  DIST,
} from './harness.js';

const ON = process.env.CAACI_UI_TESTS === '1';
const skip = ON
  ? false
  : 'set CAACI_UI_TESTS=1 to run (drives a real browser; needs a dist/ build)';

const PORT = Number(process.env.CAACI_UI_A11Y_PORT || 8792);
const ORIGIN = `http://localhost:${PORT}`;
// Our injected UI, whatever it is called: every component class in
// src/caaci-ui.css starts with this prefix.
const OURS = '[class*="caaci-"]';

let server;
let browser;
let ALL = [];

before(async () => {
  if (!ON) return;
  assert.ok(existsSync(DIST), 'dist/ is missing — run `npm run build` first');
  assert.ok(axeAvailable(), 'axe-core is not installed');
  ALL = await pages();
  server = serve(PORT);
  await server.ready;
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.stop();
});

async function audit(url, { scoped, react }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await stubNetwork(page, ORIGIN);
  await gotoSettled(page, `${ORIGIN}${url}`, { react });

  let violations = [];
  if (scoped) {
    // Nothing of ours on the page: nothing for us to answer for. axe errors on
    // an include that matches no element, so check before asking.
    const count = await page.locator(OURS).count();
    if (count > 0) violations = await axeViolations(page, { include: [[OURS]] });
  } else {
    violations = await axeViolations(page);
  }

  await context.close();
  return violations;
}

const found = new Map();

test('every page is audited', { skip }, async () => {
  assert.ok(ALL.length > 10, `found ${ALL.length} pages in dist/`);
  for (const p of ALL) {
    found.set(p.url, {
      react: p.react,
      violations: await audit(p.url, { scoped: !p.react, react: p.react }),
    });
  }
});

test('the React routes have no serious accessibility violation', { skip }, () => {
  const bad = [];
  for (const [url, r] of found) {
    if (!r.react) continue;
    for (const v of r.violations) bad.push(`${url} — ${v.impact} ${v.id}: ${v.nodes[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('the UI injected into the mirror has no serious violation either', { skip }, () => {
  const bad = [];
  for (const [url, r] of found) {
    if (r.react) continue;
    for (const v of r.violations) bad.push(`${url} — ${v.impact} ${v.id}: ${v.nodes[0]}`);
  }
  assert.deepEqual(
    bad,
    [],
    "these are inside .caaci-* — our own markup on a mirrored page, not Divi's",
  );
});
