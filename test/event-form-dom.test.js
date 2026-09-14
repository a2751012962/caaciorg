// Boots the real registration page (member-src/event-register.html) with
// src/caaci-member.js in jsdom and /api/event-register stubbed. Pins where the
// page takes its event from, what it sends (the POST body with the answers in
// the API's shape, a bearer token only when signed in), how it draws each kind
// of question, and what each API answer does to it: loading, not open, could
// not load, closed, the event details, the free-gift callout and step, and the
// success state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');
const SOURCE = await readFile(
  new URL('../member-src/event-register.html', import.meta.url),
  'utf8',
);

const FESTIVAL_PATH = '/mid_autumn_festival_form/';
const tick = () => new Promise((r) => setTimeout(r, 15));
const q = (s) => document.querySelector(s);

// `event` does what build.mjs does for the festival's printed QR route: the
// same page with data-event on <body> (test/build-routes.test.js checks the
// real build). Pass event: null for the generic /event-register/ page.
function setup({ path = FESTIVAL_PATH, search = '', event = 'mid-autumn-festival' } = {}) {
  const html = event ? SOURCE.replace('<body ', `<body data-event="${event}" `) : SOURCE;
  const dom = new JSDOM(html, { url: `https://caaci.example${path}${search}` });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = {
    pathname: path,
    origin: 'https://caaci.example',
    search,
    hash: '',
    href: '',
  };
  dom.window.__CAACI_TEST__ = true;
  globalThis.window = dom.window;
}

// The page only asks Supabase for the session (its access token and user).
const supaWith = (user) => ({
  auth: {
    getSession: async () => ({ data: { session: user ? { access_token: 'tok', user } : null } }),
  },
});
const USER = { id: 'u1', email: 'mei@x.com', created_at: '2026-01-01T00:00:00Z' };

const FUTURE = '2099-09-27T19:00:00Z'; // a Sunday, 2:00 PM in Chicago (CDT)
const PAST = '2020-09-27T19:00:00Z';
const opt = (id, en, zh) => ({ id, label_en: en, label_zh: zh });

// The festival's four questions, as the migration backfills them.
const MID_AUTUMN_QUESTIONS = [
  {
    id: 'attending',
    type: 'single',
    label_en: 'Can you attend?',
    label_zh: '您能参加吗？',
    required: true,
    options: [
      opt('yes', "Yes, I'll be there", '能，我会参加'),
      opt('no', "Sorry, can't make it", '抱歉，无法参加'),
    ],
  },
  {
    id: 'names',
    type: 'textarea',
    label_en: 'What are the names of people attending?',
    label_zh: '参加者的姓名是？',
    required: true,
  },
  {
    id: 'heard_from',
    type: 'single',
    label_en: 'How did you hear about this event?',
    label_zh: '您是从哪里得知本次活动的？',
    required: false,
    options: [
      opt('website', 'Website', '网站'),
      opt('friend', 'Friend', '朋友'),
      opt('newsletter', 'Newsletter', '简报'),
      opt('social', 'Social Media', '社交媒体'),
    ],
    other: true,
  },
  {
    id: 'meal',
    type: 'single',
    label_en: 'Would you like to purchase a meal?',
    label_zh: '您想购买餐食吗？',
    required: false,
    options: [opt('yes', 'Yes', '是'), opt('no', 'No', '否')],
  },
];
const MOONCAKE = { item_en: 'mooncake', item_zh: '月饼', deadline: FUTURE };
const EVENT = {
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 2099',
  title_zh: '中秋节',
  description: 'Mooncakes under the harvest moon.',
  description_zh: '在丰收的明月下，一起分享月饼。',
  starts_at: FUTURE,
  ends_at: '2099-09-27T23:00:00Z',
  location: 'Siebel Center for Design',
  perk: MOONCAKE,
  questions: MID_AUTUMN_QUESTIONS,
  open: true,
};

// Every question type, for an event with no free gift.
const POTLUCK_QUESTIONS = [
  {
    id: 'dishes',
    type: 'multi',
    label_en: 'Which dishes will you bring?',
    label_zh: '您会带哪些菜？',
    required: true,
    options: [
      opt('dumplings', 'Dumplings', '饺子'),
      opt('noodles', 'Noodles', '面条'),
      opt('tea', 'Tea', '茶'),
    ],
    other: true,
  },
  {
    id: 'size',
    type: 'single',
    label_en: 'T-shirt size',
    label_zh: 'T恤尺码',
    required: false,
    options: [opt('s', 'Small', '小号'), opt('m', 'Medium', '中号')],
    other: true,
  },
  { id: 'phone', type: 'text', label_en: 'Phone number', label_zh: '电话号码', required: true },
  {
    id: 'notes',
    type: 'textarea',
    label_en: 'Anything else?',
    label_zh: '还有别的吗？',
    required: false,
  },
];
const POTLUCK = {
  slug: 'spring-potluck',
  title: 'Spring Potluck',
  title_zh: null,
  description: null,
  starts_at: FUTURE,
  ends_at: null,
  location: null,
  perk: null,
  questions: POTLUCK_QUESTIONS,
  open: true,
};

const anonGet =
  (event = EVENT) =>
  () => ({ body: { event, signed_in: false } });
// No `linked`: a response from before that field counts as linked when signed in.
const POST_OK = (extra = {}) => ({
  body: {
    ok: true,
    already: false,
    registered_at: '2026-09-13T20:04:05.123Z',
    signed_in: false,
    perk: MOONCAKE,
    ...extra,
  },
});

