import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/event-register.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const API = 'https://beta.caaciorg.com/api/event-register';
const FIRST_AT = '2026-09-14T15:04:05.123456+00:00';
const EARLIER_AT = '2026-09-02T08:30:12.5+00:00';

// 2:00–6:00 PM in Champaign (CDT = UTC-5). The mooncake deadline is far in the
// future so the "create an account" offer is open whenever the suite runs.
const EVENT = {
  id: 'e1',
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 中秋节',
  description: 'Mooncakes and lanterns',
  starts_at: '2026-09-27T19:00:00+00:00',
  ends_at: '2026-09-27T23:00:00+00:00',
  location: 'Siebel Center for Design, 1208 S Fourth St, Champaign, IL',
  perk_deadline: '2099-09-20T04:59:59+00:00',
  published: true,
};

const VALID = {
  event: 'mid-autumn-festival',
  email: 'pat@example.com',
  attending: 'yes',
  names: 'Pat Lee, Sam Lee',
  heard_from: 'friend',
  heard_from_other: '',
  wants_meal: 'yes',
  _hp: '',
};

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
  upsert,
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
const emails = (fetch) => callsTo(fetch, 'api.resend.com').map((c) => JSON.parse(c.options.body));

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

const INVALID = [
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
  ['attending missing', { attending: undefined }, 'Tell us whether you can attend.'],
  ['attending not yes/no', { attending: 'Yes' }, 'Tell us whether you can attend.'],
  ['attending boolean', { attending: true }, 'Tell us whether you can attend.'],
  ['names over 1000 chars', { names: 'x'.repeat(1001) }, 'Names are too long.'],
  [
    'names over 1000 chars when not attending',
    { attending: 'no', names: 'x'.repeat(1001) },
    'Names are too long.',
  ],
  ['names blank when attending', { names: '  \n ' }, 'List the names of the people attending.'],
  ['names missing when attending', { names: undefined }, 'List the names of the people attending.'],
  ['heard_from unknown', { heard_from: 'tv' }, 'Invalid answer for how you heard about the event.'],
  [
    'heard_from display value instead of key',
    { heard_from: 'Website' },
    'Invalid answer for how you heard about the event.',
  ],
  [
    'heard_from_other over 200 chars',
    { heard_from: 'other', heard_from_other: 'x'.repeat(201) },
    'Invalid answer for how you heard about the event.',
  ],
  // The checks run in the contract's order: the first failing one answers.
  ['order: event before email', { event: '', email: 'bad' }, 'event required'],
  [
    'order: email before attending',
    { email: 'bad', attending: 'maybe' },
    'Enter a valid email address.',
  ],
  [
    'order: attending before names',
    { attending: 'maybe', names: 'x'.repeat(1001) },
    'Tell us whether you can attend.',
  ],
  [
    'order: names before heard_from',
    { names: '', heard_from: 'tv' },
    'List the names of the people attending.',
  ],
];

