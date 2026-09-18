// Sign in with a mobile number. The login page gets an Email | Mobile number
// tab pair; the phone tab texts a one-time code (signInWithOtp with a phone and
// shouldCreateUser:false — only a number already verified on an account gets
// one) and signs in with verifyOtp(type 'sms'). The account page's Security
// section is where a member adds that number (updateUser({ phone }) +
// verifyOtp(type 'phone_change')), and 0025 copies a confirmed number onto
// members.phone.
//
// Boots the real login page and module in jsdom, as legacy-login-hint.test.js
// does. The React account section is TypeScript, which node --test cannot load
// on Node 20 (CI), so its contract is pinned by reading the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { normalizePhone } from '../src/caaci-shared.js';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const LOGIN = await readFile(new URL('../member-src/login.html', import.meta.url), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 15));
const q = (s) => document.querySelector(s);
const callsTo = (stub, name) => stub.calls.filter((c) => c.name === name).map((c) => c.args);
const mockClock = (t) => t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
const submit = (sel) => q(sel).dispatchEvent(new Event('submit'));
const typeInto = (sel, value) => {
  q(sel).value = value;
  q(sel).dispatchEvent(new Event('input'));
};

function setup({ search = '' } = {}) {
  const dom = new JSDOM(LOGIN, { url: 'https://caaci.example/x/' });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.Image = dom.window.Image;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.location = {
    pathname: '/login-3/',
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

const GOOD_CODE = '123456';
const E164 = '+12175550123';
const SENT = "If this number is on an account, we've texted it a sign-in code.";
const NO_ACCOUNT_ERRORS = [
  { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' },
  { code: 'user_not_found', status: 404, message: 'User not found' },
  { status: 422, message: 'Signups not allowed for otp' },
];

// A code equal to GOOD_CODE signs in as u-phone; anything else is refused.
function supaStub({ isAdmin = false, auth = {} } = {}) {
  const calls = [];
  const methods = {
    getUser: async () => ({ data: { user: null } }),
    getSession: async () => ({ data: { session: null } }),
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    }),
    signInWithOtp: async () => ({ data: {}, error: null }),
    verifyOtp: async ({ phone, token }) =>
      token === GOOD_CODE
        ? { data: { user: { id: 'u-phone', phone }, session: {} }, error: null }
        : {
            data: { user: null, session: null },
            error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' },
          },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    resend: async () => ({ data: {}, error: null }),
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
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: isAdmin ? { is_admin: true } : null }) }),
      }),
    }),
  };
}

// The login page, wired, on the phone tab.
async function phoneTab(stub, { search = '', click = true } = {}) {
  setup({ search });
  member.__setSupa(stub);
  await member.wireAuthPage();
  if (click) q('#caaci-li-tab-phone').click();
}

// -------------------------------------------------------------- normalizePhone

test('normalizePhone: ten US/Canada digits in any common spelling become +1…', () => {
  for (const typed of [
    '2175550123',
    '(217) 555-0123',
    '217.555.0123',
    '217 555 0123',
    '  217-555-0123 ',
    '+1 (217) 555-0123',
    '+1-217-555-0123',
  ])
    assert.equal(normalizePhone(typed), E164, JSON.stringify(typed));
});

test('normalizePhone: other countries need + and the country code; eleven bare digits starting with 1 are refused', () => {
  assert.equal(normalizePhone('+86 138 0013 8000'), '+8613800138000');
  assert.equal(normalizePhone('+44 7911 123456'), '+447911123456');
  // 13800138000 is a Chinese mobile AND 1 + a Columbus, Ohio number: a code
  // texted to the wrong reading goes to a stranger, so neither reading is guessed.
  assert.equal(normalizePhone('13800138000'), null);
  assert.equal(normalizePhone('1 217 555 0123'), null, 'the same shape — type +1 or drop the 1');
  assert.equal(normalizePhone('0086 138 0013 8000'), null, '00 is not a country-code prefix here');
});

test('normalizePhone: anything that cannot be a number is null', () => {
  for (const bad of [
    '',
    '   ',
    null,
    undefined,
    '555-0123',
    '217555012',
    '02175550123',
    'call me',
    '+',
    '+1',
    '+0 123456789',
    '2175550123 ext 5',
    '+1234567890123456',
  ])
    assert.equal(normalizePhone(bad), null, JSON.stringify(bad));
});

