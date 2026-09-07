// The mirror-page enhancement layer (src/caaci-app.js): contact form, donation
// checkout, and the shared notice helper, driven through jsdom. Membership,
// login and account behaviour is covered by caaci-member-dom.test.js — those
// routes are standalone Tabler pages, not mirrored ones.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';
import { notice, wireContact, wireDonate, openDonation } from '../src/caaci-app.js';

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