// Routes the page's two requests: GET ?event= and the POST.
function stubApi({ get = anonGet(), post = () => POST_OK() } = {}) {
  return mockFetch((url, options) => {
    if (options.method === 'POST' && url === '/api/event-register') return post(url, options);
    if (url.startsWith('/api/event-register?')) return get(url, options);
    return { status: 404, body: {} };
  });
}
const posts = (fetch) => fetch.calls.filter((c) => c.options.method === 'POST');
const postedBody = (fetch, i = 0) => JSON.parse(posts(fetch)[i].options.body);

// Fills in the festival's form. `heard` is an option id or 'other'.
function fillForm({
  email = 'mei@x.com',
  attending = 'yes',
  names = 'Mei Lin, Ada Lin',
  heard = 'other',
  other = 'Flyer at the library',
  meal = 'yes',
} = {}) {
  q('#caaci-ev-email').value = email;
  if (attending) q(`#caaci-ev-q-attending-o-${attending}`).checked = true;
  q('#caaci-ev-q-names').value = names;
  if (heard === 'other') q('#caaci-ev-q-heard_from-other').checked = true;
  else if (heard) q(`#caaci-ev-q-heard_from-o-${heard}`).checked = true;
  q('#caaci-ev-q-heard_from-other-text').value = other;
  if (meal) q(`#caaci-ev-q-meal-o-${meal}`).checked = true;
}
const submit = async () => {
  q('#caaci-ev-form').dispatchEvent(new Event('submit'));
  await tick();
};
const shown = (sel) => q(sel).hidden === false;
const typeInto = (sel, value) => {
  q(sel).value = value;
  q(sel).dispatchEvent(new Event('input', { bubbles: true }));
};

test('event form: an anonymous visitor registers for the festival, then is sent to signup with the email kept out of the URL', async () => {
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi();
  try {
    const wired = member.wireEventFormPage();
    assert.ok(shown('#caaci-ev-loading'), 'loading until the API answers');
    assert.equal(q('#caaci-ev-form-card').hidden, true);
    await wired;
    const [get] = fetch.calls;
    assert.equal(get.url, '/api/event-register?event=mid-autumn-festival');
    assert.equal(get.options.headers?.authorization, undefined);
    for (const sel of [
      '#caaci-ev-loading',
      '#caaci-ev-missing',
      '#caaci-ev-error',
      '#caaci-ev-closed',
    ])
      assert.equal(q(sel).hidden, true, sel);
    assert.ok(shown('#caaci-ev-form-card'));

    // In English the title and description are the English ones, though the
    // event has title_zh and description_zh.
    assert.equal(q('#caaci-ev-title').textContent, 'Mid-Autumn Festival 2099');
    assert.equal(q('#caaci-ev-desc').textContent, 'Mooncakes under the harvest moon.');
    assert.equal(
      document.title,
      'Mid-Autumn Festival 2099 | Chinese American Association of Central Illinois',
    );
    assert.match(
      q('#caaci-ev-when').textContent,
      /^Sunday, September 27, 2099 · 2:00\sPM – 6:00\sPM$/,
    );
    assert.equal(q('#caaci-ev-where').textContent, 'Siebel Center for Design');
    assert.ok(shown('#caaci-ev-details'));
    assert.equal(q('#caaci-ev-desc').textContent, 'Mooncakes under the harvest moon.');
    assert.ok(shown('#caaci-ev-desc'));
    // The user-approved festival copy, word for word, built from the gift's
    // name and its deadline (2:00 PM in Chicago).
    const perk = q('#caaci-ev-perk');
    assert.ok(shown('#caaci-ev-perk'));
    assert.ok(perk.classList.contains('alert-warning'));
    assert.equal(q('#caaci-ev-perk-title').textContent, 'Free mooncake');
    assert.equal(
      q('#caaci-ev-perk-text').textContent,
      'Register and create a free CAACI website account by September 27, 2:00 PM Central Time, and pick up your free mooncake at the event.',
    );
    assert.equal(
      q('#caaci-ev-perk-note').textContent,
      "You can register without an account — you just won't get the free mooncake.",
    );
    assert.ok(shown('#caaci-ev-perk-note'));

    fillForm({ email: '  mei@x.com ' });
    await submit();
    const [post] = posts(fetch);
    assert.ok(post, 'posted');
    assert.equal(post.options.headers.authorization, undefined, 'no bearer without a session');
    assert.deepEqual(JSON.parse(post.options.body), {
      event: 'mid-autumn-festival',
      email: 'mei@x.com',
      answers: {
        attending: { option: 'yes' },
        names: 'Mei Lin, Ada Lin',
        heard_from: { other: 'Flyer at the library' },
        meal: { option: 'yes' },
      },
      _hp: '',
    });

    assert.equal(q('#caaci-ev-form-card').hidden, true, 'the form is replaced');
    assert.ok(shown('#caaci-ev-done'));
    assert.equal(q('#caaci-ev-done-title').textContent, "You're registered");
    assert.equal(document.activeElement, q('#caaci-ev-done-title'));
    const time = q('#caaci-ev-done-time').textContent;
    assert.match(time, /Sep 13, 2026/);
    assert.match(time, /3:04:05 PM Central Time/, 'to the second, in Chicago time');
    assert.equal(q('#caaci-ev-done-already').hidden, true);
    assert.equal(q('#caaci-ev-perk-counted').hidden, true);
    assert.equal(q('#caaci-ev-perk-closed').hidden, true);
    assert.ok(shown('#caaci-ev-perk-cta'));
    assert.equal(
      q('#caaci-ev-perk-cta-text').textContent,
      'One more step for a free mooncake: create a free CAACI account with the email you registered with by September 27, 2:00 PM Central Time.',
    );
    assert.ok(shown('#caaci-ev-edit-row'));
    assert.equal(
      q('#caaci-ev-login').getAttribute('href'),
      '/login-3/?next=%2Fmid_autumn_festival_form%2F',
    );

    q('#caaci-ev-signup').click();
    assert.equal(sessionStorage.getItem('caaci-signup-email'), 'mei@x.com');
    assert.equal(location.href, '/login-3/?signup=1&next=%2Fmid_autumn_festival_form%2F');
    assert.doesNotMatch(location.href, /mei|@|%40/, 'the email never goes into a URL');
  } finally {
    fetch.restore();
  }
});