// ------------------------------------------------------------------ the tabs

test('login page: the Mobile number tab swaps the panels, is remembered, and ?method=phone opens it', async (t) => {
  mockClock(t);
  await phoneTab(supaStub(), { click: false });
  // Email first by default.
  assert.equal(q('#caaci-li-panel-email').hidden, false);
  assert.equal(q('#caaci-li-panel-phone').hidden, true);
  assert.equal(q('#caaci-li-tab-email').getAttribute('aria-selected'), 'true');
  assert.equal(q('#caaci-li-tab-phone').getAttribute('aria-selected'), 'false');

  q('#caaci-li-tab-phone').click();
  assert.equal(q('#caaci-li-panel-email').hidden, true);
  assert.equal(q('#caaci-li-panel-phone').hidden, false);
  assert.equal(q('#caaci-li-tab-phone').getAttribute('aria-selected'), 'true');
  assert.equal(q('#caaci-li-tab-phone').classList.contains('active'), true);
  assert.equal(q('#caaci-li-tab-email').classList.contains('active'), false);
  assert.equal(q('#caaci-li-tab-email').tabIndex, -1, 'roving tabindex');
  assert.equal(document.activeElement, q('#caaci-ph-number'), 'focus moves into the panel');
  assert.equal(localStorage.getItem('caaci-login-method'), 'phone');
  // The OAuth buttons stay available on both tabs.
  assert.equal(q('#caaci-oauth-host').closest('[hidden]'), null);

  // Next visit: the remembered tab (same jsdom localStorage).
  const store = localStorage;
  setup();
  globalThis.localStorage = store;
  member.__setSupa(supaStub());
  await member.wireAuthPage();
  assert.equal(q('#caaci-li-panel-phone').hidden, false, 'remembered');

  // A link from the account page.
  await phoneTab(supaStub(), { search: '?method=phone', click: false });
  assert.equal(q('#caaci-li-panel-phone').hidden, false);
  assert.equal(q('#caaci-li-panel-email').hidden, true);

  // An unknown method falls back to email.
  await phoneTab(supaStub(), { search: '?method=carrier-pigeon', click: false });
  assert.equal(q('#caaci-li-panel-email').hidden, false);
});

test('login page: switching tabs clears the other way in’s message and offer', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await phoneTab(stub, { click: false });
  q('#caaci-li-email').value = 'mei@x.com';
  q('#caaci-li-pwd').value = 'wrong';
  submit('#caaci-login-form');
  await tick();
  assert.equal(q('#caaci-login-notice').hidden, false);
  assert.equal(q('#caaci-li-legacy').hidden, false, 'the reset/code offer for the email');

  q('#caaci-li-tab-phone').click();
  assert.equal(q('#caaci-login-notice').hidden, true);
  assert.equal(q('#caaci-li-legacy').hidden, true);
});

test('login page: the labels are in Chinese when the page is', async (t) => {
  mockClock(t);
  member.__setLang('zh');
  try {
    await phoneTab(supaStub());
    member.applyLang();
    assert.equal(q('#caaci-li-tab-phone').textContent, '手机号');
    assert.equal(q('#caaci-ph-send').textContent, '发送短信验证码');
    typeInto('#caaci-ph-number', 'nope');
    submit('#caaci-phone-form');
    await tick();
    assert.match(q('#caaci-login-notice').textContent, /请输入有效的手机号/);
  } finally {
    member.__setLang('en');
  }
});

// -------------------------------------------------------------- send a code

test('login page: a valid number asks for a code without creating an account, then offers code entry', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await phoneTab(stub);
  typeInto('#caaci-ph-number', '(217) 555-0123');
  submit('#caaci-phone-form');
  await tick();
  assert.deepEqual(callsTo(stub, 'signInWithOtp'), [
    [{ phone: E164, options: { shouldCreateUser: false } }],
  ]);
  assert.equal(q('#caaci-login-notice').textContent, SENT);
  assert.match(q('#caaci-login-notice').className, /alert-success/);
  const send = q('#caaci-ph-send');
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Resend in 60s');

  assert.equal(q('#caaci-ph-code-form').hidden, false);
  const input = q('#caaci-ph-code');
  assert.equal(input.getAttribute('inputmode'), 'numeric');
  assert.equal(input.getAttribute('autocomplete'), 'one-time-code');
  assert.equal(input.getAttribute('pattern'), '[0-9]{6,10}');
  assert.equal(document.activeElement, input);

  // The countdown runs out and the button offers another text.
  t.mock.timers.tick(61000);
  assert.equal(send.disabled, false);
  assert.equal(send.textContent, 'Text me another code');
});

