import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateQuestions,
  validateAnswers,
  perkOf,
  registrationOpen,
  choiceAnswerLabels,
} from '../functions/api/_event-form.js';

const opt = (id, en = id, zh = `${id}中`) => ({ id, label_en: en, label_zh: zh });
const q = (over) => ({
  id: 'q1',
  type: 'single',
  label_en: 'Pick one',
  label_zh: '选一个',
  required: false,
  options: [opt('a', 'Apple', '苹果'), opt('b', 'Banana', '香蕉')],
  other: false,
  ...over,
});

// ------------------------------------------------------- validateQuestions ----

test('validateQuestions: normalizes — trims labels, drops unknown keys, options/other only on choices', () => {
  const { questions, error } = validateQuestions([
    {
      id: 'heard',
      type: 'multi',
      label_en: '  Where?  ',
      label_zh: ' 哪里？ ',
      required: 'yes', // not a boolean true → not required
      options: [{ id: 'web', label_en: ' Web ', label_zh: ' 网站 ', color: 'red' }],
      other: 1, // not true → no Other
      extra: 'dropped',
    },
    {
      id: 'names',
      type: 'textarea',
      label_en: 'Names',
      label_zh: '姓名',
      required: true,
      options: [opt('x')],
      other: true,
    },
  ]);
  assert.equal(error, undefined);
  assert.deepEqual(questions, [
    {
      id: 'heard',
      type: 'multi',
      label_en: 'Where?',
      label_zh: '哪里？',
      required: false,
      options: [{ id: 'web', label_en: 'Web', label_zh: '网站' }],
      other: false,
    },
    { id: 'names', type: 'textarea', label_en: 'Names', label_zh: '姓名', required: true },
  ]);
});

test('validateQuestions: an empty list is an open form with no questions', () => {
  assert.deepEqual(validateQuestions([]), { questions: [] });
});

test('validateQuestions: 30 questions and 30 options are allowed, 31 are not', () => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  assert.equal(validateQuestions(many(30, (i) => q({ id: `q${i}` }))).error, undefined);
  assert.equal(
    validateQuestions(many(31, (i) => q({ id: `q${i}` }))).error,
    'An event can have at most 30 questions.',
  );
  assert.equal(validateQuestions([q({ options: many(30, (i) => opt(`o${i}`)) })]).error, undefined);
  assert.equal(
    validateQuestions([q({ options: many(31, (i) => opt(`o${i}`)) })]).error,
    'Question 1 needs 1 to 30 options.',
  );
});

for (const [label, raw, error] of [
  ['not a list', { id: 'q1' }, 'Registration questions must be a list.'],
  ['null', null, 'Registration questions must be a list.'],
  ['a question that is not an object', [q(), 'text'], 'Question 2 is invalid.'],
  ['an id with upper case', [q({ id: 'Heard' })], /^Question 1 has an invalid id/],
  ['an id with a dash', [q({ id: 'heard-from' })], /^Question 1 has an invalid id/],
  ['an empty id', [q({ id: '' })], /^Question 1 has an invalid id/],
  ['a 41-character id', [q({ id: 'a'.repeat(41) })], /^Question 1 has an invalid id/],
  ['the id __proto__', [q({ id: '__proto__' })], /^Question 1 has an invalid id/],
  ['a repeated id', [q(), q()], 'Question 2 repeats the id "q1".'],
  ['an unknown type', [q({ type: 'file' })], 'Question 1 has an unknown type.'],
  ['a type in the wrong case', [q({ type: 'Number' })], 'Question 1 has an unknown type.'],
  ['no Chinese label', [q({ label_zh: '  ' })], /^Question 1 needs a label in both/],
  ['no English label', [q({ label_en: undefined })], /^Question 1 needs a label in both/],
  ['a 201-character label', [q({ label_en: 'x'.repeat(201) })], /^Question 1 needs a label/],
  ['a choice with no options', [q({ options: [] })], 'Question 1 needs 1 to 30 options.'],
  [
    'a choice with options not a list',
    [q({ options: 'a,b' })],
    'Question 1 needs 1 to 30 options.',
  ],
  [
    'an option that is not an object',
    [q({ options: ['a'] })],
    'Option 1 of question 1 is invalid.',
  ],
  [
    'an invalid option id',
    [q({ options: [opt('A')] })],
    /^Option 1 of question 1 has an invalid id/,
  ],
  [
    'the option id "other"',
    [q({ options: [opt('other')] })],
    /^Option 1 of question 1 has an invalid id/,
  ],
  [
    'a repeated option id',
    [q({ options: [opt('a'), opt('a')] })],
    'Option 2 of question 1 repeats the id "a".',
  ],
  [
    'an option without a Chinese label',
    [q({ options: [opt('a'), { id: 'b', label_en: 'B' }] })],
    /^Option 2 of question 1 needs a label in both/,
  ],
]) {
  test(`validateQuestions: ${label} -> error`, () => {
    const out = validateQuestions(raw);
    assert.equal(out.questions, undefined);
    if (error instanceof RegExp) assert.match(out.error, error);
    else assert.equal(out.error, error);
  });
}

