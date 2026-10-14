import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/volunteer.js';
import { fakeRequest, mockFetch, fakeEnv, turnstileRoute, withTurnstile } from './helpers.js';

const API = 'https://beta.caaciorg.com/api/volunteer';

// Two published events far enough in the future that they stay upcoming
// whenever the suite runs, and one that is over.
const LUNAR = {
  id: 'e1',
  slug: 'lunar-new-year',
  title: 'Lunar New Year Gala',
  title_zh: '春节晚会',
  starts_at: '2099-02-10T01:00:00+00:00',
  ends_at: '2099-02-10T05:00:00+00:00',
  location: 'Krannert Center, Urbana, IL',
};
const PICNIC = {
  id: 'e2',
  slug: 'summer-picnic',
  title: 'Summer Picnic',
  title_zh: null,
  starts_at: '2099-07-04T16:00:00+00:00',
  ends_at: null,
  location: null,
};
const PUBLIC_LUNAR = {
  slug: LUNAR.slug,
  title: LUNAR.title,
  title_zh: LUNAR.title_zh,
  description: null,
  description_zh: null,
  starts_at: LUNAR.starts_at,
  ends_at: LUNAR.ends_at,
  location: LUNAR.location,
  questions: null,
};
const PUBLIC_PICNIC = {
  slug: PICNIC.slug,
  title: PICNIC.title,
  title_zh: null,
  description: null,
  description_zh: null,
  starts_at: PICNIC.starts_at,
  ends_at: null,
  location: null,
  questions: null,
};

// The volunteer questions (0035): one event's own form, and the site's default
// template as a form_templates row.
const SHIFTS = {
  id: 'shifts',
  type: 'multi',
  label_en: 'When can you help?',
  label_zh: '您可以帮忙的时间段？',
  required: true,
  options: [
    { id: 'setup', label_en: '12:00–2:00 PM (setup)', label_zh: '12:00–2:00 PM（布置）' },
    { id: 'late', label_en: '4:30–7:00 PM', label_zh: '4:30–7:00 PM' },
  ],
  other: false,
};
const DEFAULT_Q = [
  {
    id: 'interests',
    type: 'multi',
    label_en: 'Areas of interest',
    label_zh: '感兴趣的志愿领域',
    required: false,
    options: [{ id: 'stage', label_en: 'Stage management', label_zh: '舞台管理' }],
    other: true,
  },
  {
    id: 'notes',
    type: 'textarea',
    label_en: 'Skills or notes',
    label_zh: '专长或备注',
    required: false,
  },
];
const DEFAULT_TEMPLATE = [{ questions: DEFAULT_Q }];

const VALID = {
  name: 'Pat Lee',
  email: 'pat@example.com',
  phone: '217-555-0101',
  message: 'Happy to help with setup.',
  _hp: '',
};

const resendEnv = () =>
  fakeEnv({
    RESEND_API_KEY: 're_1',
    NOTIFY_FROM: 'events@caaci.example',
    NOTIFY_TO: 'staff@caaci.example',
  });

// Routes the auth lookup, the events select (which answers with whatever the
// `in.(…)` list or `eq.` asks for out of `events`), the default volunteer
// template (form_templates, 0035), the event_volunteers read before each write
// (`prior`: the rows already stored, or a function of the URL) and upsert, and
// Resend.
function route({
  user = null,
  events = [LUNAR, PICNIC],
  upsert,
  prior = [],
  templates = [],
  resend,
  hostname = new URL(API).hostname,
} = {}) {
  return (url, options = {}) => {
    // The Turnstile check, which every POST now passes through. The token has
    // to come from the host the request was made to, so a test that posts from
    // another origin says so here too.
    const human = turnstileRoute(url, 'volunteer', { hostname });
    if (human) return human;
    if (url.includes('/auth/v1/user')) return user ? { body: user } : { ok: false, status: 401 };
    if (url.includes('/rest/v1/events')) {
      const decoded = decodeURIComponent(url);
      const one = decoded.match(/slug=eq\.([^&]+)/);
      if (one) return { body: events.filter((e) => e.slug === one[1]) };
      const m = decoded.match(/slug=in\.\(([^)]*)\)/);
      if (!m) return { body: events };
      const want = new Set(m[1].split(','));
      return { body: events.filter((e) => want.has(e.slug)) };
    }
    if (url.includes('/rest/v1/form_templates')) return { body: templates };
    if (url.includes('/rest/v1/event_volunteers')) {
      if (options.method !== 'POST')
        return typeof prior === 'function' ? prior(url) : { body: prior };
      return upsert ?? { body: [{ id: 'v1', ...JSON.parse(options.body) }] };
    }
    if (url.includes('api.resend.com')) {
      if (typeof resend === 'function') return resend();
      return resend ?? { body: { id: 'email_1' } };
    }
    return { body: {} };
  };
}