for (const [label, patch, error] of INVALID) {
  test(`event-register POST: ${label} -> 400 with no DB write`, async () => {
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

test('event-register POST: the length limits are inclusive (254-char email, 1000-char names)', async () => {
  const fetch = mockFetch(route());
  try {
    const email = `${'a'.repeat(242)}@example.com`;
    assert.equal(email.length, 254);
    const r = await post({ ...VALID, email, names: 'n'.repeat(1000) });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(upsertCall(fetch).options.body).attendee_names.length, 1000);
  } finally {
    fetch.restore();
  }
});

for (const [label, event] of [
  ['unpublished event', { ...EVENT, published: false }],
  ['nonexistent event', null],
]) {
  test(`event-register POST: ${label} -> 404 with no registration write, auth call or email`, async () => {
    const fetch = mockFetch(route({ event, user: { id: 'u1', email: 'pat@example.com' } }));
    try {
      const r = await post(VALID, { headers: { authorization: 'Bearer good' } });
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'Event not found.' });
      const lookup = callsTo(fetch, '/rest/v1/events')[0];
      assert.match(
        lookup.url,
        /\?select=id,title,starts_at,ends_at,location,perk_deadline,published&slug=eq\.mid-autumn-festival&limit=1$/,
      );
      assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
      assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
      assert.equal(emails(fetch).length, 0);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: anonymous first registration upserts on (event_id, email) without created_at or member_id', async () => {
  const fetch = mockFetch(route());
  try {
    const before = Date.now();
    const r = await post({ ...VALID, email: '  Pat@Example.COM ', names: '  Pat Lee, Sam Lee \n' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      already: false,
      registered_at: FIRST_AT,
      signed_in: false,
      linked: false,
      deadline: EVENT.perk_deadline,
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
      attending: true,
      attendee_names: 'Pat Lee, Sam Lee',
      heard_from: 'Friend',
      wants_meal: true,
    });
    assert.equal('created_at' in row, false, 'created_at is never sent');
    assert.equal('member_id' in row, false, 'member_id is never sent as null');
    assert.ok(Date.parse(updated_at) >= before - 1000 && Date.parse(updated_at) <= Date.now());
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0, 'no token, no auth lookup');
  } finally {
    fetch.restore();
  }
});

for (const [label, patch, expected] of [
  ['website', { heard_from: 'website' }, 'Website'],
  ['friend', { heard_from: 'friend' }, 'Friend'],
  ['newsletter', { heard_from: 'newsletter' }, 'Newsletter'],
  ['social', { heard_from: 'social' }, 'Social Media'],
  [
    'other with text (trimmed)',
    { heard_from: 'other', heard_from_other: '  Poster at the library  ' },
    'Poster at the library',
  ],
  [
    'other with 200 chars',
    { heard_from: 'other', heard_from_other: 'y'.repeat(200) },
    'y'.repeat(200),
  ],
  ['other with blank text', { heard_from: 'other', heard_from_other: '   ' }, 'Other'],
  ['other with no text', { heard_from: 'other', heard_from_other: undefined }, 'Other'],
  ['empty', { heard_from: '' }, null],
  ['absent', { heard_from: undefined }, null],
  ['null', { heard_from: null }, null],
  ['empty, ignoring a leftover other text', { heard_from: '', heard_from_other: 'TV' }, null],
]) {
  test(`event-register POST: heard_from ${label} -> ${JSON.stringify(expected)}`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, ...patch });
      assert.equal(r.status, 200);
      assert.equal(JSON.parse(upsertCall(fetch).options.body).heard_from, expected);
    } finally {
      fetch.restore();
    }
  });
}

