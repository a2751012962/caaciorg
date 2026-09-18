// The React site's volunteer dialog signs people up through /api/volunteer —
// the endpoint feat/volunteer-events added, which stores one event_volunteers
// row per event picked — instead of dropping a contact-form message. It offers
// only the events GET /api/volunteer lists (published, not over yet) and falls
// back to "any event" when there are none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');

const volunteerPart = async () => {
  const src = await read('components/Modals.tsx');
  const start = src.indexOf('function VolunteerModalContent');
  assert.ok(start > 0, 'VolunteerModalContent exists');
  return src.slice(start);
};

test('the dialog lists upcoming events from GET /api/volunteer', async () => {
  const src = await volunteerPart();
  assert.match(src, /api<\{ events\?: VolunteerEvent\[\] \}>\('\/api\/volunteer'\)/);
  assert.match(
    src,
    /typeof ev\.slug === 'string' && ev\.slug/,
    'entries without a slug are dropped',
  );
  assert.match(src, /Any event \/ wherever needed/);
  assert.match(src, /任何活动均可/);
});

test('a sign-up posts name, email, phone, message, events and the honeypot to /api/volunteer', async () => {
  const src = await volunteerPart();
  const post =
    /'\/api\/volunteer',\s*\{\s*name: name\.trim\(\),\s*email: email\.trim\(\),\s*phone: phone\.trim\(\),\s*message,\s*events: chosen,\s*_hp: hp,\s*'cf-turnstile-response': token,\s*\}/;
  assert.match(src, post);
  assert.doesNotMatch(
    src,
    /\/api\/contact/,
    'the volunteer dialog no longer files a contact message',
  );
});

test('the message is only what the person chose or typed', async () => {
  const src = await volunteerPart();
  assert.doesNotMatch(
    src,
    /\[Volunteer sign-up/,
    'no header line: the endpoint already knows what it is',
  );
  assert.match(src, /\.filter\(Boolean\)\s*\.join\('\\n'\)/);
});

test('server refusals a person can act on are shown in Chinese on /zh/', async () => {
  const src = await read('components/Modals.tsx');
  for (const key of ['Enter your name.', 'Enter a valid email address.', 'Event not found.'])
    assert.match(src, new RegExp(`'${key.replace('.', '\\.')}': '[^']+'`));
  assert.match(src, /VOLUNTEER_ERRORS_ZH\[server\]/);
});

test('the thank-you names the events picked and mentions the confirmation email', async () => {
  const src = await volunteerPart();
  assert.match(src, /names\.join\(', '\)/);
  assert.match(src, /names\.join\('、'\)/);
  assert.match(src, /A confirmation has been emailed to you\./);
});
