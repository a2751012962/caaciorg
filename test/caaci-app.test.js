import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';
import {
  notice,
  oauthButtons,
  tierFromSlug,
  TIER_BY_SLUG,
  usd,
  withFee,
  loadTiers,
  wireLogin,
  wireAccount,
  wireContact,
  wireDonate,
  wireRegister,
  wirePlans,
  openCheckout,
  __setSupa,
} from '../src/caaci-app.js';

let dom;
const tick = () => new Promise((r) => setTimeout(r, 10));

// Build a jsdom document and wire the globals the module reads at call time.
// `location` is a plain object so we can assert on `location.href` redirects
// (jsdom would otherwise throw "navigation not implemented").
function setup(html, pathname = '/') {
  dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.window = dom.window;
  globalThis.location = { pathname, origin: 'https://caaci.example', href: '', reload: () => {} };
  globalThis.alert = () => {};
  globalThis.prompt = () => null;
}

afterEach(() => {
  __setSupa(null);
  for (const k of ['document', 'Event', 'window', 'alert', 'prompt']) delete globalThis[k];
  // A successful plan-switch schedules location.reload() ~1.2s later; leave a
  // harmless location stub in place so that timer can't throw after teardown.
  globalThis.location = { pathname: '/', origin: '', href: '', reload: () => {} };
});

test('tierFromSlug maps register-page paths to tier slugs', () => {
  assert.equal(tierFromSlug('/individual-membership/'), 'individual');
  assert.equal(tierFromSlug('/family-membership'), 'family');
  assert.equal(tierFromSlug('/about/'), undefined);
  assert.equal(Object.keys(TIER_BY_SLUG).length, 4);
});

test('notice() creates a .caaci-notice once and toggles the error state', () => {
  setup('<div id="host"></div>');
  const host = document.getElementById('host');
  notice(host, 'All good');
  let n = host.querySelector('.caaci-notice');
  assert.equal(n.textContent, 'All good');
  assert.equal(n.getAttribute('data-state'), null);

  notice(host, 'Something broke', false);
  assert.equal(host.querySelectorAll('.caaci-notice').length, 1, 'reuses the same node');
  n = host.querySelector('.caaci-notice');
  assert.equal(n.textContent, 'Something broke');
  assert.equal(n.getAttribute('data-state'), 'error');
});

test('oauthButtons() renders both providers and clicks trigger signInWithOAuth', () => {
  setup('');
  const calls = [];
  __setSupa({
    auth: {
      signInWithOAuth: async (opts) => {
        calls.push(opts.provider);
        return {};
      },
    },
  });
  const wrap = oauthButtons();
  const btns = wrap.querySelectorAll('button');
  assert.equal(btns.length, 2);
  assert.deepEqual(
    [...btns].map((b) => b.dataset.p),
    ['google', 'azure'],
  );
  btns[0].click();
  btns[1].click();
  assert.deepEqual(calls, ['google', 'azure']);
});

test('wireLogin validates empty fields before calling Supabase', async () => {
  setup('<form id="mepr_loginform"><input name="log"><input name="pwd"></form>', '/login/');
  let called = false;
  __setSupa({
    auth: {
      signInWithPassword: async () => {
        called = true;
        return {};
      },
    },
  });
  wireLogin();
  const form = document.getElementById('mepr_loginform');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(called, false);
  assert.equal(form.querySelector('.caaci-notice').getAttribute('data-state'), 'error');
  // OAuth buttons get injected next to the form
  assert.ok(document.querySelector('.caaci-oauth'));
});

// Build a minimal Supabase mock: signInWithPassword returns a user, and the
// chained members query (select -> eq -> maybeSingle) resolves to `member`.
function loginSupa(member, seen = {}) {
  return {
    auth: {
      signInWithPassword: async (creds) => {
        Object.assign(seen, creds);
        return { data: { user: { id: 'u-1' } }, error: null };
      },
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: member }),
      };
      return q;
    },
  };
}

test('wireLogin signs in and redirects a non-admin to /account/', async () => {
  setup(
    '<form id="mepr_loginform"><input name="log" value="a@x.com"><input name="pwd" value="pw"></form>',
    '/login/',
  );
  const seen = {};
  __setSupa(loginSupa({ is_admin: false }, seen));
  wireLogin();
  document
    .getElementById('mepr_loginform')
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(seen, { email: 'a@x.com', password: 'pw' });
  assert.equal(location.href, '/account/');
});