test('validateQuestions: a 200-character label and a 40-character id are allowed', () => {
  const out = validateQuestions([q({ id: 'a'.repeat(40), label_zh: '字'.repeat(200) })]);
  assert.equal(out.error, undefined);
});

const numberQ = (over) => ({
  id: 'guests',
  type: 'number',
  label_en: 'How many guests?',
  label_zh: '几位客人？',
  required: true,
  ...over,
});

test('validateQuestions: number, phone and date are plain questions; a number keeps only the bounds it sets', () => {
  const { questions, error } = validateQuestions([
    numberQ({ options: [opt('x')], other: true }), // choice-only keys dropped
    numberQ({ id: 'kids', min: 0, max: '10', required: false }),
    numberQ({ id: 'age', min: ' 18 ', max: '', extra: 1 }),
    { id: 'tel', type: 'phone', label_en: 'Phone', label_zh: '电话', min: 1, max: 2 },
    { id: 'when', type: 'date', label_en: 'Arriving on', label_zh: '到达日期', required: true },
  ]);
  assert.equal(error, undefined);
  assert.deepEqual(questions, [
    {
      id: 'guests',
      type: 'number',
      label_en: 'How many guests?',
      label_zh: '几位客人？',
      required: true,
    },
    {
      id: 'kids',
      type: 'number',
      label_en: 'How many guests?',
      label_zh: '几位客人？',
      required: false,
      min: 0,
      max: 10,
    },
    {
      id: 'age',
      type: 'number',
      label_en: 'How many guests?',
      label_zh: '几位客人？',
      required: true,
      min: 18,
    },
    { id: 'tel', type: 'phone', label_en: 'Phone', label_zh: '电话', required: false },
    { id: 'when', type: 'date', label_en: 'Arriving on', label_zh: '到达日期', required: true },
  ]);
});

for (const [label, patch, error] of [
  ['a fractional min', { min: 1.5 }, /must be whole numbers\.$/],
  ['a max that is not a number', { max: 'ten' }, /must be whole numbers\.$/],
  ['a max beyond a billion', { max: 1_000_000_001 }, /must be whole numbers\.$/],
  ['an 11-digit min as text', { min: '10000000000' }, /must be whole numbers\.$/],
  [
    'min above max',
    { min: 5, max: 4 },
    /^Question 1: the smallest allowed value is above the largest\.$/,
  ],
]) {
  test(`validateQuestions: a number question with ${label} -> error`, () => {
    assert.match(String(validateQuestions([numberQ(patch)]).error), error);
  });
}

// --------------------------------------------------------- validateAnswers ----

