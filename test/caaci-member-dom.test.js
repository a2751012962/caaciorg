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

function setup(page, { search = '' } = {}) {
  const dom = new JSDOM(PAGES[page], { url: 'https://caaci.example/x/' });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.Image = dom.window.Image;
  globalThis.localStorage = dom.window.localStorage;
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

const TIER_ROWS = [
  { id: 'individual', name: 'Individual Membership', price_cents: 3000, active: true },
];

function supaStub({ user = null, memberRow = null, payments = [], isAdmin = false } = {}) {
  return {
    auth: {
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
      updateUser: async () => ({ error: null }),
    },
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
