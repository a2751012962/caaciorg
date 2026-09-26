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
    // an event's volunteer form, served at /events/<slug>/volunteer/ the same way
    'event-volunteer/',
    // tokens: a scanned member card lands on /charge/?m=…
    'charge/',
    'merchant/',
    // scan-to-pay: the address printed on a product's QR
    'pay/',
    'token-admin/',
    // the back office: this app renders the console at /admin/ (App.tsx)
    'admin/',
    'plan-preview/',
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
  // Cloudflare Pages serves 404.html, with a 404 status, for any address that
  // matches nothing; it is this app, which renders its not-found page there.
  assert.equal(await dist('404.html'), home);
  assert.equal(await dist('zh/404.html'), home.replace('<html lang="en">', '<html lang="zh-CN">'));
});

test('build: the login page stays Tabler; old pages point into the React site', async () => {
  await built;
  const login = await dist('login-3/index.html');
  assert.match(login, /tabler\.min\.css/);
  assert.match(await dist('zh/login-3/index.html'), /location\.replace\("\/login-3\/"/);
  assert.match(await dist('zh/login-3/index.html'), /"lang=zh"/);
  // The /zh/ login duplicates go straight to the bilingual page in one hop,
  // not via the /zh/login-3/ stub.
  assert.match(await dist('zh/login/index.html'), /location\.replace\("\/login-3\/"/);
  assert.match(await dist('zh/login/index.html'), /"lang=zh"/);
  assert.match(
    await dist('login/index.html'),
    /location\.replace\("\/login-3\/" \+ location\.search/,
  );
  // The back office answers at /admin/ (the React app, asserted above), and the
  // address it was built at while the Tabler panel still held /admin/ is a stub
  // into it, so an admin's bookmark still opens the console.
  assert.match(await dist('admin-next/index.html'), /location\.replace\("\/admin\/"/);
  assert.match(await dist('zh/admin-next/index.html'), /location\.replace\("\/zh\/admin\/"/);
  // Nothing of the retired Tabler panel is served any more.
  assert.equal((await dist('admin/index.html')).includes('caaci-admin.js'), false);
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

test('build: a mirrored page with a contact form gets the runtime config before caaci-app.js', async () => {
  await built;
  // The business-directory pages are still the mirrored Divi pages, and their
  // contact form posts to /api/contact, which needs a Turnstile token. The
  // sitekey travels in window.CAACI_CONFIG (caaci-config.js), so the injection
  // has to load it, and load it before the module that reads it.
  for (const page of [
    'business-services/business-directory/index.html',
    'zh/business-services/business-directory-restaurant/index.html',
  ]) {
    const html = await dist(page);
    assert.match(html, /et_pb_contact_form/, `${page}: expected the mirrored Divi form`);
    const config = html.search(
      /<script src="\/assets\/caaci-config\.js(\?v=[0-9a-f]{12})?"><\/script>/,
    );
    const app = html.search(
      /<script type="module" src="\/assets\/caaci-app\.js(\?v=[0-9a-f]{12})?"><\/script>/,
    );
    assert.notEqual(config, -1, `${page}: caaci-config.js not injected`);
    assert.notEqual(app, -1, `${page}: caaci-app.js not injected`);
    assert.ok(config < app, `${page}: caaci-config.js must load before caaci-app.js`);
  }
});

test('build: _redirects rewrites /events/<slug>/register onto the React registration page', async () => {
  await built;

  // Cloudflare Pages: one "from to status" rule per line; 200 is a rewrite.
  const rules = (await dist('_redirects'))
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).join(' '))
    .filter((line) => line && !line.startsWith('#'));
  assert.ok(rules.includes('/events/:slug/register /event-register/ 200'), rules.join('\n'));
  assert.ok(rules.includes('/events/:slug/register/ /event-register/ 200'), rules.join('\n'));
  // The page moves a Chinese visitor to /zh/events/<slug>/register/ (pathFor in
  // App.tsx), so that address must resolve too: refresh, bookmark, shared link.
  assert.ok(rules.includes('/zh/events/:slug/register /zh/event-register/ 200'), rules.join('\n'));
  assert.ok(rules.includes('/zh/events/:slug/register/ /zh/event-register/ 200'), rules.join('\n'));
  // The volunteer page (0035) is served the same way, both spellings, both languages.
  for (const rule of [
    '/events/:slug/volunteer /event-volunteer/ 200',
    '/events/:slug/volunteer/ /event-volunteer/ 200',
    '/zh/events/:slug/volunteer /zh/event-volunteer/ 200',
    '/zh/events/:slug/volunteer/ /zh/event-volunteer/ 200',
  ])
    assert.ok(rules.includes(rule), rule);
  assert.equal(await dist('event-volunteer/index.html'), await dist('index.html'));

  // The rewrite target is the React site, not the retired Tabler form.
  const home = await dist('index.html');
  assert.equal(await dist('event-register/index.html'), home);
  assert.equal(
    await dist('zh/event-register/index.html'),
    home.replace('<html lang="en">', '<html lang="zh-CN">'),
  );

  // The URL printed on the Mid-Autumn Festival's QR codes still resolves: it is
  // now a stub into the event's real registration URL (the /zh/ copy in Chinese).
  // Both forward the visitor's own ?query, so the older promo link
  // /mid_autumn_festival_form/?lang=zh keeps landing in Chinese.
  assert.match(
    await dist('mid_autumn_festival_form/index.html'),
    /location\.replace\("\/events\/mid-autumn-festival\/register\/" \+ location\.search \+ location\.hash\)/,
  );
  const zhQr = await dist('zh/mid_autumn_festival_form/index.html');
  assert.match(
    zhQr,
    /location\.replace\("\/events\/mid-autumn-festival\/register\/" \+ \(location\.search \? location\.search \+ '&' : '\?'\) \+ "lang=zh" \+ location\.hash\)/,
  );
  assert.match(zhQr, /url=\/events\/mid-autumn-festival\/register\/\?lang=zh"/);

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