test('login page: a number that cannot be a phone is refused before anything is sent', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await phoneTab(stub);
  for (const typed of ['', '555-0123', '13800138000', 'call me']) {
    typeInto('#caaci-ph-number', typed);
    submit('#caaci-phone-form');
    await tick();
    assert.match(q('#caaci-login-notice').textContent, /valid mobile number/);
    assert.match(q('#caaci-login-notice').textContent, /start with \+ and the country code/);
    assert.match(q('#caaci-login-notice').className, /alert-danger/);
  }
  assert.equal(callsTo(stub, 'signInWithOtp').length, 0);
  assert.equal(q('#caaci-ph-code-form').hidden, true);
});

test('login page: a code request for a number with no account reads exactly like a real send', async (t) => {
  mockClock(t);
  await phoneTab(supaStub());
  typeInto('#caaci-ph-number', E164);
  submit('#caaci-phone-form');
  await tick();
  const real = {
    text: q('#caaci-login-notice').textContent,
    className: q('#caaci-login-notice').className,
    button: q('#caaci-ph-send').textContent,
    form: q('#caaci-ph-code-form').hidden,
  };

  for (const error of NO_ACCOUNT_ERRORS) {
    await phoneTab(supaStub({ auth: { signInWithOtp: async () => ({ data: {}, error }) } }));
    typeInto('#caaci-ph-number', E164);
    submit('#caaci-phone-form');
    await tick();
    assert.deepEqual(
      {
        text: q('#caaci-login-notice').textContent,
        className: q('#caaci-login-notice').className,
        button: q('#caaci-ph-send').textContent,
        form: q('#caaci-ph-code-form').hidden,
      },
      real,
      `"${error.message}" must not reveal that there is no account`,
    );
  }
});

test('login page: a rate-limited text counts down from the seconds Supabase gave; a Twilio failure gets a plain message', async (t) => {
  mockClock(t);
  const limited = {
    code: 'over_sms_send_rate_limit',
    status: 429,
    message: 'For security purposes, you can only request this after 37 seconds.',
  };
  await phoneTab(supaStub({ auth: { signInWithOtp: async () => ({ data: {}, error: limited }) } }));
  typeInto('#caaci-ph-number', E164);
  submit('#caaci-phone-form');
  await tick();
  assert.match(q('#caaci-login-notice').textContent, /37 seconds/);
  assert.equal(q('#caaci-ph-send').textContent, 'Resend in 37s');
  assert.equal(q('#caaci-ph-code-form').hidden, true, 'nothing was sent');

  const twilio = {
    code: 'sms_send_failed',
    status: 500,
    message: "Error sending sms: The 'To' number +12175550123 is not a valid phone number.",
  };
  await phoneTab(supaStub({ auth: { signInWithOtp: async () => ({ data: {}, error: twilio }) } }));
  typeInto('#caaci-ph-number', E164);
  submit('#caaci-phone-form');
  await tick();
  assert.match(q('#caaci-login-notice').textContent, /could not send a text/);
  assert.doesNotMatch(q('#caaci-login-notice').textContent, /Error sending sms/);
  assert.match(q('#caaci-login-notice').className, /alert-danger/);
  assert.equal(q('#caaci-ph-send').disabled, false, 'not a rate limit — no countdown');
});

