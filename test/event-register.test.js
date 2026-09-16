import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/event-register.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const API = 'https://beta.caaciorg.com/api/event-register';
const FIRST_AT = '2026-09-14T15:04:05.123456+00:00';
const EARLIER_AT = '2026-09-02T08:30:12.5+00:00';

// The Mid-Autumn form as 0018 stores it. The event and its free-gift deadline
// are far in the future so registration and the account offer are open
// whenever the suite runs.
const QUESTIONS = [
  {
    id: 'attending',
    type: 'single',
    required: true,
    label_en: 'Can you attend?',
    label_zh: '您能参加吗？',
    options: [
      { id: 'yes', label_en: "Yes, I'll be there", label_zh: '能，我会参加' },
      { id: 'no', label_en: "Sorry, can't make it", label_zh: '抱歉，无法参加' },
    ],
    other: false,
  },
  {
    id: 'names',
    type: 'textarea',
    required: true,
    label_en: 'What are the names of people attending?',
    label_zh: '参加者的姓名是？',
  },
  {
    id: 'heard_from',
    type: 'single',
    required: false,
    label_en: 'How did you hear about this event?',
    label_zh: '您是从哪里得知本次活动的？',
    options: [
      { id: 'website', label_en: 'Website', label_zh: '网站' },
      { id: 'friend', label_en: 'Friend', label_zh: '朋友' },
      { id: 'newsletter', label_en: 'Newsletter', label_zh: '简报' },
      { id: 'social', label_en: 'Social Media', label_zh: '社交媒体' },
    ],
    other: true,
  },
  {
    id: 'meal',
    type: 'single',
    required: false,
    label_en: 'Would you like to purchase a meal?',
    label_zh: '您想购买餐食吗？',
    options: [
      { id: 'yes', label_en: 'Yes', label_zh: '是' },
      { id: 'no', label_en: 'No', label_zh: '否' },
    ],
    other: false,
  },
];

const EVENT = {
  id: 'e1',
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 中秋节',
  title_zh: '中秋节',
  description: 'Mooncakes and lanterns',
  description_zh: '月饼和灯笼',
  starts_at: '2099-09-27T19:00:00+00:00',
  ends_at: '2099-09-27T23:00:00+00:00',
  location: 'Siebel Center for Design, 1208 S Fourth St, Champaign, IL',
  perk_deadline: '2099-09-20T04:59:59+00:00',
  perk_item_zh: '月饼',
  perk_item_en: 'mooncake',
  registration_questions: QUESTIONS,
  published: true,
};
const PERK = { item_en: 'mooncake', item_zh: '月饼', deadline: EVENT.perk_deadline };
const PAST = { starts_at: '2000-01-01T19:00:00+00:00', ends_at: '2000-01-01T23:00:00+00:00' };

const ANSWERS = {
  attending: { option: 'yes' },
  names: 'Pat Lee, Sam Lee',
  heard_from: { option: 'friend' },
  meal: { option: 'yes' },
};
const VALID = { event: 'mid-autumn-festival', email: 'pat@example.com', answers: ANSWERS, _hp: '' };

const resendEnv = () =>
  fakeEnv({
    RESEND_API_KEY: 're_1',
    NOTIFY_FROM: 'events@caaci.example',
    NOTIFY_TO: 'staff@caaci.example',
  });

// Routes the auth lookup (valid token -> user), the events lookup, the
// event_registrations selects (by email / by member_id) and upsert, and Resend.
// The upsert echoes the row it was sent, plus the id and created_at the DB adds.
function route({
  user = null,
  event = EVENT,
  byEmail = null,
  byMember = null,
  volunteer = null,
  upsert,
  volunteerUpsert,
  resend,
} = {}) {
  return (url, options = {}) => {
    if (url.includes('/auth/v1/user')) return user ? { body: user } : { ok: false, status: 401 };
    if (url.includes('/rest/v1/events')) return { body: event ? [event] : [] };
    if (url.includes('/rest/v1/event_registrations')) {
      if (options.method === 'POST')
        return (
          upsert ?? { body: [{ id: 'r1', created_at: FIRST_AT, ...JSON.parse(options.body) }] }
        );
      if (url.includes('member_id=eq.')) return { body: byMember ? [byMember] : [] };
      return { body: byEmail ? [byEmail] : [] };
    }
    if (url.includes('/rest/v1/event_volunteers')) {
      if (options.method === 'POST')
        return volunteerUpsert ?? { body: [{ id: 'v1', ...JSON.parse(options.body) }] };
      return { body: volunteer ? [volunteer] : [] };
    }
    if (url.includes('api.resend.com')) {
      if (typeof resend === 'function') return resend();
      return resend ?? { body: { id: 'email_1' } };
    }
    return { body: {} };
  };
}

