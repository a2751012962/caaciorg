// Runs the real build (node build.mjs, well under a second) and checks what the
// event registration page needs from it: the React site written at
// /event-register/, the dist/_redirects rewrites that serve it at
// /events/<slug>/register/, and the Mid-Autumn Festival's printed QR route
// redirecting into that URL. dist/ is gitignored build output.
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
    'event-register/',
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

test('build: _redirects rewrites /events/<slug>/register onto the React registration page', async () => {
  await built;

  // Cloudflare Pages: one "from to status" rule per line; 200 is a rewrite.
  const rules = (await dist('_redirects'))
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).join(' '))
    .filter((line) => line && !line.startsWith('#'));
  // Both spellings in both languages: pathFor() settles a Chinese visitor on
  // /zh/events/<slug>/register/, which has to be rewritten too or a reload 404s.
  for (const rule of [
    '/events/:slug/register /event-register/ 200',
    '/events/:slug/register/ /event-register/ 200',
    '/zh/events/:slug/register /zh/event-register/ 200',
    '/zh/events/:slug/register/ /zh/event-register/ 200',
  ])
    assert.ok(rules.includes(rule), `${rule}\n---\n${rules.join('\n')}`);

  // The rewrite target is the React site, not the retired Tabler form.
  const home = await dist('index.html');
  assert.equal(await dist('event-register/index.html'), home);
  assert.equal(
    await dist('zh/event-register/index.html'),
    home.replace('<html lang="en">', '<html lang="zh-CN">'),
  );

  // The URL printed on the Mid-Autumn Festival's QR codes still resolves: it is
  // now a stub into the event's real registration URL (the /zh/ copy in Chinese).
  // It forwards the query it was reached with (the festival promo links
  // /mid_autumn_festival_form/?lang=zh); the /zh/ copy only adds its own
  // ?lang=zh when there is nothing to forward.
  assert.match(
    await dist('mid_autumn_festival_form/index.html'),
    /location\.replace\("\/events\/mid-autumn-festival\/register\/" \+ \(location\.search \|\| ""\) \+ location\.hash\)/,
  );
  assert.match(
    await dist('zh/mid_autumn_festival_form/index.html'),
    /location\.replace\("\/events\/mid-autumn-festival\/register\/" \+ \(location\.search \|\| "\?lang=zh"\) \+ location\.hash\)/,
  );
  // The no-JS fallback still points at the right destination.
  assert.match(
    await dist('zh/mid_autumn_festival_form/index.html'),
    /url=\/events\/mid-autumn-festival\/register\/\?lang=zh"/,
  );

  // Registration no longer runs on the Tabler member bundle anywhere in dist/.
  for (const page of [
    'event-register/index.html',
    'zh/event-register/index.html',
    'mid_autumn_festival_form/index.html',
    'zh/mid_autumn_festival_form/index.html',
  ]) {
    assert.equal((await dist(page)).includes('caaci-member.js'), false, page);
  }
});