test('event form: checks answers before sending, keeps the button busy, and shows the API error as returned', async () => {
  setup();
  member.__setSupa(supaWith(null));
  let release;
  const fetch = stubApi({
    post: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ status: 409, body: { error: 'Registration for this event has closed.' } });
      }),
  });
  try {
    await member.wireEventFormPage();
    const note = q('#caaci-ev-notice');
    await submit();
    assert.match(note.textContent, /valid email/i);
    assert.equal(q('#caaci-ev-email').getAttribute('aria-invalid'), 'true');
    assert.equal(document.activeElement, q('#caaci-ev-email'));

    fillForm({ attending: null });
    await submit();
    assert.equal(note.textContent, 'Answer the question: Can you attend?');
    assert.equal(document.activeElement, q('#caaci-ev-q-attending-o-yes'));
    assert.equal(q('#caaci-ev-q-attending-o-yes').getAttribute('aria-invalid'), 'true');
    assert.equal(
      q('#caaci-ev-email').hasAttribute('aria-invalid'),
      false,
      'the fixed field is cleared',
    );

    fillForm({ names: '  ' });
    await submit();
    assert.equal(note.textContent, 'Answer the question: What are the names of people attending?');
    assert.equal(document.activeElement, q('#caaci-ev-q-names'));

    fillForm({ other: '  ' }); // "Other" picked with nothing typed
    await submit();
    assert.equal(note.textContent, 'Fill in “Other” for: How did you hear about this event?');
    assert.equal(document.activeElement, q('#caaci-ev-q-heard_from-other-text'));
    assert.ok(note.classList.contains('alert-danger'));
    assert.equal(posts(fetch).length, 0, 'nothing sent while answers are missing');

    fillForm();
    await submit();
    const btn = q('#caaci-ev-submit');
    assert.equal(btn.disabled, true);
    assert.equal(btn.getAttribute('aria-busy'), 'true');
    assert.match(btn.textContent, /Submitting/);
    assert.equal(note.hidden, true, 'the old error is cleared while sending');
    await submit(); // a second tap while the first is in flight
    assert.equal(posts(fetch).length, 1);

    release();
    await tick();
    assert.equal(note.textContent, 'Registration for this event has closed.');
    assert.ok(note.classList.contains('alert-danger'));
    assert.equal(note.hidden, false);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent.trim(), 'Submit');
    assert.equal(q('#caaci-ev-done').hidden, true, 'the form stays for another try');
  } finally {
    fetch.restore();
  }
});

test('event form: the honeypot has a name autofill ignores, and an ok without a registration time is not shown as success', async () => {
  setup();
  member.__setSupa(supaWith(null));
  // What the API answers a filled honeypot: ok, but nothing was saved.
  const fetch = stubApi({ post: () => ({ body: { ok: true } }) });
  try {
    await member.wireEventFormPage();
    const hidden = q('#caaci-ev-form').querySelectorAll('input.visually-hidden');
    assert.equal(hidden.length, 1, 'one honeypot');
    const [hp] = hidden;
    assert.equal(hp.id, 'caaci_hp_field');
    assert.equal(hp.name, 'caaci_hp_field');
    // Nothing an autofill heuristic or password manager maps to an identity field.
    assert.doesNotMatch(
      `${hp.id} ${hp.name}`,
      /web|site|url|name|mail|phone|tel|addr|company|org|city|zip/i,
    );
    assert.equal(hp.getAttribute('tabindex'), '-1');
    assert.equal(hp.getAttribute('autocomplete'), 'off');
    assert.equal(hp.getAttribute('aria-hidden'), 'true');

    fillForm();
    hp.value = 'https://bot.example';
    await submit();
    assert.equal(postedBody(fetch)._hp, 'https://bot.example');
    const note = q('#caaci-ev-notice');
    assert.equal(note.hidden, false);
    assert.ok(note.classList.contains('alert-danger'));
    assert.match(note.textContent, /could not confirm your registration/i);
    assert.equal(q('#caaci-ev-done').hidden, true, 'no "You\'re registered" for an unsaved answer');
    assert.equal(q('#caaci-ev-form-card').hidden, false);
    assert.equal(q('#caaci-ev-submit').disabled, false);
  } finally {
    fetch.restore();
  }
});

test('event form: a resubmission says the answers were updated and shows the original time', async () => {
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi({
    post: () => POST_OK({ already: true, registered_at: '2026-09-01T15:00:00Z' }),
  });
  try {
    await member.wireEventFormPage();
    fillForm();
    await submit();
    assert.ok(shown('#caaci-ev-done-already'));
    assert.match(q('#caaci-ev-done-already').textContent, /original registration time is kept/);
    assert.match(q('#caaci-ev-done-time').textContent, /Sep 1, 2026\D+10:00:00 AM Central Time/);
  } finally {
    fetch.restore();
  }
});