const FORM = validateQuestions([
  q({ id: 'attending', required: true, options: [opt('yes', 'Yes'), opt('no', 'No')] }),
  q({ id: 'heard', label_en: 'How did you hear?', other: true }),
  q({
    id: 'food',
    type: 'multi',
    label_en: 'Food',
    other: true,
    options: [opt('a'), opt('b'), opt('c')],
  }),
  { id: 'names', type: 'textarea', label_en: 'Names', label_zh: '姓名', required: true },
  { id: 'note', type: 'text', label_en: 'Note', label_zh: '备注' },
]).questions;
const MIN = { attending: { option: 'yes' }, names: 'Pat' };

test('validateAnswers: normalizes — trims text, drops unknown questions, empties and extra keys', () => {
  const out = validateAnswers(FORM, {
    attending: { option: 'no', other: null, extra: 1 },
    heard: { other: '  a poster  ' },
    food: { options: ['c', 'a', 'c'], other: ' ' },
    names: '  Pat Lee \n',
    note: '   ',
    unknown_question: 'dropped',
  });
  assert.deepEqual(out, {
    answers: {
      attending: { option: 'no' },
      heard: { other: 'a poster' },
      food: { options: ['a', 'c'] },
      names: 'Pat Lee',
    },
  });
});

test('validateAnswers: unanswered optional questions are simply absent', () => {
  for (const extra of [
    {},
    { heard: null, food: null, note: null },
    { heard: { option: '' }, food: { options: [] }, note: '' },
  ]) {
    assert.deepEqual(
      validateAnswers(FORM, { ...MIN, ...extra }),
      { answers: MIN },
      JSON.stringify(extra),
    );
  }
});

test('validateAnswers: Other with nothing typed does not answer a required question', () => {
  const single = validateQuestions([q({ id: 'heard', required: true, other: true })]).questions;
  for (const other of ['', '   ', '\n\t']) {
    assert.deepEqual(
      validateAnswers(single, { heard: { other } }),
      { error: 'Answer the question: Pick one' },
      JSON.stringify(other),
    );
  }
  const multi = validateQuestions([q({ type: 'multi', required: true, other: true })]).questions;
  for (const answer of [{ other: '' }, { options: [], other: '  ' }]) {
    assert.deepEqual(
      validateAnswers(multi, { q1: answer }),
      { error: 'Answer the question: Pick one' },
      JSON.stringify(answer),
    );
  }
});

test('validateAnswers: a blank Other is dropped; typed Other text is still an answer', () => {
  const single = validateQuestions([q({ other: true })]).questions;
  const multi = validateQuestions([q({ id: 'food', type: 'multi', other: true })]).questions;
  const noOther = validateQuestions([q({ id: 'plain' })]).questions;
  for (const [questions, given, answers] of [
    [single, { q1: { other: '  ' } }, {}],
    [single, { q1: { option: 'a', other: ' ' } }, { q1: { option: 'a' } }],
    [single, { q1: { other: '  a poster ' } }, { q1: { other: 'a poster' } }],
    [multi, { food: { options: ['b'], other: '   ' } }, { food: { options: ['b'] } }],
    [multi, { food: { options: [], other: '' } }, {}],
    [multi, { food: { options: [], other: ' tea ' } }, { food: { options: [], other: 'tea' } }],
    // Nothing typed on a question without Other is simply no Other.
    [noOther, { plain: { option: 'a', other: '' } }, { plain: { option: 'a' } }],
  ]) {
    assert.deepEqual(validateAnswers(questions, given), { answers }, JSON.stringify(given));
  }
});

