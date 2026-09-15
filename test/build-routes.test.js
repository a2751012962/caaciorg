// Runs the real build (node build.mjs, well under a second) and checks what the
// event registration page needs from it: the page at /event-register/, the same
// page at the Mid-Autumn Festival's printed QR route with its event fixed on
// <body>, and the dist/_redirects rewrites that serve it at
// /events/<slug>/register/. dist/ is gitignored build output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const dist = (path) => readFile(new URL(`dist/${path}`, ROOT), 'utf8');

// One build for the whole file. A fresh checkout has no web/dist/ yet, and
// build.mjs then runs the Vite build itself, which takes several seconds.
const built = promisify(execFile)(process.execPath, ['build.mjs'], {
  cwd: fileURLToPath(ROOT),
  maxBuffer: 16 * 1024 * 1024,
});

test('build: the React site is written at every route it serves, in English and under /zh/', async () => {
  await built;
  const routes = [
    '',
    'about/',
    'events/',
    'membership/',
    'account/',
    'resources/',
    'community-calendar/',
    'business-services/',
    'thank-you/',
  ];
  const home = await dist('index.html');
  assert.match(home, /<div id="root"><\/div>/);
  assert.match(home, /<script type="module" crossorigin src="\/app\/[^"]+\.js"><\/script>/);
  assert.match(home, /<script src="\/assets\/caaci-config\.js(\?v=[0-9a-f]{12})?"><\/script>/);
  assert.equal(
    home.includes('<script type="module" src="/assets/caaci-app.js">'),
    false,
    'opted out of the mirror injection',
  );
  for (const route of routes) {
    assert.equal(await dist(`${route}index.html`), home, `/${route}`);
    assert.equal(
      await dist(`zh/${route}index.html`),
      home.replace('<html lang="en">', '<html lang="zh-CN">'),
      `/zh/${route}`,
    );
  }
});

test('build: the login page stays Tabler; old pages point into the React site', async () => {
  await built;
  const login = await dist('login-3/index.html');
  assert.match(login, /tabler\.min\.css/);
  assert.match(await dist('zh/login-3/index.html'), /location\.replace\("\/login-3\/"/);
  assert.match(await dist('zh/login-3/index.html'), /"lang=zh"/);
  // Stripe's donation cancel_url, and the volunteer page: their dialog on the home page.
  assert.match(await dist('donate/index.html'), /location\.replace\("\/\?modal=donate"\)/);
  assert.match(
    await dist('zh/volunteer/index.html'),
    /location\.replace\("\/zh\/\?modal=volunteer"\)/,
  );
  assert.match(await dist('past-events/index.html'), /location\.replace\("\/events\/#past"\)/);
  // Printed per-tier links open that tier on the membership page, in their language.
  assert.match(await dist('register/family-membership/index.html'), /"\/membership\/"/);
  assert.match(await dist('zh/register/family-membership/index.html'), /"\/zh\/membership\/"/);
  assert.match(await dist('zh/register/family-membership/index.html'), /"tier=family"/);
});

test('build: _redirects rewrites /events/<slug>/register onto /event-register/, and both registration routes are written', async () => {
  await built;

  // Cloudflare Pages: one "from to status" rule per line; 200 is a rewrite.
  const rules = (await dist('_redirects'))
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).join(' '))
    .filter((line) => line && !line.startsWith('#'));
  assert.ok(rules.includes('/events/:slug/register /event-register/ 200'), rules.join('\n'));
  assert.ok(rules.includes('/events/:slug/register/ /event-register/ 200'), rules.join('\n'));

  const generic = await dist('event-register/index.html');
  const festival = await dist('mid_autumn_festival_form/index.html');
  assert.match(generic, /<body data-page="event-form">/);
  assert.doesNotMatch(generic, /data-event=/, 'the generic page takes its event from the URL');
  assert.match(festival, /<body data-event="mid-autumn-festival" data-page="event-form">/);
  assert.equal(
    festival.replace(' data-event="mid-autumn-festival"', ''),
    generic,
    'otherwise the very same page',
  );
  for (const [route, page] of [
    ['event-register', generic],
    ['mid_autumn_festival_form', festival],
  ]) {
    assert.equal(page.includes('<!--CAACI_NAV-->'), false, `${route}: nav marker substituted`);
    assert.match(page, /class="navbar[^"]*caaci-sitenav/, `${route}: the shared nav`);
    assert.equal(
      page.includes('<script type="module" src="/assets/caaci-app.js">'),
      false,
      `${route}: opted out of the mirror injection`,
    );
    // build.mjs versions every /assets/ URL with a content hash (?v=…).
    assert.match(
      page,
      /<script type="module" src="\/assets\/caaci-member\.js(\?v=[0-9a-f]{12})?"><\/script>/,
      route,
    );
  }
});
