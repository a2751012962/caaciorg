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
  wireVolunteer,
  volunteerWhen,
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

// ---------- /volunteer/ ----------
// The Divi contact form as the mirror ships it, minus the parts nothing reads.
const VOLUNTEER_FORM = `<form class="et_pb_contact_form">
  <p class="et_pb_contact_field"><input name="et_pb_contact_name_0" value=""></p>
  <p class="et_pb_contact_field"><input name="et_pb_contact_email_0" value=""></p>
  <p class="et_pb_contact_field"><input name="et_pb_contact_phone_0" value=""></p>
  <p class="et_pb_contact_field">
    <label for="et_pb_contact_message_0" class="et_pb_contact_form_label">Message</label>
    <textarea name="et_pb_contact_message_0" id="et_pb_contact_message_0"
      data-required_mark="required" placeholder="Message"></textarea></p>
  <button type="submit" class="et_pb_contact_submit">send</button>
</form>`;

const VOL_EVENTS = [
  {
    slug: 'mid-autumn-festival',
    title: 'Mid-Autumn Festival',
    title_zh: '中秋节晚会',
    starts_at: '2099-09-27T19:00:00Z',
  },
  {
    slug: 'spring-potluck',
    title: 'Spring Potluck',
    title_zh: null,
    starts_at: '2099-04-05T17:00:00Z',
  },
];
// Routes the picker's GET and the sign-up POST.
const volunteerApi = ({ events = VOL_EVENTS, post = () => ({ body: { ok: true } }) } = {}) =>
  mockFetch((url, options) => {
    if (url === '/api/volunteer' && options.method === 'POST') return post(url, options);
    if (url === '/api/volunteer') return events ? { body: { events } } : { ok: false, status: 500 };
    return { status: 404, body: {} };
  });
const rows = () => [...document.querySelectorAll('.caaci-volunteer-events .caaci-check')];
const boxes = () => rows().map((r) => r.querySelector('input'));

test('volunteerWhen formats the event date in Champaign time, and drops an unusable one', () => {
  assert.equal(volunteerWhen('2099-09-27T19:00:00Z', false), 'September 27, 2099');
  assert.equal(volunteerWhen('2099-09-27T19:00:00Z', true), '2099年9月27日');
  // 00:30 UTC is still the previous evening in Chicago.
  assert.equal(volunteerWhen('2099-09-28T00:30:00Z', false), 'September 27, 2099');
  assert.equal(volunteerWhen(null, false), '');
  assert.equal(volunteerWhen('not a date', false), '');
});

test('wireVolunteer builds the event picker on /volunteer/ and posts the chosen slugs', async () => {
  const fetch = volunteerApi();
  try {
    setup(VOLUNTEER_FORM, '/volunteer/');
    await wireVolunteer();
    wireContact(); // the page's other wiring must not take the form as well
    const form = document.querySelector('.et_pb_contact_form');
    assert.equal(form.dataset.caaciVolunteer, '1');

    // The picker sits above the message field, which is now optional.
    const picker = document.querySelector('.caaci-volunteer-events');
    assert.ok(picker, 'picker injected');
    assert.equal(
      picker.nextElementSibling,
      document.querySelector('#et_pb_contact_message_0').closest('p'),
    );
    assert.equal(
      picker.querySelector('legend').textContent,
      'Which event(s) would you like to help with?',
    );
    const message = document.querySelector('#et_pb_contact_message_0');
    assert.equal(message.placeholder, 'How would you like to help? (optional)');
    assert.equal(message.getAttribute('data-required_mark'), null);
    assert.equal(
      document.querySelector('label[for="et_pb_contact_message_0"]').textContent,
      'How would you like to help? (optional)',
    );

    assert.deepEqual(
      rows().map((r) => r.textContent),
      [
        'Mid-Autumn Festival · September 27, 2099',
        'Spring Potluck · April 5, 2099',
        'Any event / wherever needed',
      ],
    );
    // TranslatePress blanks text it sees appear on /zh/ pages.
    for (const node of picker.querySelectorAll('*'))
      assert.ok(node.hasAttribute('data-no-dynamic-translation'), node.outerHTML);
    assert.equal(
      boxes().filter((b) => b.checked).length,
      0,
      'with events listed, nothing is pre-checked',
    );

    form.querySelector('[name*=name]').value = 'Pat Lin';
    form.querySelector('[name*=email]').value = 'pat@x.com';
    form.querySelector('[name*=phone]').value = '555-0100';
    message.value = 'Weekends work best';
    boxes()[0].checked = true;
    boxes()[0].dispatchEvent(new Event('change', { bubbles: true }));

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const call = fetch.calls.find((c) => c.options.method === 'POST');
    assert.ok(call, 'posted to /api/volunteer');
    assert.equal(call.url, '/api/volunteer');
    assert.deepEqual(JSON.parse(call.options.body), {
      name: 'Pat Lin',
      email: 'pat@x.com',
      phone: '555-0100',
      message: 'Weekends work best',
      events: ['mid-autumn-festival'],
    });
    assert.match(form.querySelector('.caaci-notice').textContent, /Thank you for volunteering/);
    assert.equal(form.querySelector('.caaci-notice').getAttribute('data-state'), null);
    assert.equal(form.querySelector('.et_pb_contact_submit').disabled, false, 'button released');
    assert.equal(form.querySelector('.et_pb_contact_submit').textContent, 'send');
    assert.equal(boxes().filter((b) => b.checked).length, 0, 'the picker is back to default');
  } finally {
    fetch.restore();
  }
});

