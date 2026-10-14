// The React site's volunteer dialog signs people up through /api/volunteer —
// the endpoint feat/volunteer-events added, which stores one event_volunteers
// row per event picked — instead of dropping a contact-form message. Since
// 0035 it first asks whether the sign-up is for a particular event, and then
// asks the questions of the form in effect: the picked event's own volunteer
// questions, else the site's default template. Nothing it asks is written in
// this file any more.
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

test('the dialog lists upcoming events and the default questions from GET /api/volunteer', async () => {
  const src = await volunteerPart();
  assert.match(
    src,
    /api<\{ events\?: VolunteerEvent\[\]; questions\?: Question\[\] \}>\('\/api\/volunteer'\)/,
  );
  assert.match(
    src,
    /typeof ev\.slug === 'string' && ev\.slug/,
    'entries without a slug are dropped',
  );
  assert.match(src, /Any event \/ wherever needed/);
  assert.match(src, /任何活动均可/);
});

test('it first asks whether the sign-up is for a particular event, one pick', async () => {
  const src = await volunteerPart();
  assert.match(src, /Is this for a particular event\?/);
  assert.match(src, /是为某场具体活动报名志愿者吗？/);
  assert.match(src, /type="radio"\s+name="volunteer-event"/, 'one event, or any: radios');
  assert.doesNotMatch(src, /type="checkbox"\s+className="accent-brick"\s+value=\{ev\.slug\}/);
});

test('the questions are the picked event’s own, else the default template’s — never this file’s', async () => {
  const src = await read('components/Modals.tsx');
  assert.match(src, /const questions = picked\?\.questions \?\? defaults;/);
  assert.match(src, /<QuestionFields questions=\{questions\}/);
  assert.doesNotMatch(
    src,
    /const INTERESTS = \[/,
    'the chips moved into the default template (0035)',
  );
  assert.doesNotMatch(src, /const AVAILABILITY = \[/);
  // Changing the pick can change the form, so the answers start over.
  assert.match(src, /setChosen\(slug\);\s*setAnswers\(blankAnswers\(asked\)\);/);
});

test('a sign-up posts name, email, phone, the one event, the answers and the honeypot to /api/volunteer', async () => {
  const src = await volunteerPart();
  const post =
    /'\/api\/volunteer',\s*\{\s*name: name\.trim\(\),\s*email: email\.trim\(\),\s*phone: phone\.trim\(\),\s*events: chosen \? \[chosen\] : \[\],\s*answers: read\.answers,\s*_hp: hp,\s*'cf-turnstile-response': token,\s*\}/;
  assert.match(src, post);
  assert.match(
    src,
    /readAnswers\(questions, answers, lang\)/,
    'answers are checked before the round trip',
  );
  assert.doesNotMatch(
    src,
    /\/api\/contact/,
    'the volunteer dialog no longer files a contact message',
  );
  assert.doesNotMatch(src, /message,/, 'no free-text message is assembled: notes are a question');
});

test('server refusals a person can act on are shown in Chinese on /zh/', async () => {
  const rules = await read('lib/registration.js');
  for (const key of ['Enter your name.', 'Enter a valid email address.', 'Event not found.'])
    assert.match(rules, new RegExp(`'${key.replace('.', '\\.')}': '[^']+'`));
  const src = await volunteerPart();
  assert.match(src, /volunteerZhError\(server\)/);
});

test('the thank-you names the event picked and mentions the confirmation email', async () => {
  const src = await volunteerPart();
  assert.match(src, /names\.join\(', '\)/);
  assert.match(src, /names\.join\('、'\)/);
  assert.match(src, /A confirmation has been emailed to you\./);
});
