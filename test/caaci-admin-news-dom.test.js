// Boots the REAL admin page markup + module in jsdom (like
// caaci-admin-passwords-dom.test.js) and drives Compose News' test send and the
// test-only mode. Each test imports a fresh module instance (a distinct ?query)
// against its own document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

const html = await readFile(new URL('../admin-src/index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));

// A signed-in admin.
const supabase = {
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok', user: { id: 'admin-1' } } },
      }),
      getUser: async () => ({ data: { user: { id: 'admin-1', email: 'ada@x.com' } }, error: null }),
      signOut: async () => {},
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { is_admin: true } }) }),
        order: async () => ({
          data: table === 'membership_tiers' ? [{ id: 'individual', name: 'Individual' }] : [],
        }),
      }),
    }),
  }),
};

// What /api/admin/news answers, by method and body; each test sets it.
let newsReply = () => ({ body: {} });
function apiRoutes(u, options = {}) {
  if (u === '/api/admin/news')
    return newsReply(options.method || 'GET', JSON.parse(options.body || '{}'));
  if (u.includes('/api/admin/households')) return { status: 500, body: { error: 'down' } };
  return { body: { rows: [], total: 0 } };
}

async function boot(query) {
  const dom = new JSDOM(html, { url: 'https://caaci.example/admin/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  globalThis.location = { pathname: '/admin/', origin: 'https://caaci.example', href: '' };
  dom.window.CAACI_CONFIG = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' };
  dom.window.supabase = supabase;
  await import(`../src/caaci-admin.js?${query}`);
  await tick();
  return dom;
}

const $ = (s) => document.querySelector(s);
const openNews = async () => {
  $('[data-tab="news"]').click();
  await tick();
};

test('Compose News: Send test email posts a test send with the extra addresses and says who got it', async () => {
  newsReply = (method, body) => {
    if (method === 'GET') return { body: { test_only: false } };
    return body.test
      ? { body: { ok: true, test: true, sent: 2, recipients: ['ada@x.com', 'bo@x.com'] } }
      : { body: { ok: true, sent: 9, failed: 0, total: 9 } };
  };
  const fetch = mockFetch(apiRoutes);
  const posts = () =>
    fetch.calls.filter((c) => c.url === '/api/admin/news' && c.options.method === 'POST');
  const notb = () => $('#caaci-news-notice');
  try {
    await boot('test-send');
    await openNews();
    assert.equal($('#caaci-news-test-only').hidden, true);
    assert.equal($('#caaci-news-send').disabled, false);
    assert.ok($('label[for="caaci-news-test-to"]'), 'the field is labelled');

    // Nothing to send yet.
    $('#caaci-news-test-btn').click();
    await tick();
    assert.equal(posts().length, 0);
    assert.match(notb().textContent, /Subject and message are required/);

    // No confirmation box needed; extra addresses split on commas and spaces.
    $('#caaci-news-subject').value = 'Hello';
    $('#caaci-news-body').value = '<p>Hi</p>';
    $('#caaci-news-test-to').value = 'bo@x.com, ,  cy@x.com';
    $('#caaci-news-test-btn').click();
    await tick();
    assert.equal(posts().length, 1);
    assert.equal(posts()[0].options.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(posts()[0].options.body), {
      subject: 'Hello',
      body_html: '<p>Hi</p>',
      test: true,
      test_to: ['bo@x.com', 'cy@x.com'],
    });
    assert.ok(notb().classList.contains('alert-success'));
    assert.equal(notb().textContent, 'Test email sent to ada@x.com, bo@x.com.');
    assert.equal(
      $('#caaci-news-confirm').checked,
      false,
      'the real-send confirmation is untouched',
    );

    // The API's refusal is shown as returned, and the button is usable again.
    newsReply = () => ({
      status: 400,
      body: { error: 'Test emails can only go to admin accounts: cy@x.com' },
    });
    $('#caaci-news-test-btn').click();
    await tick();
    assert.ok(notb().classList.contains('alert-danger'));
    assert.equal(notb().textContent, 'Test emails can only go to admin accounts: cy@x.com');
    assert.equal($('#caaci-news-test-btn').disabled, false);

    // A thrown fetch: a generic message, not a stuck button.
    newsReply = () => {
      throw new TypeError('Failed to fetch');
    };
    $('#caaci-news-test-btn').click();
    await tick();
    assert.match(notb().textContent, /Could not send the test email/);
    assert.equal($('#caaci-news-test-btn').disabled, false);

    // Chinese copy for the new controls.
    $('#caaci-lang').click();
    await tick();
    assert.equal($('#caaci-news-test-btn').textContent.trim(), '发送测试邮件');
    assert.equal($('label[for="caaci-news-test-to"]').textContent.trim(), '测试收件人（可选）');
  } finally {
    fetch.restore();
  }
});

test('Compose News in a test-only environment shows the banner and turns the real send off', async () => {
  newsReply = (method) =>
    method === 'GET'
      ? { body: { test_only: true } }
      : { body: { ok: true, test: true, sent: 1, recipients: ['ada@x.com'] } };
  const fetch = mockFetch(apiRoutes);
  try {
    await boot('test-only');
    await openNews();
    const gets = fetch.calls.filter(
      (c) => c.url === '/api/admin/news' && c.options.method === 'GET',
    );
    assert.equal(gets.length, 1, 'the mode is read when the tab opens');
    assert.equal($('#caaci-news-test-only').hidden, false);
    assert.match($('#caaci-news-test-only').textContent, /only sends test emails/);
    assert.equal($('#caaci-news-send').disabled, true);
    assert.equal($('#caaci-news-test-btn').disabled, false);
  } finally {
    fetch.restore();
  }
});
