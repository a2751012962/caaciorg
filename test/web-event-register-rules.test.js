// The rules behind the React registration page, exercised without a DOM:
// web/src/lib/registration.js is plain JS so node --test can import it on
// Node 20 (CI), where a .ts module would not load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  eventSlugFrom,
  perkStep,
  questionFieldId,
  otherFieldId,
  questionLabel,
  readAnswers,
  volunteerBody,
  zhError,
} from '../web/src/lib/registration.js';

// ---------------------------------------------------------------- eventSlugFrom

test('the path names the event, in English and on /zh/', () => {
  assert.equal(eventSlugFrom('/events/mid-autumn-festival/register/', ''), 'mid-autumn-festival');
  assert.equal(eventSlugFrom('/events/mid-autumn-festival/register', ''), 'mid-autumn-festival');
  assert.equal(
    eventSlugFrom('/zh/events/mid-autumn-festival/register/', ''),
    'mid-autumn-festival',
  );
  assert.equal(eventSlugFrom('/events/a%20b/register/', ''), 'a b');
});

test('?event= is the fallback, and a malformed escape names no event', () => {
  assert.equal(eventSlugFrom('/event-register/', '?event=spring-gala'), 'spring-gala');
  assert.equal(eventSlugFrom('/event-register/', '?event=%20spring-gala%20'), 'spring-gala');
  assert.equal(eventSlugFrom('/events/%E0%A4%A/register/', ''), '');
  assert.equal(eventSlugFrom('/event-register/', ''), '');
  assert.equal(
    eventSlugFrom('/events/', '?event=only-a-register-path-counts'),
    'only-a-register-path-counts',
  );
});

test('the path wins over ?event=', () => {
  assert.equal(eventSlugFrom('/events/from-path/register/', '?event=from-query'), 'from-path');
});

// ---------------------------------------------------------------- perkStep

const DEADLINE = '2026-09-20T19:00:00.000Z';
const before = '2026-09-19T00:00:00.000Z';
const after = '2026-09-21T00:00:00.000Z';

test('a registration after the deadline closes the gift, whoever it is', () => {
  for (const signedIn of [true, false])
    assert.equal(
      perkStep({ deadline: DEADLINE, registeredAt: after, signedIn, accountCreatedAt: before }),
      'closed',
    );
});

test('signed in: the account must exist by the deadline too', () => {
  assert.equal(
    perkStep({
      deadline: DEADLINE,
      registeredAt: before,
      signedIn: true,
      accountCreatedAt: before,
    }),
    'counted',
  );
  assert.equal(
    perkStep({ deadline: DEADLINE, registeredAt: before, signedIn: true, accountCreatedAt: after }),
    'closed',
  );
});

test('signed out: the step is "make an account" until the deadline passes', () => {
  const at = (now) => perkStep({ deadline: DEADLINE, registeredAt: before, signedIn: false, now });
  assert.equal(at(Date.parse(before)), 'signup');
  assert.equal(at(Date.parse(after)), 'closed');
});

test('a deadline or a time we do not know never closes the gift', () => {
  assert.equal(
    perkStep({ deadline: null, registeredAt: after, signedIn: true, accountCreatedAt: after }),
    'counted',
  );
  assert.equal(
    perkStep({ deadline: DEADLINE, registeredAt: null, signedIn: false, now: Date.parse(before) }),
    'signup',
  );
});

// ---------------------------------------------------------------- readAnswers

const QUESTIONS = [
  { id: 'name', type: 'text', label_en: 'Your name', label_zh: '姓名', required: true },
  { id: 'notes', type: 'textarea', label_en: 'Notes', label_zh: '备注' },
  {
    id: 'meal',
    type: 'single',
    label_en: 'Meal',
    label_zh: '餐食',
    required: true,
    other: true,
    options: [{ id: 'veg', label_en: 'Vegetarian', label_zh: '素食' }],
  },
  {
    id: 'heard',
    type: 'multi',
    label_en: 'How did you hear about us',
    label_zh: '从哪里得知',
    other: true,
    options: [
      { id: 'wechat', label_en: 'WeChat', label_zh: '微信' },
      { id: 'friend', label_en: 'A friend', label_zh: '朋友' },
    ],
  },
];

const state = (over = {}) => ({
  name: 'Mei',
  notes: '',
  meal: { picked: ['veg'], other: null },
  heard: { picked: [], other: null },
  ...over,
});

test('answers come back in the API shape, and blanks are left out', () => {
  const read = readAnswers(QUESTIONS, state(), 'en');
  assert.deepEqual(read, { answers: { name: 'Mei', meal: { option: 'veg' } } });
});

test('a multiple choice sends options, and "Other" its own text', () => {
  const read = readAnswers(
    QUESTIONS,
    state({ heard: { picked: ['wechat', 'friend'], other: 'A poster' } }),
    'en',
  );
  assert.deepEqual(read.answers.heard, { options: ['wechat', 'friend'], other: 'A poster' });
  const only = readAnswers(QUESTIONS, state({ meal: { picked: [], other: 'Halal' } }), 'en');
  assert.deepEqual(only.answers.meal, { other: 'Halal' });
});

test('a required question left blank names the field to focus', () => {
  const read = readAnswers(QUESTIONS, state({ name: '   ' }), 'en');
  assert.equal(read.error, 'Answer the question: Your name');
  assert.equal(read.field, questionFieldId(QUESTIONS[0]));
  const choice = readAnswers(QUESTIONS, state({ meal: { picked: [], other: null } }), 'en');
  assert.equal(choice.field, questionFieldId(QUESTIONS[2]));
});

test('a ticked "Other" with nothing typed points at the text box', () => {
  const read = readAnswers(QUESTIONS, state({ meal: { picked: [], other: '  ' } }), 'en');
  assert.equal(read.field, otherFieldId(QUESTIONS[2]));
  assert.match(read.error, /Fill in “Other”/);
});

test('/zh/ asks in Chinese, using the question’s Chinese label', () => {
  const read = readAnswers(QUESTIONS, state({ name: '' }), 'zh');
  assert.equal(read.error, '请回答：姓名');
  assert.equal(questionLabel(QUESTIONS[0], 'zh'), '姓名');
  assert.equal(questionLabel({ label_en: 'Only English' }, 'zh'), 'Only English');
});

// ---------------------------------------------------------------- volunteerBody

test('the volunteer field has exactly three cases', () => {
  assert.deepEqual(volunteerBody(false, true, ' Mei ', ' 555 '), {
    volunteer: { name: 'Mei', phone: '555' },
  });
  // Pre-filled by the signed-in GET and un-ticked here: that is a withdrawal.
  assert.deepEqual(volunteerBody(true, false, '', ''), { volunteer: false });
  // Never asked for: the key stays out, so a plain registration leaves the
  // volunteer list alone.
  assert.deepEqual(volunteerBody(false, false, '', ''), {});
  assert.deepEqual(volunteerBody(true, true, 'Mei', ''), {
    volunteer: { name: 'Mei', phone: '' },
  });
});

// ---------------------------------------------------------------- zhError

test('refusals a person can act on have Chinese wording', () => {
  assert.equal(zhError('Enter a valid email address.'), '请输入有效的电子邮箱。');
  assert.equal(zhError('Enter your name to volunteer.'), '请填写志愿者姓名。');
  assert.equal(zhError('Registration for this event has closed.'), '本活动报名已截止。');
  assert.equal(zhError('some server detail nobody can act on'), '');
  assert.equal(zhError(undefined), '');
});
