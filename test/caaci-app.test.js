import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';
import {
  notice,
  esc,
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
  signupCard,
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
    document.querySelector('#caaci-pwd').value = 'longenough'; // signup now requires a real password
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

test('openCheckout offers OAuth buttons and a log-in toggle for a logged-out visitor', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/m2' } }));
  try {
    setup('<main></main>', '/membership/');
    let signedIn = null;
    __setSupa({
      auth: {
        signInWithOAuth: async () => ({}),
        signInWithPassword: async (creds) => {
          signedIn = creds;
          return { data: { user: { id: 'u7' } }, error: null };
        },
        signUp: async () => ({ data: { user: { id: 'should-not-be-used' } }, error: null }),
      },
    });
    openCheckout({
      type: 'membership',
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      user: null,
    });
    const modal = document.querySelector('.caaci-modal');
    assert.equal(modal.querySelectorAll('.caaci-oauth-btn').length, 2, 'Google + Microsoft');

    // Toggle from "create account" to "log in": the name field hides.
    modal.querySelector('#caaci-auth-toggle').click();
    assert.match(modal.querySelector('.caaci-auth-title').textContent, /Log in/);
    assert.equal(modal.querySelector('.caaci-auth-name').style.display, 'none');

    modal.querySelector('#caaci-email').value = 'me@x.com';
    modal.querySelector('#caaci-pwd').value = 'secret';
    modal.querySelector('.caaci-pay').click();
    await tick();
    assert.deepEqual(
      signedIn,
      { email: 'me@x.com', password: 'secret' },
      'signed in, not signed up',
    );
    const call = fetch.calls.find((c) => c.url === '/api/checkout');
    assert.equal(JSON.parse(call.options.body).member_id, 'u7');
    assert.equal(location.href, 'https://pay/m2');
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

test('esc() neutralises HTML in user-supplied strings', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('a & "b"'), 'a &amp; &quot;b&quot;');
  assert.equal(esc(null), '');
});

test('openCheckout signup blocks a short password and an already-registered email', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/m3' } }));
  try {
    setup('<main></main>', '/membership/');
    __setSupa({
      auth: {
        signInWithOAuth: async () => ({}),
        // Supabase's obfuscated "existing account" response: success, but the
        // returned user carries no identities.
        signUp: async () => ({
          data: { user: { id: 'ghost', identities: [] }, session: null },
          error: null,
        }),
      },
    });
    openCheckout({
      type: 'membership',
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      user: null,
    });
    const modal = document.querySelector('.caaci-modal');
    modal.querySelector('#caaci-email').value = 'dup@x.com';

    modal.querySelector('#caaci-pwd').value = 'short';
    modal.querySelector('.caaci-pay').click();
    await tick();
    assert.match(modal.querySelector('.caaci-notice').textContent, /at least 8 characters/);

    modal.querySelector('#caaci-pwd').value = 'longenough';
    modal.querySelector('.caaci-pay').click();
    await tick();
    assert.match(modal.querySelector('.caaci-notice').textContent, /already has an account/);
    assert.equal(
      fetch.calls.filter((c) => c.url === '/api/checkout').length,
      0,
      'no checkout for a duplicate account',
    );
    assert.equal(modal.querySelector('.caaci-pay').disabled, false, 'button re-enabled');
  } finally {
    fetch.restore();
  }
});

test('openCheckout applies a discount code to the summary and the checkout call', async () => {
  const fetch = mockFetch((url) => {
    if (url === '/api/discount') return { ok: true, body: { code: 'SPRING20', percent_off: 20 } };
    return { ok: true, body: { url: 'https://pay/m4' } };
  });
  try {
    setup('<main></main>', '/membership/');
    __setSupa({ auth: {} });
    openCheckout({
      type: 'membership',
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      user: { id: 'u1', email: 'mei@x.com' },
    });
    const modal = document.querySelector('.caaci-modal');
    // withFee(3000) = 3105; 20% off = 621 -> total 2484
    modal.querySelector('#caaci-code').value = 'spring20';
    modal.querySelector('.caaci-discount-apply').click();
    await tick();
    assert.match(modal.querySelector('.caaci-line--discount').textContent, /SPRING20.*\$6\.21/s);
    assert.match(modal.querySelector('.caaci-line--total').textContent, /\$24\.84/);
    assert.match(modal.querySelector('.caaci-discount-msg').textContent, /20% off/);

    modal.querySelector('.caaci-pay').click();
    await tick();
    const call = fetch.calls.find((c) => c.url === '/api/checkout');
    const sent = JSON.parse(call.options.body);
    assert.equal(sent.discount_code, 'SPRING20');
    assert.equal(sent.member_id, 'u1');
    assert.equal(location.href, 'https://pay/m4');
  } finally {
    fetch.restore();
  }
});

