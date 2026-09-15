import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/volunteer.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

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
  starts_at: LUNAR.starts_at,
  ends_at: LUNAR.ends_at,
  location: LUNAR.location,
};
const PUBLIC_PICNIC = {
  slug: PICNIC.slug,
  title: PICNIC.title,
  title_zh: null,
  starts_at: PICNIC.starts_at,
  ends_at: null,
  location: null,
};

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
// `in.(…)` list asks for out of `events`), the event_volunteers upsert and Resend.
function route({ user = null, events = [LUNAR, PICNIC], upsert, resend } = {}) {
  return (url, options = {}) => {
    if (url.includes('/auth/v1/user')) return user ? { body: user } : { ok: false, status: 401 };
    if (url.includes('/rest/v1/events')) {
      const m = decodeURIComponent(url).match(/slug=in\.\(([^)]*)\)/);
      if (!m) return { body: events };
      const want = new Set(m[1].split(','));
      return { body: events.filter((e) => want.has(e.slug)) };
    }
    if (url.includes('/rest/v1/event_volunteers'))
      return upsert ?? { body: [{ id: 'v1', ...JSON.parse(options.body) }] };
    if (url.includes('api.resend.com')) {
      if (typeof resend === 'function') return resend();
      return resend ?? { body: { id: 'email_1' } };
    }
    return { body: {} };
  };
}

const post = (body, { headers = {}, url = API, env = resendEnv() } = {}) =>
  onRequestPost({ request: fakeRequest({ url, body, headers }), env });
const get = ({ env = fakeEnv() } = {}) => onRequestGet({ request: fakeRequest({ url: API }), env });

const callsTo = (fetch, part) => fetch.calls.filter((c) => c.url.includes(part));
const upserts = (fetch) =>
  callsTo(fetch, '/rest/v1/event_volunteers').map((c) => JSON.parse(c.options.body));
const emails = (fetch) => callsTo(fetch, 'api.resend.com').map((c) => JSON.parse(c.options.body));

// ----------------------------------------------------------------- GET ----

test('volunteer GET: the published, not-yet-over events, oldest first, and nothing about volunteers', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get();
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { events: [PUBLIC_LUNAR, PUBLIC_PICNIC] });

    const [call] = callsTo(fetch, '/rest/v1/events');
    const url = decodeURIComponent(call.url);
    assert.match(url, /select=id,slug,title,title_zh,starts_at,ends_at,location/);
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
    assert.deepEqual(await r.json(), { events: [] });
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
    assert.deepEqual(await r.json(), { ok: true, events: [], signed_in: false, linked: false });

    // No slugs to resolve, so no event lookup at all.
    assert.equal(callsTo(fetch, '/rest/v1/events').length, 0);
    const calls = callsTo(fetch, '/rest/v1/event_volunteers');
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
  const fetch = mockFetch(route());
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
