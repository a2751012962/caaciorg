// Boots the REAL admin page markup + module in jsdom (like caaci-admin-dom.test.js)
// and drives the two password features: setting a member's password from the
// member editor, and the My account tab where the signed-in admin changes their
// own password through Supabase Auth. Each test imports a fresh module instance
// (a distinct ?query) against its own document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

const html = await readFile(new URL('../admin-src/index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));

// A signed-in admin whose Supabase client records every auth call. Push onto
// `updateReplies` to script what the next updateUser() answers.
function supaStub(user, updateReplies = []) {
  const calls = { updateUser: [], reauthenticate: 0 };
  const stub = {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'tok', user: { id: user.id } } },
        }),
        getUser: async () => ({ data: { user }, error: null }),
        updateUser: async (attrs) => {
          calls.updateUser.push(attrs);
          return updateReplies.shift() || { data: { user }, error: null };
        },
        reauthenticate: async () => {
          calls.reauthenticate += 1;
          return { data: {}, error: null };
        },
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
  return { stub, calls };
}

let passwordReply = () => ({ body: { ok: true } });
function apiRoutes(u, options = {}) {
  if (u.includes('/api/admin/member-password'))
    return passwordReply(JSON.parse(options.body || '{}'));
  if (u.includes('/api/admin/members'))
    return {
      body: {
        rows: [
          {
            id: 'm1',
            full_name: 'Mei Lin',
            email: 'mei@x.com',
            tier_id: 'individual',
            status: 'active',
          },
          {
            id: 'admin-1',
            full_name: 'Ada Admin',
            email: 'admin@x.com',
            tier_id: 'individual',
            status: 'active',
          },
        ],
        total: 2,
      },
    };
  if (u.includes('/api/admin/households')) return { status: 500, body: { error: 'down' } };
  return { body: {} };
}