test('event form: every question type is drawn in order with its label, required marker and field', async () => {
  setup({ path: '/events/spring-potluck/register/', event: null });
  member.__setSupa(supaWith(null));
  const fetch = stubApi({ get: anonGet(POTLUCK) });
  try {
    await member.wireEventFormPage();
    const host = q('#caaci-ev-questions');
    assert.deepEqual(
      [...host.children].map((el) => el.querySelector('input, textarea').id),
      [
        'caaci-ev-q-dishes-o-dumplings',
        'caaci-ev-q-size-o-s',
        'caaci-ev-q-phone',
        'caaci-ev-q-notes',
      ],
      'in the order the event lists them',
    );
    const labelFor = (id) => q(`label[for="${id}"]`);

    // multi: a fieldset of checkboxes, the question as its legend, plus Other.
    const dishes = q('#caaci-ev-q-dishes-o-dumplings').closest('fieldset');
    assert.ok(dishes, 'a choice question is a fieldset');
    const dishesLegend = dishes.querySelector('legend');
    assert.equal(dishesLegend.textContent, 'Which dishes will you bring?');
    assert.ok(dishesLegend.classList.contains('required'), 'required marker');
    const boxes = [...dishes.querySelectorAll('input[type="checkbox"]')];
    assert.deepEqual(
      boxes.map((b) => [b.id, b.value, labelFor(b.id).textContent]),
      [
        ['caaci-ev-q-dishes-o-dumplings', 'dumplings', 'Dumplings'],
        ['caaci-ev-q-dishes-o-noodles', 'noodles', 'Noodles'],
        ['caaci-ev-q-dishes-o-tea', 'tea', 'Tea'],
        ['caaci-ev-q-dishes-other', '', 'Other:'],
      ],
    );
    assert.ok(
      boxes.every((b) => !b.required),
      'a required checkbox would demand every box',
    );
    const otherText = q('#caaci-ev-q-dishes-other-text');
    assert.equal(otherText.type, 'text');
    assert.equal(otherText.maxLength, 200);
    assert.equal(labelFor(otherText.id).textContent, 'Other — Which dishes will you bring?');
    assert.ok(labelFor(otherText.id).classList.contains('visually-hidden'));
    assert.ok(dishes.contains(otherText));

    // single: radios in one group, not required here.
    const size = q('#caaci-ev-q-size-o-s').closest('fieldset');
    assert.equal(size.querySelector('legend').textContent, 'T-shirt size');
    assert.equal(size.querySelector('legend').classList.contains('required'), false);
    const radios = [...size.querySelectorAll('input[type="radio"]')];
    assert.deepEqual(
      radios.map((r) => r.id),
      ['caaci-ev-q-size-o-s', 'caaci-ev-q-size-o-m', 'caaci-ev-q-size-other'],
    );
    assert.ok(radios.every((r) => r.name === 'caaci-ev-q-size' && !r.required));

    // text: a labelled input, required.
    const phone = q('#caaci-ev-q-phone');
    assert.equal(phone.tagName, 'INPUT');
    assert.equal(phone.type, 'text');
    assert.equal(phone.required, true);
    assert.equal(phone.maxLength, 500);
    assert.equal(labelFor('caaci-ev-q-phone').textContent, 'Phone number');
    assert.ok(labelFor('caaci-ev-q-phone').classList.contains('required'));

    // textarea: a labelled textarea, optional.
    const notes = q('#caaci-ev-q-notes');
    assert.equal(notes.tagName, 'TEXTAREA');
    assert.equal(notes.required, false);
    assert.equal(notes.maxLength, 2000);
    assert.equal(labelFor('caaci-ev-q-notes').textContent, 'Anything else?');
    assert.equal(labelFor('caaci-ev-q-notes').classList.contains('required'), false);

    // A required single choice puts `required` on its radios.
    setup();
    await member.wireEventFormPage();
    assert.ok(
      [...document.querySelectorAll('input[name="caaci-ev-q-attending"]')].every((r) => r.required),
    );
  } finally {
    fetch.restore();
  }
});

test('event form: each question type sends its answer in the API shape, Other included, and blanks are left out', async () => {
  setup({ path: '/events/spring-potluck/register/', event: null });
  member.__setSupa(supaWith(null));
  const fetch = stubApi({ get: anonGet(POTLUCK), post: () => POST_OK({ perk: null }) });
  try {
    await member.wireEventFormPage();
    q('#caaci-ev-email').value = 'ann@x.com';
    q('#caaci-ev-q-dishes-o-dumplings').checked = true;
    q('#caaci-ev-q-dishes-o-tea').checked = true;
    typeInto('#caaci-ev-q-dishes-other-text', 'Scallion pancakes');
    assert.equal(q('#caaci-ev-q-dishes-other').checked, true, 'typing an Other answer picks Other');
    typeInto('#caaci-ev-q-size-other-text', ' XL ');
    assert.equal(q('#caaci-ev-q-size-other').checked, true);
    q('#caaci-ev-q-phone').value = '  217-555-0100 ';
    await submit();
    assert.deepEqual(postedBody(fetch), {
      event: 'spring-potluck',
      email: 'ann@x.com',
      answers: {
        dishes: { options: ['dumplings', 'tea'], other: 'Scallion pancakes' },
        size: { other: 'XL' },
        phone: '217-555-0100',
      },
      _hp: '',
    });
    // No gift: no callout and no gift step.
    assert.ok(shown('#caaci-ev-done'));
    for (const sel of [
      '#caaci-ev-perk',
      '#caaci-ev-perk-counted',
      '#caaci-ev-perk-cta',
      '#caaci-ev-perk-closed',
    ])
      assert.equal(q(sel).hidden, true, sel);

    q('#caaci-ev-edit').click();
    q('#caaci-ev-q-dishes-o-dumplings').checked = false;
    q('#caaci-ev-q-dishes-o-tea').checked = false;
    q('#caaci-ev-q-dishes-other-text').value = 'Fruit';
    q('#caaci-ev-q-size-o-s').checked = true; // replaces Other; its text is ignored
    q('#caaci-ev-q-notes').value = ' Vegetarian, please. ';
    await submit();
    assert.deepEqual(postedBody(fetch, 1).answers, {
      dishes: { options: [], other: 'Fruit' },
      size: { option: 's' },
      phone: '217-555-0100',
      notes: 'Vegetarian, please.',
    });

    q('#caaci-ev-edit').click();
    q('#caaci-ev-q-dishes-other').checked = false;
    q('#caaci-ev-q-dishes-o-noodles').checked = true;
    await submit();
    assert.deepEqual(postedBody(fetch, 2).answers.dishes, { options: ['noodles'] }, 'no Other key');
  } finally {
    fetch.restore();
  }
});

