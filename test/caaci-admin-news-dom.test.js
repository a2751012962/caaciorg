// Boots the REAL admin page markup + module in jsdom (like
// caaci-admin-passwords-dom.test.js) and drives Compose News' test send, the
// test-only mode and how the Jodit editor is made. Each test imports a fresh
// module instance (a distinct ?query) against its own document.
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
  if (u.startsWith('/api/admin/news-template'))
    return { body: { subject: 'Template subject', html: '<p>Template body</p>' } };
  if (u.includes('/api/admin/households')) return { status: 500, body: { error: 'down' } };
  return { body: { rows: [], total: 0 } };
}

async function boot(query, { Jodit } = {}) {
  const dom = new JSDOM(html, { url: 'https://caaci.example/admin/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  globalThis.location = { pathname: '/admin/', origin: 'https://caaci.example', href: '' };
  dom.window.CAACI_CONFIG = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' };
  dom.window.supabase = supabase;
  if (Jodit) dom.window.Jodit = Jodit;
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

// A stand-in for window.Jodit: records what Compose News asks it to make.
function fakeJodit() {
  const made = [];
  const Jodit = {
    atom: (value) => ({ atom: value }),
    make: (selector, options) => {
      const editor = { selector, options, value: '' };
      made.push(editor);
      return editor;
    },
  };
  return { Jodit, made };
}

test('Compose News makes the Jodit editor once the tab opens: sandboxed frame, pasted formatting kept, pictures to the media library', async () => {
  newsReply = (method) =>
    method === 'GET'
      ? { body: { test_only: false } }
      : { body: { ok: true, test: true, sent: 1, recipients: ['ada@x.com'] } };
  const { Jodit, made } = fakeJodit();
  const fetch = mockFetch(apiRoutes);
  try {
    await boot('jodit', { Jodit });
    assert.equal(made.length, 0, 'not made while the panel is hidden');
    await openNews();
    await openNews();
    assert.equal(made.length, 1, 'made once');
    const [{ selector, options: o }] = made;
    assert.equal(selector, '#caaci-news-body');

    // Edits inside an iframe that may not run scripts; pastes keep formatting without a prompt.
    assert.equal(o.iframe, true);
    assert.equal(o.iframeSandbox, 'allow-same-origin');
    assert.equal(o.askBeforePasteHTML, false);
    assert.equal(o.defaultActionOnPaste, 'insert_as_html');
    assert.equal(o.toolbarAdaptive, false, 'every button stays on the toolbar');
    for (const b of [
      'undo',
      'redo',
      'bold',
      'font',
      'fontsize',
      'brush',
      'copyformat',
      'link',
      'image',
      'source',
    ])
      assert.ok(o.buttons.includes(b), b);
    assert.equal(o.language, 'en');
    assert.equal(
      o.controls.font.list.atom["'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif"],
      '微软雅黑 / 苹方',
    );

    // Pictures upload like the Media tab: PUT multipart "file" with the session token.
    const u = o.uploader;
    assert.equal(u.url, '/api/admin/media');
    assert.equal(u.method, 'PUT');
    assert.equal(u.insertImageAsBase64URI, false);
    assert.deepEqual(u.headers(), { authorization: 'Bearer tok' });
    assert.equal(u.filesVariableName(0), 'file');
    const url = 'https://db.example/storage/v1/object/public/media/1-a.png';
    assert.equal(u.isSuccess({ ok: true, file: { url } }), true);
    assert.equal(u.isSuccess({ error: 'Image is too large (max 5 MB).' }), false);
    assert.equal(
      u.getMessage({ error: 'Image is too large (max 5 MB).' }),
      'Image is too large (max 5 MB).',
    );
    assert.deepEqual(u.process({ ok: true, file: { url } }), {
      files: [url],
      isImages: [true],
      baseurl: '',
      messages: [],
    });

    // An empty editor holds "<p><br></p>": that is no message, so a test send is refused.
    made[0].value = '<p><br></p>';
    $('#caaci-news-subject').value = 'Hello';
    $('#caaci-news-test-btn').click();
    await tick();
    assert.equal(
      fetch.calls.filter((c) => c.url === '/api/admin/news' && c.options.method === 'POST').length,
      0,
    );
    assert.match($('#caaci-news-notice').textContent, /Subject and message are required/);
    $('#caaci-news-subject').value = '';

    // A template fills the empty editor without asking, and sending reads the
    // editor, not the box under it.
    window.confirm = () => {
      throw new Error('an empty editor must not ask before a template fills it');
    };
    const select = $('#caaci-news-template');
    select.value = 'general';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    assert.equal(made[0].value, '<p>Template body</p>');
    assert.equal($('#caaci-news-body').value, '', 'the box under the editor is not written');
    made[0].value = '<p>From the <b>editor</b></p>';
    $('#caaci-news-test-btn').click();
    await tick();
    const post = fetch.calls.find(
      (c) => c.url === '/api/admin/news' && c.options.method === 'POST',
    );
    assert.deepEqual(JSON.parse(post.options.body), {
      subject: 'Template subject',
      body_html: '<p>From the <b>editor</b></p>',
      test: true,
      test_to: [],
    });
  } finally {
    fetch.restore();
  }
});
