// The React site's event registration page replaces the Tabler one
// (member-src/event-register.html + the event-register block of
// src/caaci-member.js). It talks to the same /api/event-register, so the
// details that make it behave identically are pinned here from the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');
const page = () => read('pages/EventRegisterPage.tsx');

test('the event is loaded from GET /api/event-register with the bearer token', async () => {
  const src = await page();
  assert.match(
    src,
    /api<RegInfo>\(\s*`\/api\/event-register\?event=\$\{encodeURIComponent\(slug\)\}`,\s*undefined,\s*\{\s*auth: true,?\s*\}/,
  );
  assert.match(src, /eventSlugFrom\(window\.location\.pathname, window\.location\.search\)/);
});

test('404 is "not open for registration", anything else offers a retry', async () => {
  const src = await page();
  assert.match(src, /code === 404\) return setStatus\('missing'\)/);
  assert.match(src, /if \(!ok \|\| !data\.event\) return setStatus\('failed'\)/);
  assert.match(src, /This event is not open for registration/);
  assert.match(src, /See all events/);
  assert.match(src, /Try again/);
  assert.match(src, /Registration has closed/);
});

test('a registration posts event, email, answers, the honeypot and the volunteer key', async () => {
  const src = await page();
  const body =
    /const body = \{\s*event: slug,\s*email: address,\s*answers: read\.answers,\s*_hp: hp,\s*\.\.\.volunteerBody\(volPrefilled, volChecked, volName, volPhone\),\s*\}/;
  assert.match(src, body, 'the three-way volunteer rule comes from volunteerBody');
  assert.match(
    src,
    /api<PostResult>\('\/api\/event-register', body, \{\s*auth: true,?\s*\}\)/,
    'the POST carries the signed-in token so the row can be linked',
  );
  assert.doesNotMatch(src, /\/api\/contact/, 'registration is not a contact message');
  // The page never assembles the volunteer key itself.
  assert.doesNotMatch(src, /volunteer: false/, 'only volunteerBody decides on a withdrawal');
});

test('the honeypot is a hidden field, not an inline style', async () => {
  const src = await page();
  assert.match(src, /id="caaci_hp_field"/);
  assert.match(src, /tabIndex=\{-1\}/);
  assert.match(src, /aria-hidden="true"/);
  assert.doesNotMatch(src, /style=\{\{[^}]*display/, 'no inline style on the honeypot');
});

test('an ok without a registration time is not shown as success', async () => {
  const src = await page();
  assert.match(src, /if \(!data\.registered_at\)/);
  assert.match(src, /We could not confirm your registration\./);
});

test('the success card keeps the Tabler page’s wording', async () => {
  const src = await page();
  for (const line of [
    "You're registered",
    'We updated your answers; your original registration time is kept\\.',
    "Thank you for volunteering — we'll be in touch\\.",
    'Change my answers',
    'Create a free account',
  ])
    assert.match(src, new RegExp(line));
  assert.match(src, /perkStep\(\{/, 'the free-gift step is the shared rule');
  assert.match(src, /setDone\(null\)/, '"Change my answers" returns to the filled-in form');
});

test('Chicago time is named in words, never as GMT-5', async () => {
  const src = await page();
  assert.match(src, /美国中部时间/);
  assert.match(src, /Central Time/);
  assert.doesNotMatch(src, /GMT-5/);
  assert.match(src, /timeZone: EVENT_TZ/);
});

test('a signed-in visitor registers under the account email, or signs out', async () => {
  const src = await page();
  assert.match(src, /readOnly=\{!!auth\.user\}/);
  assert.match(src, /Registering under another email\?/);
  assert.match(src, /auth\.signOut\(\)/);
});

test('both languages come from lang, never from data-en/data-zh', async () => {
  const src = await page();
  assert.doesNotMatch(src, /data-en=|data-zh=|dataEn|dataZh/);
  assert.match(src, /const en = lang === 'en'/);
  assert.match(src, /我也想在本次活动做志愿者/);
  assert.match(src, /I'd also like to volunteer at this event/);
});

test('server refusals are read out in Chinese on /zh/ through zhError', async () => {
  const src = await page();
  assert.match(src, /zhError\(server\)/);
});

test('App.tsx serves the page at /event-register/ and /events/<slug>/register/', async () => {
  const src = await read('App.tsx');
  assert.match(src, /\| 'event-register'/, "'event-register' is a PageId");
  assert.match(src, /'event-register': 'event-register',/, 'and its own path segment');
  assert.match(
    src,
    /const REGISTER_PATH = \/\^\\\/\(\?:zh\\\/\)\?events\\\/\(\[\^\/\]\+\)\\\/register\\\/\?\$\/i;/,
  );
  assert.match(src, /if \(REGISTER_PATH\.test\(pathname\)\) return 'event-register';/);
  // Settling the address must not drop the slug the page reads its event from.
  assert.match(src, /pathFor\(page, lang, url\.pathname\)/);
  assert.match(src, /return `\$\{prefix\}\/events\/\$\{match\[1\]\}\/register\/`/);
  assert.match(
    src,
    /import\('\.\/pages\/EventRegisterPage'\)/,
    'the page is lazy, like the others',
  );
});
