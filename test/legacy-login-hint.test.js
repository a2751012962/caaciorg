// Members of the old WordPress site are imported into Supabase as confirmed
// accounts with NO password, and no email is sent at import. Their first
// password sign-in therefore fails. Every failed sign-in (except an unconfirmed
// email, which has its own resend flow) offers two ways in: the existing
// password-reset email, or a one-time code (signInWithOtp + verifyOtp).
//
// GoTrue answers "Invalid login credentials" alike for an unknown address and a
// wrong password, and refuses a code for an address with no account — so none
// of this may reveal whether an account exists.
//
// Boots the real login page and module in jsdom, as caaci-member-dom.test.js
// does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { buildAuthPatch, loadTemplates } from '../push-auth-emails.mjs';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const PAGES = {};
for (const p of ['login'])
  PAGES[p] = await readFile(new URL(`../member-src/${p}.html`, import.meta.url), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 15));
const q = (s) => document.querySelector(s);
const callsTo = (stub, name) => stub.calls.filter((c) => c.name === name).map((c) => c.args);
const mockClock = (t) => t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
const submit = (sel) => q(sel).dispatchEvent(new Event('submit'));
const typeInto = (sel, value) => {
  q(sel).value = value;
  q(sel).dispatchEvent(new Event('input'));
};

function setup(page, { search = '' } = {}) {
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
    hash: '',
    href: '',
    reload: () => {},
  };
  globalThis.alert = () => {};
  const w = dom.window;
  w.__CAACI_TEST__ = true;
  globalThis.window = w;
  return dom;
}

const INVALID = { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' };
const NO_ACCOUNT_ERRORS = [
  { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
  { code: 'user_not_found', status: 404, message: 'User not found' },
  { status: 422, message: 'Signups not allowed for otp' }, // no code → message fallback
];
const RESET_REDIRECT = { redirectTo: 'https://caaci.example/account/?recovery=1' };
const GOOD_CODE = '123456';
const SENT_CODE = "If this email has an account, we've sent a sign-in code.";
const WRONG_CODE = 'That code is wrong or has expired — request a new one.';
const HINT_EN =
  'Moved over from the old caaciorg.com site, or forgot your password? Set a new password, or sign in with a one-time code.';
const HINT_ZH = '从老网站转过来的会员或忘记密码？请重新设置密码，或用临时验证码登录。';

// Password sign-in fails with `signInError` (a function, so a test can change
// it between submits); a code equal to GOOD_CODE signs in as u-code.
function supaStub({ signInError = () => INVALID, isAdmin = false, auth = {} } = {}) {
  const calls = [];
  const methods = {
    getUser: async () => ({ data: { user: null } }),
    getSession: async () => ({ data: { session: null } }),
    signInWithPassword: async ({ email }) => {
      const error = signInError();
      return error
        ? { data: { user: null, session: null }, error }
        : { data: { user: { id: 'u-login', email } }, error: null };
    },
    signUp: async ({ email }) =>
      email === 'taken@x.com'
        ? { data: { user: { id: 'dup', identities: [] } }, error: null }
        : { data: { user: { id: 'u-new', identities: [{}] }, session: null }, error: null },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    resend: async () => ({ data: {}, error: null }),
    signInWithOtp: async () => ({ data: {}, error: null }),
    verifyOtp: async ({ email, token }) =>
      token === GOOD_CODE
        ? { data: { user: { id: 'u-code', email }, session: {} }, error: null }
        : {
            data: { user: null, session: null },
            error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
          },
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
        eq: () => {
          if (table === 'membership_tiers')
            return Promise.resolve({
              data: [
                {
                  id: 'individual',
                  name: 'Individual Membership',
                  price_cents: 3000,
                  active: true,
                },
              ],
            });
          return { maybeSingle: async () => ({ data: isAdmin ? { is_admin: true } : null }) };
        },
      }),
    }),
  };
}

