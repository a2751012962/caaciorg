// The rules behind the React registration page, exercised without a DOM:
// web/src/lib/registration.js is plain JS so node --test can import it on
// Node 20 (CI), where a .ts module would not load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  answerStateFrom,
  eventSlugFrom,
  perkStep,
  questionFieldId,
  otherFieldId,
  questionLabel,
  readAnswers,
  volunteerBody,
  volunteerZhError,
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

test('the volunteer page reads /events/<slug>/volunteer/ the same way (0035)', () => {
  assert.equal(
    eventSlugFrom('/events/mid-autumn-festival/volunteer/', '', 'volunteer'),
    'mid-autumn-festival',
  );
  assert.equal(eventSlugFrom('/zh/events/gala/volunteer', '', 'volunteer'), 'gala');
  assert.equal(eventSlugFrom('/event-volunteer/', '?event=gala', 'volunteer'), 'gala');
  // A register path is not a volunteer path, and the other way round.
  assert.equal(eventSlugFrom('/events/gala/register/', '', 'volunteer'), '');
  assert.equal(eventSlugFrom('/events/gala/volunteer/', ''), '');
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

// ------------------------------------------------- number / phone / date fields

const TYPED = [
  {
    id: 'guests',
    type: 'number',
    label_en: 'How many guests?',
    label_zh: '几位客人？',
    required: true,
    min: 1,
    max: 6,
  },
  { id: 'floor', type: 'number', label_en: 'Floor', label_zh: '楼层', max: 3 },
  { id: 'age', type: 'number', label_en: 'Age', label_zh: '年龄', min: 18 },
  { id: 'tel', type: 'phone', label_en: 'Phone', label_zh: '电话' },
  { id: 'when', type: 'date', label_en: 'Arriving on', label_zh: '到达日期', required: true },
];
const typed = (over = {}) => ({
  guests: '2',
  floor: '',
  age: '',
  tel: '',
  when: '2026-09-27',
  ...over,
});

test('a number is sent as a number, a phone and a date as their text; blanks are left out', () => {
  assert.deepEqual(readAnswers(TYPED, typed(), 'en'), {
    answers: { guests: 2, when: '2026-09-27' },
  });
  assert.deepEqual(
    readAnswers(TYPED, typed({ floor: ' 0 ', age: '40', tel: ' +1 (217) 555-0100 ' }), 'en'),
    {
      answers: { guests: 2, floor: 0, age: 40, tel: '+1 (217) 555-0100', when: '2026-09-27' },
    },
  );
});

test('a number that is not whole, or outside the bounds, names the field, in both languages', () => {
  for (const [state, en, zh] of [
    [{ guests: '2.5' }, 'Enter a whole number for: How many guests?', '请填写整数：几位客人？'],
    [{ guests: 'two' }, 'Enter a whole number for: How many guests?', '请填写整数：几位客人？'],
    [
      { guests: '0' },
      'Enter a whole number from 1 to 6 for: How many guests?',
      '请填写 1 到 6 之间的整数：几位客人？',
    ],
    [
      { guests: '7' },
      'Enter a whole number from 1 to 6 for: How many guests?',
      '请填写 1 到 6 之间的整数：几位客人？',
    ],
    [{ floor: '4' }, 'Enter a whole number of at most 3 for: Floor', '请填写不大于 3 的整数：楼层'],
    [{ age: '17' }, 'Enter a whole number of at least 18 for: Age', '请填写不小于 18 的整数：年龄'],
  ]) {
    const [id] = Object.keys(state);
    const field = questionFieldId(TYPED.find((q) => q.id === id));
    assert.deepEqual(readAnswers(TYPED, typed(state), 'en'), { error: en, field });
    assert.deepEqual(readAnswers(TYPED, typed(state), 'zh'), { error: zh, field });
  }
});

test('a phone number needs 7 to 15 digits and only the usual punctuation', () => {
  for (const tel of ['555-01', '1234567890123456', '217-555-CALL', `${'1 '.repeat(20)}2`]) {
    assert.deepEqual(
      readAnswers(TYPED, typed({ tel }), 'en'),
      { error: 'Enter a valid phone number for: Phone', field: questionFieldId(TYPED[3]) },
      tel,
    );
  }
  assert.equal(readAnswers(TYPED, typed({ tel: '2175550100' }), 'zh').answers.tel, '2175550100');
  assert.equal(
    readAnswers(TYPED, typed({ tel: '555-01' }), 'zh').error,
    '请填写有效的电话号码：电话',
  );
});

test('a required number or date left blank asks for it like any other question', () => {
  assert.deepEqual(readAnswers(TYPED, typed({ guests: '' }), 'en'), {
    error: 'Answer the question: How many guests?',
    field: questionFieldId(TYPED[0]),
  });
  assert.deepEqual(readAnswers(TYPED, typed({ when: '  ' }), 'zh'), {
    error: '请回答：到达日期',
    field: questionFieldId(TYPED[4]),
  });
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

test('the volunteer endpoint’s refusals too, including an unanswered question', () => {
  assert.equal(volunteerZhError('Enter your name.'), '请填写姓名。');
  assert.equal(volunteerZhError('Event not found.'), '所选活动已不可报名，请关闭后重新打开再试。');
  assert.equal(
    volunteerZhError('Answer the question: When can you help?'),
    '请回答：When can you help?',
  );
  assert.equal(volunteerZhError('supabase upsert event_volunteers: 500 boom'), '');
  assert.equal(volunteerZhError(null), '');
});

// ---------------------------------------------------------------- answerStateFrom

test('stored answers become the page’s state, so a signed-in visitor sees the form as sent', () => {
  const stored = {
    name: 'Mei',
    meal: { other: 'Halal' },
    heard: { options: ['friend', 'wechat'], other: 'A poster' },
  };
  assert.deepEqual(answerStateFrom(QUESTIONS, stored), {
    name: 'Mei',
    notes: '',
    meal: { picked: [], other: 'Halal' },
    heard: { picked: ['friend', 'wechat'], other: 'A poster' },
  });
  assert.deepEqual(answerStateFrom(QUESTIONS, { meal: { option: 'veg' } }).meal, {
    picked: ['veg'],
    other: null,
  });
  // A number comes back as the text of the box; nothing stored is blank.
  assert.equal(answerStateFrom(TYPED, { guests: 2 }).guests, '2');
  assert.deepEqual(answerStateFrom(QUESTIONS, null), readAnswersBlank());
  // …and it round-trips through readAnswers.
  assert.deepEqual(readAnswers(QUESTIONS, answerStateFrom(QUESTIONS, stored), 'en'), {
    answers: stored,
  });
});

function readAnswersBlank() {
  return {
    name: '',
    notes: '',
    meal: { picked: [], other: null },
    heard: { picked: [], other: null },
  };
}
