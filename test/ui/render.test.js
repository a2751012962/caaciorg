// What jsdom cannot see.
//
// The suite in test/ is thorough about structure and text, and structurally
// blind to layout: jsdom has no viewport, no box model and no paint, so it
// cannot tell that a card is 60px past the right edge of a phone or that a
// button is 28px tall. Every UI bug this project has actually shipped lived in
// exactly that blind spot — the /events/ card broken by the .tribe-common
// reset, tap targets under 44px, horizontal overflow on /events/, the
// membership page scrolling 689px past its own form.
//
// So this opens a real Chromium against the real dist/ and measures. It is
// hermetic: serve-mirror.mjs serves the build, and every request that would
// leave the machine is answered from a fixture (see harness.js). No secrets, no
// live database, no screenshots to eyeball — every assertion is a number, so a
// failure names the element and the pixel count.
//
// Opt-in, like the auth-config suite, so `npm test` stays fast and offline:
//   CAACI_UI_TESTS=1 npm run test:ui
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pages, serve, stubNetwork, gotoSettled, OUR_SCRIPT, DIST } from './harness.js';

const ON = process.env.CAACI_UI_TESTS === '1';
const skip = ON
  ? false
  : 'set CAACI_UI_TESTS=1 to run (drives a real browser; needs a dist/ build)';

const PORT = Number(process.env.CAACI_UI_PORT || 8791);
const ORIGIN = `http://localhost:${PORT}`;

// The phone is the one that matters: UI_GUIDELINE.md writes the 44px rule down,
// and every layout regression this project has had showed up at phone width
// first. Desktop is checked too, because a fix for one has broken the other.
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

let server;
let browser;
let ALL = [];