// Login page, wired, after one password sign-in with `email`.
async function failedLogin(stub, { email = 'mei@x.com', search = '' } = {}) {
  setup('login', { search });
  member.__setSupa(stub);
  await member.wireAuthPage();
  q('#caaci-li-email').value = email;
  q('#caaci-li-pwd').value = 'password123';
  submit('#caaci-login-form');
  await tick();
}

// ---------------------------------------------------------------- login page

test('login page: any failed sign-in shows the error plus the set-a-password-or-code hint', async (t) => {
  mockClock(t);
  for (const error of [INVALID, { status: 500, message: 'Database error querying schema' }]) {
    const stub = supaStub({ signInError: () => error });
    await failedLogin(stub);

    assert.equal(q('#caaci-login-notice').textContent, error.message, 'the error itself stays');
    assert.equal(q('#caaci-li-legacy').hidden, false);
    assert.equal(q('#caaci-li-legacy-hint').textContent, HINT_EN);
    assert.equal(q('#caaci-li-legacy-reset').textContent, 'Email me a reset link');
    assert.equal(q('#caaci-li-legacy-reset').disabled, false);
    assert.equal(q('#caaci-li-code-send').textContent, 'Email me a sign-in code');
    assert.equal(q('#caaci-li-code-send').disabled, false);
    assert.equal(q('#caaci-li-code-form').hidden, true, 'no code entry before a code is sent');
    assert.equal(q('#caaci-li-resend').hidden, true, 'not the unconfirmed-email flow');
    assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 0, 'nothing is sent by itself');
    assert.equal(callsTo(stub, 'signInWithOtp').length, 0);
    assert.equal(location.href, '');
  }
});

test('login page: the hint is in Chinese when the page is', async (t) => {
  mockClock(t);
  member.__setLang('zh');
  try {
    await failedLogin(supaStub());
    assert.equal(q('#caaci-li-legacy-hint').textContent, HINT_ZH);
    assert.equal(q('#caaci-li-legacy-reset').textContent, '发送重置密码邮件');
    assert.equal(q('#caaci-li-code-send').textContent, '发送临时验证码');
  } finally {
    member.__setLang('en');
  }
});

test('login page: the hint hides when the email changes and after a successful sign-in', async (t) => {
  mockClock(t);
  let error = INVALID;
  await failedLogin(supaStub({ signInError: () => error }));
  assert.equal(q('#caaci-li-legacy').hidden, false);

  typeInto('#caaci-li-email', 'ada@x.com');
  assert.equal(q('#caaci-li-legacy').hidden, true, 'another address hides it');

  submit('#caaci-login-form');
  await tick();
  assert.equal(q('#caaci-li-legacy').hidden, false, 'failing again shows it again');

  error = null;
  submit('#caaci-login-form');
  await tick();
  assert.equal(q('#caaci-li-legacy').hidden, true);
  assert.equal(location.href, '/account/');
});

