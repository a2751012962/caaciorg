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

test('build: _redirects rewrites /events/<slug>/register onto /event-register/, and both registration routes are written', async () => {
  await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: fileURLToPath(ROOT) });

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
    assert.match(page, /<script type="module" src="\/assets\/caaci-member.js"><\/script>/, route);
  }
});