async function boot(query, supabase) {
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

test('admin page: set a member password from the member editor', async () => {
  const { stub } = supaStub({ id: 'admin-1', email: 'admin@x.com' });
  const fetch = mockFetch(apiRoutes);
  try {
    const dom = await boot('editor', stub);
    const memberRows = () =>
      document.querySelectorAll('#caaci-members-body tr:not([data-edit-row])');
    const editRow = () => document.querySelector('tr[data-edit-row]');
    const input = () => editRow().querySelector('[data-f="new_password"]');
    const setBtn = () => editRow().querySelector('[data-act="set-password"]');
    const msg = () => editRow().querySelector('[data-msg]');
    const posts = () => fetch.calls.filter((c) => c.url.includes('/api/admin/member-password'));

    // Your own row points at My account instead of offering the control.
    memberRows().item(1).querySelector('button').click();
    assert.equal(setBtn(), null);
    assert.match(editRow().querySelector('[data-set-password]').textContent, /My account/);

    memberRows().item(0).querySelector('button').click();
    assert.equal(input().type, 'password');
    assert.equal(input().getAttribute('autocomplete'), 'new-password');
    assert.ok(editRow().querySelector(`label[for="${input().id}"]`), 'the field is labelled');

    // Too short: refused in the browser, nothing sent.
    input().value = 'short';
    setBtn().click();
    await tick();
    assert.equal(posts().length, 0);
    assert.ok(msg().classList.contains('alert-danger'));
    assert.match(msg().textContent, /at least 8/);

    // Declining the confirm sends nothing.
    input().value = 'new-pass-123';
    dom.window.confirm = () => false;
    setBtn().click();
    await tick();
    assert.equal(posts().length, 0);

    // A server refusal is shown; the typed password stays for a retry.
    dom.window.confirm = () => true;
    passwordReply = () => ({
      status: 403,
      body: { error: "An administrator's password can only be changed by that administrator." },
    });
    setBtn().click();
    await tick();
    assert.equal(posts().length, 1);
    assert.ok(msg().classList.contains('alert-danger'));
    assert.match(msg().textContent, /administrator's password/);
    assert.equal(input().value, 'new-pass-123');
    assert.equal(setBtn().disabled, false);

    // A thrown fetch: generic message, button usable again.
    passwordReply = () => {
      throw new TypeError('Failed to fetch');
    };
    setBtn().click();
    await tick();
    assert.match(msg().textContent, /Could not change the password/);
    assert.equal(setBtn().disabled, false);

    // Success: token, member_id and password posted; field cleared; notice names the member.
    passwordReply = () => ({ body: { ok: true } });
    setBtn().click();
    await tick();
    const last = posts().at(-1);
    assert.equal(last.options.method, 'POST');
    assert.equal(last.options.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(last.options.body), { member_id: 'm1', password: 'new-pass-123' });
    assert.ok(msg().classList.contains('alert-success'));
    assert.match(msg().textContent, /Password updated for Mei Lin/);
    assert.equal(input().value, '');
  } finally {
    fetch.restore();
  }
});

test("admin page: My account changes the admin's own password, with a code when Supabase asks", async () => {
  const updateReplies = [];
  const user = { id: 'admin-1', email: 'admin@x.com', identities: [{ provider: 'email' }] };
  const { stub, calls } = supaStub(user, updateReplies);
  const fetch = mockFetch(apiRoutes);
  const realSetInterval = globalThis.setInterval;
  const intervals = [];
  try {
    await boot('account', stub);
    const tab = document.querySelector('[data-tab="account"]');
    const panel = document.querySelector('[data-panel="account"]');
    const host = document.querySelector('#caaci-account-host');
    const f = (name) => host.querySelector(`[data-f="${name}"]`);
    const btn = (act) => host.querySelector(`[data-act="${act}"]`);
    const msg = () => host.querySelector('[data-msg]');
    const save = async () => {
      btn('save-password').click();
      await tick();
    };

    assert.equal(panel.hidden, true);
    tab.click();
    await tick();
    assert.equal(panel.hidden, false);
    assert.match(host.textContent, /admin@x\.com/);
    for (const name of ['current', 'new', 'new2']) {
      assert.ok(f(name), `${name} field`);
      assert.equal(f(name).type, 'password');
      assert.ok(host.querySelector(`label[for="${f(name).id}"]`), `${name} is labelled`);
    }
    assert.equal(f('current').getAttribute('autocomplete'), 'current-password');

    // Clicking the tab again keeps what was typed.
    f('new').value = 'typed';
    tab.click();
    await tick();
    assert.equal(f('new').value, 'typed');

    // Validation happens before Supabase is called.
    await save();
    assert.match(msg().textContent, /current password/);
    f('current').value = 'old-pass-1';
    f('new').value = 'short';
    await save();
    assert.match(msg().textContent, /at least 8/);
    f('new').value = 'new-pass-123';
    f('new2').value = 'different-1';
    await save();
    assert.match(msg().textContent, /do not match/);
    assert.equal(calls.updateUser.length, 0);

    // Supabase wants reauthentication: the code box opens and one code is emailed.
    globalThis.setInterval = (fn) => intervals.push(fn);
    f('new2').value = 'new-pass-123';
    updateReplies.push({
      data: {},
      error: {
        code: 'reauthentication_needed',
        message: 'Password update requires reauthentication',
      },
    });
    await save();
    assert.deepEqual(calls.updateUser[0], {
      password: 'new-pass-123',
      current_password: 'old-pass-1',
    });
    assert.equal(host.querySelector('[data-reauth]').hidden, false);
    assert.match(host.querySelector('[data-reauth-msg]').textContent, /admin@x\.com/);
    assert.equal(calls.reauthenticate, 1);
    assert.equal(btn('resend-code').disabled, true);
    assert.match(btn('resend-code').textContent, /\(60s\)/);

    // Saving again while Resend is cooling does not email another code.
    updateReplies.push({ data: {}, error: { code: 'reauthentication_needed', message: 'again' } });
    await save();
    assert.equal(calls.reauthenticate, 1);

    // Confirm needs the code, then sends it as the nonce with the same fields.
    btn('confirm-code').click();
    await tick();
    assert.match(msg().textContent, /code from the email/);
    f('code').value = ' 123456 ';
    btn('confirm-code').click();
    await tick();
    assert.deepEqual(calls.updateUser.at(-1), {
      password: 'new-pass-123',
      current_password: 'old-pass-1',
      nonce: '123456',
    });
    assert.ok(msg().classList.contains('alert-success'));
    assert.match(msg().textContent, /Password updated/);
    assert.equal(host.querySelector('[data-reauth]').hidden, true);
    for (const name of ['current', 'new', 'new2', 'code']) assert.equal(f(name).value, '');

    // A wrong current password: Supabase's message is shown.
    f('current').value = 'wrong';
    f('new').value = 'another-pass-1';
    f('new2').value = 'another-pass-1';
    updateReplies.push({ data: {}, error: { message: 'Current password is incorrect' } });
    await save();
    assert.ok(msg().classList.contains('alert-danger'));
    assert.match(msg().textContent, /Current password is incorrect/);

    // The countdown ticks back to a usable Resend button.
    assert.equal(intervals.length, 1);
    for (let i = 0; i < 60; i++) intervals[0]();
    assert.equal(btn('resend-code').disabled, false);
    assert.equal(btn('resend-code').textContent, 'Resend code');

    // Your own password never goes through the admin endpoint.
    assert.equal(fetch.calls.filter((c) => c.url.includes('member-password')).length, 0);
  } finally {
    globalThis.setInterval = realSetInterval;
    fetch.restore();
  }
});

test('admin page: a Google/Microsoft-only admin sets a first password on My account', async () => {
  const user = {
    id: 'admin-1',
    email: 'admin@x.com',
    identities: [{ provider: 'azure' }],
    app_metadata: { providers: ['azure'] },
  };
  const { stub, calls } = supaStub(user);
  const fetch = mockFetch(apiRoutes);
  try {
    await boot('oauth', stub);
    document.querySelector('[data-tab="account"]').click();
    await tick();
    const host = document.querySelector('#caaci-account-host');
    const f = (name) => host.querySelector(`[data-f="${name}"]`);
    const saveBtn = () => host.querySelector('[data-act="save-password"]');

    assert.equal(f('current'), null, 'no current password to confirm');
    assert.match(host.textContent, /Google or Microsoft/);
    assert.match(saveBtn().textContent, /Set password/);

    f('new').value = 'first-pass-1';
    f('new2').value = 'first-pass-1';
    saveBtn().click();
    await tick();
    assert.deepEqual(calls.updateUser[0], { password: 'first-pass-1' });
    assert.match(host.querySelector('[data-msg]').textContent, /also sign in with your email/);

    // From now on a change confirms the password just set.
    assert.ok(f('current'));
    assert.match(saveBtn().textContent, /Change password/);
  } finally {
    fetch.restore();
  }
});
