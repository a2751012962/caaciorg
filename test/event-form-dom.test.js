// Boots the real /mid_autumn_festival_form/ page (member-src/mid-autumn-form.html)
// with src/caaci-member.js in jsdom and /api/event-register stubbed. Pins what
// the page sends (the POST body, a bearer token only when signed in) and what
// each answer does to it: the event details, the mooncake callout and step,
// and the success state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');
const PAGE = await readFile(new URL('../member-src/mid-autumn-form.html', import.meta.url), 'utf8');

const PATH = '/mid_autumn_festival_form/';
const tick = () => new Promise((r) => setTimeout(r, 15));
const q = (s) => document.querySelector(s);

function setup() {
  const dom = new JSDOM(PAGE, { url: `https://caaci.example${PATH}` });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = {
    pathname: PATH,
    origin: 'https://caaci.example',
    search: '',
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
const EVENT = {
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 2099',
  description: 'Mooncakes under the harvest moon.',
  starts_at: FUTURE,
  ends_at: '2099-09-27T23:00:00Z',
  location: 'Siebel Center for Design',
  perk_deadline: null,
  deadline: FUTURE,
};
const ANON_GET = () => ({ body: { event: EVENT, signed_in: false } });
const POST_OK = (extra = {}) => ({
  body: {
    ok: true,
    already: false,
    registered_at: '2026-09-13T20:04:05.123Z',
    signed_in: false,
    deadline: FUTURE,
    ...extra,
  },
});

// Routes the page's two requests: GET ?event= and the POST.
function stubApi({ get = ANON_GET, post = () => POST_OK() } = {}) {
  return mockFetch((url, options) => {
    if (options.method === 'POST' && url === '/api/event-register') return post(url, options);
    if (url.startsWith('/api/event-register?')) return get(url, options);
    return { status: 404, body: {} };
  });
}
const posts = (fetch) => fetch.calls.filter((c) => c.options.method === 'POST');

function fillForm({
  email = 'mei@x.com',
  attending = 'yes',
  names = 'Mei Lin, Ada Lin',
  heard = 'other',
  other = 'Flyer at the library',
  meal = 'yes',
} = {}) {
  q('#caaci-ev-email').value = email;
  if (attending) {
    const radio = q(`#caaci-ev-attending-${attending}`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  }
  q('#caaci-ev-names').value = names;
  if (heard) q(`#caaci-ev-heard-${heard}`).checked = true;
  q('#caaci-ev-heard-other-text').value = other;
  if (meal) q(`#caaci-ev-meal-${meal}`).checked = true;
}
const submit = async () => {
  q('#caaci-ev-form').dispatchEvent(new Event('submit'));
  await tick();
};
const shown = (sel) => q(sel).hidden === false;

test('event form: an anonymous visitor registers, then is sent to signup with the email kept out of the URL', async () => {
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi();
  try {
    await member.wireEventFormPage();
    const [get] = fetch.calls;
    assert.equal(get.url, '/api/event-register?event=mid-autumn-festival');
    assert.equal(get.options.headers?.authorization, undefined);
    // The database title is English only, so the bilingual heading stays.
    const title = q('#caaci-ev-title');
    assert.equal(title.textContent.trim(), 'Mid-Autumn Festival 中秋节');
    assert.equal(title.getAttribute('data-en'), 'Mid-Autumn Festival 中秋节');
    assert.equal(title.getAttribute('data-zh'), '中秋节 Mid-Autumn Festival');
    assert.match(
      q('#caaci-ev-when').textContent,
      /^Sunday, September 27, 2099 · 2:00\sPM – 6:00\sPM$/,
    );
    assert.equal(q('#caaci-ev-where').textContent, 'Siebel Center for Design');
    assert.ok(shown('#caaci-ev-desc'));
    const perk = q('#caaci-ev-perk');
    assert.ok(perk.classList.contains('alert-warning'));
    assert.match(perk.textContent, /Free mooncake/);
    assert.match(perk.textContent, /September 27\D+2:00\sPM CDT/, 'deadline in Chicago time');

    fillForm({ email: '  mei@x.com ' });
    await submit();
    const [post] = posts(fetch);
    assert.ok(post, 'posted');
    assert.equal(post.options.headers.authorization, undefined, 'no bearer without a session');
    assert.deepEqual(JSON.parse(post.options.body), {
      event: 'mid-autumn-festival',
      email: 'mei@x.com',
      attending: 'yes',
      names: 'Mei Lin, Ada Lin',
      heard_from: 'other',
      heard_from_other: 'Flyer at the library',
      wants_meal: 'yes',
      _hp: '',
    });

    assert.equal(q('#caaci-ev-form-card').hidden, true, 'the form is replaced');
    assert.ok(shown('#caaci-ev-done'));
    assert.equal(q('#caaci-ev-done-title').textContent, "You're registered");
    assert.equal(document.activeElement, q('#caaci-ev-done-title'));
    const time = q('#caaci-ev-done-time').textContent;
    assert.match(time, /Sep 13, 2026/);
    assert.match(time, /3:04:05\sPM CDT/, 'to the second, in Chicago time');
    assert.equal(q('#caaci-ev-done-already').hidden, true);
    assert.equal(q('#caaci-ev-perk-counted').hidden, true);
    assert.equal(q('#caaci-ev-perk-closed').hidden, true);
    assert.ok(shown('#caaci-ev-perk-cta'));
    assert.match(q('#caaci-ev-perk-cta').textContent, /September 27\D+2:00\sPM CDT/);
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

test('event form: checks answers before sending, keeps the button busy, and shows the API error', async () => {
  setup();
  member.__setSupa(supaWith(null));
  let release;
  const fetch = stubApi({
    post: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            status: 400,
            body: { error: 'Invalid answer for how you heard about the event.' },
          });
      }),
  });
  try {
    await member.wireEventFormPage();
    const note = q('#caaci-ev-notice');
    await submit();
    assert.match(note.textContent, /valid email/i);
    fillForm({ attending: null });
    await submit();
    assert.match(note.textContent, /whether you can attend/i);
    fillForm({ names: '  ' });
    await submit();
    assert.match(note.textContent, /names of the people attending/i);
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
    assert.equal(note.textContent, 'Invalid answer for how you heard about the event.');
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
    assert.equal(JSON.parse(posts(fetch)[0].options.body)._hp, 'https://bot.example');
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
    assert.match(q('#caaci-ev-done-time').textContent, /Sep 1, 2026\D+10:00:00\sAM CDT/);
  } finally {
    fetch.restore();
  }
});

test('event form: "can\'t make it" needs no names and gets no mooncake step', async () => {
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi();
  try {
    await member.wireEventFormPage();
    const namesLabel = q('label[for="caaci-ev-names"]');
    assert.ok(namesLabel.classList.contains('required'));
    fillForm({ attending: 'no', names: '', heard: null, other: '', meal: null });
    assert.equal(namesLabel.classList.contains('required'), false);
    assert.equal(q('#caaci-ev-names').required, false);
    await submit();
    assert.deepEqual(JSON.parse(posts(fetch)[0].options.body), {
      event: 'mid-autumn-festival',
      email: 'mei@x.com',
      attending: 'no',
      names: '',
      heard_from: '',
      heard_from_other: '',
      wants_meal: '',
      _hp: '',
    });
    assert.equal(q('#caaci-ev-done-title').textContent, 'Thanks for letting us know');
    for (const sel of ['#caaci-ev-perk-counted', '#caaci-ev-perk-cta', '#caaci-ev-perk-closed'])
      assert.equal(q(sel).hidden, true, sel);
  } finally {
    fetch.restore();
  }
});

// POST_OK has no `linked`: a response from before that field counts as linked.
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
    assert.match(q('#caaci-ev-perk-counted').textContent, /✓ Counted for a free mooncake/);
    assert.equal(q('#caaci-ev-perk-cta').hidden, true);
    assert.equal(q('#caaci-ev-perk-closed').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: signed in but registered under another email, the mooncake step asks for an account with that email', async () => {
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
    assert.match(cta, /goes with the email you registered with/);
    assert.match(cta, /September 27\D+2:00\sPM CDT/);
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
        registration: {
          registered_at: '2026-09-10T01:02:03Z',
          attending: true,
          updated_at: '2026-09-11T00:00:00Z',
        },
      },
    }),
  });
  try {
    await member.wireEventFormPage();
    assert.equal(posts(fetch).length, 0);
    assert.equal(q('#caaci-ev-form-card').hidden, true);
    assert.ok(shown('#caaci-ev-done'));
    // 01:02:03 UTC on the 10th is still the evening of the 9th in Champaign.
    assert.match(q('#caaci-ev-done-time').textContent, /Sep 9, 2026\D+8:02:03\sPM CDT/);
    assert.equal(q('#caaci-ev-done-already').hidden, true);
    assert.ok(shown('#caaci-ev-perk-counted'));

    q('#caaci-ev-edit').click();
    assert.equal(
      q('#caaci-ev-form-card').hidden,
      false,
      '"Change my answers" brings the form back',
    );
    assert.equal(q('#caaci-ev-done').hidden, true);
    assert.equal(q('#caaci-ev-email').value, 'mei@x.com');
  } finally {
    fetch.restore();
  }
});