test('login page: an unconfirmed email keeps the confirmation resend and shows no hint', async (t) => {
  mockClock(t);
  let error = INVALID;
  const stub = supaStub({ signInError: () => error });
  await failedLogin(stub);
  assert.equal(q('#caaci-li-legacy').hidden, false);

  error = { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' };
  submit('#caaci-login-form');
  await tick();
  assert.match(q('#caaci-login-notice').textContent, /not confirmed yet/i);
  assert.equal(q('#caaci-li-resend').hidden, false);
  assert.equal(q('#caaci-li-legacy').hidden, true, 'the hint gives way to the resend flow');

  await failedLogin(supaStub({ signInError: () => error }));
  assert.equal(q('#caaci-li-resend').hidden, false);
  assert.equal(q('#caaci-li-legacy').hidden, true, 'never shown for an unconfirmed email');
});

test("login page: the hint's reset button emails the typed address on the shared recovery cooldown", async (t) => {
  mockClock(t);
  const stub = supaStub();
  await failedLogin(stub, { email: ' mei@x.com ' });
  const reset = q('#caaci-li-legacy-reset');
  reset.click();
  await tick();
  assert.deepEqual(callsTo(stub, 'resetPasswordForEmail'), [['mei@x.com', RESET_REDIRECT]]);
  assert.match(q('#caaci-login-notice').textContent, /check your inbox/i);
  assert.equal(reset.disabled, true);
  assert.equal(reset.textContent, 'Resend in 60s');

  // The forgot-password form for the same address picks up the same countdown.
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  assert.equal(q('#caaci-reset-send').disabled, true);
  assert.equal(q('#caaci-reset-send').textContent, 'Resend in 60s');

  // And the other way round: a reset sent from the forgot form holds the hint's button.
  const other = supaStub();
  setup('login');
  member.__setSupa(other);
  await member.wireAuthPage();
  q('#caaci-forgot').dispatchEvent(new Event('click'));
  q('#caaci-reset-email').value = 'ada@x.com';
  submit('#caaci-reset-form');
  await tick();
  t.mock.timers.tick(15000);
  q('#caaci-li-email').value = 'ada@x.com';
  q('#caaci-li-pwd').value = 'password123';
  submit('#caaci-login-form');
  await tick();
  assert.equal(q('#caaci-li-legacy-reset').disabled, true);
  assert.equal(q('#caaci-li-legacy-reset').textContent, 'Resend in 45s');
  q('#caaci-li-legacy-reset').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(callsTo(other, 'resetPasswordForEmail').length, 1, 'no second email inside 60s');
});

test('login page: the code button asks for a code without creating an account, then offers code entry', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await failedLogin(stub, { search: '?next=/membership/' });
  const send = q('#caaci-li-code-send');
  send.click();
  await tick();
  assert.deepEqual(callsTo(stub, 'signInWithOtp'), [
    [
      {
        email: 'mei@x.com',
        options: {
          shouldCreateUser: false,
          emailRedirectTo: 'https://caaci.example/membership/',
        },
      },
    ],
  ]);
  assert.equal(q('#caaci-login-notice').textContent, SENT_CODE);
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Resend in 60s');

  assert.equal(q('#caaci-li-code-form').hidden, false);
  const input = q('#caaci-li-code');
  assert.equal(input.getAttribute('inputmode'), 'numeric');
  assert.equal(input.getAttribute('autocomplete'), 'one-time-code');
  assert.equal(input.getAttribute('pattern'), '[0-9]{6,10}');
  assert.equal(q('#caaci-li-code-verify').textContent.trim(), 'Sign in');
});

test('login page: a code request for an address with no account reads exactly like a real send', async (t) => {
  mockClock(t);
  await failedLogin(supaStub());
  q('#caaci-li-code-send').click();
  await tick();
  const real = {
    text: q('#caaci-login-notice').textContent,
    className: q('#caaci-login-notice').className,
    button: q('#caaci-li-code-send').textContent,
    form: q('#caaci-li-code-form').hidden,
  };

  for (const error of NO_ACCOUNT_ERRORS) {
    await failedLogin(supaStub({ auth: { signInWithOtp: async () => ({ data: {}, error }) } }));
    q('#caaci-li-code-send').click();
    await tick();
    assert.deepEqual(
      {
        text: q('#caaci-login-notice').textContent,
        className: q('#caaci-login-notice').className,
        button: q('#caaci-li-code-send').textContent,
        form: q('#caaci-li-code-form').hidden,
      },
      real,
      `"${error.message}" must not reveal that there is no account`,
    );
  }
});

test('login page: a rate-limited code request counts down from the seconds Supabase gave', async (t) => {
  mockClock(t);
  const error = {
    code: 'over_email_send_rate_limit',
    status: 429,
    message: 'For security purposes, you can only request this after 37 seconds.',
  };
  await failedLogin(supaStub({ auth: { signInWithOtp: async () => ({ data: {}, error }) } }));
  q('#caaci-li-code-send').click();
  await tick();
  assert.match(q('#caaci-login-notice').textContent, /37 seconds/);
  assert.equal(q('#caaci-li-code-send').textContent, 'Resend in 37s');
});