const post = (body, { headers = {}, url = API, env = resendEnv() } = {}) =>
  onRequestPost({ request: fakeRequest({ url, body, headers }), env });
const get = (query, { headers = {}, env = fakeEnv() } = {}) =>
  onRequestGet({ request: fakeRequest({ url: `${API}${query}`, headers }), env });

const callsTo = (fetch, part) => fetch.calls.filter((c) => c.url.includes(part));
const regSelects = (fetch) =>
  callsTo(fetch, '/rest/v1/event_registrations').filter((c) => c.options.method !== 'POST');
const upsertCall = (fetch) =>
  callsTo(fetch, '/rest/v1/event_registrations').find((c) => c.options.method === 'POST');
const upsertBody = (fetch) => JSON.parse(upsertCall(fetch).options.body);
const volunteerCalls = (fetch) => callsTo(fetch, '/rest/v1/event_volunteers');
const volunteerUpsertBody = (fetch) =>
  JSON.parse(volunteerCalls(fetch).find((c) => c.options.method === 'POST').options.body);
const emails = (fetch) => callsTo(fetch, 'api.resend.com').map((c) => JSON.parse(c.options.body));

const EVENT_SELECT =
  /\?select=id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,perk_deadline,perk_item_zh,perk_item_en,registration_questions,published&slug=eq\.mid-autumn-festival&limit=1$/;

// ---------------------------------------------------------------- POST ----

test('event-register POST: invalid JSON -> 400 with no fetch', async () => {
  for (const body of ['{bad', 'null', '"text"']) {
    const fetch = mockFetch(route());
    try {
      const r = await post(body);
      assert.equal(r.status, 400, body);
      assert.deepEqual(await r.json(), { error: 'invalid JSON' });
      assert.equal(fetch.calls.length, 0);
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: honeypot is silently accepted with no DB call and no email', async () => {
  // Checked before any other field, so a bot's otherwise-invalid body gets the same answer.
  for (const body of [
    { ...VALID, _hp: 'x' },
    { _hp: 'x', email: 'nope' },
  ]) {
    const fetch = mockFetch(route());
    try {
      const r = await post(body);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ok: true });
      assert.equal(fetch.calls.length, 0);
    } finally {
      fetch.restore();
    }
  }
});

// Checked before the event is looked up: no request of any kind.
for (const [label, patch, error] of [
  ['event missing', { event: undefined }, 'event required'],
  ['event blank', { event: '   ' }, 'event required'],
  ['email missing', { email: undefined }, 'Enter a valid email address.'],
  ['email without @', { email: 'pat.example.com' }, 'Enter a valid email address.'],
  ['email with a space', { email: 'pat lee@example.com' }, 'Enter a valid email address.'],
  ['email without a dot in the domain', { email: 'pat@example' }, 'Enter a valid email address.'],
  [
    'email over 254 chars',
    { email: `${'a'.repeat(243)}@example.com` },
    'Enter a valid email address.',
  ],
  ['order: event before email', { event: '', email: 'bad' }, 'event required'],
  [
    'order: email before answers',
    { email: 'bad', answers: { attending: { option: 'maybe' } } },
    'Enter a valid email address.',
  ],
]) {
  test(`event-register POST: ${label} -> 400 with no fetch`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, ...patch });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error });
      assert.equal(fetch.calls.length, 0, 'no DB call, auth call or email on validation failure');
    } finally {
      fetch.restore();
    }
  });
}

