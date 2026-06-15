import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';
import {
  notice,
  oauthButtons,
  tierFromSlug,
  TIER_BY_SLUG,
  wireLogin,
  wireContact,
  wireDonate,
  wireRegister,
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
  globalThis.location = { pathname, origin: 'https://caaci.example', href: '' };
  globalThis.alert = () => {};
  globalThis.prompt = () => null;
}

afterEach(() => {
  __setSupa(null);
  for (const k of ['document', 'Event', 'window', 'location', 'alert', 'prompt'])
    delete globalThis[k];
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

test('wireLogin signs in and redirects on success', async () => {
  setup(
    '<form id="mepr_loginform"><input name="log" value="a@x.com"><input name="pwd" value="pw"></form>',
    '/login/',
  );
  const seen = {};
  __setSupa({
    auth: {
      signInWithPassword: async (creds) => {
        Object.assign(seen, creds);
        return { error: null };
      },
    },
  });
  wireLogin();
  document
    .getElementById('mepr_loginform')
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(seen, { email: 'a@x.com', password: 'pw' });
  assert.equal(location.href, '/account/');
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

test('wireDonate builds amount_cents from the prompt and redirects to the Stripe url', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/cs_1' } }));
  try {
    setup('<button>Donate now</button>', '/donate/');
    globalThis.prompt = () => '25';
    wireDonate();
    document.querySelector('button').click();
    await tick();
    const call = fetch.calls.find((c) => c.url === '/api/checkout');
    const sent = JSON.parse(call.options.body);
    assert.deepEqual(sent, { type: 'donation', amount_cents: 2500 });
    assert.equal(location.href, 'https://pay/cs_1');
  } finally {
    fetch.restore();
  }
});

test('wireRegister signs up then starts membership checkout', async () => {
  const fetch = mockFetch(() => ({ ok: true, body: { url: 'https://pay/m1' } }));
  try {
    setup(
      '<form><input type="email" name="email" value="m@x.com"><input type="password" value="pw"></form>',
      '/individual-membership/',
    );
    __setSupa({ auth: { signUp: async () => ({ data: { user: { id: 'u9' } }, error: null }) } });
    wireRegister();
    document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
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