const post = (body, { headers = {}, url = API, env = resendEnv() } = {}) =>
  onRequestPost({ request: fakeRequest({ url, body: withTurnstile(body), headers }), env });
const get = ({ query = '', headers = {}, env = fakeEnv() } = {}) =>
  onRequestGet({ request: fakeRequest({ url: `${API}${query}`, headers }), env });

const callsTo = (fetch, part) => fetch.calls.filter((c) => c.url.includes(part));
const writes = (fetch) =>
  callsTo(fetch, '/rest/v1/event_volunteers').filter((c) => c.options.method === 'POST');
const reads = (fetch) =>
  callsTo(fetch, '/rest/v1/event_volunteers').filter((c) => c.options.method !== 'POST');
const upserts = (fetch) => writes(fetch).map((c) => JSON.parse(c.options.body));
const emails = (fetch) => callsTo(fetch, 'api.resend.com').map((c) => JSON.parse(c.options.body));

// ----------------------------------------------------------------- GET ----

test('volunteer GET: the published, not-yet-over events, oldest first, and nothing about volunteers', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get();
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { events: [PUBLIC_LUNAR, PUBLIC_PICNIC], questions: [] });

    const [call] = callsTo(fetch, '/rest/v1/events');
    const url = decodeURIComponent(call.url);
    assert.match(
      url,
      /select=id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,volunteer_questions/,
    );
    assert.match(url, /published=eq\.true/);
    // (ends_at ?? starts_at) >= now, as a PostgREST filter.
    assert.match(url, /or=\(ends_at\.gte\.[^,]+,and\(ends_at\.is\.null,starts_at\.gte\.[^)]+\)\)/);
    assert.match(url, /order=starts_at\.asc/);
    assert.match(url, /limit=20/);
    assert.equal(callsTo(fetch, '/rest/v1/event_volunteers').length, 0);
  } finally {
    fetch.restore();
  }
});

test('volunteer GET: the event id is never exposed; no events is an empty list', async () => {
  const fetch = mockFetch(route({ events: [] }));
  try {
    const r = await get();
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { events: [], questions: [] });
  } finally {
    fetch.restore();
  }
  const f2 = mockFetch(route());
  try {
    const { events } = await (await get()).json();
    for (const e of events) assert.equal('id' in e, false, 'the event id is not exposed');
  } finally {
    f2.restore();
  }
});

// ------------------------------------------------- the volunteer forms (0035) ----

test('volunteer GET: each event carries its own volunteer questions, normalized, or null; the default template rides along', async () => {
  const own = { ...LUNAR, volunteer_questions: [{ ...SHIFTS, extra: 'dropped' }] };
  const broken = { ...PICNIC, volunteer_questions: [{ id: 'x' }] }; // hand-edited, invalid
  const fetch = mockFetch(route({ events: [own, broken], templates: DEFAULT_TEMPLATE }));
  try {
    const out = await (await get()).json();
    assert.deepEqual(out.events[0].questions, [SHIFTS]);
    assert.equal(
      out.events[1].questions,
      null,
      'an invalid column reads as no questions of its own',
    );
    assert.deepEqual(out.questions, DEFAULT_Q);
    const t = decodeURIComponent(callsTo(fetch, '/rest/v1/form_templates')[0].url);
    assert.match(t, /kind=eq\.volunteer/);
    assert.match(t, /is_default=eq\.true/);
    assert.equal(reads(fetch).length, 0, 'the list never reads a volunteer row');
  } finally {
    fetch.restore();
  }
});