test('validateAnswers: the length limits are inclusive (500 text, 2000 textarea, 200 Other)', () => {
  const ok = validateAnswers(FORM, {
    ...MIN,
    names: 'n'.repeat(2000),
    note: 't'.repeat(500),
    heard: { other: 'o'.repeat(200) },
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.answers.names.length, 2000);
});

for (const [label, patch, error] of [
  ['required single missing', { attending: undefined }, 'Answer the question: Pick one'],
  ['required single null', { attending: null }, 'Answer the question: Pick one'],
  [
    'required single with an empty option',
    { attending: { option: '' } },
    'Answer the question: Pick one',
  ],
  ['required textarea blank', { names: ' \n ' }, 'Answer the question: Names'],
  ['required textarea missing', { names: undefined }, 'Answer the question: Names'],
  ['unknown option id', { attending: { option: 'maybe' } }, 'Invalid answer for: Pick one'],
  ['option given as a label', { attending: { option: 'Yes' } }, 'Invalid answer for: Pick one'],
  ['a bare string for a single', { attending: 'yes' }, 'Invalid answer for: Pick one'],
  ['an array for a single', { attending: ['yes'] }, 'Invalid answer for: Pick one'],
  ['a number option', { attending: { option: 1 } }, 'Invalid answer for: Pick one'],
  ['Other where not allowed', { attending: { other: 'later' } }, 'Invalid answer for: Pick one'],
  [
    'an option and Other together',
    { heard: { option: 'a', other: 'x' } },
    'Invalid answer for: How did you hear?',
  ],
  [
    'Other over 200',
    { heard: { other: 'o'.repeat(201) } },
    'Invalid answer for: How did you hear?',
  ],
  ['Other not a string', { heard: { other: 5 } }, 'Invalid answer for: How did you hear?'],
  ['multi options not a list', { food: { options: 'a' } }, 'Invalid answer for: Food'],
  ['multi with an unknown option', { food: { options: ['a', 'z'] } }, 'Invalid answer for: Food'],
  [
    'multi Other over 200',
    { food: { options: [], other: 'x'.repeat(201) } },
    'Invalid answer for: Food',
  ],
  ['textarea over 2000', { names: 'n'.repeat(2001) }, 'Invalid answer for: Names'],
  ['textarea not a string', { names: ['Pat'] }, 'Invalid answer for: Names'],
  ['text over 500', { note: 't'.repeat(501) }, 'Invalid answer for: Note'],
  // Questions are checked in display order: the first failing one answers.
  [
    'order: first question first',
    { attending: undefined, names: undefined },
    'Answer the question: Pick one',
  ],
]) {
  test(`validateAnswers: ${label} -> ${error}`, () => {
    assert.deepEqual(validateAnswers(FORM, { ...MIN, ...patch }), { error });
  });
}

test('validateAnswers: answers that are not an object are refused; missing ones are unanswered', () => {
  for (const raw of ['yes', ['yes'], 5, true]) {
    assert.deepEqual(
      validateAnswers(FORM, raw),
      { error: 'Invalid answers.' },
      JSON.stringify(raw),
    );
  }
  assert.deepEqual(validateAnswers(FORM, undefined), { error: 'Answer the question: Pick one' });
  assert.deepEqual(validateAnswers([], null), { answers: {} });
});

test('validateAnswers: inherited keys are not answers', () => {
  const tricky = validateQuestions([
    { id: 'constructor', type: 'text', label_en: 'C', label_zh: 'C', required: true },
  ]).questions;
  assert.deepEqual(validateAnswers(tricky, {}), { error: 'Answer the question: C' });
  const parsed = JSON.parse('{"__proto__": {"option": "a"}, "q1": {"option": "b"}}');
  assert.deepEqual(validateAnswers([q({ required: true })], parsed), {
    answers: { q1: { option: 'b' } },
  });
});

// ---------------------------------------------- number / phone / date answers ----

const TYPED = validateQuestions([
  numberQ({ min: 1, max: 6 }),
  numberQ({ id: 'floor', required: false }),
  { id: 'tel', type: 'phone', label_en: 'Phone', label_zh: '电话', required: false },
  { id: 'when', type: 'date', label_en: 'Arriving on', label_zh: '到达日期', required: false },
]).questions;

test('validateAnswers: a number is stored as a whole number, from a number or its text', () => {
  for (const [given, stored] of [
    [3, 3],
    ['3', 3],
    [' 6 ', 6],
    ['1', 1],
  ]) {
    assert.deepEqual(validateAnswers(TYPED, { guests: given }), { answers: { guests: stored } });
  }
  // Zero and negatives are numbers too (no bounds on `floor`).
  assert.deepEqual(validateAnswers(TYPED, { guests: 2, floor: 0 }), {
    answers: { guests: 2, floor: 0 },
  });
  assert.deepEqual(validateAnswers(TYPED, { guests: 2, floor: '-1' }), {
    answers: { guests: 2, floor: -1 },
  });
});

test('validateAnswers: phone and date answers are trimmed strings', () => {
  assert.deepEqual(
    validateAnswers(TYPED, { guests: 1, tel: ' +1 (217) 555-0100 ', when: '2026-09-27' }),
    { answers: { guests: 1, tel: '+1 (217) 555-0100', when: '2026-09-27' } },
  );
});

test('validateAnswers: blank number, phone and date answers are unanswered', () => {
  for (const blank of ['', '  ', null, undefined]) {
    assert.deepEqual(
      validateAnswers(TYPED, { guests: 1, floor: blank, tel: blank, when: blank }),
      { answers: { guests: 1 } },
      JSON.stringify(blank),
    );
    assert.deepEqual(
      validateAnswers(TYPED, { guests: blank }),
      { error: 'Answer the question: How many guests?' },
      JSON.stringify(blank),
    );
  }
});

for (const [label, patch, error] of [
  ['a number below min', { guests: 0 }, 'Invalid answer for: How many guests?'],
  ['a number above max', { guests: '7' }, 'Invalid answer for: How many guests?'],
  ['a fraction', { guests: 2.5 }, 'Invalid answer for: How many guests?'],
  ['fraction text', { guests: '2.5' }, 'Invalid answer for: How many guests?'],
  ['number words', { guests: 'two' }, 'Invalid answer for: How many guests?'],
  ['a number in a list', { guests: [2] }, 'Invalid answer for: How many guests?'],
  ['a number as an object', { guests: { option: '2' } }, 'Invalid answer for: How many guests?'],
  ['a huge unbounded number', { floor: 1_000_000_001 }, 'Invalid answer for: How many guests?'],
  ['NaN', { floor: NaN }, 'Invalid answer for: How many guests?'],
  ['too few phone digits', { tel: '555-01' }, 'Invalid answer for: Phone'],
  ['too many phone digits', { tel: '1234567890123456' }, 'Invalid answer for: Phone'],
  ['letters in a phone', { tel: '217-555-CALL' }, 'Invalid answer for: Phone'],
  ['a phone over 40 characters', { tel: `${'1 '.repeat(20)}2` }, 'Invalid answer for: Phone'],
  ['a phone that is a number', { tel: 2175550100 }, 'Invalid answer for: Phone'],
  ['a date in another format', { when: '09/27/2026' }, 'Invalid answer for: Arriving on'],
  ['a date with a time', { when: '2026-09-27T10:00' }, 'Invalid answer for: Arriving on'],
  ['a day that does not exist', { when: '2026-02-30' }, 'Invalid answer for: Arriving on'],
  ['a 13th month', { when: '2026-13-01' }, 'Invalid answer for: Arriving on'],
  ['a date that is a number', { when: 20260927 }, 'Invalid answer for: Arriving on'],
]) {
  test(`validateAnswers: ${label} -> ${error}`, () => {
    assert.deepEqual(validateAnswers(TYPED, { guests: 1, ...patch }), { error });
  });
}

test('validateAnswers: a leap day is a real date', () => {
  assert.deepEqual(validateAnswers(TYPED, { guests: 1, when: '2028-02-29' }), {
    answers: { guests: 1, when: '2028-02-29' },
  });
  assert.equal(
    validateAnswers(TYPED, { guests: 1, when: '2027-02-29' }).error,
    'Invalid answer for: Arriving on',
  );
});

// ------------------------------------------------------------------ perkOf ----

test('perkOf: both names -> item and deadline; perk_deadline wins over the start', () => {
  const event = {
    starts_at: '2026-09-27T19:00:00Z',
    perk_deadline: '2026-09-21T04:59:59Z',
    perk_item_zh: ' 月饼 ',
    perk_item_en: 'mooncake',
  };
  assert.deepEqual(perkOf(event), {
    item_en: 'mooncake',
    item_zh: '月饼',
    deadline: '2026-09-21T04:59:59Z',
  });
  assert.equal(perkOf({ ...event, perk_deadline: null }).deadline, '2026-09-27T19:00:00Z');
});

test('perkOf: no gift unless both names are set', () => {
  const base = { starts_at: '2026-09-27T19:00:00Z', perk_deadline: null };
  for (const names of [
    {},
    { perk_item_zh: '月饼' },
    { perk_item_en: 'mooncake' },
    { perk_item_zh: '月饼', perk_item_en: '  ' },
    { perk_item_zh: null, perk_item_en: null },
  ]) {
    assert.equal(perkOf({ ...base, ...names }), null, JSON.stringify(names));
  }
});

// -------------------------------------------------------- registrationOpen ----

test('registrationOpen: open until the end, inclusive; the start when there is no end', () => {
  const end = Date.parse('2026-09-27T23:00:00Z');
  const event = { starts_at: '2026-09-27T19:00:00Z', ends_at: '2026-09-27T23:00:00Z' };
  assert.equal(registrationOpen(event, end - 1), true);
  assert.equal(registrationOpen(event, end), true);
  assert.equal(registrationOpen(event, end + 1), false);
  const start = Date.parse(event.starts_at);
  const noEnd = { ...event, ends_at: null };
  assert.equal(registrationOpen(noEnd, start), true);
  assert.equal(registrationOpen(noEnd, start + 1), false);
  assert.equal(registrationOpen({ starts_at: '2099-01-01T00:00:00Z' }), true, 'defaults to now');
  assert.equal(registrationOpen({ starts_at: '2000-01-01T00:00:00Z' }), false);
});

// ------------------------------------------------------ choiceAnswerLabels ----

test('choiceAnswerLabels: option labels in the language asked, in question order', () => {
  const [, , food] = FORM;
  const heard = FORM[1];
  assert.deepEqual(choiceAnswerLabels(heard, { option: 'b' }, 'zh'), ['香蕉']);
  assert.deepEqual(choiceAnswerLabels(heard, { option: 'b' }, 'en'), ['Banana']);
  assert.deepEqual(choiceAnswerLabels(food, { options: ['c', 'a'] }, 'en'), ['a', 'c']);
});

test('choiceAnswerLabels: Other is the word, never the typed text', () => {
  const [, heard, food] = FORM;
  assert.deepEqual(choiceAnswerLabels(heard, { other: 'https://evil.example <b>' }, 'zh'), [
    '其他',
  ]);
  assert.deepEqual(choiceAnswerLabels(heard, { other: '' }, 'en'), ['Other']);
  assert.deepEqual(choiceAnswerLabels(food, { options: ['b'], other: 'evil' }, 'en'), [
    'b',
    'Other',
  ]);
});

test('choiceAnswerLabels: unanswered, malformed or removed options yield nothing', () => {
  const heard = FORM[1];
  assert.deepEqual(choiceAnswerLabels(heard, undefined, 'en'), []);
  assert.deepEqual(choiceAnswerLabels(heard, 'a', 'en'), []);
  assert.deepEqual(choiceAnswerLabels(heard, { option: 'gone' }, 'en'), []);
  assert.deepEqual(choiceAnswerLabels(FORM[3], { option: 'a' }, 'en'), [], 'a text question');
});