test('login page: a correct code signs in with verifyOtp and lands where a password sign-in would', async (t) => {
  mockClock(t);
  for (const [isAdmin, landing] of [
    [false, '/account/'],
    [true, '/admin/'],
  ]) {
    const stub = supaStub({ isAdmin });
    await failedLogin(stub);
    q('#caaci-li-code-send').click();
    await tick();
    q('#caaci-li-code').value = ' 123 456 ';
    submit('#caaci-li-code-form');
    await tick();
    assert.deepEqual(callsTo(stub, 'verifyOtp'), [
      [{ email: 'mei@x.com', token: GOOD_CODE, type: 'email' }],
    ]);
    assert.equal(location.href, landing);
    assert.equal(
      q('#caaci-li-code-verify').getAttribute('aria-busy'),
      'true',
      'left busy — the page is navigating',
    );
  }
});

test('login page: a wrong or expired code says so and frees the button', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await failedLogin(stub);
  q('#caaci-li-code-send').click();
  await tick();

  q('#caaci-li-code').value = 'abc';
  submit('#caaci-li-code-form');
  await tick();
  assert.equal(callsTo(stub, 'verifyOtp').length, 0, 'not digits — nothing to verify');
  assert.match(q('#caaci-login-notice').className, /alert-danger/);

  q('#caaci-li-code').value = '000000';
  submit('#caaci-li-code-form');
  await tick();
  assert.equal(callsTo(stub, 'verifyOtp').length, 1);
  assert.equal(q('#caaci-login-notice').textContent, WRONG_CODE);
  assert.match(q('#caaci-login-notice').className, /alert-danger/);
  const verify = q('#caaci-li-code-verify');
  assert.equal(verify.disabled, false);
  assert.equal(verify.getAttribute('aria-busy'), null);
  assert.equal(location.href, '');

  member.__setLang('zh');
  try {
    await failedLogin(supaStub());
    q('#caaci-li-code-send').click();
    await tick();
    assert.equal(q('#caaci-login-notice').textContent, '如果该邮箱已注册，验证码已发送。');
    q('#caaci-li-code').value = '000000';
    submit('#caaci-li-code-form');
    await tick();
    assert.equal(q('#caaci-login-notice').textContent, '验证码错误或已过期，请重新获取。');
  } finally {
    member.__setLang('en');
  }
});

// ---------------------------------------------------------------- email template

test('the magic-link email carries the one-time code as well as the link', async () => {
  const dir = new URL('../supabase/templates/', import.meta.url);
  const html = await readFile(new URL('magic_link.html', dir), 'utf8');
  assert.match(html, /\{\{\s*\.ConfirmationURL\s*\}\}/);
  assert.match(html, /\{\{\s*\.Token\s*\}\}/);
  assert.match(html, /或输入以下验证码登录/);
  assert.match(html, /Or enter this code to sign in/);

  // After the sign-in button, before the copy-this-link fallback.
  const token = html.search(/\{\{\s*\.Token\s*\}\}/);
  assert.ok(html.lastIndexOf('</table>', token) !== -1, 'code comes after the button table');
  assert.ok(token < html.indexOf('按钮无法点击'), 'code comes before the link fallback');
  assert.doesNotMatch(html, /no one can sign in without this link\./, 'a code signs in too');

  const subjects = JSON.parse(await readFile(new URL('subjects.json', dir), 'utf8'));
  assert.match(subjects.magic_link, /验证码/);
  assert.match(subjects.magic_link, /code/i);

  // push-auth-emails.mjs refuses to push a magic-link template that lost its code.
  const good = await loadTemplates();
  assert.throws(
    () =>
      buildAuthPatch({
        subjects: good.subjects,
        contents: {
          ...good.contents,
          magic_link: good.contents.magic_link.replace(/\{\{\s*\.Token\s*\}\}/g, ''),
        },
      }),
    /magic_link\.html has no \{\{ \.Token \}\}/,
  );
});