before(async () => {
  if (!ON) return;
  assert.ok(
    existsSync(DIST),
    'dist/ is missing — run `npm run build` first (CI builds it in the ui job)',
  );
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

// One page, one browser context, both viewports. Returns everything measured so
// each assertion below can be its own named test without reloading the page.
async function measure({ url, react }, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // Only errors from the layer this repo owns. A mirror page carries Divi and
  // WordPress scripts that want third-party assets a hermetic run does not
  // serve, so their failures are this harness's doing, not the site's — the
  // same two-layer line the a11y audit draws. On a React route everything is
  // ours, so everything counts.
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // A failed subresource is the fixture layer, not a bug in the page.
    if (/Failed to load resource/.test(m.text())) return;
    const from = m.location()?.url || '';
    if (react || OUR_SCRIPT.test(from)) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    const from = e.stack || '';
    if (react || OUR_SCRIPT.test(from)) errors.push(`uncaught: ${e.message}`);
  });
  await stubNetwork(page, ORIGIN);

  const response = await gotoSettled(page, `${ORIGIN}${url}`, { react });

  const measured = await page.evaluate(
    ({ min, ours }) => {
      const doc = document.documentElement;

      // "On screen" is more than display:none. A closed mobile drawer keeps its
      // items in the tree with a real height, hidden by opacity, a transform, a
      // clip or aria-hidden — measuring those reports a 16px menu item that
      // nobody can tap because nobody can see it.
      const hidden = (el) => {
        if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return true;
        // Chromium's own answer to display/visibility/content-visibility/opacity.
        if (
          el.checkVisibility &&
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        )
          return true;
        const own = el.getBoundingClientRect();
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (Number(s.opacity) === 0) return true;
          if (s.clipPath === 'inset(100%)' || s.clip === 'rect(0px, 0px, 0px, 0px)') return true;
          const r = n.getBoundingClientRect();
          // Slid out of view, the usual closed-drawer trick.
          if (r.right <= 0 || r.bottom <= 0) return true;
          // Clipped away by an ancestor: the collapsed-menu pattern is
          // `max-height: 0; overflow: hidden`, which leaves every item a real
          // 16px rect that no finger can ever reach.
          const clips = s.overflow !== 'visible' || s.overflowY !== 'visible';
          if (clips && (r.height <= 1 || r.width <= 1)) return true;
          if (clips && (own.top >= r.bottom || own.bottom <= r.top)) return true;
        }
        return false;
      };
      // Elements wider than the viewport, named so a failure says which one.
      const overflowing = [...document.querySelectorAll('body *')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (hidden(el)) return false;
          const s = getComputedStyle(el);
          // Deliberately off-screen things (honeypots, slide-out menus) are not
          // overflow; only what sticks out to the right of a laid-out page is.
          if (s.position === 'fixed' || s.position === 'absolute') return false;
          return r.right > doc.clientWidth + 1;
        })
        .slice(0, 5)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} +${Math.round(r.right - doc.clientWidth)}px`;
        });

      // Tap targets. UI_GUIDELINE.md sets 44px; only visible, interactive,
      // on-screen things count, and an inline link inside a paragraph is text,
      // not a button, so it is measured by its own line box and excluded when it
      // sits in running prose.
      const small = [
        ...document.querySelectorAll('a[href], button, input, select, [role="button"]'),
      ]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (hidden(el)) return false;
          if (el.closest('p, li') && el.tagName === 'A') return false; // prose link
          // The same line a11y.test.js draws, for the same reason: on a mirror
          // page only the controls this repo injects are ours to size. Divi's
          // captured markup is fixed by UI_GUIDELINE.md — "we do not restyle
          // it" — so reporting its button heights is reporting work nobody here
          // is allowed to do. A React route is ours end to end.
          if (!ours && !el.closest('[class*="caaci-"]')) return false;
          if (el.type === 'hidden') return false;
          return r.height < min;
        })
        .slice(0, 5)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const label = (el.textContent || el.value || el.name || '').trim().slice(0, 24);
          return `${el.tagName.toLowerCase()}[${label}] ${Math.round(r.height)}px`;
        });

      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowing,
        small,
        title: document.title,
        bodyText: (document.body.innerText || '').trim().length,
      };
    },
    { min: 44, ours: react },
  );

  const finalUrl = page.url();
  await context.close();
  // A stub page (/admin-next/, the printed-QR addresses) exists to send the
  // visitor somewhere else. It has done its job when the address changed; its
  // destination is a route of its own and is measured there.
  const redirected = !finalUrl.endsWith(url);
  return { status: response?.status() ?? 0, errors, redirected, finalUrl, ...measured };
}

// One describe-per-page would mean one browser context per assertion. Instead
// each page is measured once and its findings collected, then asserted in four
// named tests — so a failure says which rule broke across which pages, which is
// what you want when a shared component regresses.
const results = { phone: new Map(), desktop: new Map() };

test('every built page is measured', { skip }, async () => {
  assert.ok(ALL.length > 10, `found ${ALL.length} pages in dist/`);
  for (const p of ALL) {
    results.phone.set(p.url, await measure(p, PHONE));
  }
  // Desktop only for the React routes: the mirror is a fixed-width WordPress
  // capture whose desktop layout is not ours and does not change.
  for (const p of ALL.filter((x) => x.react)) {
    results.desktop.set(p.url, await measure(p, DESKTOP));
  }
});

test('every page renders something', { skip }, () => {
  const empty = [...results.phone.entries()]
    .filter(([, r]) => !r.redirected && (r.status >= 400 || r.bodyText < 50))
    .map(([url, r]) => `${url} (status ${r.status}, ${r.bodyText} chars)`);
  assert.deepEqual(empty, []);
});

test('no page logs an error', { skip }, () => {
  const noisy = [];
  for (const [url, r] of results.phone) {
    for (const e of r.errors.slice(0, 2)) noisy.push(`${url} — ${e.slice(0, 120)}`);
  }
  assert.deepEqual(noisy, []);
});

test('nothing sticks out sideways at 375px', { skip }, () => {
  const wide = [];
  for (const [url, r] of results.phone) {
    if (r.scrollWidth > r.clientWidth + 1) {
      wide.push(
        `${url} — scrollWidth ${r.scrollWidth} > ${r.clientWidth}: ${r.overflowing.join(', ')}`,
      );
    }
  }
  assert.deepEqual(wide, [], 'a phone should never scroll sideways');
});

test('every tap target is at least 44px tall', { skip }, () => {
  const small = [];
  for (const [url, r] of results.phone) {
    for (const s of r.small) small.push(`${url} — ${s}`);
  }
  assert.deepEqual(small, [], 'UI_GUIDELINE.md: a touch target is >= 44px');
});

test('the React routes hold together at 1280px too', { skip }, () => {
  const broken = [];
  for (const [url, r] of results.desktop) {
    if (!r.redirected && (r.status >= 400 || r.bodyText < 50))
      broken.push(`${url} (status ${r.status})`);
    if (r.scrollWidth > r.clientWidth + 1) broken.push(`${url} — scrolls sideways`);
  }
  assert.deepEqual(broken, []);
});