test('login page: changing the number hides the code entry; retyping a number texted moments ago brings it back', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await phoneTab(stub);
  typeInto('#caaci-ph-number', E164);
  submit('#caaci-phone-form');
  await tick();
  assert.equal(q('#caaci-ph-code-form').hidden, false);

  typeInto('#caaci-ph-number', '+1 217 555 0124');
  assert.equal(q('#caaci-ph-code-form').hidden, true);
  assert.equal(q('#caaci-ph-code').value, '');
  assert.equal(q('#caaci-ph-send').disabled, false, 'the other number has no countdown');
  assert.equal(q('#caaci-ph-send').textContent, 'Text me a sign-in code');

  typeInto('#caaci-ph-number', '217-555-0123'); // the same number, spelt differently
  assert.equal(q('#caaci-ph-code-form').hidden, false, 'the code already texted still works');
  assert.equal(q('#caaci-ph-send').textContent, 'Resend in 60s');

  // Same spelling, no change: the code entry stays.
  typeInto('#caaci-ph-number', '217-555-0123');
  assert.equal(q('#caaci-ph-code-form').hidden, false);
});

// ------------------------------------------------------------- verify a code

test('login page: a correct code signs in with verifyOtp(type sms) and lands where a password sign-in would', async (t) => {
  mockClock(t);
  for (const [isAdmin, search, landing] of [
    [false, '', '/account/'],
    [false, '?next=/membership/?tier=family', '/membership/?tier=family'],
    [true, '', '/admin/'],
  ]) {
    const stub = supaStub({ isAdmin });
    await phoneTab(stub, { search });
    typeInto('#caaci-ph-number', '2175550123');
    submit('#caaci-phone-form');
    await tick();
    q('#caaci-ph-code').value = ' 123 456 ';
    submit('#caaci-ph-code-form');
    await tick();
    assert.deepEqual(callsTo(stub, 'verifyOtp'), [
      [{ phone: E164, token: GOOD_CODE, type: 'sms' }],
    ]);
    assert.equal(location.href, landing);
    assert.equal(
      q('#caaci-ph-verify').getAttribute('aria-busy'),
      'true',
      'left busy — the page is navigating',
    );
  }
});

test('login page: a wrong or expired code says so and frees the button', async (t) => {
  mockClock(t);
  const stub = supaStub();
  await phoneTab(stub);
  typeInto('#caaci-ph-number', E164);
  submit('#caaci-phone-form');
  await tick();

  q('#caaci-ph-code').value = 'abc';
  submit('#caaci-ph-code-form');
  await tick();
  assert.equal(callsTo(stub, 'verifyOtp').length, 0, 'not digits — nothing to verify');
  assert.equal(q('#caaci-login-notice').textContent, 'Enter the code from the text message.');

  q('#caaci-ph-code').value = '000000';
  submit('#caaci-ph-code-form');
  await tick();
  assert.equal(callsTo(stub, 'verifyOtp').length, 1);
  assert.equal(
    q('#caaci-login-notice').textContent,
    'That code is wrong or has expired — request a new one.',
  );
  assert.match(q('#caaci-login-notice').className, /alert-danger/);
  const verify = q('#caaci-ph-verify');
  assert.equal(verify.disabled, false);
  assert.equal(verify.getAttribute('aria-busy'), null);
  assert.equal(location.href, '');

  member.__setLang('zh');
  try {
    await phoneTab(supaStub());
    typeInto('#caaci-ph-number', E164);
    submit('#caaci-phone-form');
    await tick();
    assert.equal(
      q('#caaci-login-notice').textContent,
      '如果该手机号已绑定账户，验证码已通过短信发送。',
    );
    q('#caaci-ph-code').value = '000000';
    submit('#caaci-ph-code-form');
    await tick();
    assert.equal(q('#caaci-login-notice').textContent, '验证码错误或已过期，请重新获取。');
  } finally {
    member.__setLang('en');
  }
});

test('login page: the emailed one-time code still verifies as type email', async (t) => {
  mockClock(t);
  const stub = supaStub({
    auth: {
      verifyOtp: async ({ email }) => ({
        data: { user: { id: 'u-code', email }, session: {} },
        error: null,
      }),
    },
  });
  await phoneTab(stub, { click: false });
  q('#caaci-li-email').value = 'mei@x.com';
  q('#caaci-li-pwd').value = 'wrong';
  submit('#caaci-login-form');
  await tick();
  q('#caaci-li-code-send').click();
  await tick();
  q('#caaci-li-code').value = GOOD_CODE;
  submit('#caaci-li-code-form');
  await tick();
  assert.deepEqual(callsTo(stub, 'verifyOtp'), [
    [{ email: 'mei@x.com', token: GOOD_CODE, type: 'email' }],
  ]);
  assert.equal(location.href, '/account/');
});