test('event form: a required choice or text question left blank blocks the POST', async () => {
  setup({ path: '/events/spring-potluck/register/', event: null });
  member.__setSupa(supaWith(null));
  const fetch = stubApi({ get: anonGet(POTLUCK), post: () => POST_OK({ perk: null }) });
  try {
    await member.wireEventFormPage();
    const note = q('#caaci-ev-notice');
    q('#caaci-ev-email').value = 'ann@x.com';
    await submit();
    assert.equal(note.textContent, 'Answer the question: Which dishes will you bring?');
    assert.equal(document.activeElement, q('#caaci-ev-q-dishes-o-dumplings'));

    q('#caaci-ev-q-dishes-other').checked = true; // Other ticked, nothing typed
    await submit();
    assert.equal(note.textContent, 'Fill in “Other” for: Which dishes will you bring?');

    q('#caaci-ev-q-dishes-other').checked = false;
    q('#caaci-ev-q-dishes-o-noodles').checked = true;
    q('#caaci-ev-q-phone').value = '   ';
    await submit();
    assert.equal(note.textContent, 'Answer the question: Phone number');
    assert.equal(document.activeElement, q('#caaci-ev-q-phone'));
    assert.equal(posts(fetch).length, 0, 'nothing sent');

    q('#caaci-ev-q-phone').value = '217-555-0100';
    await submit();
    assert.deepEqual(postedBody(fetch).answers, {
      dishes: { options: ['noodles'] },
      phone: '217-555-0100',
    });
  } finally {
    fetch.restore();
  }
});