test('openCheckout rejects a bad discount code and keeps the full price', async () => {
  const fetch = mockFetch((url) => {
    if (url === '/api/discount')
      return { ok: false, status: 400, body: { error: 'This discount code has expired.' } };
    return { ok: true, body: {} };
  });
  try {
    setup('<main></main>', '/membership/');
    __setSupa({ auth: {} });
    openCheckout({
      type: 'membership',
      tier: { id: 'individual', name: 'Individual', price_cents: 3000 },
      user: { id: 'u1', email: 'mei@x.com' },
    });
    const modal = document.querySelector('.caaci-modal');
    modal.querySelector('#caaci-code').value = 'OLD';
    modal.querySelector('.caaci-discount-apply').click();
    await tick();
    const msg = modal.querySelector('.caaci-discount-msg');
    assert.equal(msg.getAttribute('data-state'), 'error');
    assert.match(msg.textContent, /expired/);
    assert.equal(modal.querySelector('.caaci-line--discount'), null);
    assert.match(modal.querySelector('.caaci-line--total').textContent, /\$31\.05/);
  } finally {
    fetch.restore();
  }
});

test('wirePlans surfaces a valid ?code= discount as a banner', async () => {
  const fetch = mockFetch((url) =>
    url === '/api/discount'
      ? { ok: true, body: { code: 'QR10', percent_off: 10 } }
      : { ok: true, body: {} },
  );
  try {
    setup('<main></main>', '/membership/');
    globalThis.location.search = '?code=QR10';
    __setSupa(plansSupa({ user: null }));
    await wirePlans();
    const banner = document.querySelector('.caaci-plans-discount');
    assert.ok(banner, 'discount banner rendered');
    assert.match(banner.textContent, /QR10.*10% off/s);
    assert.equal(banner.getAttribute('data-state'), null);
  } finally {
    fetch.restore();
  }
});

test('signupCard validates, detects duplicates, and confirms a pending signup', async () => {
  setup('', '/login-3/');
  let mode = 'ok';
  __setSupa({
    auth: {
      signUp: async ({ email, password, options }) => {
        assert.equal(email, 'new@x.com');
        assert.equal(password, 'longenough');
        assert.equal(options.data.full_name, 'Mei');
        if (mode === 'dup')
          return { data: { user: { id: 'x', identities: [] }, session: null }, error: null };
        return { data: { user: { id: 'u5', identities: [{}] }, session: null }, error: null };
      },
    },
  });
  const card = signupCard();
  document.body.appendChild(card);
  const v = (id, val) => (card.querySelector(id).value = val);
  v('#caaci-su-name', 'Mei');
  v('#caaci-su-email', 'not-an-email');
  v('#caaci-su-pwd', 'longenough');
  v('#caaci-su-pwd2', 'longenough');
  card.querySelector('#caaci-su-submit').click();
  await tick();
  assert.match(card.querySelector('.caaci-notice').textContent, /valid email/);

  v('#caaci-su-email', 'new@x.com');
  v('#caaci-su-pwd2', 'different1');
  card.querySelector('#caaci-su-submit').click();
  await tick();
  assert.match(card.querySelector('.caaci-notice').textContent, /do not match/);

  v('#caaci-su-pwd2', 'longenough');
  mode = 'dup';
  card.querySelector('#caaci-su-submit').click();
  await tick();
  assert.match(card.querySelector('.caaci-notice').textContent, /already has an account/);

  mode = 'ok';
  card.querySelector('#caaci-su-submit').click();
  await tick();
  // no session -> email confirmation required, stay on the page
  assert.match(card.querySelector('.caaci-notice').textContent, /Check your email/);
  assert.equal(location.href, '');
});

test('wireLogin adds forgot-password + create-account links that work', async () => {
  setup(
    '<form id="mepr_loginform"><input name="log" value="mei@x.com"><input name="pwd"></form>',
    '/login-3/',
  );
  let resetFor = null;
  __setSupa({
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signInWithOAuth: async () => ({}),
      resetPasswordForEmail: async (email, opts) => {
        resetFor = { email, ...opts };
        return { error: null };
      },
    },
  });
  wireLogin();
  const links = document.querySelector('.caaci-auth-links');
  assert.ok(links, 'auth links injected');

  links.querySelector('#caaci-forgot').click();
  await tick();
  assert.equal(resetFor.email, 'mei@x.com');
  assert.equal(resetFor.redirectTo, 'https://caaci.example/account/?recovery=1');
  const form = document.getElementById('mepr_loginform');
  assert.match(form.querySelector('.caaci-notice').textContent, /reset email sent/i);

  links.querySelector('#caaci-show-signup').click();
  const card = document.querySelector('.caaci-signup-card');
  assert.ok(card, 'signup card shown');
  links.querySelector('#caaci-show-signup').click();
  assert.equal(card.hidden, true, 'second click hides it');
});