test('event form: after the deadline the callout says mooncake sign-up closed, and registering still works', async () => {
  setup();
  member.__setSupa(supaWith(null));
  const fetch = stubApi({
    get: () => ({
      body: { event: { ...EVENT, perk_deadline: PAST, deadline: PAST }, signed_in: false },
    }),
    post: () => POST_OK({ deadline: PAST }),
  });
  try {
    await member.wireEventFormPage();
    const perk = q('#caaci-ev-perk');
    assert.ok(perk.classList.contains('alert-secondary'));
    assert.equal(perk.classList.contains('alert-warning'), false);
    assert.match(perk.textContent, /sign-up has closed/);
    assert.match(perk.textContent, /September 27\D+2:00\sPM CDT/);
    assert.match(perk.textContent, /still register/);

    fillForm();
    await submit();
    assert.ok(shown('#caaci-ev-done'));
    assert.ok(shown('#caaci-ev-perk-closed'));
    assert.equal(q('#caaci-ev-perk-cta').hidden, true, 'no signup push for a closed perk');
    assert.equal(q('#caaci-ev-perk-counted').hidden, true);
  } finally {
    fetch.restore();
  }
});

test('event form: a failing API leaves the flyer details in place and the form still submits', async () => {
  const failures = [
    ['500', () => ({ status: 500, body: { error: 'boom' } }), supaWith(null)],
    [
      'network error, no Supabase client',
      () => {
        throw new TypeError('Failed to fetch');
      },
      null,
    ],
  ];
  for (const [label, get, supa] of failures) {
    setup();
    member.__setSupa(supa);
    const before = ['#caaci-ev-title', '#caaci-ev-when', '#caaci-ev-where', '#caaci-ev-perk'].map(
      (s) => q(s).textContent,
    );
    const fetch = stubApi({ get });
    try {
      await member.wireEventFormPage();
      const after = ['#caaci-ev-title', '#caaci-ev-when', '#caaci-ev-where', '#caaci-ev-perk'].map(
        (s) => q(s).textContent,
      );
      assert.deepEqual(after, before, label);
      assert.match(before[1], /September 27/, label);

      fillForm();
      await submit();
      assert.equal(posts(fetch).length, 1, label);
      assert.ok(shown('#caaci-ev-done'), label);
    } finally {
      fetch.restore();
    }
  }
});