// Checked against the event's own questions, so after the event lookup — but
// still before any auth call, registration read or write, or email.
for (const [label, answers, error] of [
  ['answers missing', undefined, 'Answer the question: Can you attend?'],
  ['answers not an object', 'yes', 'Invalid answers.'],
  [
    'required choice missing',
    { ...ANSWERS, attending: undefined },
    'Answer the question: Can you attend?',
  ],
  [
    'required names blank',
    { ...ANSWERS, names: '  \n ' },
    'Answer the question: What are the names of people attending?',
  ],
  [
    'names over 2000 chars',
    { ...ANSWERS, names: 'x'.repeat(2001) },
    'Invalid answer for: What are the names of people attending?',
  ],
  [
    'unknown option',
    { ...ANSWERS, heard_from: { option: 'tv' } },
    'Invalid answer for: How did you hear about this event?',
  ],
  [
    'display label instead of the option id',
    { ...ANSWERS, heard_from: { option: 'Website' } },
    'Invalid answer for: How did you hear about this event?',
  ],
  [
    'Other over 200 chars',
    { ...ANSWERS, heard_from: { other: 'x'.repeat(201) } },
    'Invalid answer for: How did you hear about this event?',
  ],
  [
    'Other where the question has none',
    { ...ANSWERS, meal: { other: 'dinner' } },
    'Invalid answer for: Would you like to purchase a meal?',
  ],
  [
    'the old flat fields',
    { attending: 'yes', names: 'Pat' },
    'Invalid answer for: Can you attend?',
  ],
]) {
  test(`event-register POST: ${label} -> 400 with no registration write, auth call or email`, async () => {
    const fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
    try {
      const r = await post({ ...VALID, answers }, { headers: { authorization: 'Bearer good' } });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error });
      assert.equal(callsTo(fetch, '/rest/v1/events').length, 1);
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
      assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
      assert.equal(emails(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  });
}

for (const [label, event] of [
  ['unpublished event', { ...EVENT, published: false }],
  ['nonexistent event', null],
  ['event that takes no registrations', { ...EVENT, registration_questions: null }],
]) {
  test(`event-register POST: ${label} -> 404 with no registration write, auth call or email`, async () => {
    const fetch = mockFetch(route({ event, user: { id: 'u1', email: 'pat@example.com' } }));
    try {
      const r = await post(VALID, { headers: { authorization: 'Bearer good' } });
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
      assert.match(callsTo(fetch, '/rest/v1/events')[0].url, EVENT_SELECT);
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
      assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
      assert.equal(emails(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: after the event ends -> 409, checked before the answers', async () => {
  for (const [label, event, answers] of [
    ['ended', { ...EVENT, ...PAST }, ANSWERS],
    ['no end, started', { ...EVENT, ...PAST, ends_at: null }, ANSWERS],
    ['ended, with invalid answers', { ...EVENT, ...PAST }, { attending: { option: 'maybe' } }],
  ]) {
    const fetch = mockFetch(route({ event, user: { id: 'u1', email: 'pat@example.com' } }));
    try {
      const r = await post({ ...VALID, answers }, { headers: { authorization: 'Bearer good' } });
      assert.equal(r.status, 409, label);
      assert.deepEqual(await r.json(), { error: 'Registration for this event has closed.' });
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0, label);
      assert.equal(callsTo(fetch, '/auth/v1/user').length, 0, label);
      assert.equal(emails(fetch).length, 0, label);
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: a hand-edited, invalid question list is a 500, not a registration', async () => {
  const fetch = mockFetch(route({ event: { ...EVENT, registration_questions: [{ id: 'X' }] } }));
  try {
    const r = await post(VALID);
    assert.equal(r.status, 500);
    assert.match(
      (await r.json()).error,
      /registration form is invalid: Question 1 has an invalid id/,
    );
    assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: anonymous first registration upserts answers on (event_id, email) and nothing else', async () => {
  const fetch = mockFetch(route());
  try {
    const before = Date.now();
    const r = await post({
      ...VALID,
      email: '  Pat@Example.COM ',
      answers: {
        ...ANSWERS,
        names: '  Pat Lee, Sam Lee \n',
        heard_from: { other: '  Poster at the library  ' },
        not_a_question: 'dropped',
      },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      already: false,
      registered_at: FIRST_AT,
      signed_in: false,
      linked: false,
      volunteer: false,
      perk: PERK,
    });

    const existing = regSelects(fetch);
    assert.equal(existing.length, 1);
    assert.match(
      existing[0].url,
      /\/rest\/v1\/event_registrations\?select=id,created_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1$/,
    );

    const { url, options } = upsertCall(fetch);
    assert.equal(url, 'https://db.example/rest/v1/event_registrations?on_conflict=event_id,email');
    assert.equal(options.headers.prefer, 'resolution=merge-duplicates,return=representation');
    const { updated_at, ...row } = JSON.parse(options.body);
    assert.deepEqual(row, {
      event_id: 'e1',
      email: 'pat@example.com',
      answers: {
        attending: { option: 'yes' },
        names: 'Pat Lee, Sam Lee',
        heard_from: { other: 'Poster at the library' },
        meal: { option: 'yes' },
      },
    });
    for (const key of [
      'created_at',
      'member_id',
      'attending',
      'attendee_names',
      'heard_from',
      'wants_meal',
    ])
      assert.equal(key in row, false, `${key} is never sent`);
    assert.ok(Date.parse(updated_at) >= before - 1000 && Date.parse(updated_at) <= Date.now());
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0, 'no token, no auth lookup');
  } finally {
    fetch.restore();
  }
});

test('event-register POST: optional questions may be left out, and the length limits are inclusive', async () => {
  const fetch = mockFetch(route());
  try {
    const email = `${'a'.repeat(242)}@example.com`;
    assert.equal(email.length, 254);
    const r = await post({
      ...VALID,
      email,
      answers: { attending: { option: 'no' }, names: 'n'.repeat(2000) },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(upsertBody(fetch).answers, {
      attending: { option: 'no' },
      names: 'n'.repeat(2000),
    });
  } finally {
    fetch.restore();
  }
});

test('event-register POST: a number answer is stored as a number, within the question’s bounds', async () => {
  const guests = {
    id: 'guests',
    type: 'number',
    required: true,
    label_en: 'How many guests?',
    label_zh: '几位客人？',
    min: 1,
    max: 6,
  };
  const event = { ...EVENT, registration_questions: [...QUESTIONS, guests] };
  let fetch = mockFetch(route({ event }));
  try {
    // From the page's <input type="number"> the value arrives as text.
    const r = await post({ ...VALID, answers: { ...ANSWERS, guests: '3' } });
    assert.equal(r.status, 200);
    assert.deepEqual(upsertBody(fetch).answers, { ...ANSWERS, guests: 3 });
  } finally {
    fetch.restore();
  }
  for (const [label, guests, error] of [
    ['above the bound', 7, 'Invalid answer for: How many guests?'],
    ['a fraction', '2.5', 'Invalid answer for: How many guests?'],
    ['left out', undefined, 'Answer the question: How many guests?'],
  ]) {
    fetch = mockFetch(route({ event }));
    try {
      const r = await post({ ...VALID, answers: { ...ANSWERS, guests } });
      assert.equal(r.status, 400, label);
      assert.deepEqual(await r.json(), { error }, label);
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0, 'nothing written');
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: an event with no gift answers perk null; with no perk_deadline the deadline is the start', async () => {
  let fetch = mockFetch(route({ event: { ...EVENT, perk_item_en: null } }));
  try {
    assert.equal((await (await post(VALID)).json()).perk, null);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ event: { ...EVENT, perk_deadline: null } }));
  try {
    assert.equal((await (await post(VALID)).json()).perk.deadline, EVENT.starts_at);
  } finally {
    fetch.restore();
  }
});

// Signed in, the row is linked to the account only when the form email is the
// account's own login email; registering any other address is stored exactly
// like a signed-out submission, so it cannot be counted against the account.
for (const [label, loginEmail, formEmail, linked] of [
  ['same email -> linked, member_id sent', 'pat@example.com', 'pat@example.com', true],
  ['same email in another case -> linked', 'Pat@Example.COM', '  pat@EXAMPLE.com ', true],
  ['different email -> no member_id key', 'someone@else.com', 'pat@example.com', false],
  ['login without an email -> no member_id key', undefined, 'pat@example.com', false],
]) {
  test(`event-register POST: signed in, ${label}`, async () => {
    const fetch = mockFetch(route({ user: { id: 'u1', email: loginEmail } }));
    try {
      const r = await post(
        { ...VALID, email: formEmail },
        { headers: { authorization: 'Bearer good-token' } },
      );
      assert.equal(r.status, 200);
      const out = await r.json();
      assert.equal(out.signed_in, true);
      assert.equal(out.linked, linked);
      const auth = callsTo(fetch, '/auth/v1/user')[0];
      assert.equal(auth.options.headers.authorization, 'Bearer good-token');
      assert.equal(auth.options.headers.apikey, 'anon-key');
      const row = upsertBody(fetch);
      assert.equal(row.email, 'pat@example.com', 'the form email is stored, not the login email');
      assert.equal('member_id' in row, linked);
      assert.equal(row.member_id, linked ? 'u1' : undefined);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: an invalid token is treated as anonymous, not an error', async () => {
  const fetch = mockFetch(route({ user: null }));
  try {
    const r = await post(VALID, { headers: { authorization: 'Bearer expired' } });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.ok, true);
    assert.equal(out.signed_in, false);
    assert.equal(out.linked, false);
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 1);
    assert.equal('member_id' in upsertBody(fetch), false);
    assert.equal(emails(fetch).length, 1, 'still a first registration');
  } finally {
    fetch.restore();
  }
});

test('event-register POST: resubmission -> already=true, keeps the first created_at, sends no email', async () => {
  // The upsert returns a different created_at than the existing row so the
  // test can tell which one the response reports.
  const fetch = mockFetch(route({ byEmail: { id: 'r1', created_at: EARLIER_AT } }));
  try {
    const r = await post({ ...VALID, answers: { attending: { option: 'no' }, names: 'Pat' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      already: true,
      registered_at: EARLIER_AT,
      signed_in: false,
      linked: false,
      volunteer: false,
      perk: PERK,
    });
    const row = upsertBody(fetch);
    assert.equal('created_at' in row, false);
    assert.deepEqual(row.answers.attending, { option: 'no' }, 'the new answers are still written');
    assert.equal(emails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: first registration emails the registrant with links from the request origin', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post(
      { ...VALID, email: 'Pat@Example.com' },
      { url: 'https://caaciorg.com/api/event-register' },
    );
    assert.equal(r.status, 200);

    const sent = emails(fetch);
    assert.equal(sent.length, 1);
    const [mail] = sent;
    assert.equal(mail.to, 'pat@example.com', 'to the registrant, lower-cased');
    assert.equal(mail.from, 'events@caaci.example');
    assert.equal(mail.reply_to, 'staff@caaci.example');
    assert.equal(mail.subject, '中秋节 · 报名确认 / Registration confirmed');

    const { html } = mail;
    assert.match(
      html,
      /src="https:\/\/db\.example\/storage\/v1\/object\/public\/media\/email\/caaci-logo\.png"/,
    );
    // Links are built from the request's origin, so they follow a domain move.
    assert.match(html, /href="https:\/\/caaciorg\.com\/login-3\/"/);
    assert.equal(html.includes('beta.caaciorg.com'), false);
    assert.match(
      html,
      /Create a free CAACI website account with this email by September 19, 11:59 PM Central Time/,
    );
    assert.match(html, /9月19日晚上11点59分（美国中部时间）前用此邮箱免费注册/);
    assert.match(
      html,
      /您能参加吗？ · Can you attend\?<\/td><td[^>]*>能，我会参加 · Yes, I&#39;ll be there<\/td>/,
    );
    assert.match(
      html,
      /购买餐食吗？ · Would you like to purchase a meal\?<\/td><td[^>]*>是 · Yes<\/td>/,
    );
  } finally {
    fetch.restore();
  }
});

// Anyone can make the endpoint mail any address from CAACI, so nothing the
// registrant typed may reach the email: it would be branded phishing copy.
test('event-register POST: the email carries no registrant-typed text, only option labels', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({
      ...VALID,
      email: 'victim+verify-at-evil.example@gmail.com',
      answers: {
        attending: { option: 'yes' },
        names:
          'Your account is suspended, verify at https://evil.example/login <a href="https://evil.example">here</a>',
        heard_from: { other: 'Call now: http://evil.example <b>urgent</b>' },
        meal: { option: 'yes' },
      },
    });
    assert.equal(r.status, 200);
    const row = upsertBody(fetch);
    assert.match(row.answers.names, /suspended/, 'the answers are still stored');
    assert.match(row.answers.heard_from.other, /Call now/);

    const [mail] = emails(fetch);
    assert.equal(mail.to, 'victim+verify-at-evil.example@gmail.com');
    for (const typed of [
      'evil',
      'suspended',
      'verify',
      'urgent',
      'Call now',
      'victim',
      'here</a>',
    ]) {
      assert.equal(mail.html.includes(typed), false, `email body contains "${typed}"`);
      assert.equal(mail.subject.includes(typed), false, `subject contains "${typed}"`);
    }
    assert.match(
      mail.html,
      /您是从哪里得知本次活动的？ · How did you hear about this event\?<\/td><td[^>]*>其他 · Other<\/td>/,
    );
  } finally {
    fetch.restore();
  }
});

test('event-register POST: a linked first registration is told it counts, with no sign-up link', async () => {
  const fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
  try {
    const r = await post(VALID, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 200);
    const { html } = emails(fetch)[0];
    assert.match(html, /counts for your free mooncake/);
    assert.equal(html.includes('/login-3/'), false);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: signed in but registering another address, the email offers the sign-up link', async () => {
  const fetch = mockFetch(route({ user: { id: 'u1', email: 'someone@else.com' } }));
  try {
    const r = await post(VALID, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 200);
    const { html } = emails(fetch)[0];
    assert.equal(/counts for your free mooncake/.test(html), false);
    assert.match(html, /href="https:\/\/beta\.caaciorg\.com\/login-3\/"/);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: after the gift deadline, or with no gift, the confirmation offers none', async () => {
  for (const event of [
    { ...EVENT, perk_deadline: '2000-01-01T00:00:00+00:00' },
    { ...EVENT, perk_item_zh: null, perk_item_en: null },
  ]) {
    const fetch = mockFetch(route({ event }));
    try {
      const r = await post(VALID);
      assert.equal(r.status, 200);
      const { html } = emails(fetch)[0];
      assert.equal(/mooncake|月饼/.test(html), false);
      assert.equal(html.includes('/login-3/'), false);
      assert.match(
        html,
        /能，我会参加 · Yes, I&#39;ll be there/,
        'the answers are still confirmed',
      );
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: an email failure still returns 200', async () => {
  const fetch = mockFetch(
    route({
      resend: () => {
        throw new Error('network down');
      },
    }),
  );
  try {
    const r = await post(VALID);
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.ok, true);
    assert.equal(out.already, false);
    assert.equal(callsTo(fetch, 'api.resend.com').length, 1, 'the send was attempted');
  } finally {
    fetch.restore();
  }
});

test('event-register POST: a DB error -> 500 with the message, and no email', async () => {
  const fetch = mockFetch(route({ upsert: { ok: false, status: 500, body: 'boom' } }));
  try {
    const r = await post(VALID);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase upsert event_registrations: 500 boom' });
    assert.equal(emails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

// ----------------------------------------------------------------- GET ----

const PUBLIC_EVENT = {
  slug: EVENT.slug,
  title: EVENT.title,
  title_zh: EVENT.title_zh,
  description: EVENT.description,
  description_zh: EVENT.description_zh,
  starts_at: EVENT.starts_at,
  ends_at: EVENT.ends_at,
  location: EVENT.location,
  perk: PERK,
  questions: QUESTIONS,
  open: true,
};

test('event-register GET: no slug -> 400 with no fetch', async () => {
  for (const query of ['', '?event=', '?event=%20%20']) {
    const fetch = mockFetch(route());
    try {
      const r = await get(query);
      assert.equal(r.status, 400, query);
      assert.deepEqual(await r.json(), { error: 'event required' });
      assert.equal(fetch.calls.length, 0);
    } finally {
      fetch.restore();
    }
  }
});

for (const [label, event] of [
  ['unpublished event', { ...EVENT, published: false }],
  ['nonexistent event', null],
  ['event that takes no registrations', { ...EVENT, registration_questions: null }],
]) {
  test(`event-register GET: ${label} -> 404`, async () => {
    const fetch = mockFetch(route({ event, user: { id: 'u1', email: 'pat@example.com' } }));
    try {
      const r = await get('?event=mid-autumn-festival', {
        headers: { authorization: 'Bearer good' },
      });
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register GET: anonymous -> public event, gift, questions, open, and signed_in=false', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get('?event=mid-autumn-festival');
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.deepEqual(out, { event: PUBLIC_EVENT, signed_in: false });
    assert.equal('id' in out.event, false, 'the event id is not exposed');
    assert.equal('published' in out.event, false);
    assert.match(callsTo(fetch, '/rest/v1/events')[0].url, EVENT_SELECT);
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
    assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: questions come back normalized; an empty list is an open form', async () => {
  const messy = [{ ...QUESTIONS[1], label_en: '  Names?  ', extra: 'x' }];
  let fetch = mockFetch(route({ event: { ...EVENT, registration_questions: messy } }));
  try {
    const { event } = await (await get('?event=mid-autumn-festival')).json();
    assert.deepEqual(event.questions, [{ ...QUESTIONS[1], label_en: 'Names?' }]);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ event: { ...EVENT, registration_questions: [] } }));
  try {
    const r = await get('?event=mid-autumn-festival');
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).event.questions, []);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: a past event is still shown, with open=false', async () => {
  const fetch = mockFetch(route({ event: { ...EVENT, ...PAST } }));
  try {
    const r = await get('?event=mid-autumn-festival');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).event.open, false);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: gift null without both names; deadline is the start with no perk_deadline', async () => {
  for (const [event, perk] of [
    [{ ...EVENT, perk_item_zh: '' }, null],
    [
      { ...EVENT, perk_deadline: null },
      { ...PERK, deadline: EVENT.starts_at },
    ],
    [{ ...EVENT, title_zh: undefined, description_zh: undefined }, PERK],
  ]) {
    const fetch = mockFetch(route({ event }));
    try {
      const out = await (await get('?event=mid-autumn-festival')).json();
      assert.deepEqual(out.event.perk, perk);
      assert.equal(out.event.title_zh, event.title_zh ?? null);
      assert.equal(out.event.description_zh, event.description_zh ?? null);
    } finally {
      fetch.restore();
    }
  }
});

test('event-register GET: an invalid token gets exactly the anonymous answer', async () => {
  const fetch = mockFetch(route({ user: null }));
  try {
    const r = await get('?event=mid-autumn-festival', { headers: { authorization: 'Bearer bad' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { event: PUBLIC_EVENT, signed_in: false });
    assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: signed in, registration found by lower-cased login email', async () => {
  const fetch = mockFetch(
    route({
      user: { id: 'u1', email: 'Pat@Example.com' },
      byEmail: { created_at: FIRST_AT, updated_at: '2026-09-15T00:00:00+00:00' },
      byMember: { created_at: EARLIER_AT, updated_at: EARLIER_AT },
    }),
  );
  try {
    const r = await get('?event=mid-autumn-festival', {
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      event: PUBLIC_EVENT,
      signed_in: true,
      email: 'Pat@Example.com',
      registration: { registered_at: FIRST_AT, updated_at: '2026-09-15T00:00:00+00:00' },
      volunteer: null,
    });
    const lookups = regSelects(fetch);
    assert.equal(lookups.length, 1, 'no member_id lookup once the email matched');
    assert.match(
      lookups[0].url,
      /\?select=created_at,updated_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1$/,
    );
  } finally {
    fetch.restore();
  }
});

test('event-register GET: signed in, falls back to member_id with a separate eq lookup (no or= filter)', async () => {
  const fetch = mockFetch(
    route({
      user: { id: 'u1', email: 'a,b(c)@example.com' },
      byMember: { created_at: EARLIER_AT, updated_at: FIRST_AT },
    }),
  );
  try {
    const r = await get('?event=mid-autumn-festival', {
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).registration, {
      registered_at: EARLIER_AT,
      updated_at: FIRST_AT,
    });
    const lookups = regSelects(fetch);
    assert.equal(lookups.length, 2);
    assert.match(lookups[0].url, /&event_id=eq\.e1&email=eq\.a%2Cb\(c\)%40example\.com&limit=1$/);
    assert.match(lookups[1].url, /&event_id=eq\.e1&member_id=eq\.u1&limit=1$/);
    for (const c of lookups) assert.equal(c.url.includes('or='), false);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: signed in with no registration -> registration null', async () => {
  const fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
  try {
    const r = await get('?event=mid-autumn-festival', {
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.signed_in, true);
    assert.equal(out.email, 'pat@example.com');
    assert.equal(out.registration, null);
    assert.equal(regSelects(fetch).length, 2);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: a DB error -> 500', async () => {
  const fetch = mockFetch((url) =>
    url.includes('/rest/v1/events') ? { ok: false, status: 503, body: 'down' } : { body: {} },
  );
  try {
    const r = await get('?event=mid-autumn-festival');
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase select events: 503 down' });
  } finally {
    fetch.restore();
  }
});

// ----------------------------------------------- the volunteer extension ----
// "I'd also like to volunteer at this event" on the registration form writes an
// event_volunteers row (0021) next to the registration, source 'registration'.

test('event-register POST: no volunteer field -> volunteer false and no event_volunteers call', async () => {
  for (const volunteer of [undefined, null]) {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, volunteer });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).volunteer, false);
      assert.equal(volunteerCalls(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: volunteer false removes the sign-up, after the registration is saved', async () => {
  const fetch = mockFetch(route({ volunteer: { name: 'Pat Lee', phone: null } }));
  try {
    const r = await post({ ...VALID, volunteer: false });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).volunteer, false);

    // The page only sends `false` when the box it pre-filled was un-ticked, so
    // this is the one way someone can take themselves off the list again.
    const calls = volunteerCalls(fetch);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'DELETE');
    assert.equal(
      calls[0].url,
      'https://db.example/rest/v1/event_volunteers?event_id=eq.e1&email=eq.pat%40example.com',
    );
    // The registration is what they came for: it is saved first either way.
    assert.ok(
      fetch.calls.indexOf(upsertCall(fetch)) < fetch.calls.indexOf(calls[0]),
      'registration written before the sign-up is dropped',
    );
  } finally {
    fetch.restore();
  }
});

for (const [label, volunteer, error] of [
  ['name missing', { phone: '217-555-0101' }, 'Enter your name to volunteer.'],
  ['name blank', { name: '  ', phone: '' }, 'Enter your name to volunteer.'],
  ['volunteer: true with no name', true, 'Enter your name to volunteer.'],
  ['name over 120 chars', { name: 'n'.repeat(121) }, 'That name is too long.'],
  ['phone over 40 chars', { name: 'Pat', phone: '1'.repeat(41) }, 'That phone number is too long.'],
]) {
  test(`event-register POST: volunteer ${label} -> 400 with no registration write or email`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, volunteer });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error });
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0, 'checked first');
      assert.equal(volunteerCalls(fetch).length, 0);
      assert.equal(emails(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: volunteer -> a registration row and a sign-up on (event_id, email)', async () => {
  const fetch = mockFetch(route());
  try {
    const before = Date.now();
    const r = await post({
      ...VALID,
      email: '  Pat@Example.COM ',
      volunteer: { name: '  Pat Lee  ', phone: ' 217-555-0101 ' },
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).volunteer, true);

    const calls = volunteerCalls(fetch);
    // One read (what source is already on the row?) and one upsert.
    assert.equal(calls.length, 2);
    const write = calls.find((c) => c.options.method === 'POST');
    assert.equal(
      write.url,
      'https://db.example/rest/v1/event_volunteers?on_conflict=event_id,email',
    );
    assert.equal(write.options.headers.prefer, 'resolution=merge-duplicates,return=representation');
    const { updated_at, ...row } = volunteerUpsertBody(fetch);
    assert.deepEqual(row, {
      event_id: 'e1',
      name: 'Pat Lee',
      email: 'pat@example.com',
      phone: '217-555-0101',
      source: 'registration',
    });
    // This form has no message field, so it must not send one: a null would
    // wipe the "how I can help" note the same person left on /volunteer/.
    for (const key of ['created_at', 'member_id', 'message'])
      assert.equal(key in row, false, `${key} is never sent`);
    assert.ok(Date.parse(updated_at) >= before - 1000 && Date.parse(updated_at) <= Date.now());
  } finally {
    fetch.restore();
  }
});

test('event-register POST: an existing volunteer-page sign-up keeps its source', async () => {
  for (const [existing, source] of [
    [{ source: 'volunteer' }, 'volunteer'],
    [{ source: 'registration' }, 'registration'],
    [null, 'registration'],
  ]) {
    const fetch = mockFetch(route({ volunteer: existing }));
    try {
      const r = await post({ ...VALID, volunteer: { name: 'Pat Lee' } });
      assert.equal(r.status, 200);
      // An upsert has to send source, so without reading the row first this
      // box would relabel a /volunteer/ sign-up as a registration one and the
      // admin list would credit the wrong form.
      assert.equal(volunteerUpsertBody(fetch).source, source);
      const read = volunteerCalls(fetch).find((c) => c.options.method !== 'POST');
      assert.match(
        decodeURIComponent(read.url),
        /select=source&event_id=eq\.e1&email=eq\.pat@example\.com/,
      );
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: an omitted volunteer phone is stored as null', async () => {
  const fetch = mockFetch(route());
  try {
    await post({ ...VALID, volunteer: { name: 'Pat Lee' } });
    assert.equal(volunteerUpsertBody(fetch).phone, null);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: the sign-up is linked to the account on the same rule as the registration', async () => {
  for (const [loginEmail, linked] of [
    ['pat@example.com', true],
    ['someone@else.com', false],
  ]) {
    const fetch = mockFetch(route({ user: { id: 'u1', email: loginEmail } }));
    try {
      const r = await post(
        { ...VALID, volunteer: { name: 'Pat Lee' } },
        { headers: { authorization: 'Bearer good' } },
      );
      assert.equal(r.status, 200);
      const out = await r.json();
      assert.equal(out.linked, linked);
      assert.equal(out.volunteer, true);
      const row = volunteerUpsertBody(fetch);
      assert.equal('member_id' in row, linked);
      assert.equal(row.member_id, linked ? 'u1' : undefined);
    } finally {
      fetch.restore();
    }
  }
});

test('event-register POST: the sign-up is written only after the registration succeeds', async () => {
  const fetch = mockFetch(route({ upsert: { ok: false, status: 500, body: 'boom' } }));
  try {
    const r = await post({ ...VALID, volunteer: { name: 'Pat Lee' } });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase upsert event_registrations: 500 boom' });
    assert.equal(volunteerCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: signed in, the sign-up for (event_id, email) comes back', async () => {
  const fetch = mockFetch(
    route({
      user: { id: 'u1', email: 'Pat@Example.com' },
      volunteer: { name: 'Pat Lee', phone: '217-555-0101', created_at: EARLIER_AT },
    }),
  );
  try {
    const r = await get('?event=mid-autumn-festival', {
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).volunteer, {
      name: 'Pat Lee',
      phone: '217-555-0101',
      created_at: EARLIER_AT,
    });
    const [lookup] = volunteerCalls(fetch);
    assert.match(
      lookup.url,
      /\/rest\/v1\/event_volunteers\?select=name,phone,created_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1$/,
    );
  } finally {
    fetch.restore();
  }
});

test('event-register GET: no sign-up -> volunteer null; signed out, no volunteer key at all', async () => {
  let fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
  try {
    const out = await (
      await get('?event=mid-autumn-festival', { headers: { authorization: 'Bearer good' } })
    ).json();
    assert.equal(out.volunteer, null);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ volunteer: { name: 'Pat Lee', phone: null, created_at: FIRST_AT } }));
  try {
    const out = await (await get('?event=mid-autumn-festival')).json();
    assert.equal('volunteer' in out, false, 'nothing about any address when signed out');
    assert.equal(volunteerCalls(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});