test('volunteer GET ?event=: one event for its page; unknown, past or malformed is 404', async () => {
  let fetch = mockFetch(route({ templates: DEFAULT_TEMPLATE }));
  try {
    const r = await get({ query: '?event=summer-picnic' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      events: [PUBLIC_PICNIC],
      questions: DEFAULT_Q,
      signed_in: false,
    });
    assert.match(
      decodeURIComponent(callsTo(fetch, '/rest/v1/events')[0].url),
      /slug=eq\.summer-picnic/,
    );
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0, 'no token, no auth lookup');
  } finally {
    fetch.restore();
  }
  for (const query of ['?event=no-such-event', '?event=Lunar%20New%20Year', '?event=a,b)']) {
    fetch = mockFetch(route());
    try {
      const r = await get({ query });
      assert.equal(r.status, 404, query);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
    } finally {
      fetch.restore();
    }
  }
});

test('volunteer GET ?event=: signed in, the caller’s own sign-up for it — by the login email only', async () => {
  const stored = {
    name: 'Pat Lee',
    phone: '217-555-0101',
    answers: { shifts: { options: ['setup'] } },
    created_at: '2026-09-10T12:00:00+00:00',
    updated_at: '2026-09-11T12:00:00+00:00',
  };
  let fetch = mockFetch(
    route({
      user: { id: 'u1', email: 'Pat@Example.com' },
      prior: [stored],
      templates: DEFAULT_TEMPLATE,
    }),
  );
  try {
    const r = await get({
      query: '?event=lunar-new-year',
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.signed_in, true);
    assert.equal(out.email, 'Pat@Example.com');
    assert.deepEqual(out.signup, stored);
    const [read] = reads(fetch);
    assert.match(
      read.url,
      /event_volunteers\?select=name,phone,answers,created_at,updated_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1&offset=0$/,
    );
  } finally {
    fetch.restore();
  }
  // No sign-up -> null; a bad token is the anonymous answer with no lookup.
  fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
  try {
    const out = await (
      await get({ query: '?event=lunar-new-year', headers: { authorization: 'Bearer good' } })
    ).json();
    assert.equal(out.signup, null);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ user: null }));
  try {
    const out = await (
      await get({ query: '?event=lunar-new-year', headers: { authorization: 'Bearer bad' } })
    ).json();
    assert.deepEqual(out, { events: [PUBLIC_LUNAR], questions: [], signed_in: false });
    assert.equal(reads(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: one event with its own questions -> answers checked against those and stored', async () => {
  const own = { ...LUNAR, volunteer_questions: [SHIFTS] };
  let fetch = mockFetch(route({ events: [own, PICNIC], templates: DEFAULT_TEMPLATE }));
  try {
    const r = await post({
      ...VALID,
      events: ['lunar-new-year'],
      answers: { shifts: { options: ['late', 'setup'] }, notes: 'ignored: not asked' },
    });
    assert.equal(r.status, 200);
    const [row] = upserts(fetch);
    // In the question's own order; an answer to a question the form does not ask is dropped.
    assert.deepEqual(row.answers, { shifts: { options: ['setup', 'late'] } });
    assert.equal(
      callsTo(fetch, '/rest/v1/form_templates').length,
      0,
      'the default template is not read when the event has its own questions',
    );
  } finally {
    fetch.restore();
  }
  // A required question left out is refused before anything is written.
  fetch = mockFetch(route({ events: [own, PICNIC] }));
  try {
    const r = await post({ ...VALID, events: ['lunar-new-year'], answers: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Answer the question: When can you help?' });
    assert.equal(callsTo(fetch, '/rest/v1/event_volunteers').length, 0);
    assert.equal(emails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: no event, several events, or one without its own questions -> the default template', async () => {
  const own = { ...LUNAR, volunteer_questions: [SHIFTS] };
  for (const events of [undefined, ['summer-picnic'], ['lunar-new-year', 'summer-picnic']]) {
    const fetch = mockFetch(route({ events: [own, PICNIC], templates: DEFAULT_TEMPLATE }));
    try {
      const r = await post({
        ...VALID,
        events,
        answers: {
          interests: { options: ['stage'], other: 'Photos' },
          shifts: { options: ['setup'] },
        },
      });
      assert.equal(r.status, 200, JSON.stringify(events));
      for (const row of upserts(fetch))
        assert.deepEqual(row.answers, { interests: { options: ['stage'], other: 'Photos' } });
      assert.equal(callsTo(fetch, '/rest/v1/form_templates').length, 1);
    } finally {
      fetch.restore();
    }
  }
  // With no default template at all, answers are simply not asked for.
  const fetch = mockFetch(route());
  try {
    const r = await post({ ...VALID, answers: { interests: { options: ['stage'] } } });
    assert.equal(r.status, 200);
    assert.deepEqual(upserts(fetch)[0].answers, {});
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: answers merge into the stored ones, key by key; already and created_at report the earlier sign-up', async () => {
  const own = { ...LUNAR, volunteer_questions: [SHIFTS] };
  const stored = {
    answers: { interests: { options: ['stage'] }, shifts: { options: ['late'] } },
    created_at: '2026-09-10T12:00:00+00:00',
  };
  const fetch = mockFetch(route({ events: [own, PICNIC], prior: [stored] }));
  try {
    const r = await post({
      ...VALID,
      events: ['lunar-new-year'],
      answers: { shifts: { options: ['setup'] } },
    });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.already, true);
    assert.equal(out.created_at, stored.created_at);
    const [read] = reads(fetch);
    assert.match(
      read.url,
      /select=answers,created_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1&offset=0$/,
    );
    assert.deepEqual(upserts(fetch)[0].answers, {
      interests: { options: ['stage'] },
      shifts: { options: ['setup'] },
    });
  } finally {
    fetch.restore();
  }
  // The "wherever needed" row is looked up with is.null, which eq cannot say.
  const f2 = mockFetch(route());
  try {
    await post(VALID);
    const [read] = reads(f2);
    assert.match(read.url, /event_id=is\.null&email=eq\.pat%40example\.com&limit=1&offset=0$/);
    const out = upserts(f2)[0];
    assert.deepEqual(out.answers, {});
  } finally {
    f2.restore();
  }
});

test('volunteer POST: the staff notification lists the answers, escaped; the thank-you carries none of them', async () => {
  const own = { ...LUNAR, volunteer_questions: [SHIFTS, DEFAULT_Q[1]] };
  const fetch = mockFetch(route({ events: [own, PICNIC] }));
  try {
    await post({
      ...VALID,
      events: ['lunar-new-year'],
      answers: { shifts: { options: ['setup'] }, notes: 'Bring <b>ladders</b>' },
    });
    const [staff, mine] = emails(fetch);
    assert.match(staff.html, /<b>When can you help\?:<\/b> 12:00–2:00 PM \(setup\)/);
    assert.match(staff.html, /<b>Skills or notes:<\/b> Bring &lt;b&gt;ladders&lt;\/b&gt;/);
    assert.equal(mine.html.includes('ladders'), false);
    assert.equal(mine.html.includes('12:00'), false);
  } finally {
    fetch.restore();
  }
});

test('volunteer GET: a DB error -> 500', async () => {
  const fetch = mockFetch((url) =>
    url.includes('/rest/v1/events') ? { ok: false, status: 503, body: 'down' } : { body: {} },
  );
  try {
    const r = await get();
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase select events: 503 down' });
  } finally {
    fetch.restore();
  }
});

// ---------------------------------------------------------------- POST ----

test('volunteer POST: invalid JSON -> 400 with no fetch', async () => {
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

test('volunteer POST: honeypot is silently accepted with no DB call and no email', async () => {
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

for (const [label, patch, error] of [
  ['name missing', { name: undefined }, 'Enter your name.'],
  ['name blank', { name: '   ' }, 'Enter your name.'],
  ['name over 120 chars', { name: 'n'.repeat(121) }, 'Enter your name.'],
  ['email missing', { email: undefined }, 'Enter a valid email address.'],
  ['email without @', { email: 'pat.example.com' }, 'Enter a valid email address.'],
  ['email with a space', { email: 'pat lee@example.com' }, 'Enter a valid email address.'],
  ['email without a dot in the domain', { email: 'pat@example' }, 'Enter a valid email address.'],
  [
    'email over 254 chars',
    { email: `${'a'.repeat(243)}@example.com` },
    'Enter a valid email address.',
  ],
  ['phone over 40 chars', { phone: '1'.repeat(41) }, 'That phone number is too long.'],
  ['message over 2000 chars', { message: 'x'.repeat(2001) }, 'That message is too long.'],
  ['events not an array', { events: { slug: 'lunar-new-year' } }, 'Invalid events.'],
  [
    'more than 20 events',
    { events: Array.from({ length: 21 }, (_, i) => `event-${i}`) },
    'Too many events selected.',
  ],
  ['order: name before email', { name: '', email: 'bad' }, 'Enter your name.'],
]) {
  test(`volunteer POST: ${label} -> 400 with no fetch`, async () => {
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

test('volunteer POST: no events -> one row with event_id null, the "wherever needed" sign-up', async () => {
  const fetch = mockFetch(route());
  try {
    const before = Date.now();
    const r = await post({ ...VALID, email: '  Pat@Example.COM ', name: '  Pat Lee  ' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      events: [],
      signed_in: false,
      linked: false,
      already: false,
      created_at: null,
    });

    // No slugs to resolve, so no event lookup at all.
    assert.equal(callsTo(fetch, '/rest/v1/events').length, 0);
    // One read (the answers to merge into) and one write.
    assert.equal(reads(fetch).length, 1);
    const calls = writes(fetch);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://db.example/rest/v1/event_volunteers?on_conflict=event_id,email',
    );
    assert.equal(
      calls[0].options.headers.prefer,
      'resolution=merge-duplicates,return=representation',
    );
    const { updated_at, ...row } = upserts(fetch)[0];
    assert.deepEqual(row, {
      event_id: null,
      name: 'Pat Lee',
      email: 'pat@example.com',
      phone: '217-555-0101',
      message: 'Happy to help with setup.',
      source: 'volunteer',
      answers: {},
    });
    for (const key of ['created_at', 'member_id'])
      assert.equal(key in row, false, `${key} is never sent`);
    assert.ok(Date.parse(updated_at) >= before - 1000 && Date.parse(updated_at) <= Date.now());
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0, 'no token, no auth lookup');
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: an empty phone is stored as null, an empty message is left alone, and an empty events list is "any event"', async () => {
  for (const events of [undefined, [], null]) {
    const fetch = mockFetch(route());
    try {
      const r = await post({
        name: 'Pat',
        email: 'pat@example.com',
        phone: ' ',
        message: '',
        events,
      });
      assert.equal(r.status, 200);
      const [row] = upserts(fetch);
      assert.equal(row.phone, null);
      assert.equal(row.event_id, null);
      // An upsert sends the whole row, so a null message would overwrite the
      // note this person may have left last time (and the registration form,
      // which has no message field at all, would wipe it on every sign-up).
      assert.equal('message' in row, false, 'no message, no message column');
    } finally {
      fetch.restore();
    }
  }
});

test('volunteer POST: one row per chosen event, de-duplicated, in the order given', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({
      ...VALID,
      events: ['summer-picnic', 'lunar-new-year', 'summer-picnic'],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      events: [
        { slug: 'summer-picnic', title: 'Summer Picnic', title_zh: null },
        { slug: 'lunar-new-year', title: 'Lunar New Year Gala', title_zh: '春节晚会' },
      ],
      signed_in: false,
      linked: false,
      already: false,
      created_at: null,
    });

    // One lookup for the whole list, filtered to the events people may pick.
    const lookups = callsTo(fetch, '/rest/v1/events');
    assert.equal(lookups.length, 1);
    const url = decodeURIComponent(lookups[0].url);
    assert.match(url, /slug=in\.\(summer-picnic,lunar-new-year\)/);
    assert.match(url, /published=eq\.true/);
    assert.match(url, /or=\(ends_at\.gte\./);

    const rows = upserts(fetch);
    assert.equal(rows.length, 2, 'no duplicate row for the repeated slug');
    assert.deepEqual(
      rows.map((r2) => r2.event_id),
      ['e2', 'e1'],
    );
    for (const row of rows) {
      assert.equal(row.email, 'pat@example.com');
      assert.equal(row.name, 'Pat Lee');
      assert.equal(row.source, 'volunteer');
    }
  } finally {
    fetch.restore();
  }
});

for (const [label, events] of [
  ['an unknown slug', ['lunar-new-year', 'no-such-event']],
  ['a past or unpublished event the filter drops', ['last-years-gala']],
  ['a slug no slugify() could produce', ['Lunar New Year']],
  ['a slug with PostgREST list syntax in it', ['a,b)']],
]) {
  test(`volunteer POST: ${label} -> 400 Event not found, with no write and no email`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, events });
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
      assert.equal(callsTo(fetch, '/rest/v1/event_volunteers').length, 0);
      assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
      assert.equal(emails(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  });
}

// Signed in, the row is linked to the account only when the form email is the
// account's own login email, exactly like /api/event-register.
for (const [label, loginEmail, formEmail, linked] of [
  ['same email -> linked, member_id sent', 'pat@example.com', 'pat@example.com', true],
  ['same email in another case -> linked', 'Pat@Example.COM', '  pat@EXAMPLE.com ', true],
  ['different email -> no member_id key', 'someone@else.com', 'pat@example.com', false],
  ['login without an email -> no member_id key', undefined, 'pat@example.com', false],
]) {
  test(`volunteer POST: signed in, ${label}`, async () => {
    const fetch = mockFetch(route({ user: { id: 'u1', email: loginEmail } }));
    try {
      const r = await post(
        { ...VALID, email: formEmail, events: ['lunar-new-year'] },
        { headers: { authorization: 'Bearer good-token' } },
      );
      assert.equal(r.status, 200);
      const out = await r.json();
      assert.equal(out.signed_in, true);
      assert.equal(out.linked, linked);
      const auth = callsTo(fetch, '/auth/v1/user')[0];
      assert.equal(auth.options.headers.authorization, 'Bearer good-token');
      assert.equal(auth.options.headers.apikey, 'anon-key');
      const [row] = upserts(fetch);
      assert.equal(row.email, 'pat@example.com', 'the form email is stored, not the login email');
      assert.equal('member_id' in row, linked);
      assert.equal(row.member_id, linked ? 'u1' : undefined);
    } finally {
      fetch.restore();
    }
  });
}

test('volunteer POST: an invalid token is treated as anonymous, not an error', async () => {
  const fetch = mockFetch(route({ user: null }));
  try {
    const r = await post(VALID, { headers: { authorization: 'Bearer expired' } });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.equal(out.ok, true);
    assert.equal(out.signed_in, false);
    assert.equal(out.linked, false);
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 1);
    assert.equal('member_id' in upserts(fetch)[0], false);
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: staff get a reply-to notification, the volunteer a bilingual thank-you', async () => {
  const fetch = mockFetch(route({ hostname: 'caaciorg.com' })); // posted from that origin below
  try {
    const r = await post(
      { ...VALID, email: 'Pat@Example.com', events: ['lunar-new-year', 'summer-picnic'] },
      { url: 'https://caaciorg.com/api/volunteer' },
    );
    assert.equal(r.status, 200);

    const [staff, mine] = emails(fetch);
    assert.equal(staff.to, 'staff@caaci.example');
    assert.equal(staff.reply_to, 'pat@example.com');
    assert.equal(staff.subject, 'CAACI volunteer sign-up: Pat Lee');
    assert.match(staff.html, /<b>Phone:<\/b> 217-555-0101/);
    assert.match(staff.html, /Happy to help with setup\./);
    assert.match(staff.html, /春节晚会 · Lunar New Year Gala/);
    assert.match(staff.html, /Summer Picnic/);

    assert.equal(mine.to, 'pat@example.com', 'to the volunteer, lower-cased');
    assert.equal(mine.from, 'events@caaci.example');
    assert.equal(mine.reply_to, 'staff@caaci.example');
    assert.equal(mine.subject, 'CAACI 志愿者报名确认 / Thank you for volunteering');
    assert.match(mine.html, /感谢您报名志愿者/);
    assert.match(mine.html, /Thank you for volunteering/);
    assert.match(mine.html, /春节晚会 · Lunar New Year Gala/);
    assert.match(mine.html, /<li[^>]*>Summer Picnic<\/li>/, 'no " · " when there is no title_zh');
    // Links follow the request's origin, so they survive a domain move.
    assert.match(mine.html, /href="https:\/\/caaciorg\.com\/events\/"/);
    assert.equal(mine.html.includes('beta.caaciorg.com'), false);
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: with no events the thank-you says "any event"', async () => {
  const fetch = mockFetch(route());
  try {
    await post(VALID);
    const [staff, mine] = emails(fetch);
    assert.match(staff.html, /<b>Events:<\/b><br>Any event/);
    assert.match(mine.html, /任何活动均可 · Any event/);
  } finally {
    fetch.restore();
  }
});

// The endpoint will mail any address anyone types into it, so the volunteer's
// own email may carry nothing they typed — it would be CAACI-branded phishing
// copy. The staff notification does carry it, escaped.
test('volunteer POST: typed text is escaped in the staff email and absent from the volunteer email', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({
      name: 'Your account is suspended <b>verify</b>',
      email: 'victim+verify-at-evil.example@gmail.com',
      phone: '<img src=x onerror=alert(1)>',
      message: 'Call now: http://evil.example & <a href="https://evil.example">here</a>',
    });
    assert.equal(r.status, 200);
    const [row] = upserts(fetch);
    assert.match(row.message, /Call now/, 'the message is still stored as typed');

    const [staff, mine] = emails(fetch);
    for (const raw of ['<b>verify</b>', '<img src=x', '<a href=', '&amp;'])
      assert.equal(staff.html.includes(raw), raw === '&amp;', `staff email: ${raw}`);
    assert.match(staff.html, /&lt;b&gt;verify&lt;\/b&gt;/, 'markup is escaped, not stripped');
    assert.match(staff.html, /&lt;img src=x onerror=alert\(1\)&gt;/);

    for (const typed of ['evil', 'suspended', 'verify', 'Call now', 'victim', 'onerror']) {
      assert.equal(mine.html.includes(typed), false, `volunteer email contains "${typed}"`);
      assert.equal(mine.subject.includes(typed), false, `subject contains "${typed}"`);
    }
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: an event title with markup in it is escaped in both emails', async () => {
  const evil = { ...LUNAR, title: 'Gala <script>alert(1)</script>', title_zh: null };
  const fetch = mockFetch(route({ events: [evil] }));
  try {
    await post({ ...VALID, events: ['lunar-new-year'] });
    for (const mail of emails(fetch)) {
      assert.equal(mail.html.includes('<script>'), false);
      assert.match(mail.html, /Gala &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    }
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: an email failure still returns 200 and keeps the sign-up', async () => {
  for (const resend of [
    () => {
      throw new Error('network down');
    },
    () => ({ ok: false, status: 429, body: 'rate limited' }),
  ]) {
    const fetch = mockFetch(route({ resend }));
    try {
      const r = await post(VALID);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).ok, true);
      assert.equal(upserts(fetch).length, 1, 'the row was still written');
      assert.equal(callsTo(fetch, 'api.resend.com').length, 2, 'both sends were attempted');
    } finally {
      fetch.restore();
    }
  }
});

test('volunteer POST: with email unconfigured the sign-up still succeeds', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post(VALID, { env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(callsTo(fetch, 'api.resend.com').length, 0);
  } finally {
    fetch.restore();
  }
});

test('volunteer POST: a DB error -> 500 with the message, and no email', async () => {
  const fetch = mockFetch(route({ upsert: { ok: false, status: 500, body: 'boom' } }));
  try {
    const r = await post(VALID);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase upsert event_volunteers: 500 boom' });
    assert.equal(emails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});