for (const [value, expected] of [
  ['yes', true],
  ['no', false],
  ['', null],
  [undefined, null],
  ['maybe', null],
]) {
  test(`event-register POST: wants_meal ${JSON.stringify(value)} -> ${expected}`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, wants_meal: value });
      assert.equal(r.status, 200);
      assert.equal(JSON.parse(upsertCall(fetch).options.body).wants_meal, expected);
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: not attending needs no names and stores attending=false, names null', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ ...VALID, attending: 'no', names: '' });
    assert.equal(r.status, 200);
    const row = JSON.parse(upsertCall(fetch).options.body);
    assert.equal(row.attending, false);
    assert.equal(row.attendee_names, null);
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
      const row = JSON.parse(upsertCall(fetch).options.body);
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
    assert.equal('member_id' in JSON.parse(upsertCall(fetch).options.body), false);
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
    const r = await post({ ...VALID, attending: 'no', names: '' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      already: true,
      registered_at: EARLIER_AT,
      signed_in: false,
      linked: false,
      deadline: EVENT.perk_deadline,
    });
    const row = JSON.parse(upsertCall(fetch).options.body);
    assert.equal('created_at' in row, false);
    assert.equal(row.attending, false, 'the new answers are still written');
    assert.equal(emails(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: with no perk_deadline, the deadline is the event start', async () => {
  const fetch = mockFetch(route({ event: { ...EVENT, perk_deadline: null } }));
  try {
    const r = await post(VALID);
    assert.equal((await r.json()).deadline, EVENT.starts_at);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: first registration emails the registrant Chicago times, escaped event fields and the account link', async () => {
  const fetch = mockFetch(
    route({ event: { ...EVENT, title: 'Moon & <Lantern> Night', location: 'Hall "A" <b>' } }),
  );
  try {
    const r = await post(
      { ...VALID, email: 'Pat@Example.com', wants_meal: 'no' },
      { url: 'https://caaciorg.com/api/event-register' },
    );
    assert.equal(r.status, 200);

    const sent = emails(fetch);
    assert.equal(sent.length, 1);
    const [mail] = sent;
    assert.equal(mail.to, 'pat@example.com', 'to the registrant, lower-cased');
    assert.equal(mail.from, 'events@caaci.example');
    assert.equal(mail.reply_to, 'staff@caaci.example');
    assert.match(mail.subject, /Moon & <Lantern> Night/);

    const { html } = mail;
    assert.equal(html.includes('<Lantern>'), false);
    assert.match(html, /Moon &amp; &lt;Lantern&gt; Night/);
    assert.match(html, /Hall &quot;A&quot; &lt;b&gt;/);

    // 19:00–23:00 UTC is 2:00–6:00 PM in Champaign, not 7:00 PM.
    assert.match(html, /Sunday, September 27, 2026 at 2:00\sPM – 6:00\sPM/);
    assert.match(html, /2026年9月27日星期日 14:00 – 18:00/);
    assert.equal(/7:00\sPM/.test(html), false);

    // Links are built from the request's origin, so they follow a domain move.
    assert.match(html, /href="https:\/\/caaciorg\.com\/login-3\/"/);
    assert.equal(html.includes('beta.caaciorg.com'), false);
    assert.match(html, /Create a free CAACI account with this email before .*2099/);
  } finally {
    fetch.restore();
  }
});

// Anyone can make the endpoint mail any address from CAACI, so nothing the
// registrant typed may reach the email: it would be branded phishing copy.
test('event-register POST: the email carries no registrant-typed text, only structured answers', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({
      ...VALID,
      email: 'victim+verify-at-evil.example@gmail.com',
      names:
        'Your account is suspended, verify at https://evil.example/login <a href="https://evil.example">here</a>',
      heard_from: 'other',
      heard_from_other: 'Call now: http://evil.example <b>urgent</b>',
      wants_meal: 'yes',
    });
    assert.equal(r.status, 200);
    const row = JSON.parse(upsertCall(fetch).options.body);
    assert.match(row.attendee_names, /suspended/, 'the answers are still stored');
    assert.match(row.heard_from, /Call now/);

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
    assert.match(mail.html, /我会参加 · Yes, I’ll be there/);
    assert.match(
      mail.html,
      /了解渠道 · How you heard about this event<\/td><td[^>]*>其他 · Other<\/td>/,
    );
    assert.match(mail.html, /购买餐食 · Purchase a meal\?<\/td><td[^>]*>是 · Yes<\/td>/);
  } finally {
    fetch.restore();
  }
});

for (const [label, patch, heard, meal] of [
  ['website, no meal', { heard_from: 'website', wants_meal: 'no' }, '网站 · Website', '否 · No'],
  ['friend', { heard_from: 'friend' }, '朋友 · Friend', '是 · Yes'],
  ['newsletter', { heard_from: 'newsletter' }, '电子报 · Newsletter', '是 · Yes'],
  ['social', { heard_from: 'social' }, '社交媒体 · Social Media', '是 · Yes'],
  ['not answered', { heard_from: '', wants_meal: '' }, '—', '—'],
  [
    'Other typed as a prototype key',
    { heard_from: 'other', heard_from_other: 'constructor' },
    '其他 · Other',
    '是 · Yes',
  ],
  ['not attending', { attending: 'no', names: '' }, '朋友 · Friend', '是 · Yes'],
]) {
  test(`event-register POST: email structured answers, ${label}`, async () => {
    const fetch = mockFetch(route());
    try {
      const r = await post({ ...VALID, ...patch });
      assert.equal(r.status, 200);
      const { html } = emails(fetch)[0];
      const cell = (name, value) =>
        new RegExp(`${name}</td><td[^>]*>${value.replace(/[?]/g, '\\?')}</td>`);
      assert.match(html, cell('了解渠道 · How you heard about this event', heard));
      assert.match(html, cell('购买餐食 · Purchase a meal\\?', meal));
      assert.match(
        html,
        patch.attending === 'no'
          ? /无法参加 · Sorry, can’t make it/
          : /我会参加 · Yes, I’ll be there/,
      );
    } finally {
      fetch.restore();
    }
  });
}