// ------------------------------------------------- /account/ (React, by source)

const SECURITY = await readFile(
  new URL('../web/src/pages/account/SecurityCard.tsx', import.meta.url),
  'utf8',
);

test('account security: adding a mobile number goes through updateUser({ phone }) with the normalised number', () => {
  assert.match(SECURITY, /import \{ normalizePhone \} from '\.\.\/\.\.\/lib\/shared'/);
  assert.match(SECURITY, /const value = normalizePhone\(newPhone\)/);
  assert.match(SECURITY, /supabase\.auth\.updateUser\(\{ phone: value \}\)/);
  // A number Supabase already confirmed is not re-sent.
  assert.match(SECURITY, /if \(value === verifiedPhone\)/);
});

test('account security: the texted code confirms the change as phone_change, and only a confirmed number counts', () => {
  assert.match(
    SECURITY,
    /verifyOtp\(\{\s*phone: pendingPhone,\s*token,\s*type: 'phone_change',?\s*\}\)/,
  );
  assert.match(SECURITY, /resend\(\{ type: 'phone_change', phone: pendingPhone \}\)/);
  assert.match(
    SECURITY,
    /const verifiedPhoneOf = \(user: User\) => \(user\.phone_confirmed_at && user\.phone\) \|\| ''/,
  );
  // Phone confirmations off in the dashboard: Supabase saves it at once — no code step.
  assert.match(SECURITY, /verifiedPhoneOf\(updated\) === value\) return phoneSaved\(value\)/);
  // The same 60 s "send again" countdown as every auth email.
  assert.match(SECURITY, /useCooldown\('sms_change', user\.id\)/);
  assert.match(SECURITY, /phCooldown\.start\(SMS_COOLDOWN_S\)/);
});

test('account security: the refusals a member can act on are worded, in both languages', () => {
  assert.match(SECURITY, /'phone_exists'/);
  assert.match(SECURITY, /That number is already on another account\./);
  assert.match(SECURITY, /该手机号已被其他账户使用。/);
  assert.match(SECURITY, /'sms_send_failed'/);
  assert.match(SECURITY, /Enter a valid mobile number\. Outside the US and Canada/);
  assert.match(SECURITY, /请输入有效的手机号/);
  assert.match(SECURITY, /Enter the code from the text message\./);
  assert.match(SECURITY, /id="account-phone"/);
});

// --------------------------------------------------------------- migration

test('0025_phone_login.sql copies a confirmed mobile number onto members.phone', async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const own = files.find((f) => f.endsWith('_phone_login.sql'));
  assert.equal(own, '0025_phone_login.sql');
  const sql = (await readFile(new URL(own, dir), 'utf8')).replace(/--[^\n]*/g, '');
  const flat = sql.replace(/\s+/g, ' ').toLowerCase();

  // handle_new_user keeps its shape (0007) and also takes auth.users.phone.
  assert.match(flat, /create or replace function public\.handle_new_user\(\)/);
  assert.match(flat, /insert into public\.members \(id, email, full_name, phone\)/);
  assert.match(flat, /coalesce\(nullif\(new\.raw_user_meta_data->>'phone', ''\), new\.phone\)/);
  assert.match(flat, /on conflict \(id\) do nothing/);

  assert.match(flat, /create or replace function public\.handle_user_phone_change\(\)/);
  assert.match(flat, /security definer set search_path = public/);
  assert.match(
    flat,
    /new\.phone_confirmed_at is not null/,
    'a pending, unverified number stays off the profile',
  );
  assert.match(flat, /update public\.members set phone = new\.phone where id = new\.id/);
  assert.match(flat, /drop trigger if exists on_auth_user_phone_change on auth\.users/);
  assert.match(
    flat,
    /create trigger on_auth_user_phone_change after update of phone, phone_confirmed_at on auth\.users for each row execute function public\.handle_user_phone_change\(\)/,
  );
  // Only adds and replaces: nothing is dropped or altered on members.
  assert.doesNotMatch(flat, /alter table|drop table|drop column|delete from/);
});