test('wireLogin redirects an admin to /admin/', async () => {
  setup(
    '<form id="mepr_loginform"><input name="log" value="boss@x.com"><input name="pwd" value="pw"></form>',
    '/login/',
  );
  __setSupa(loginSupa({ is_admin: true }));
  wireLogin();
  document
    .getElementById('mepr_loginform')
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(location.href, '/admin/');
});

// The mirrored /account/ page is a logged-out snapshot, so it ships with
// MemberPress's "unauthorized" notice + login form baked in. A logged-in
// visitor must not see that dead login UI lingering below the account card.
const ACCOUNT_SNAPSHOT = `<main>
  <div class="mepr-unauthorized-excerpt">You are unauthorized to view this page.</div>
  <div class="mepr-login-form-wrap"><form name="mepr_loginform" id="mepr_loginform">
    <input name="log"><input name="pwd"></form></div>
</main>`;

test('wireAccount removes the leftover login form for a logged-in member', async () => {
  setup(ACCOUNT_SNAPSHOT, '/account/');
  __setSupa({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@x.com' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tier_id: 'individual', status: 'active' } }),
        }),
      }),
    }),
  });
  await wireAccount();
  assert.equal(document.querySelector('#mepr_loginform'), null, 'login form removed');
  assert.equal(
    document.querySelector('.mepr-unauthorized-excerpt'),
    null,
    'unauthorized notice removed',
  );
  assert.equal(document.querySelector('.mepr-login-form-wrap'), null, 'login wrap removed');
  assert.match(document.querySelector('.caaci-card').textContent, /My Account/);
});

test('wireAccount keeps the login form for a logged-out visitor', async () => {
  setup(ACCOUNT_SNAPSHOT, '/account/');
  __setSupa({ auth: { getUser: async () => ({ data: { user: null } }) } });
  await wireAccount();
  assert.ok(document.querySelector('#mepr_loginform'), 'login form preserved');
  assert.match(document.querySelector('.caaci-card').textContent, /not logged in/);
});

test('wireContact posts the form to /api/contact and resets on success', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { ok: true } }));
  try {
    setup(`<form class="et_pb_contact_form">
      <input name="your_name" value="Pat">
      <input name="your_email" value="p@x.com">
      <input name="your_phone" value="555">
      <textarea name="your_message">hello</textarea></form>`);
    wireContact();
    const form = document.querySelector('.et_pb_contact_form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();

    const call = fetch.calls.find((c) => c.url === '/api/contact');
    assert.ok(call, 'posted to /api/contact');
    const sent = JSON.parse(call.options.body);
    assert.deepEqual(sent, { name: 'Pat', email: 'p@x.com', phone: '555', message: 'hello' });
    assert.match(form.querySelector('.caaci-notice').textContent, /Thank you/);
  } finally {
    fetch.restore();
  }
});

test('wireContact surfaces an error notice when the API fails', async () => {
  const fetch = mockFetch(() => ({ ok: false, status: 500, body: { error: 'boom' } }));
  try {
    setup('<form class="et_pb_contact_form"><input name="your_name" value="Pat"></form>');
    wireContact();
    const form = document.querySelector('.et_pb_contact_form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const n = form.querySelector('.caaci-notice');
    assert.equal(n.getAttribute('data-state'), 'error');
    assert.equal(n.textContent, 'boom');
  } finally {
    fetch.restore();
  }
});

// A Supabase mock covering the chains the plan view / checkout use:
//   from('membership_tiers').select('*').eq('active', true)   -> awaited -> { data }
//   from('members').select('*').eq('id', x).maybeSingle()     -> { data: member }
//   auth.getUser() / auth.signUp()
// `.eq()` returns a thenable that is ALSO chainable to .maybeSingle().
function plansSupa({ liveTiers = [], user = null, member = null, signUpUser } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      signUp: async () => ({ data: { user: signUpUser || { id: 'new-user' } }, error: null }),
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          then: (resolve) => resolve({ data: table === 'membership_tiers' ? liveTiers : null }),
          maybeSingle: async () => ({ data: member }),
        }),
      }),
    }),
  };
}

test('usd / withFee format prices and apply the 3.5% card surcharge', () => {
  assert.equal(usd(3000), '$30.00');
  assert.equal(withFee(3000), 3105); // $31.05 — matches the live site
  assert.equal(usd(withFee(10000)), '$103.50');
});

test('loadTiers falls back to the seed catalogue when no live rows exist', async () => {
  __setSupa(plansSupa({ liveTiers: [] }));
  const tiers = await loadTiers();
  assert.deepEqual(
    tiers.map((t) => t.id),
    ['student', 'individual', 'family', 'business'],
  );
});