test('event-register POST: a linked first registration is told it counts, with no sign-up link', async () => {
  const fetch = mockFetch(route({ user: { id: 'u1', email: 'pat@example.com' } }));
  try {
    const r = await post(VALID, { headers: { authorization: 'Bearer good' } });
    assert.equal(r.status, 200);
    const { html } = emails(fetch)[0];
    assert.match(html, /counts for a free mooncake/);
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
    assert.equal(/counts for a free mooncake/.test(html), false);
    assert.match(html, /href="https:\/\/beta\.caaciorg\.com\/login-3\/"/);
  } finally {
    fetch.restore();
  }
});

test('event-register POST: after the deadline the confirmation offers no mooncake', async () => {
  const fetch = mockFetch(
    route({ event: { ...EVENT, perk_deadline: '2000-01-01T00:00:00+00:00' } }),
  );
  try {
    const r = await post(VALID);
    assert.equal(r.status, 200);
    const { html } = emails(fetch)[0];
    assert.equal(/mooncake|月饼/.test(html), false);
    assert.equal(html.includes('/login-3/'), false);
    assert.match(html, /我会参加 · Yes, I’ll be there/, 'the answers are still confirmed');
  } finally {
    fetch.restore();
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
  description: EVENT.description,
  starts_at: EVENT.starts_at,
  ends_at: EVENT.ends_at,
  location: EVENT.location,
  perk_deadline: EVENT.perk_deadline,
  deadline: EVENT.perk_deadline,
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

test('event-register GET: anonymous -> public event fields and signed_in=false, nothing else', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get('?event=mid-autumn-festival');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { event: PUBLIC_EVENT, signed_in: false });
    assert.match(
      callsTo(fetch, '/rest/v1/events')[0].url,
      /&slug=eq\.mid-autumn-festival&limit=1$/,
    );
    assert.equal(callsTo(fetch, '/auth/v1/user').length, 0);
    assert.equal(callsTo(fetch, '/rest/v1/event_registrations').length, 0);
  } finally {
    fetch.restore();
  }
});

test('event-register GET: with no perk_deadline, deadline is the event start', async () => {
  const fetch = mockFetch(route({ event: { ...EVENT, perk_deadline: null } }));
  try {
    const { event } = await (await get('?event=mid-autumn-festival')).json();
    assert.equal(event.perk_deadline, null);
    assert.equal(event.deadline, EVENT.starts_at);
  } finally {
    fetch.restore();
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
      byEmail: { created_at: FIRST_AT, attending: true, updated_at: '2026-09-15T00:00:00+00:00' },
      byMember: { created_at: EARLIER_AT, attending: false, updated_at: EARLIER_AT },
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
      registration: {
        registered_at: FIRST_AT,
        attending: true,
        updated_at: '2026-09-15T00:00:00+00:00',
      },
    });
    const lookups = regSelects(fetch);
    assert.equal(lookups.length, 1, 'no member_id lookup once the email matched');
    assert.match(
      lookups[0].url,
      /\?select=created_at,attending,updated_at&event_id=eq\.e1&email=eq\.pat%40example\.com&limit=1$/,
    );
  } finally {
    fetch.restore();
  }
});

test('event-register GET: signed in, falls back to member_id with a separate eq lookup (no or= filter)', async () => {
  const fetch = mockFetch(
    route({
      user: { id: 'u1', email: 'a,b(c)@example.com' },
      byMember: { created_at: EARLIER_AT, attending: false, updated_at: FIRST_AT },
    }),
  );
  try {
    const r = await get('?event=mid-autumn-festival', {
      headers: { authorization: 'Bearer good' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).registration, {
      registered_at: EARLIER_AT,
      attending: false,
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
