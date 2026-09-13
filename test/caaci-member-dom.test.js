// Boots the REAL member pages (member-src/*.html) + the real module
// (src/caaci-member.js) in jsdom with Supabase and the APIs stubbed.
// Pins the behavioral contracts ported from caaci-app.js: fee math, the
// /api/checkout body, the duplicate-email guard, and the admin redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const PAGES = {};
for (const p of ['login', 'membership', 'account'])
  PAGES[p] = await readFile(new URL(`../member-src/${p}.html`, import.meta.url), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 15));

function setup(page, { search = '', hash = '' } = {}) {
  const dom = new JSDOM(PAGES[page], { url: 'https://caaci.example/x/' });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.Image = dom.window.Image;
  globalThis.localStorage = dom.window.localStorage;
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

test('membership page: the free tier joins without Stripe and lands on /account/', async () => {
  setup('membership');
  member.__setSupa(supaStub()); // logged out
  const fetch = mockFetch((u) =>
    u.includes('/api/checkout') ? { body: { ok: true, activated: true, tier_id: 'free' } } : {},
  );
  try {
    await member.wireMembershipPage();
    const card = document.querySelector('[data-tier="free"]').closest('.card');
    assert.match(card.textContent, /Free/);
    assert.doesNotMatch(card.textContent, /3\.5%/, 'no fee line on the free card');
    assert.match(card.querySelector('[data-tier="free"]').textContent, /Join for free/);

    card.querySelector('[data-tier="free"]').click();
    await tick();
    const summary = document.querySelector('#caaci-co-summary').textContent;
    assert.match(summary, /Free/);
    assert.doesNotMatch(summary, /\$/, 'no dollar amounts');
    assert.equal(document.querySelector('#caaci-code'), null, 'no discount-code box');

    document.querySelector('#caaci-email').value = 'new@x.com';
    document.querySelector('#caaci-pwd').value = 'longenough1';
    document.querySelector('#caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url.includes('/api/checkout'));
    assert.deepEqual(JSON.parse(call.options.body), {
      type: 'membership',
      tier_id: 'free',
      email: 'new@x.com',
      member_id: 'u-new',
    });
    assert.equal(location.href, '/account/'); // no Stripe redirect
  } finally {
    fetch.restore();
  }
});

test('membership page: Honorable tier sends a visitor to log in first, then back here', async () => {
  setup('membership');
  member.__setSupa(supaStub()); // logged out
  const fetch = mockFetch(() => ({ body: {} }));
  try {
    await member.wireMembershipPage();
    const card = [...document.querySelectorAll('#caaci-plans-row .card')].find((c) =>
      /Honorable/.test(c.textContent),
    );
    assert.ok(card, 'honorary card renders');
    assert.match(card.textContent, /Free/);
    assert.equal(card.querySelector('[data-tier]'), null, 'no checkout button');

    card.querySelector('[data-invite="honorary"]').click();
    await tick();
    assert.equal(location.href, '/login-3/?next=%2Fmembership%2F%3Ftier%3Dhonorary');
    assert.equal(
      document.querySelector('#caaci-inv-name'),
      null,
      'no request form while logged out',
    );
    assert.equal(fetch.calls.length, 0, 'nothing posted');
  } finally {
    fetch.restore();
  }
});

test('membership page: a live paid member is sent to billing instead of switching to free; a free member upgrades via fresh checkout', async () => {
  // Paid + active → the free card has no switch button, just a link to /account/.
  setup('membership');
  const user = { id: 'u1', email: 'mei@x.com' };
  member.__setSupa(
    supaStub({ user, memberRow: { id: 'u1', tier_id: 'family', status: 'active' } }),
  );
  await member.wireMembershipPage();
  assert.equal(document.querySelector('[data-tier="free"]'), null);
  const freeCard = [...document.querySelectorAll('#caaci-plans-row .card')].find((c) =>
    /Free Membership/.test(c.textContent),
  );
  assert.ok(freeCard.querySelector('a[href="/account/"]'));
  assert.match(freeCard.textContent, /Cancel your paid plan first/);

  // Free + active → picking a paid tier is a first purchase (/api/checkout), not a plan change.
  setup('membership');
  member.__setSupa(supaStub({ user, memberRow: { id: 'u1', tier_id: 'free', status: 'active' } }));
  const fetch = mockFetch((u) =>
    u.includes('/api/checkout') ? { body: { url: 'https://stripe.test/session' } } : {},
  );
  try {
    await member.wireMembershipPage();
    document.querySelector('[data-tier="individual"]').click();
    await tick();
    assert.match(document.querySelector('#caaci-co-title').textContent, /confirm your membership/i);
    document.querySelector('#caaci-pay').click();
    await tick();
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/api/change-plan')),
      false,
    );
    const call = fetch.calls.find((c) => c.url.includes('/api/checkout'));
    assert.equal(JSON.parse(call.options.body).tier_id, 'individual');
    assert.equal(location.href, 'https://stripe.test/session');
  } finally {
    fetch.restore();
  }
});

test('membership page: a signed-in visitor requests Honorable Membership via /api/contact, never checkout', async () => {
  // Arriving with ?tier=honorary (the login page sends people back here) opens
  // the request form directly, prefilled from the account.
  setup('membership', { search: '?tier=honorary' });
  const user = { id: 'u1', email: 'ada@example.com' };
  member.__setSupa(
    supaStub({ user, memberRow: { id: 'u1', full_name: 'Ada', status: 'pending' } }),
  );
  const fetch = mockFetch((u) =>
    u.includes('/api/contact') ? { body: { ok: true } } : { body: {} },
  );
  try {
    await member.wireMembershipPage();
    await tick();
    assert.equal(document.querySelector('#caaci-inv-name').value, 'Ada');
    assert.equal(document.querySelector('#caaci-inv-email').value, 'ada@example.com');
    document.querySelector('#caaci-inv-msg').value = 'Ran the festival kitchen for a decade.';
    document.querySelector('[data-act="send"]').click();
    await tick();

    const call = fetch.calls.find((c) => c.url.includes('/api/contact'));
    const body = JSON.parse(call.options.body);
    assert.equal(body.email, 'ada@example.com');
    assert.match(body.message, /^\[Honorable Membership request\]/);
    assert.match(document.querySelector('#caaci-inv-notice').textContent, /Request sent/);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/api/checkout')),
      false,
    );
    assert.equal(location.href, '', 'no redirect once signed in');
  } finally {
    fetch.restore();
  }
});