test('wireVolunteer: "Any event" and a named event are alternatives', async () => {
  const fetch = volunteerApi();
  try {
    setup(VOLUNTEER_FORM, '/volunteer/');
    await wireVolunteer();
    const [first, , any] = boxes();
    any.checked = true;
    any.dispatchEvent(new Event('change', { bubbles: true }));
    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(any.checked, false, 'picking an event clears "Any event"');
    any.checked = true;
    any.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(first.checked, false, 'and the other way round');

    document.querySelector('[name*=email]').value = 'pat@x.com';
    document
      .querySelector('.et_pb_contact_form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const sent = JSON.parse(fetch.calls.find((c) => c.options.method === 'POST').options.body);
    assert.deepEqual(sent.events, [], '"Any event" sends no slug');
  } finally {
    fetch.restore();
  }
});

test('wireVolunteer: a failed event list still offers "Any event", checked', async () => {
  const fetch = volunteerApi({ events: null });
  try {
    setup(VOLUNTEER_FORM, '/volunteer/');
    await wireVolunteer();
    assert.deepEqual(
      rows().map((r) => r.textContent),
      ['Any event / wherever needed'],
    );
    assert.equal(boxes()[0].checked, true);
  } finally {
    fetch.restore();
  }
});

test('wireVolunteer shows the API error and leaves the form filled in', async () => {
  const fetch = volunteerApi({
    post: () => ({ ok: false, status: 400, body: { error: 'Enter your name.' } }),
  });
  try {
    setup(VOLUNTEER_FORM, '/volunteer/');
    await wireVolunteer();
    const form = document.querySelector('.et_pb_contact_form');
    form.querySelector('[name*=email]').value = 'pat@x.com';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    const n = form.querySelector('.caaci-notice');
    assert.equal(n.textContent, 'Enter your name.');
    assert.equal(n.getAttribute('data-state'), 'error');
    assert.equal(form.querySelector('[name*=email]').value, 'pat@x.com', 'not reset');
  } finally {
    fetch.restore();
  }
});

test('wireVolunteer speaks Chinese on /zh/volunteer/ and prefers title_zh', async () => {
  const fetch = volunteerApi();
  try {
    setup(VOLUNTEER_FORM, '/zh/volunteer/');
    await wireVolunteer();
    assert.equal(
      document.querySelector('.caaci-volunteer-events legend').textContent,
      '您想为哪些活动做志愿者？',
    );
    assert.deepEqual(
      rows().map((r) => r.textContent),
      ['中秋节晚会 · 2099年9月27日', 'Spring Potluck · 2099年4月5日', '任何活动均可'],
    );
    assert.equal(
      document.querySelector('#et_pb_contact_message_0').placeholder,
      '您想怎样帮忙？（选填）',
    );
    document.querySelector('[name*=email]').value = 'pat@x.com';
    document
      .querySelector('.et_pb_contact_form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    assert.match(document.querySelector('.caaci-notice').textContent, /感谢您报名志愿者/);
  } finally {
    fetch.restore();
  }
});

test('wireVolunteer leaves every other page to wireContact', async () => {
  const fetch = volunteerApi();
  try {
    setup(VOLUNTEER_FORM, '/contact/');
    await wireVolunteer();
    assert.equal(document.querySelector('.caaci-volunteer-events'), null, 'no picker');
    const form = document.querySelector('.et_pb_contact_form');
    assert.equal(form.dataset.caaciVolunteer, undefined);
    wireContact();
    form.querySelector('[name*=email]').value = 'pat@x.com';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    assert.deepEqual(
      fetch.calls.map((c) => c.url),
      ['/api/contact'],
      'the contact API, and nothing from the volunteer wiring',
    );
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