test('event form: the event comes from data-event, else the /events/<slug>/register/ path, else ?event=', async () => {
  const cases = [
    [
      'data-event wins over the path and the query',
      { path: '/events/lantern-walk/register/', search: '?event=other', event: 'spring-potluck' },
    ],
    [
      'the rewritten path wins over the query',
      { path: '/events/spring-potluck/register/', search: '?event=other', event: null },
    ],
    ['the path without its slash', { path: '/events/spring-potluck/register', event: null }],
    [
      '?event= on /event-register/',
      { path: '/event-register/', search: '?event=spring-potluck', event: null },
    ],
  ];
  for (const [label, where] of cases) {
    setup(where);
    member.__setSupa(supaWith(null));
    const fetch = stubApi({ get: anonGet(POTLUCK) });
    try {
      await member.wireEventFormPage();
      assert.equal(fetch.calls[0].url, '/api/event-register?event=spring-potluck', label);
      assert.ok(shown('#caaci-ev-form-card'), label);
      if (where.path === '/event-register/')
        assert.equal(
          q('#caaci-ev-login').getAttribute('href'),
          '/login-3/?next=%2Fevent-register%2F%3Fevent%3Dspring-potluck',
          'the way back keeps the query that names the event',
        );
    } finally {
      fetch.restore();
    }
  }

  setup({ path: '/event-register/', event: null });
  const fetch = stubApi();
  try {
    await member.wireEventFormPage();
    assert.equal(fetch.calls.length, 0, 'no event named, nothing asked');
    assert.ok(shown('#caaci-ev-missing'));
    assert.equal(q('#caaci-ev-loading').hidden, true);
    assert.equal(q('#caaci-ev-form-card').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: an event the API does not know (404) is "not open for registration", with no form', async () => {
  setup({ path: '/events/no-such-event/register/', event: null });
  member.__setSupa(supaWith(null));
  const fetch = stubApi({ get: () => ({ status: 404, body: { error: 'Event not found.' } }) });
  try {
    await member.wireEventFormPage();
    assert.equal(fetch.calls[0].url, '/api/event-register?event=no-such-event');
    assert.ok(shown('#caaci-ev-missing'));
    assert.match(q('#caaci-ev-missing').textContent, /This event is not open for registration/);
    assert.equal(q('#caaci-ev-missing').getAttribute('role'), 'alert');
    for (const sel of [
      '#caaci-ev-loading',
      '#caaci-ev-error',
      '#caaci-ev-closed',
      '#caaci-ev-form-card',
      '#caaci-ev-perk',
      '#caaci-ev-details',
    ])
      assert.equal(q(sel).hidden, true, sel);

    member.__setLang('zh');
    member.applyLang();
    assert.match(q('#caaci-ev-missing').textContent, /该活动未开放报名/);
  } finally {
    fetch.restore();
    member.__setLang('en');
  }
});

test('event form: a load that fails offers a retry, which brings the form', async () => {
  const failures = [
    [
      'network error, no Supabase client',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
    ['500', () => ({ status: 500, body: { error: 'boom' } })],
  ];
  for (const [label, fail] of failures) {
    setup();
    member.__setSupa(null);
    let gets = 0;
    const fetch = stubApi({
      get: (...args) => (++gets === 1 ? fail() : anonGet()(...args)),
    });
    try {
      await member.wireEventFormPage();
      assert.ok(shown('#caaci-ev-error'), label);
      assert.equal(q('#caaci-ev-error').getAttribute('role'), 'alert');
      assert.match(q('#caaci-ev-error').textContent, /couldn't load the registration form/, label);
      for (const sel of [
        '#caaci-ev-loading',
        '#caaci-ev-missing',
        '#caaci-ev-form-card',
        '#caaci-ev-perk',
      ])
        assert.equal(q(sel).hidden, true, `${label}: ${sel}`);

      q('#caaci-ev-retry').click();
      assert.ok(shown('#caaci-ev-loading'), `${label}: loading again`);
      assert.equal(q('#caaci-ev-error').hidden, true, label);
      await tick();
      assert.equal(gets, 2, label);
      assert.equal(q('#caaci-ev-loading').hidden, true, label);
      assert.ok(shown('#caaci-ev-form-card'), label);
      assert.ok(q('#caaci-ev-q-attending-o-yes'), `${label}: the questions are drawn`);

      fillForm();
      await submit();
      assert.equal(posts(fetch).length, 1, label);
      assert.ok(shown('#caaci-ev-done'), label);
    } finally {
      fetch.restore();
    }
  }
});

test('event form: a closed event (open: false) says registration has closed and draws no form', async () => {
  const CLOSED = { ...EVENT, perk: { ...MOONCAKE, deadline: PAST }, open: false };
  setup();
  member.__setSupa(supaWith(null));
  let fetch = stubApi({ get: anonGet(CLOSED) });
  try {
    await member.wireEventFormPage();
    assert.ok(shown('#caaci-ev-closed'));
    assert.match(q('#caaci-ev-closed').textContent, /Registration has closed/);
    assert.equal(
      q('#caaci-ev-title').textContent,
      'Mid-Autumn Festival 2099',
      'still says which event',
    );
    for (const sel of [
      '#caaci-ev-loading',
      '#caaci-ev-form-card',
      '#caaci-ev-perk',
      '#caaci-ev-done',
    ])
      assert.equal(q(sel).hidden, true, sel);
    assert.equal(q('#caaci-ev-questions').children.length, 0, 'no questions drawn');
    member.__setLang('zh');
    member.applyLang();
    assert.match(q('#caaci-ev-closed').textContent, /报名已截止/);
  } finally {
    fetch.restore();
    member.__setLang('en');
  }

  // Signed in and registered before it closed: their registration, but nothing to change.
  setup();
  member.__setSupa(supaWith(USER));
  fetch = stubApi({
    get: () => ({
      body: {
        event: CLOSED,
        signed_in: true,
        email: 'mei@x.com',
        registration: { registered_at: '2020-09-10T01:02:03Z', updated_at: '2020-09-11T00:00:00Z' },
      },
    }),
  });
  try {
    await member.wireEventFormPage();
    assert.ok(shown('#caaci-ev-closed'));
    assert.ok(shown('#caaci-ev-done'));
    assert.equal(q('#caaci-ev-edit-row').hidden, true, 'no "Change my answers"');
    assert.equal(q('#caaci-ev-form-card').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: the callout names the event\'s own gift, and says "event" unless the title says festival', async () => {
  const UMBRELLA = { item_en: 'umbrella', item_zh: '雨伞', deadline: FUTURE };
  setup({ path: '/events/lantern-walk/register/', event: null });
  member.__setSupa(supaWith(null));
  const fetch = stubApi({
    get: anonGet({ ...POTLUCK, slug: 'lantern-walk', title: 'Lantern Walk', perk: UMBRELLA }),
    post: () => POST_OK({ perk: UMBRELLA }),
  });
  try {
    await member.wireEventFormPage();
    assert.ok(shown('#caaci-ev-perk'));
    assert.equal(q('#caaci-ev-perk-title').textContent, 'Free umbrella');
    assert.equal(
      q('#caaci-ev-perk-text').textContent,
      'Register and create a free CAACI website account by September 27, 2:00 PM Central Time, and pick up your free umbrella at the event.',
    );
    assert.equal(
      q('#caaci-ev-perk-note').textContent,
      "You can register without an account — you just won't get the free umbrella.",
    );
    q('#caaci-ev-email').value = 'ann@x.com';
    q('#caaci-ev-q-dishes-o-tea').checked = true;
    q('#caaci-ev-q-phone').value = '217-555-0100';
    await submit();
    assert.equal(
      q('#caaci-ev-perk-cta-text').textContent,
      'One more step for a free umbrella: create a free CAACI account with the email you registered with by September 27, 2:00 PM Central Time.',
    );
    assert.doesNotMatch(document.body.textContent, /mooncake|festival/i);
  } finally {
    fetch.restore();
  }
});

test('event form: a signed-in visitor gets the email prefilled, sends a bearer token, and is counted', async () => {
  setup();
  member.__setSupa(supaWith(USER));
  const fetch = stubApi({
    get: () => ({
      body: { event: EVENT, signed_in: true, email: 'mei@x.com', registration: null },
    }),
    post: () => POST_OK({ signed_in: true }),
  });
  try {
    await member.wireEventFormPage();
    assert.equal(fetch.calls[0].options.headers.authorization, 'Bearer tok');
    assert.equal(q('#caaci-ev-email').value, 'mei@x.com');
    assert.equal(q('#caaci-ev-form-card').hidden, false, 'not registered yet');

    fillForm();
    await submit();
    assert.equal(posts(fetch)[0].options.headers.authorization, 'Bearer tok');
    assert.ok(shown('#caaci-ev-perk-counted'));
    assert.equal(q('#caaci-ev-perk-counted').textContent, '✓ Counted for a free mooncake');
    assert.equal(q('#caaci-ev-perk-cta').hidden, true);
    assert.equal(q('#caaci-ev-perk-closed').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: signed in but registered under another email, the gift step asks for an account with that email', async () => {
  setup();
  const signOuts = [];
  const supa = supaWith(USER);
  supa.auth.signOut = async () => {
    signOuts.push(true);
    return { error: null };
  };
  member.__setSupa(supa);
  const fetch = stubApi({
    get: () => ({
      body: { event: EVENT, signed_in: true, email: 'mei@x.com', registration: null },
    }),
    post: () => POST_OK({ signed_in: true, linked: false }),
  });
  try {
    await member.wireEventFormPage();
    const emailEl = q('#caaci-ev-email');
    assert.equal(emailEl.value, 'mei@x.com', 'prefilled from the account');
    assert.equal(emailEl.readOnly || emailEl.disabled, false, 'and still editable');

    fillForm({ email: 'family@x.com' });
    await submit();
    assert.equal(posts(fetch)[0].options.headers.authorization, 'Bearer tok');
    assert.equal(q('#caaci-ev-perk-counted').hidden, true, 'not counted under another email');
    assert.equal(q('#caaci-ev-perk-closed').hidden, true);
    assert.ok(shown('#caaci-ev-perk-cta'));
    const cta = q('#caaci-ev-perk-cta-text').textContent;
    assert.match(cta, /The free mooncake goes with the email you registered with/);
    assert.match(cta, /September 27, 2:00 PM Central Time/);
    assert.match(cta, /signed out/);

    q('#caaci-ev-signup').click();
    await tick();
    // Otherwise the login page would send the signed-in visitor straight back.
    assert.equal(signOuts.length, 1, 'signed out first');
    assert.equal(sessionStorage.getItem('caaci-signup-email'), 'family@x.com');
    assert.equal(location.href, '/login-3/?signup=1&next=%2Fmid_autumn_festival_form%2F');
    assert.doesNotMatch(location.href, /family|@|%40/);

    location.href = '';
    q('#caaci-ev-login').click();
    await tick();
    assert.equal(signOuts.length, 2);
    assert.equal(location.href, '/login-3/?next=%2Fmid_autumn_festival_form%2F');
  } finally {
    fetch.restore();
  }
});

// Signed in as mei@x.com, registered as family@x.com: the success state offers
// signup, which signs out first. `auth` overrides methods on the stub.
async function registeredUnderAnotherEmail(auth) {
  setup();
  const supa = supaWith(USER); // getSession keeps answering with the session
  Object.assign(supa.auth, auth);
  member.__setSupa(supa);
  const fetch = stubApi({
    get: () => ({
      body: { event: EVENT, signed_in: true, email: 'mei@x.com', registration: null },
    }),
    post: () => POST_OK({ signed_in: true, linked: false }),
  });
  await member.wireEventFormPage();
  fillForm({ email: 'family@x.com' });
  await submit();
  return fetch;
}
// Settles pending promises without setTimeout, which the test below mocks.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

test('event form: a sign-out that never settles still clears the stored session, locally, before going to login', async (t) => {
  const signOutArgs = [];
  const fetch = await registeredUnderAnotherEmail({
    storageKey: 'sb-test-auth-token',
    signOut: (...args) => {
      signOutArgs.push(args);
      return new Promise(() => {}); // the logout request hangs
    },
  });
  try {
    localStorage.setItem('sb-test-auth-token', '{"access_token":"tok"}');
    localStorage.setItem('unrelated-key', 'kept');
    t.mock.timers.enable({ apis: ['setTimeout'] });

    q('#caaci-ev-signup').click();
    await flush();
    assert.deepEqual(signOutArgs, [[{ scope: 'local' }]], 'this device only');
    assert.equal(location.href, '', 'still waiting on the sign-out');

    t.mock.timers.tick(3500);
    await flush();
    assert.equal(localStorage.getItem('sb-test-auth-token'), null, 'the stored session is gone');
    assert.equal(localStorage.getItem('unrelated-key'), 'kept');
    assert.equal(location.href, '/login-3/?signup=1&next=%2Fmid_autumn_festival_form%2F');
  } finally {
    fetch.restore();
  }
});

test('event form: a sign-out that fails leaves no session behind, found by key pattern when the client names none', async () => {
  const fetch = await registeredUnderAnotherEmail({
    signOut: async () => ({
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
    }),
  });
  try {
    localStorage.setItem('sb-abcdef-auth-token', '{"access_token":"tok"}');
    localStorage.setItem('sb-abcdef-auth-token-code-verifier', 'kept');
    q('#caaci-ev-login').click();
    await tick();
    assert.equal(localStorage.getItem('sb-abcdef-auth-token'), null);
    assert.equal(localStorage.getItem('sb-abcdef-auth-token-code-verifier'), 'kept');
    assert.equal(location.href, '/login-3/?next=%2Fmid_autumn_festival_form%2F');
  } finally {
    fetch.restore();
  }
});

test('event form: a signed-in visitor who already registered sees the success state straight away', async () => {
  setup();
  member.__setSupa(supaWith(USER));
  const fetch = stubApi({
    get: () => ({
      body: {
        event: EVENT,
        signed_in: true,
        email: 'mei@x.com',
        registration: { registered_at: '2026-09-10T01:02:03Z', updated_at: '2026-09-11T00:00:00Z' },
      },
    }),
  });
  try {
    await member.wireEventFormPage();
    assert.equal(posts(fetch).length, 0);
    assert.equal(q('#caaci-ev-form-card').hidden, true);
    assert.ok(shown('#caaci-ev-done'));
    // 01:02:03 UTC on the 10th is still the evening of the 9th in Champaign.
    assert.match(q('#caaci-ev-done-time').textContent, /Sep 9, 2026\D+8:02:03 PM Central Time/);
    assert.equal(q('#caaci-ev-done-already').hidden, true);
    assert.ok(shown('#caaci-ev-perk-counted'));
    assert.ok(shown('#caaci-ev-edit-row'));

    q('#caaci-ev-edit').click();
    assert.equal(
      q('#caaci-ev-form-card').hidden,
      false,
      '"Change my answers" brings the form back',
    );
    assert.equal(q('#caaci-ev-done').hidden, true);
    assert.equal(q('#caaci-ev-email').value, 'mei@x.com');
    assert.ok(q('#caaci-ev-q-names'), 'with the questions drawn');
  } finally {
    fetch.restore();
  }
});

test('event form: after the gift deadline the callout says mooncake sign-up closed, and registering still works', async () => {
  const closedPerk = { ...MOONCAKE, deadline: PAST };
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi({
    get: anonGet({ ...EVENT, perk: closedPerk }),
    post: () => POST_OK({ perk: closedPerk }),
  });
  try {
    await member.wireEventFormPage();
    const perk = q('#caaci-ev-perk');
    assert.ok(perk.classList.contains('alert-secondary'));
    assert.equal(perk.classList.contains('alert-warning'), false);
    assert.equal(q('#caaci-ev-perk-title').textContent, 'Free mooncake sign-up has closed');
    assert.match(perk.textContent, /sign-up has closed/);
    assert.match(perk.textContent, /September 27, 2:00 PM Central Time/);
    assert.match(perk.textContent, /still register below/);
    assert.equal(q('#caaci-ev-perk-note').hidden, true, 'no "without an account" line once closed');

    fillForm();
    await submit();
    assert.ok(shown('#caaci-ev-done'));
    assert.ok(shown('#caaci-ev-perk-closed'));
    assert.equal(q('#caaci-ev-perk-closed').textContent, 'Free mooncake sign-up has closed.');
    assert.equal(q('#caaci-ev-perk-cta').hidden, true, 'no signup push for a closed perk');
    assert.equal(q('#caaci-ev-perk-counted').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: in Chinese the title is title_zh, the questions are in Chinese, and the mooncake copy and times say 美国中部时间, never GMT-5', async () => {
  const PERK_ZH =
    '9月27日下午2点（美国中部时间）前报名，并免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份月饼。';
  const NOTE_ZH = '不注册账户也可以报名参加活动，只是领不到月饼。';
  member.__setLang('zh');
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi();
  try {
    member.applyLang();
    await member.wireEventFormPage();
    assert.equal(q('#caaci-ev-title').textContent, '中秋节');
    assert.equal(q('#caaci-ev-desc').textContent, '在丰收的明月下，一起分享月饼。');
    assert.ok(shown('#caaci-ev-desc'));
    assert.equal(
      q('#caaci-ev-q-attending-o-yes').closest('fieldset').querySelector('legend').textContent,
      '您能参加吗？',
    );
    assert.equal(q('label[for="caaci-ev-q-attending-o-yes"]').textContent, '能，我会参加');
    assert.equal(q('label[for="caaci-ev-q-names"]').textContent, '参加者的姓名是？');
    assert.equal(q('label[for="caaci-ev-q-heard_from-other"]').textContent, '其他：');
    assert.equal(q('#caaci-ev-q-heard_from-other-text').placeholder, '请注明');

    // The user-approved copy, rebuilt from 月饼 and the deadline (2:00 PM in Chicago).
    assert.equal(q('#caaci-ev-perk-title').textContent, '免费领月饼');
    assert.equal(q('#caaci-ev-perk-text').textContent, PERK_ZH);
    assert.equal(q('#caaci-ev-perk-note').textContent, NOTE_ZH);
    assert.ok(shown('#caaci-ev-perk-note'));

    fillForm({ attending: null });
    await submit();
    assert.equal(q('#caaci-ev-notice').textContent, '请回答：您能参加吗？');

    fillForm();
    await submit();
    assert.equal(q('#caaci-ev-done-title').textContent, '报名成功');
    // 20:04:05 UTC is 3:04:05 in the afternoon in Champaign.
    assert.match(q('#caaci-ev-done-time').textContent, /2026年9月13日 下午3:04:05（美国中部时间）/);
    assert.equal(
      q('#caaci-ev-perk-cta-text').textContent,
      '领取免费月饼还差一步：请在9月27日下午2点（美国中部时间）前，用报名时填写的邮箱免费注册 CAACI 账户。',
    );
    assert.doesNotMatch(document.body.textContent, /GMT|CDT/);
  } finally {
    fetch.restore();
    member.__setLang('en');
  }
});