test('membership page in 中文: banner status, badges, and descriptions have no English left', async () => {
  setup('membership');
  const user = { id: 'u1', email: 'mei@x.com' };
  member.__setSupa(supaStub({ user, memberRow: { id: 'u1', tier_id: 'free', status: 'active' } }));
  member.__setLang('zh');
  try {
    await member.wireMembershipPage();
    const banner = document.querySelector('#caaci-plans-you').textContent;
    assert.match(banner, /免费会员 · 有效/);
    assert.doesNotMatch(banner, /Active/);
    const cards = document.querySelector('#caaci-plans-row').textContent;
    assert.match(cards, /最受欢迎/);
    assert.match(cards, /面向年满 18 岁的在校大学生/);
    // Only prices, "3.5%", and the CAACI name may be Latin script.
    assert.doesNotMatch(cards.replace(/CAACI/g, ''), /[A-Za-z]{2,}/);
  } finally {
    member.__setLang('en');
  }
});

test('account page: a free member sees Free, an Upgrade link, and no billing portal button', async () => {
  setup('account');
  const user = { id: 'u1', email: 'mei@x.com' };
  member.__setSupa(
    supaStub({
      user,
      memberRow: { id: 'u1', full_name: 'Mei Lin', tier_id: 'free', status: 'active' },
    }),
  );
  globalThis.window.qrcode = () => ({
    addData() {},
    make() {},
    createDataURL: () => 'data:image/gif;base64,R0lGOD',
  });
  const fetch = mockFetch(() => ({ status: 503, body: {} }));
  try {
    await member.wireAccountPage();
    const host = document.querySelector('#caaci-account-host');
    assert.match(host.textContent, /Free Membership/);
    assert.doesNotMatch(host.textContent, /3\.5% card fee/);
    assert.equal(document.querySelector('#caaci-billing'), null, 'no Stripe portal button');
    assert.match(host.querySelector('a[href="/membership/"]').textContent, /Upgrade/);
  } finally {
    fetch.restore();
  }
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

test('membership page: plans render with fee-inclusive prices; checkout posts the right body', async () => {
  setup('membership', { search: '?code=spring20' });
  member.__setSupa(supaStub()); // logged out
  const fetch = mockFetch((u) => {
    if (u.includes('/api/discount')) return { body: { code: 'SPRING20', percent_off: 20 } };
    if (u.includes('/api/checkout')) return { body: { url: 'https://stripe.test/session' } };
    return { body: {} };
  });
  try {
    await member.wireMembershipPage();

    const cards = document.querySelectorAll('#caaci-plans-row .card');
    assert.ok(cards.length >= 4, 'all tiers render');
    // Individual: 3000 base → $31.05 with the 3.5% fee
    assert.match(document.querySelector('#caaci-plans-row').textContent, /\$31\.05/);
    assert.match(document.querySelector('#caaci-plans-discount').textContent, /SPRING20/);

    // open checkout for individual → summary shows the discount on the fee-inclusive total
    document.querySelector('[data-tier="individual"]').click();
    await tick();
    const summary = document.querySelector('#caaci-co-summary').textContent;
    assert.match(summary, /\$31\.05/); // annual + fee lines
    assert.match(summary, /−\$6\.21/); // 20% of $31.05
    assert.match(summary, /\$24\.84/); // total today

    // anonymous signup → checkout
    document.querySelector('#caaci-email').value = 'new@x.com';
    document.querySelector('#caaci-pwd').value = 'longenough1';
    document.querySelector('#caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url.includes('/api/checkout'));
    assert.ok(call, 'posted /api/checkout');
    assert.deepEqual(JSON.parse(call.options.body), {
      type: 'membership',
      tier_id: 'individual',
      email: 'new@x.com',
      member_id: 'u-new',
      discount_code: 'SPRING20',
    });
    assert.equal(location.href, 'https://stripe.test/session');
  } finally {
    fetch.restore();
  }
});

test('membership page: active member switching plans posts /api/change-plan, no redirect', async () => {
  setup('membership');
  const user = { id: 'u1', email: 'mei@x.com' };
  member.__setSupa(
    supaStub({ user, memberRow: { id: 'u1', tier_id: 'family', status: 'active' } }),
  );
  const fetch = mockFetch((u) => {
    if (u.includes('/api/change-plan')) return { body: { ok: true, tier_id: 'individual' } };
    return { body: {} };
  });
  try {
    await member.wireMembershipPage();
    document.querySelector('[data-tier="individual"]').click();
    await tick();
    assert.match(document.querySelector('#caaci-co-title').textContent, /change your plan/i);
    document.querySelector('#caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url.includes('/api/change-plan'));
    assert.deepEqual(JSON.parse(call.options.body), { member_id: 'u1', tier_id: 'individual' });
    assert.equal(location.href, ''); // in-place update, no redirect
    assert.match(document.querySelector('#caaci-co-notice').textContent, /updated/i);
  } finally {
    fetch.restore();
  }
});

test('account page: renders subscription, history, and card for an active member', async () => {
  setup('account');
  const user = { id: 'u1', email: 'mei@x.com' };
  member.__setSupa(
    supaStub({
      user,
      memberRow: {
        id: 'u1',
        full_name: 'Mei Lin',
        tier_id: 'individual',
        status: 'active',
        expires_at: '2027-03-01T00:00:00Z',
      },
      payments: [{ paid_at: '2026-07-20', kind: 'membership', amount_cents: 3105 }],
    }),
  );
  // fake QR lib for the membership card
  globalThis.window.qrcode = () => ({
    addData() {},
    make() {},
    createDataURL: () => 'data:image/gif;base64,R0lGOD',
  });
  const fetch = mockFetch((u) => {
    if (u.includes('/api/wallet-pass')) return { status: 503, body: { configured: false } };
    return { body: {} };
  });
  try {
    await member.wireAccountPage();
    const html = document.querySelector('#caaci-account-host').textContent;
    assert.match(html, /mei@x\.com/);
    assert.match(html, /Individual Membership/);
    assert.ok(document.querySelector('.badge.bg-success-lt'), 'active status badge');
    assert.match(html, /\$31\.05/); // history row
    assert.ok(document.querySelector('.caaci-mcard2'), 'membership card rendered');
    assert.equal(document.querySelector('#caaci-mcard-dl').disabled, false);
    assert.equal(document.querySelector('#caaci-wallet').hidden, true); // 503 → stays hidden
  } finally {
    fetch.restore();
  }
});

test('account page: signed-out prompt', async () => {
  setup('account');
  member.__setSupa(supaStub({ user: null }));
  await member.wireAccountPage();
  assert.match(document.querySelector('#caaci-account-host').textContent, /not signed in/i);
  assert.ok(document.querySelector('#caaci-account-host a[href="/login-3/"]'));
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

test('membership checkout: log-in mode has a forgot-password link that emails the typed address', async (t) => {
  mockClock(t);
  setup('membership');
  const stub = supaStub(); // logged out
  member.__setSupa(stub);
  await member.wireMembershipPage();
  q('[data-tier="individual"]').click();
  await tick();

  const wrap = q('#caaci-co-forgotwrap');
  assert.equal(wrap.hidden, true, 'not offered while creating an account');
  q('#caaci-auth-toggle').click();
  assert.equal(wrap.hidden, false);

  const forgot = q('#caaci-co-forgot');
  forgot.click();
  await tick();
  assert.match(q('#caaci-co-notice').textContent, /valid email/i);
  assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 0);

  q('#caaci-email').value = 'mei@x.com';
  forgot.click();
  await tick();
  assert.deepEqual(callsTo(stub, 'resetPasswordForEmail'), [['mei@x.com', RESET_REDIRECT]]);
  assert.match(q('#caaci-co-notice').textContent, /check your inbox/i);
  assert.equal(forgot.disabled, true);
  assert.equal(forgot.textContent, 'Resend in 60s');

  q('#caaci-auth-toggle').click();
  assert.equal(wrap.hidden, true, 'hidden again back in signup mode');
});

// ---------- /account/: recovery links and account security ----------
const EXPIRED =
  'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

test('account page: an expired or already-used recovery link says so and points back to /login-3/', async () => {
  for (const where of [
    { search: '?recovery=1', hash: `#${EXPIRED}` },
    { search: `?recovery=1&${EXPIRED}` },
    { hash: `#type=recovery&${EXPIRED}` },
  ]) {
    setup('account', where);
    member.__setSupa(supaStub({ user: null }));
    await member.wireAccountPage();
    const rec = q('#caaci-recovery-host');
    const label = JSON.stringify(where);
    assert.match(rec.textContent, /password reset link/i, label);
    assert.match(rec.textContent, /expired or has already been used/i, label);
    assert.ok(rec.querySelector('a[href="/login-3/"]'), 'link to request a new one');
    assert.equal(q('#caaci-np'), null, 'no set-password form for a dead link');
    // URLSearchParams decodes "+" to spaces, so check the decoded wording.
    assert.doesNotMatch(rec.textContent, /invalid or has expired/, 'the URL text is not echoed');
  }
});

test('account page: other dead links (signup confirmation, email change, OAuth) get a generic message', async () => {
  for (const where of [
    { hash: `#${EXPIRED}` },
    {
      search:
        '?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code',
    },
  ]) {
    setup('account', where);
    member.__setSupa(supaStub({ user: null }));
    await member.wireAccountPage();
    const rec = q('#caaci-recovery-host');
    const label = JSON.stringify(where);
    assert.match(rec.textContent, /This link no longer works/, label);
    assert.doesNotMatch(rec.textContent, /password/i, label);
    assert.ok(rec.querySelector('a[href="/login-3/"]'), label);
    assert.doesNotMatch(rec.textContent, /invalid or has expired|exchange external code/, label);
  }
});

test('account page: a hostile error_description in a dead link is never rendered as markup', async () => {
  const hostile = encodeURIComponent('<img src=x onerror=alert(1)>');
  for (const where of [
    { search: `?recovery=1&error_code=otp_expired&error_description=${hostile}` },
    { hash: `#error=access_denied&error_description=${hostile}` },
  ]) {
    setup('account', where);
    member.__setSupa(supaStub({ user: null }));
    await member.wireAccountPage();
    assert.equal(document.querySelector('img, [onerror]'), null, JSON.stringify(where));
    assert.doesNotMatch(q('#caaci-recovery-host').textContent, /onerror/);
  }
});

test('account page: saving a password from a recovery link clears the marker and the form', async () => {
  setup('account', { search: '?recovery=1' });
  const user = { id: 'u1', email: 'mei@x.com', identities: [{ provider: 'email' }] };
  const stub = supaStub({ user, memberRow: { id: 'u1' } });
  member.__setSupa(stub);
  const replaced = [];
  window.history.replaceState = (...args) => replaced.push(args);
  await member.wireAccountPage();

  q('#caaci-np').value = 'newpassword1';
  q('#caaci-np2').value = 'newpassword1';
  q('#caaci-np-save').click();
  await tick();
  assert.deepEqual(callsTo(stub, 'updateUser'), [[{ password: 'newpassword1' }]]);
  assert.match(q('#caaci-recovery-host').textContent, /Password updated/);
  assert.equal(q('#caaci-np'), null, 'form replaced by the success message');
  assert.deepEqual(replaced, [[null, '', '/account/']]);
});

const EMAIL_USER = {
  id: 'u1',
  email: 'mei@x.com',
  identities: [{ provider: 'email' }],
  app_metadata: { provider: 'email', providers: ['email'] },
};
const OAUTH_USER = {
  id: 'u2',
  email: 'ada@x.com',
  identities: [{ provider: 'google' }],
  app_metadata: { provider: 'google', providers: ['google'] },
};

async function accountWith(user, auth = {}) {
  setup('account');
  const stub = supaStub({ user, memberRow: { id: user.id }, auth });
  member.__setSupa(stub);
  await member.wireAccountPage();
  return stub;
}
const fill = (sel, value) => {
  q(sel).value = value;
};
const PASSWORD_FIELDS = ['#caaci-pw-current', '#caaci-pw-new', '#caaci-pw-new2'];

test('account security: an email/password member confirms the current password to change it', async () => {
  const stub = await accountWith(EMAIL_USER);
  const card = q('#caaci-security');
  assert.ok(card, 'security card renders');
  assert.match(card.closest('.col-lg-6').textContent, /Profile/, 'in the Profile column');
  assert.match(card.textContent, /Change password/);

  q('#caaci-pw-save').click();
  await tick();
  assert.match(q('#caaci-pw-notice').textContent, /current password/i);
  fill('#caaci-pw-current', 'oldpassword1');
  fill('#caaci-pw-new', 'short');
  fill('#caaci-pw-new2', 'short');
  q('#caaci-pw-save').click();
  await tick();
  assert.match(q('#caaci-pw-notice').textContent, /at least 8 characters/);
  fill('#caaci-pw-new', 'newpassword1');
  fill('#caaci-pw-new2', 'different1');
  q('#caaci-pw-save').click();
  await tick();
  assert.match(q('#caaci-pw-notice').textContent, /do not match/);
  assert.equal(callsTo(stub, 'updateUser').length, 0);

  fill('#caaci-pw-new2', 'newpassword1');
  q('#caaci-pw-save').click();
  await tick();
  assert.deepEqual(callsTo(stub, 'updateUser'), [
    [{ password: 'newpassword1', current_password: 'oldpassword1' }],
  ]);
  assert.match(q('#caaci-pw-notice').textContent, /Password updated/);
  for (const s of PASSWORD_FIELDS) assert.equal(q(s).value, '', `${s} cleared`);
});

test('account security: an OAuth-only member sets a password with no current-password field', async () => {
  const stub = await accountWith(OAUTH_USER);
  assert.match(q('#caaci-security').textContent, /Set a password/);
  assert.equal(q('#caaci-pw-current'), null);
  fill('#caaci-pw-new', 'newpassword1');
  fill('#caaci-pw-new2', 'newpassword1');
  q('#caaci-pw-save').click();
  await tick();
  assert.deepEqual(callsTo(stub, 'updateUser'), [[{ password: 'newpassword1' }]]);
  assert.match(q('#caaci-pw-notice').textContent, /Password (updated|set)/);
});

test('account security: when Supabase wants reauthentication, the emailed code completes the change', async (t) => {
  mockClock(t);
  const stub = await accountWith(EMAIL_USER, {
    updateUser: async (attrs) => {
      if (!attrs.nonce)
        return {
          data: { user: null },
          error: {
            code: 'reauthentication_needed',
            message: 'Password update requires reauthentication',
          },
        };
      return attrs.nonce === '123456'
        ? { data: { user: EMAIL_USER }, error: null }
        : { data: { user: null }, error: { message: 'Invalid nonce' } };
    },
  });
  fill('#caaci-pw-current', 'oldpassword1');
  fill('#caaci-pw-new', 'newpassword1');
  fill('#caaci-pw-new2', 'newpassword1');
  q('#caaci-pw-save').click();
  await tick();

  assert.equal(callsTo(stub, 'reauthenticate').length, 1);
  const reauth = q('#caaci-pw-reauth');
  assert.equal(reauth.hidden, false);
  assert.match(reauth.textContent, /We emailed a verification code to mei@x\.com/);
  const resend = q('#caaci-pw-code-resend');
  assert.equal(resend.disabled, true);
  assert.equal(resend.textContent, 'Resend in 60s');
  t.mock.timers.tick(60000);
  resend.click();
  await tick();
  assert.equal(callsTo(stub, 'reauthenticate').length, 2, 'resend asks for another code');
  assert.equal(resend.textContent, 'Resend in 60s');

  fill('#caaci-pw-code', '000000');
  q('#caaci-pw-confirm').click();
  await tick();
  assert.match(q('#caaci-pw-notice').textContent, /Invalid nonce/);

  fill('#caaci-pw-code', '123456');
  q('#caaci-pw-confirm').click();
  await tick();
  assert.deepEqual(callsTo(stub, 'updateUser').at(-1), [
    { password: 'newpassword1', current_password: 'oldpassword1', nonce: '123456' },
  ]);
  assert.match(q('#caaci-pw-notice').textContent, /Password updated/);
  assert.equal(reauth.hidden, true);
  for (const s of [...PASSWORD_FIELDS, '#caaci-pw-code'])
    assert.equal(q(s).value, '', `${s} cleared`);
});

test('account security: changing email confirms via the new address, with a resend on cooldown', async (t) => {
  mockClock(t);
  const stub = await accountWith(EMAIL_USER);
  fill('#caaci-em-new', 'MEI@x.com');
  q('#caaci-em-save').click();
  await tick();
  assert.match(q('#caaci-em-notice').textContent, /already your email/i);
  fill('#caaci-em-new', 'not-an-email');
  q('#caaci-em-save').click();
  await tick();
  assert.match(q('#caaci-em-notice').textContent, /valid email/i);
  assert.equal(callsTo(stub, 'updateUser').length, 0);

  fill('#caaci-em-new', 'mei.lin@y.com');
  q('#caaci-em-save').click();
  await tick();
  assert.deepEqual(callsTo(stub, 'updateUser'), [
    [{ email: 'mei.lin@y.com' }, { emailRedirectTo: 'https://caaci.example/account/' }],
  ]);
  assert.match(q('#caaci-em-notice').textContent, /mei\.lin@y\.com/);
  const resend = q('#caaci-em-resend');
  assert.equal(resend.hidden, false);
  assert.equal(resend.disabled, true);
  assert.equal(resend.textContent, 'Resend in 60s');

  t.mock.timers.tick(60000);
  resend.click();
  await tick();
  // GoTrue finds the member by the CURRENT address and re-mails the pending
  // change; asked about the new address it finds no one and sends nothing.
  assert.deepEqual(callsTo(stub, 'resend'), [
    [
      {
        type: 'email_change',
        email: 'mei@x.com',
        options: { emailRedirectTo: 'https://caaci.example/account/' },
      },
    ],
  ]);
  assert.equal(resend.disabled, true);
});

const REAUTH_NEEDED = {
  data: { user: null },
  error: { code: 'reauthentication_needed', message: 'Password update requires reauthentication' },
};
const fillPasswords = (current, next, confirm = next) => {
  if (current != null) fill('#caaci-pw-current', current);
  fill('#caaci-pw-new', next);
  fill('#caaci-pw-new2', confirm);
};
const clickAndWait = async (sel) => {
  q(sel).click();
  await tick();
};

test('account security: Confirm sends the password fields as they are now, checked again', async (t) => {
  mockClock(t);
  const stub = await accountWith(EMAIL_USER, {
    updateUser: async (attrs) =>
      attrs.nonce ? { data: { user: EMAIL_USER }, error: null } : REAUTH_NEEDED,
  });
  fillPasswords('oldpassword1', 'newpassword1');
  await clickAndWait('#caaci-pw-save');
  assert.equal(q('#caaci-pw-reauth').hidden, false);
  fill('#caaci-pw-code', '123456');

  // Edited while the code prompt was open.
  fillPasswords('oldpassword1', 'betterpass22', 'mismatch22');
  await clickAndWait('#caaci-pw-confirm');
  assert.match(q('#caaci-pw-notice').textContent, /do not match/);
  fillPasswords('', 'betterpass22');
  await clickAndWait('#caaci-pw-confirm');
  assert.match(q('#caaci-pw-notice').textContent, /current password/i);
  fillPasswords('oldpassword1', 'short');
  await clickAndWait('#caaci-pw-confirm');
  assert.match(q('#caaci-pw-notice').textContent, /at least 8 characters/);
  assert.equal(callsTo(stub, 'updateUser').length, 1, 'nothing sent while the fields are invalid');

  fillPasswords('oldpassword2', 'betterpass22');
  await clickAndWait('#caaci-pw-confirm');
  assert.deepEqual(callsTo(stub, 'updateUser').at(-1), [
    { password: 'betterpass22', current_password: 'oldpassword2', nonce: '123456' },
  ]);
  assert.match(q('#caaci-pw-notice').textContent, /Password updated/);
});

test('account security: saving again while a code is cooling down shows the prompt without sending another', async (t) => {
  mockClock(t);
  const stub = await accountWith(EMAIL_USER, { updateUser: async () => REAUTH_NEEDED });
  fillPasswords('oldpassword1', 'newpassword1');
  await clickAndWait('#caaci-pw-save');
  assert.equal(callsTo(stub, 'reauthenticate').length, 1);

  await clickAndWait('#caaci-pw-save');
  assert.equal(callsTo(stub, 'reauthenticate').length, 1, 'no second code inside the cooldown');
  assert.equal(q('#caaci-pw-reauth').hidden, false);
  assert.equal(q('#caaci-pw-code-resend').disabled, true);

  t.mock.timers.tick(60000);
  await clickAndWait('#caaci-pw-save');
  assert.equal(
    callsTo(stub, 'reauthenticate').length,
    2,
    'after the cooldown a new code may go out',
  );
});

test('account security: once an OAuth-only member sets a password, the next change asks for it', async () => {
  const stub = await accountWith(OAUTH_USER);
  fillPasswords(null, 'newpassword1');
  await clickAndWait('#caaci-pw-save');
  assert.match(q('#caaci-pw-notice').textContent, /Password set/);
  assert.ok(q('#caaci-pw-current'), 'the current-password field appears');
  assert.match(q('#caaci-security').textContent, /Change password/);
  assert.doesNotMatch(q('#caaci-security').textContent, /Set a password/);

  fillPasswords(null, 'another-pass3');
  await clickAndWait('#caaci-pw-save');
  assert.match(q('#caaci-pw-notice').textContent, /current password/i);
  assert.equal(callsTo(stub, 'updateUser').length, 1);

  fillPasswords('newpassword1', 'another-pass3');
  await clickAndWait('#caaci-pw-save');
  assert.deepEqual(callsTo(stub, 'updateUser').at(-1), [
    { password: 'another-pass3', current_password: 'newpassword1' },
  ]);
});

test('membership checkout: the reset-link countdown follows the typed email, survives reopening, and ends on its label', async (t) => {
  mockClock(t);
  setup('membership');
  const stub = supaStub(); // logged out
  member.__setSupa(stub);
  await member.wireMembershipPage();
  // Types the email in signup mode, then switches to log-in mode.
  const openLogin = async (email) => {
    q('[data-tier="individual"]').click();
    await tick();
    fill('#caaci-email', email);
    q('#caaci-auth-toggle').click();
    return q('#caaci-co-forgot');
  };
  const typeEmail = (email) => {
    fill('#caaci-email', email);
    q('#caaci-email').dispatchEvent(new Event('input'));
  };

  let forgot = await openLogin('mei@x.com');
  forgot.click();
  await tick();
  assert.equal(forgot.textContent, 'Resend in 60s');

  typeEmail('ada@x.com');
  assert.equal(forgot.disabled, false, 'another address is not held back');
  assert.equal(forgot.textContent, 'Forgot password?');
  typeEmail('mei@x.com');
  assert.equal(forgot.disabled, true);
  assert.equal(forgot.textContent, 'Resend in 60s');

  q('[data-act="close"]').click();
  t.mock.timers.tick(10000);
  forgot = await openLogin('MEI@x.com');
  assert.equal(forgot.disabled, true, 'switching to log-in mode picks up the stored countdown');
  assert.equal(forgot.textContent, 'Resend in 50s');
  forgot.click();
  await tick();
  assert.equal(callsTo(stub, 'resetPasswordForEmail').length, 1, 'no second email inside 60s');

  t.mock.timers.tick(50000);
  assert.equal(forgot.disabled, false);
  assert.equal(forgot.textContent, 'Resend reset email');
});

test('account security: any email identity means the current-password path, even alongside Google', async () => {
  for (const [identities, providers] of [
    [
      ['google', 'email'],
      ['google', 'email'],
    ],
    [['google', 'email'], ['google']], // identities alone say email
    [['google'], ['google', 'email']], // app_metadata alone says email
  ]) {
    const stub = await accountWith({
      id: 'u3',
      email: 'lin@x.com',
      identities: identities.map((provider) => ({ provider })),
      app_metadata: { provider: 'google', providers },
    });
    const label = JSON.stringify({ identities, providers });
    assert.match(q('#caaci-security').textContent, /Change password/, label);
    fillPasswords('oldpassword1', 'newpassword1');
    await clickAndWait('#caaci-pw-save');
    assert.deepEqual(
      callsTo(stub, 'updateUser'),
      [[{ password: 'newpassword1', current_password: 'oldpassword1' }]],
      label,
    );
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