test('wireDonate opens a checkout overlay that posts a donation to /api/checkout', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/cs_1' } }));
  try {
    setup('<button>Donate now</button>', '/donate/');
    wireDonate();
    document.querySelector('button').click(); // opens the overlay (no prompt)
    assert.ok(document.querySelector('.caaci-modal'), 'overlay opened');
    assert.equal(fetch.calls.length, 0, 'nothing charged until Pay is clicked');

    document.querySelector('.caaci-pay').click(); // default $50, one-time
    await tick();
    const call = fetch.calls.find((c) => c.url === '/api/checkout');
    const sent = JSON.parse(call.options.body);
    assert.deepEqual(sent, {
      type: 'donation',
      amount_cents: 5000,
      recurring: false,
      name: '',
      email: '',
    });
    assert.equal(location.href, 'https://pay/cs_1');
  } finally {
    fetch.restore();
  }
});

test('wireRegister opens checkout; a new visitor signs up then starts membership checkout', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/m1' } }));
  try {
    setup('<form><input type="email" name="email"></form>', '/individual-membership/');
    __setSupa(plansSupa({ user: null, signUpUser: { id: 'u9' } }));
    await wireRegister();
    // The clunky MemberPress submit now opens our overlay instead of posting.
    document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    assert.ok(document.querySelector('.caaci-modal'), 'overlay opened');

    document.querySelector('#caaci-email').value = 'm@x.com';
    document.querySelector('.caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url === '/api/checkout');
    const sent = JSON.parse(call.options.body);
    assert.equal(sent.type, 'membership');
    assert.equal(sent.tier_id, 'individual');
    assert.equal(sent.member_id, 'u9');
    assert.equal(location.href, 'https://pay/m1');
  } finally {
    fetch.restore();
  }
});

test('wirePlans renders four join cards and a log-in banner before login', async () => {
  setup('<main></main>', '/membership/');
  __setSupa(plansSupa({ user: null }));
  await wirePlans();
  const cards = document.querySelectorAll('.caaci-plan');
  assert.equal(cards.length, 4);
  assert.equal(document.querySelectorAll('.caaci-plan-cta').length, 4, 'all are Join CTAs');
  assert.equal(document.querySelector('.caaci-plan[data-current]'), null, 'no current plan');
  assert.match(document.querySelector('.caaci-plans-you').textContent, /Log in/);
});

test('wirePlans marks the current plan and offers switches after login', async () => {
  setup('<main></main>', '/membership/');
  __setSupa(
    plansSupa({
      user: { id: 'u1', email: 'mei@x.com' },
      member: { tier_id: 'family', status: 'active', expires_at: '2026-12-31T00:00:00Z' },
    }),
  );
  await wirePlans();
  const current = document.querySelector('.caaci-plan[data-current]');
  assert.ok(current, 'a current plan is highlighted');
  assert.match(current.querySelector('.caaci-plan-name').textContent, /Family/);
  assert.match(current.querySelector('.caaci-badge--current').textContent, /Current plan/);
  assert.match(current.querySelector('.caaci-plan-status').textContent, /Active/);
  // The current plan shows Manage; the other three offer a switch.
  assert.equal(current.querySelector('.caaci-plan-cta'), null);
  assert.equal(document.querySelectorAll('.caaci-plan-cta').length, 3);
  assert.match(document.querySelector('.caaci-plan-cta').textContent, /Switch to this/);
});

test('openCheckout switch path updates the plan via /api/change-plan (no redirect)', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { ok: true, tier_id: 'individual' } }));
  try {
    setup('<main></main>', '/membership/');
    __setSupa(plansSupa({}));
    const tiers = await loadTiers();
    openCheckout({
      type: 'membership',
      tier: tiers.find((t) => t.id === 'individual'),
      user: { id: 'u1', email: 'mei@x.com' },
      member: { tier_id: 'family', status: 'active' },
      allTiers: tiers,
    });
    const modal = document.querySelector('.caaci-modal');
    assert.match(modal.querySelector('h2').textContent, /Change your plan/);
    assert.match(modal.querySelector('.caaci-switch-from').textContent, /Family.*Individual/s);

    modal.querySelector('.caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url === '/api/change-plan');
    assert.ok(call, 'posted to /api/change-plan');
    assert.deepEqual(JSON.parse(call.options.body), { member_id: 'u1', tier_id: 'individual' });
    assert.equal(location.href, '', 'no Stripe redirect for an in-place switch');
    assert.match(modal.querySelector('.caaci-notice').textContent, /updated/);
  } finally {
    fetch.restore();
  }
});
