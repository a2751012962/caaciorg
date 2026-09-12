// The mirror-page enhancement layer (src/caaci-app.js): contact form, donation
// checkout, and the shared notice helper, driven through jsdom. Membership,
// login and account behaviour is covered by caaci-member-dom.test.js — those
// routes are standalone Tabler pages, not mirrored ones.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mockFetch } from './helpers.js';
import {
  notice,
  wireContact,
  wireDonate,
  openDonation,
  donationPreset,
  wireAuthNav,
  hasStoredSession,
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
}

afterEach(() => {
  for (const k of ['document', 'Event', 'window']) delete globalThis[k];
  globalThis.location = { pathname: '/', origin: '', href: '', reload: () => {} };
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

test('donationPreset reads every mirrored donate button as its column amount and frequency', () => {
  // Both pages list $25 … $1,000, each with a one-time and a monthly button. The
  // Payment Links behind them had drifted (both $250 buttons opened "$100
  // Monthly"), so the checkout takes amount and frequency from the page itself.
  const expected = [2500, 5000, 10000, 25000, 50000, 100000].flatMap((cents) => [
    { cents, freq: 'once' },
    { cents, freq: 'month' },
  ]);
  for (const page of ['donate', 'zh/donate']) {
    const html = readFileSync(new URL(`../mirror/${page}/index.html`, import.meta.url), 'utf8');
    const doc = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
    const buttons = [...doc.querySelectorAll('a[href*="buy.stripe.com"]')];
    assert.deepEqual(
      buttons.map((b) => donationPreset(b)),
      expected,
      page,
    );
  }
});

test('wireDonate: an amount button opens the checkout pre-set to it instead of its Payment Link', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/cs_3' } }));
  try {
    setup(
      `<a href="/donate/">Donate</a>
      <div class="et_pb_column"><h2>$250 Dollars</h2>
        <a class="et_pb_button" href="https://buy.stripe.com/a">Support Once</a>
        <a class="et_pb_button" href="https://buy.stripe.com/b">Support Monthly</a></div>`,
      '/donate/',
    );
    wireDonate();
    const monthly = document.querySelectorAll('.et_pb_button')[1];
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    assert.equal(monthly.dispatchEvent(click), false, 'the Payment Link is not followed');

    assert.equal(document.querySelectorAll('.caaci-modal').length, 1);
    const overlay = document.querySelector('.caaci-modal');
    const total = overlay.querySelector('.caaci-line--total span:last-child').textContent;
    assert.equal(total, '$250.00/mo');
    assert.equal(overlay.querySelector('[data-freq="month"]').getAttribute('aria-pressed'), 'true');
    assert.equal(
      overlay.querySelector('.caaci-chip[data-amt="25000"]').getAttribute('aria-pressed'),
      'true',
    );

    overlay.querySelector('.caaci-pay').click();
    await tick();
    const sent = JSON.parse(fetch.calls.find((c) => c.url === '/api/checkout').options.body);
    assert.equal(sent.amount_cents, 25000);
    assert.equal(sent.recurring, true);
  } finally {
    fetch.restore();
  }
});

test('openDonation: chips, monthly toggle and a typed amount drive the summary and the request', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/cs_2' } }));
  try {
    setup('', '/donate/');
    const overlay = openDonation();
    const total = () => overlay.querySelector('.caaci-line--total span:last-child').textContent;
    assert.equal(total(), '$50.00', 'default chip is $50 one-time');

    overlay.querySelector('.caaci-chip[data-amt="10000"]').click();
    overlay.querySelector('[data-freq="month"]').click();
    assert.equal(total(), '$100.00/mo');

    const amt = overlay.querySelector('#caaci-amt');
    amt.value = '12.5';
    amt.dispatchEvent(new Event('input'));
    assert.equal(total(), '$12.50/mo');
    assert.equal(
      overlay.querySelectorAll('.caaci-chip[aria-pressed="true"]').length,
      0,
      'typing clears the chip selection',
    );

    overlay.querySelector('.caaci-pay').click();
    await tick();
    const sent = JSON.parse(fetch.calls.find((c) => c.url === '/api/checkout').options.body);
    assert.equal(sent.amount_cents, 1250);
    assert.equal(sent.recurring, true);
  } finally {
    fetch.restore();
  }
});

test('openDonation refuses amounts under $1 without calling the API', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/never' } }));
  try {
    setup('', '/donate/');
    const overlay = openDonation();
    const amt = overlay.querySelector('#caaci-amt');
    amt.value = '0.5';
    amt.dispatchEvent(new Event('input'));
    overlay.querySelector('.caaci-pay').click();
    await tick();
    assert.equal(fetch.calls.length, 0);
    const n = overlay.querySelector('.caaci-notice');
    assert.equal(n.getAttribute('data-state'), 'error');
    assert.match(n.textContent, /Minimum donation/);
  } finally {
    fetch.restore();
  }
});

// The Divi menu as mirrored, on a real origin — jsdom has no localStorage on
// about:blank. `stored` is written under the key supabase-js uses.
function mirrorMenu(pathname, stored) {
  const zh = pathname.startsWith('/zh/') ? '/zh' : '';
  dom = new JSDOM(
    `<!DOCTYPE html><body><ul id="top-menu" class="nav">
      <li class="menu-item menu-item-3675"><a href="${zh}/account/">Account</a></li>
      <li class="menu-item menu-item-3679"><a href="${zh}/login-3/">Log In</a></li>
    </ul></body>`,
    { url: `https://caaci.example${pathname}` },
  );
  if (stored !== undefined)
    dom.window.localStorage.setItem('sb-wslzeqhipvibeflmxznh-auth-token', stored);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = { pathname, origin: 'https://caaci.example', href: '', reload: () => {} };
  return () => document.querySelector('.menu-item-3679 a');
}

const SESSION = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 });

test('wireAuthNav: a stored session turns the menu "Log In" into the account link', () => {
  let link = mirrorMenu('/events/', SESSION);
  wireAuthNav();
  assert.equal(link().getAttribute('href'), '/account/');
  assert.equal(link().textContent, 'Account');
  wireAuthNav(); // the load-time second pass is a no-op
  assert.equal(link().getAttribute('href'), '/account/');

  link = mirrorMenu('/zh/events/', SESSION);
  wireAuthNav();
  assert.equal(link().getAttribute('href'), '/zh/account/');
  assert.equal(link().textContent, '我的账户');
  assert.ok(link().hasAttribute('data-no-dynamic-translation'), 'TranslatePress must skip it');
});

test('wireAuthNav: no session, or an entry that is not one, leaves "Log In" alone', () => {
  for (const stored of [undefined, 'not json', JSON.stringify({ access_token: 'a' })]) {
    const link = mirrorMenu('/events/', stored);
    wireAuthNav();
    assert.equal(link().getAttribute('href'), '/login-3/', String(stored));
    assert.equal(link().textContent, 'Log In');
  }
});

test('hasStoredSession ignores other sb-* keys such as the PKCE code verifier', () => {
  const store = new Map([['sb-x-auth-token-code-verifier', '"v"']]);
  const storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i],
    getItem: (k) => store.get(k) ?? null,
  };
  assert.equal(hasStoredSession(storage), false);
  store.set('sb-x-auth-token', SESSION);
  assert.equal(hasStoredSession(storage), true);
});
