// Boots the REAL login page (member-src/login.html) + the real module
// (src/caaci-member.js) in jsdom with Supabase stubbed. Pins the behavioral
// contracts ported from caaci-app.js: the duplicate-email guard, the admin
// redirect, ?next= handling and the email cooldowns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const PAGES = {};
for (const p of ['login'])
  PAGES[p] = await readFile(new URL(`../member-src/${p}.html`, import.meta.url), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 15));

function setup(page, { search = '', hash = '' } = {}) {
  const dom = new JSDOM(PAGES[page], { url: 'https://caaci.example/x/' });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.Image = dom.window.Image;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = {
    pathname: `/${page}/`,
    origin: 'https://caaci.example',
    search,
    hash,
    href: '',
    reload: () => {},
  };
  globalThis.alert = () => {};
  const w = dom.window;
  w.__CAACI_TEST__ = true;
  globalThis.window = w;
  return dom;
}

const TIER_ROWS = [
  { id: 'individual', name: 'Individual Membership', price_cents: 3000, active: true },
];

// `auth` overrides individual auth methods (e.g. an updateUser that fails);
// every auth call is recorded in `stub.calls` as { name, args }.
function supaStub({
  user = null,
  memberRow = null,
  payments = [],
  isAdmin = false,
  auth = {},
} = {}) {
  const calls = [];
  const methods = {
    getUser: async () => ({ data: { user } }),
    getSession: async () =>
      user ? { data: { session: { access_token: 'tok', user } } } : { data: { session: null } },
    signInWithPassword: async ({ email }) => ({
      data: { user: { id: 'u-login', email } },
      error: null,
    }),
    signUp: async ({ email }) =>
      email === 'taken@x.com'
        ? { data: { user: { id: 'dup', identities: [] } }, error: null } // duplicate account
        : { data: { user: { id: 'u-new', identities: [{}] }, session: null }, error: null },
    signOut: async () => {},
    updateUser: async () => ({ data: { user }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    resend: async () => ({ data: {}, error: null }),
    reauthenticate: async () => ({ data: {}, error: null }),
    ...auth,
  };
  return {
    calls,
    auth: Object.fromEntries(
      Object.entries(methods).map(([name, fn]) => [
        name,
        (...args) => {
          calls.push({ name, args });
          return fn(...args);
        },
      ]),
    ),
    from: (table) => ({
      select: () => ({
        eq: (col) => {
          if (table === 'membership_tiers') return Promise.resolve({ data: TIER_ROWS }); // .eq('active', true)
          if (table === 'members' && col === 'id')
            return {
              maybeSingle: async () => ({ data: isAdmin ? { is_admin: true } : memberRow }),
            };
          return {
            maybeSingle: async () => ({ data: memberRow }),
            order: () => ({ limit: async () => ({ data: payments }) }),
          };
        },
      }),
    }),
  };
}

test('login page: password sign-in redirects, admins go to /admin/', async () => {
  setup('login');
  member.__setSupa(supaStub({ isAdmin: false, memberRow: { is_admin: false } }));
  await member.wireAuthPage();

  // empty submit → validation error, no redirect
  document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.match(document.querySelector('#caaci-login-notice').textContent, /email and password/i);
  assert.equal(location.href, '');

  document.querySelector('#caaci-li-email').value = 'mei@x.com';
  document.querySelector('#caaci-li-pwd').value = 'password123';
  document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(location.href, '/account/');

  // OAuth buttons rendered (Google + Microsoft)
  assert.equal(document.querySelectorAll('#caaci-oauth-host button').length, 2);

  // admin account lands on /admin/
  setup('login');
  member.__setSupa(supaStub({ isAdmin: true }));
  await member.wireAuthPage();
  document.querySelector('#caaci-li-email').value = 'admin@x.com';
  document.querySelector('#caaci-li-pwd').value = 'password123';
  document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(location.href, '/admin/');
});

test('login page: signup blocks duplicates and short passwords', async () => {
  setup('login');
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  const note = document.querySelector('#caaci-signup-notice');

  document.querySelector('#caaci-su-email').value = 'taken@x.com';
  document.querySelector('#caaci-su-pwd').value = 'short';
  document.querySelector('#caaci-su-pwd2').value = 'short';
  document.querySelector('#caaci-signup-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.match(note.textContent, /at least 8 characters/i);

  document.querySelector('#caaci-su-pwd').value = 'longenough1';
  document.querySelector('#caaci-su-pwd2').value = 'longenough1';
  document.querySelector('#caaci-signup-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.match(note.textContent, /already has an account/i);
  assert.equal(location.href, ''); // never redirected
});

test('login page: ?next= sends a non-admin back to that same-site path after sign-in', async () => {
  setup('login', { search: '?next=%2Fmembership%2F%3Ftier%3Dhonorary' });
  member.__setSupa(supaStub({ memberRow: { is_admin: false } }));
  await member.wireAuthPage();
  document.querySelector('#caaci-li-email').value = 'mei@x.com';
  document.querySelector('#caaci-li-pwd').value = 'password123';
  document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(location.href, '/membership/?tier=honorary');

  // An off-site ?next= is ignored — the login page must not be an open redirect.
  setup('login', { search: '?next=https%3A%2F%2Fevil.example%2F' });
  member.__setSupa(supaStub({ memberRow: { is_admin: false } }));
  await member.wireAuthPage();
  document.querySelector('#caaci-li-email').value = 'mei@x.com';
  document.querySelector('#caaci-li-pwd').value = 'password123';
  document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(location.href, '/account/');
});

test('login page: a visitor who is already signed in is sent on instead of shown the form', async () => {
  const user = { id: 'u1', email: 'mei@x.com' };
  setup('login', { search: '?next=%2Fmembership%2F%3Ftier%3Dhonorary' });
  member.__setSupa(supaStub({ user, memberRow: { is_admin: false } }));
  await member.wireAuthPage();
  assert.equal(location.href, '/membership/?tier=honorary');

  setup('login');
  member.__setSupa(supaStub({ user, isAdmin: true }));
  await member.wireAuthPage();
  assert.equal(location.href, '/admin/');

  // A stored session Supabase rejects must leave the form usable, not bounce.
  setup('login');
  const stale = supaStub({ user });
  stale.auth.getUser = async () => ({ data: { user: null }, error: { message: 'invalid JWT' } });
  member.__setSupa(stale);
  await member.wireAuthPage();
  assert.equal(location.href, '');
});

// URL parsing drops tabs and reads "\" as "/", so the first two start with a
// single slash yet resolve to https://evil.example/.
const OFFSITE_NEXT = [
  '/\t/evil.example',
  '/\\evil.example',
  '//evil.example',
  'https://evil.example',
];

test('login page: an off-site ?next= never leaves the site, by form sign-in or auto-redirect', async () => {
  const user = { id: 'u1', email: 'mei@x.com' };
  for (const next of OFFSITE_NEXT) {
    const search = `?next=${encodeURIComponent(next)}`;
    setup('login', { search });
    member.__setSupa(supaStub({ memberRow: { is_admin: false } }));
    await member.wireAuthPage();
    document.querySelector('#caaci-li-email').value = 'mei@x.com';
    document.querySelector('#caaci-li-pwd').value = 'password123';
    document.querySelector('#caaci-login-form').dispatchEvent(new Event('submit'));
    await tick();
    assert.equal(location.href, '/account/', `form sign-in, next=${JSON.stringify(next)}`);

    setup('login', { search });
    member.__setSupa(supaStub({ user, memberRow: { is_admin: false } }));
    await member.wireAuthPage();
    assert.equal(location.href, '/account/', `already signed in, next=${JSON.stringify(next)}`);
  }

  // Same-site paths survive intact, and admins still land in the back-office.
  setup('login', { search: `?next=${encodeURIComponent('/membership/?tier=family')}` });
  member.__setSupa(supaStub({ user, memberRow: { is_admin: false } }));
  await member.wireAuthPage();
  assert.equal(location.href, '/membership/?tier=family');

  setup('login', { search: `?next=${encodeURIComponent('/\t/evil.example')}` });
  member.__setSupa(supaStub({ user, isAdmin: true }));
  await member.wireAuthPage();
  assert.equal(location.href, '/admin/');
});

// ---------- email sending: reset links, confirmations, cooldowns ----------
// Countdown tests mock setInterval + Date (t.mock resets them when the test
// ends), while tick() keeps using the real setTimeout to flush promises.
const q = (s) => document.querySelector(s);
const callsTo = (stub, name) => stub.calls.filter((c) => c.name === name).map((c) => c.args);
const mockClock = (t) => t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
const RESET_REDIRECT = { redirectTo: 'https://caaci.example/account/?recovery=1' };

test('login page: forgot password opens its own form, sends to the typed email, then cools down', async (t) => {
  mockClock(t);
  setup('login');
  const stub = supaStub();
  member.__setSupa(stub);
  await member.wireAuthPage();

  assert.equal(q('#caaci-reset-panel').hidden, true);
  q('#caaci-li-email').value = 'mei@x.com';
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  assert.equal(q('#caaci-reset-panel').hidden, false);
  assert.equal(q('#caaci-reset-email').value, 'mei@x.com', 'prefilled from the sign-in email');
  assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 0, 'opening the form sends nothing');

  q('#caaci-reset-email').value = 'not-an-email';
  q('#caaci-reset-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.match(q('#caaci-reset-notice').textContent, /valid email/i);
  assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 0);

  q('#caaci-reset-email').value = 'other@x.com';
  q('#caaci-reset-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.deepEqual(callsTo(stub, 'resetPasswordForEmail'), [['other@x.com', RESET_REDIRECT]]);
  assert.match(q('#caaci-reset-notice').textContent, /check your inbox/i);

  const send = q('#caaci-reset-send');
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Resend in 60s');
  t.mock.timers.tick(1000);
  assert.equal(send.textContent, 'Resend in 59s');
  t.mock.timers.tick(59000);
  assert.equal(send.disabled, false);
  assert.equal(send.textContent, 'Resend');
});

test('login page: a rate-limited reset shows busy, then counts down from the seconds Supabase gave', async (t) => {
  mockClock(t);
  setup('login');
  let release;
  const stub = supaStub({
    auth: {
      resetPasswordForEmail: () =>
        new Promise((r) => {
          release = () =>
            r({
              data: null,
              error: {
                code: 'over_email_send_rate_limit',
                status: 429,
                message: 'For security purposes, you can only request this after 42 seconds.',
              },
            });
        }),
    },
  });
  member.__setSupa(stub);
  await member.wireAuthPage();
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  q('#caaci-reset-email').value = 'mei@x.com';
  q('#caaci-reset-form').dispatchEvent(new Event('submit'));
  await tick();
  const send = q('#caaci-reset-send');
  assert.equal(send.disabled, true);
  assert.match(send.textContent, /Sending/);

  release();
  await tick();
  assert.match(q('#caaci-reset-notice').textContent, /42 seconds/);
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Resend in 42s');
});

test('login page: a reload keeps the reset cooldown for that address, but not for another one', async (t) => {
  mockClock(t);
  setup('login');
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  q('#caaci-reset-email').value = 'mei@x.com';
  q('#caaci-reset-form').dispatchEvent(new Event('submit'));
  await tick();
  t.mock.timers.tick(20000);

  // "Reload": a fresh page that inherits this origin's localStorage.
  const saved = [];
  for (let i = 0; i < localStorage.length; i++)
    saved.push([localStorage.key(i), localStorage.getItem(localStorage.key(i))]);
  setup('login');
  for (const [k, v] of saved) localStorage.setItem(k, v);
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  q('#caaci-li-email').value = 'MEI@x.com';
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  const send = q('#caaci-reset-send');
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Resend in 40s');

  q('#caaci-reset-email').value = 'someone@else.com';
  q('#caaci-reset-email').dispatchEvent(new Event('input'));
  assert.equal(send.disabled, false);
  assert.equal(send.textContent, 'Send reset link');
});

const CONFIRM_RESEND = (email) => ({
  type: 'signup',
  email,
  options: { emailRedirectTo: 'https://caaci.example/account/' },
});

test('login page: signup without a session offers a confirmation resend that starts cooling down', async (t) => {
  mockClock(t);
  setup('login');
  const stub = supaStub();
  member.__setSupa(stub);
  await member.wireAuthPage();
  const resend = q('#caaci-su-resend');
  assert.equal(resend.hidden, true);

  q('#caaci-su-email').value = 'new@x.com';
  q('#caaci-su-pwd').value = 'longenough1';
  q('#caaci-su-pwd2').value = 'longenough1';
  q('#caaci-signup-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.match(q('#caaci-signup-notice').textContent, /Check your email/);
  assert.equal(resend.hidden, false);
  assert.equal(resend.disabled, true, 'the signup itself just sent one');
  assert.equal(resend.textContent, 'Resend in 60s');

  t.mock.timers.tick(60000);
  assert.equal(resend.disabled, false);
  assert.equal(resend.textContent, 'Resend confirmation email');
  resend.click();
  await tick();
  assert.deepEqual(callsTo(stub, 'resend'), [[CONFIRM_RESEND('new@x.com')]]);
  assert.match(q('#caaci-signup-notice').textContent, /sent/i);
  assert.equal(resend.textContent, 'Resend in 60s');
});

test('login page: signing in before confirming explains why and offers the confirmation email again', async (t) => {
  mockClock(t);
  for (const error of [
    { code: 'email_not_confirmed', message: 'Email not confirmed' },
    { message: 'Email not confirmed' }, // no code → message fallback
  ]) {
    setup('login');
    const stub = supaStub({
      auth: { signInWithPassword: async () => ({ data: { user: null, session: null }, error }) },
    });
    member.__setSupa(stub);
    await member.wireAuthPage();
    q('#caaci-li-email').value = 'mei@x.com';
    q('#caaci-li-pwd').value = 'password123';
    q('#caaci-login-form').dispatchEvent(new Event('submit'));
    await tick();
    assert.match(q('#caaci-login-notice').textContent, /not confirmed yet/i);
    assert.equal(location.href, '');

    const resend = q('#caaci-li-resend');
    assert.equal(resend.hidden, false);
    assert.equal(resend.disabled, false, 'nothing was sent yet');
    resend.click();
    await tick();
    assert.deepEqual(callsTo(stub, 'resend'), [[CONFIRM_RESEND('mei@x.com')]]);
    assert.equal(resend.disabled, true);
  }
});

test('cooldowns: a reset email and a confirmation resend to the same address count down separately', async (t) => {
  mockClock(t);
  setup('login');
  const stub = supaStub({
    auth: {
      signInWithPassword: async () => ({
        data: { user: null },
        error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
      }),
    },
  });
  member.__setSupa(stub);
  await member.wireAuthPage();
  q('#caaci-li-email').value = 'mei@x.com';
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  q('#caaci-reset-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(q('#caaci-reset-send').disabled, true, 'reset is cooling down');

  q('#caaci-li-pwd').value = 'password123';
  q('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  const resend = q('#caaci-li-resend');
  assert.equal(resend.disabled, false, 'the reset countdown does not hold back confirmation');
  resend.click();
  await tick();
  assert.equal(callsTo(stub, 'resend').length, 1);
});

test('cooldowns: a rate limit without "after N seconds" falls back to 60s; other errors do not cool down', async (t) => {
  mockClock(t);
  for (const [error, disabled, label] of [
    [{ status: 429, message: 'Too many requests' }, true, 'Resend in 60s'],
    [
      { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
      true,
      'Resend in 60s',
    ],
    [{ status: 500, message: 'Error sending recovery email' }, false, 'Send reset link'],
  ]) {
    setup('login');
    member.__setSupa(
      supaStub({ auth: { resetPasswordForEmail: async () => ({ data: null, error }) } }),
    );
    await member.wireAuthPage();
    q('#caaci-forgot').dispatchEvent(new Event('click'));
    q('#caaci-reset-email').value = 'mei@x.com';
    q('#caaci-reset-form').dispatchEvent(new Event('submit'));
    await tick();
    const send = q('#caaci-reset-send');
    assert.equal(q('#caaci-reset-notice').textContent, error.message);
    assert.equal(send.disabled, disabled, error.message);
    assert.equal(send.textContent, label, error.message);
  }
});

test('login page: the confirmation resend hides again when sign-in fails for another reason', async () => {
  setup('login');
  let error = { code: 'email_not_confirmed', message: 'Email not confirmed' };
  member.__setSupa(
    supaStub({ auth: { signInWithPassword: async () => ({ data: { user: null }, error }) } }),
  );
  await member.wireAuthPage();
  q('#caaci-li-email').value = 'mei@x.com';
  q('#caaci-li-pwd').value = 'password123';
  q('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(q('#caaci-li-resend').hidden, false);

  error = { code: 'invalid_credentials', message: 'Invalid login credentials' };
  q('#caaci-login-form').dispatchEvent(new Event('submit'));
  await tick();
  assert.equal(q('#caaci-li-resend').hidden, true);
  assert.equal(q('#caaci-login-notice').textContent, 'Invalid login credentials');
});

// ---------- guards: each test below fails when its guard is removed ----------
const openResetForm = (email) => {
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  q('#caaci-reset-email').value = email;
};
const submitReset = () => q('#caaci-reset-form').dispatchEvent(new Event('submit'));
const typeResetEmail = (email) => {
  q('#caaci-reset-email').value = email;
  q('#caaci-reset-email').dispatchEvent(new Event('input'));
};
const heldSend = () => {
  const held = {};
  held.send = () =>
    new Promise((resolve) => {
      held.release = () => resolve({ data: {}, error: null });
    });
  return held;
};

test('cooldowns: switching the reset form to another address stops the old countdown for good', async (t) => {
  mockClock(t);
  setup('login');
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  openResetForm('mei@x.com');
  submitReset();
  await tick();
  const send = q('#caaci-reset-send');
  assert.equal(send.disabled, true);

  typeResetEmail('ada@x.com');
  t.mock.timers.tick(1500);
  assert.equal(send.disabled, false, 'the old countdown does not tick back in');
  assert.equal(send.textContent, 'Send reset link');
});

test('login page: a double submit of the reset form sends one email', async (t) => {
  mockClock(t);
  setup('login');
  const stub = supaStub();
  member.__setSupa(stub);
  await member.wireAuthPage();
  openResetForm('mei@x.com');
  submitReset();
  submitReset();
  await tick();
  assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 1);
});

test('login page: typing another address while a reset is sending leaves the button busy', async (t) => {
  mockClock(t);
  setup('login');
  const held = heldSend();
  member.__setSupa(supaStub({ auth: { resetPasswordForEmail: held.send } }));
  await member.wireAuthPage();
  openResetForm('mei@x.com');
  submitReset();
  const send = q('#caaci-reset-send');
  typeResetEmail('ada@x.com');
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Sending…');
  held.release();
  await tick();
});

test('cooldowns: a send that throws frees the button and says what went wrong', async (t) => {
  mockClock(t);
  for (const [thrown, message] of [
    [new TypeError('Failed to fetch'), 'Failed to fetch'],
    [{}, 'Network error — please try again.'],
  ]) {
    setup('login');
    member.__setSupa(
      supaStub({
        auth: {
          resetPasswordForEmail: async () => {
            throw thrown;
          },
        },
      }),
    );
    await member.wireAuthPage();
    openResetForm('mei@x.com');
    submitReset();
    await tick();
    const send = q('#caaci-reset-send');
    assert.equal(q('#caaci-reset-notice').textContent, message);
    assert.equal(send.disabled, false, message);
    assert.equal(send.textContent, 'Send reset link', message);
  }
});

test('login page: ?signup=1 opens the signup card with the email an event form handed over, once', async (t) => {
  // Creating the account starts the 60s resend countdown; on a real clock its
  // interval kept the test process alive for a minute after the file finished.
  mockClock(t);
  setup('login', { search: '?signup=1&next=%2Fmid_autumn_festival_form%2F' });
  sessionStorage.setItem('caaci-signup-email', 'mei@x.com');
  const stub = supaStub();
  member.__setSupa(stub);
  await member.wireAuthPage();
  assert.equal(q('#caaci-signup-card').hidden, false);
  assert.equal(q('#caaci-show-signup').getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, q('#caaci-su-name'));
  assert.equal(q('#caaci-su-email').value, 'mei@x.com');
  assert.equal(sessionStorage.getItem('caaci-signup-email'), null, 'the handover is read once');

  // The confirmation link brings them back to the form they came from.
  q('#caaci-su-name').value = 'Mei Lin';
  q('#caaci-su-pwd').value = 'longenough1';
  q('#caaci-su-pwd2').value = 'longenough1';
  q('#caaci-signup-form').dispatchEvent(new Event('submit'));
  await tick();
  const [[{ email, options }]] = callsTo(stub, 'signUp');
  assert.equal(email, 'mei@x.com');
  assert.equal(options.emailRedirectTo, 'https://caaci.example/mid_autumn_festival_form/');

  // Without ?signup=1 the card stays closed, and there is nothing to prefill.
  setup('login');
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  assert.equal(q('#caaci-signup-card').hidden, true);
  assert.equal(q('#caaci-su-email').value, '');
});
