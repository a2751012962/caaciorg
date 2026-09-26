// The React site's per-event volunteer page (/events/<slug>/volunteer/, 0035):
// the registration page as a template, minus the free gift and the account
// step. It talks to /api/volunteer, and the details that keep it in step with
// the registration page are pinned here from the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');
const page = () => read('pages/EventVolunteerPage.tsx');

test('the event is loaded from GET /api/volunteer?event= with the bearer token', async () => {
  const src = await page();
  assert.match(
    src,
    /api<VolInfo>\(`\/api\/volunteer\?event=\$\{encodeURIComponent\(slug\)\}`, undefined, \{\s*auth: true,?\s*\}/,
  );
  assert.match(
    src,
    /eventSlugFrom\(window\.location\.pathname, window\.location\.search, 'volunteer'\)/,
  );
  // The questions asked: the event's own, else the site's default ones.
  assert.match(src, /const asked = event\.questions \?\? data\.questions \?\? \[\];/);
});

test('404 is "not taking volunteers", anything else offers a retry', async () => {
  const src = await page();
  assert.match(src, /code === 404\) return setStatus\('missing'\)/);
  assert.match(src, /This event is not taking volunteers/);
  assert.match(src, /See all events/);
  assert.match(src, /Volunteer for any event/, 'the dialog is offered instead');
  assert.match(src, /Try again/);
  assert.match(src, /const LOAD_TIMEOUT_MS = \d+;/);
});

test('a sign-up posts the one event, name, email, phone, answers and the honeypot to /api/volunteer', async () => {
  const src = await page();
  const body =
    /const body = \{\s*events: \[slug\],\s*name: name\.trim\(\),\s*email: address,\s*phone: phone\.trim\(\),\s*answers: read\.answers,\s*_hp: hp,\s*'cf-turnstile-response': token,\s*\}/;
  assert.match(src, body);
  assert.match(
    src,
    /api<PostResult>\('\/api\/volunteer', body, \{\s*auth: true,?\s*\}\)/,
    'the POST carries the signed-in token so the row can be linked',
  );
  assert.match(src, /useTurnstile\('volunteer'\)/, 'the same Turnstile action as the dialog');
  assert.match(src, /readAnswers\(questions, answers, lang\)/);
});

test('a signed-in visitor sees their sign-up as it stands and can change it', async () => {
  const src = await page();
  assert.match(
    src,
    /answerStateFrom\(asked, data\.signup\.answers\)/,
    'stored answers fill the form',
  );
  assert.match(src, /setDone\(\{ createdAt: data\.signup\.created_at, already: false \}\)/);
  assert.match(src, /Change my answers/);
  assert.match(src, /your original sign-up time is kept/);
  assert.match(src, /const emailLocked = signedIn && !!email;/);
  assert.match(src, /readOnly=\{emailLocked\}/);
});

test('the honeypot is a hidden field with no identity-like wording beside it', async () => {
  const src = await page();
  assert.match(src, /id="caaci_hp_field"/);
  assert.match(src, /tabIndex=\{-1\}/);
  const at = src.indexOf('id="caaci_hp_field"');
  const around = src.slice(src.lastIndexOf('<div', at), src.indexOf('</div>', at));
  assert.doesNotMatch(around, /<label/);
});

test('the inputs are the design system’s standard variant, and there is no gift or account step', async () => {
  const src = await page();
  assert.match(
    src,
    /const INPUT =\s*'w-full min-h-\[44px\] px-3\.5 py-2\.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brick';/,
  );
  for (const word of ['perkStep', 'Create a free account', 'loginUrl', 'mooncake'])
    assert.equal(src.includes(word), false, word);
  assert.doesNotMatch(src, /FormEvent/);
  assert.doesNotMatch(src, /data-en=|data-zh=/);
});

test('App.tsx serves the page at /event-volunteer/ and /events/<slug>/volunteer/', async () => {
  const src = await read('App.tsx');
  assert.match(src, /\| 'event-volunteer'/, "'event-volunteer' is a PageId");
  assert.match(src, /'event-volunteer': 'event-volunteer',/, 'and its own path segment');
  assert.match(
    src,
    /const VOLUNTEER_PATH = \/\^\\\/\(\?:zh\\\/\)\?events\\\/\(\[\^\/\]\+\)\\\/volunteer\\\/\?\$\/i;/,
  );
  assert.match(src, /if \(VOLUNTEER_PATH\.test\(pathname\)\) return 'event-volunteer';/);
  assert.match(src, /return `\$\{prefix\}\/events\/\$\{volunteer\[1\]\}\/volunteer\/`/);
  assert.match(src, /import\('\.\/pages\/EventVolunteerPage'\)/, 'lazy, like the others');
  assert.match(src, /<EventVolunteerPage key=\{route\} \{\.\.\.pageProps\} \/>/);
});

test('the events page’s Volunteer buttons open the event’s own page; the registration page links there when the event asks its own questions', async () => {
  const events = await read('pages/EventsPage.tsx');
  assert.match(events, /volunteerPath\(item\.ev, lang\)/);
  assert.match(events, /takesVolunteers\(item\.ev\)/);
  assert.match(events, /const volunteerAction = \(/, 'one definition…');
  assert.equal(
    (events.match(/\{volunteerAction\(/g) || []).length,
    3,
    '…used in the spotlight, the phone row and the desktop row',
  );
  const register = await read('pages/EventRegisterPage.tsx');
  assert.match(register, /const ownVolunteerForm = Array\.isArray\(ev\?\.volunteer_questions\);/);
  assert.match(register, /Fill in the volunteer form/);
  assert.match(register, /填写志愿者报名表/);
  assert.match(register, /I'd also like to volunteer at this event/, 'the box stays otherwise');
  // Both pages draw questions with the shared component.
  for (const file of [
    'pages/EventRegisterPage.tsx',
    'pages/EventVolunteerPage.tsx',
    'components/Modals.tsx',
  ])
    assert.match(await read(file), /<QuestionFields questions=/, file);
});
