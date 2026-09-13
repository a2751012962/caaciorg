// Boots the REAL admin page markup (admin-src/index.html) + the real admin
// module (src/caaci-admin.js) in jsdom, with Supabase and the admin APIs
// stubbed. Catches markup/selector drift between the HTML and the module —
// ids, data-tab/data-panel hooks, badge/stat rendering, i18n labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

const html = await readFile(new URL('../admin-src/index.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));

// Minimal Supabase client stub: a signed-in admin session.
const supaStub = {
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok', user: { id: 'admin-1' } } },
      }),
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

// What /api/admin/member-email answers; each step of the test swaps it.
let memberEmailReply = () => ({ body: { ok: true } });

// The admin APIs the panel calls on boot and on tab clicks.
function apiRoutes(u, options = {}) {
  if (u.includes('/api/admin/member-email'))
    return memberEmailReply(JSON.parse(options.body || '{}'));
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
            expires_at: '2027-01-01T00:00:00Z',
          },
          {
            id: 'm2',
            full_name: 'Jun Wu',
            email: 'jun@x.com',
            tier_id: 'individual',
            status: 'active',
            expires_at: '2027-01-01T00:00:00Z',
          },
        ],
        total: 2,
      },
    };
  if (u.includes('/api/admin/households')) return { body: { rows: [] } };
  if (u.includes('/api/admin/payments'))
    return {
      body: {
        rows: [],
        total: 0,
        status_counts: { active: 12, past_due: 3, expired: 4 },
        revenue_ytd_cents: 123400,
      },
    };
  if (u.includes('/api/admin/events'))
    return {
      body: {
        rows: [
          {
            id: 'e1',
            title: 'Gala',
            starts_at: '2026-02-17T00:00:00Z',
            location: 'Springfield',
            published: false,
          },
        ],
        total: 1,
      },
    };
  if (u.includes('/api/admin/business')) return { body: { rows: [], total: 0, pending_total: 2 } };
  if (u.includes('/api/admin/media')) return { body: { rows: [] } };
  return { body: {} };
}

test('admin page: module boots against the real Tabler markup', async () => {
  const dom = new JSDOM(html, { url: 'https://caaci.example/admin/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  globalThis.location = { pathname: '/admin/', origin: 'https://caaci.example', href: '' };
  dom.window.CAACI_CONFIG = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' };
  dom.window.supabase = supaStub;
  const fetch = mockFetch(apiRoutes);
  let restoreTimers = () => {};
  try {
    await import('../src/caaci-admin.js'); // boot IIFE runs on import
    await tick();

    // Gate passed: gate hidden, app revealed.
    assert.equal(document.querySelector('#caaci-admin-gate').hidden, true);
    assert.equal(document.querySelector('#caaci-admin-app').hidden, false);

    // Members loaded into the table with a Tabler soft badge.
    const badge = document.querySelector('#caaci-members-body .badge');
    assert.ok(badge, 'member status badge rendered');
    assert.ok(badge.classList.contains('bg-success-lt'), 'active → bg-success-lt');
    assert.match(document.querySelector('#caaci-page-info').textContent, /1–2 of 2/);

    // Member editor: auth-email buttons confirm, POST member_id + action with the
    // session token, report every outcome inline, and cool down after a send.
    const editBtn = () => document.querySelector('#caaci-members-body tr button');
    const editRow = () => document.querySelector('tr[data-edit-row]');
    const btnFor = (action) => editRow().querySelector(`[data-act="send-${action}"]`);
    const editMsg = () => editRow().querySelector('[data-msg]');
    const emailPosts = () => fetch.calls.filter((c) => c.url.includes('/api/admin/member-email'));
    const click = async (action, reply) => {
      if (reply) memberEmailReply = reply;
      btnFor(action).click();
      await tick();
    };

    editBtn().click();
    assert.ok(btnFor('reset') && btnFor('invite'), 'reset + invite buttons rendered');
    assert.match(btnFor('reset').textContent, /Send password reset/);
    assert.match(btnFor('invite').textContent, /Send invitation/);
    assert.match(editRow().textContent, /never confirmed/, 'hint matches the server rule');

    dom.window.confirm = () => false; // declining sends nothing
    await click('reset');
    assert.equal(emailPosts().length, 0);
    dom.window.confirm = () => true;

    // 502: the server's safe message, and the button is usable again.
    await click('reset', () => ({
      status: 502,
      body: { error: 'The email could not be sent right now.' },
    }));
    assert.equal(emailPosts().length, 1);
    assert.ok(editMsg().classList.contains('alert-danger'));
    assert.match(editMsg().textContent, /could not be sent right now/);
    assert.equal(btnFor('reset').disabled, false);

    // A thrown fetch: generic message, button not stuck disabled.
    await click('reset', () => {
      throw new TypeError('Failed to fetch');
    });
    assert.match(editMsg().textContent, /Could not send the email/);
    assert.equal(btnFor('reset').disabled, false);

    // 409: the login is already confirmed, so point at reset; invite usable again.
    await click('invite', () => ({ status: 409, body: { error: 'x' } }));
    assert.match(editMsg().textContent, /Send password reset/);
    assert.equal(btnFor('invite').disabled, false);

    // From here on, track live intervals to prove the editor clears its own.
    const live = new Set();
    const { setInterval: realSet, clearInterval: realClear } = globalThis;
    globalThis.setInterval = (fn, ms) => {
      const id = realSet(fn, ms);
      live.add(id);
      return id;
    };
    globalThis.clearInterval = (id) => {
      live.delete(id);
      realClear(id);
    };
    restoreTimers = () =>
      Object.assign(globalThis, { setInterval: realSet, clearInterval: realClear });

    // Success: bearer token sent, success shown, 60s countdown.
    await click('reset', ({ action }) => ({ body: { ok: true, action } }));
    const okPost = emailPosts().at(-1);
    assert.equal(okPost.options.method, 'POST');
    assert.equal(okPost.options.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(okPost.options.body), { member_id: 'm1', action: 'reset' });
    assert.ok(editMsg().classList.contains('alert-success'));
    assert.equal(btnFor('reset').disabled, true);
    assert.match(btnFor('reset').textContent, /\(60s\)/);

    // A 429 also starts the countdown.
    await click('invite', () => ({ status: 429, body: { error: 'wait' } }));
    assert.ok(editMsg().classList.contains('alert-danger'));
    assert.equal(btnFor('invite').disabled, true);
    assert.match(btnFor('invite').textContent, /\(\d+s\)/);
    assert.equal(live.size, 2, 'one countdown per cooling button');

    // Closing the editor clears its intervals; reopening resumes the countdown.
    editBtn().click();
    assert.equal(editRow(), null);
    assert.equal(live.size, 0, 'closing the editor clears its intervals');
    editBtn().click();
    assert.equal(btnFor('reset').disabled, true, 'cooldown survives close/reopen');
    assert.match(btnFor('reset').textContent, /\(\d+s\)/);
    assert.equal(btnFor('invite').disabled, true);

    // Save re-renders the table (editor gone); the cooldown survives that too.
    editRow().querySelector('[data-act="save"]').click();
    await tick();
    assert.equal(editRow(), null);
    assert.equal(live.size, 0, 're-rendering the table clears the intervals');
    editBtn().click();
    assert.equal(btnFor('reset').disabled, true, 'cooldown survives a re-render');
    editBtn().click();
    assert.equal(live.size, 0);

    // Cooldowns are per member: Mei (m1) is cooling, Jun (m2) is not.
    const memberRows = () =>
      document.querySelectorAll('#caaci-members-body tr:not([data-edit-row])');
    const editBtnOf = (i) => memberRows().item(i).querySelector('button');
    editBtnOf(1).click();
    assert.equal(btnFor('reset').disabled, false, "Jun's reset is not cooling");
    assert.equal(btnFor('invite').disabled, false, "Jun's invite is not cooling");
    assert.equal(live.size, 0);
    editBtnOf(0).click(); // opening Mei replaces Jun's editor
    assert.equal(btnFor('reset').disabled, true, 'Mei is still cooling');
    editBtnOf(0).click();
    assert.equal(live.size, 0);

    // A send whose editor is closed mid-flight: the cooldown is still recorded, but
    // no interval is started on the removed button; reopening shows the countdown.
    let release;
    const pendingReply = ({ action }) =>
      new Promise((resolve) => {
        release = () => resolve({ body: { ok: true, action } });
      });
    editBtnOf(1).click();
    await click('reset', pendingReply);
    editBtnOf(1).click(); // close while the request is in flight
    assert.equal(editRow(), null);
    release();
    await tick();
    assert.equal(live.size, 0, 'no interval ticks for a removed button');
    editBtnOf(1).click();
    assert.equal(btnFor('reset').disabled, true, 'reopened editor shows the recorded cooldown');
    assert.match(btnFor('reset').textContent, /\(\d+s\)/);
    assert.equal(live.size, 1);

    // Closed and reopened mid-flight: the result lands on the CURRENT editor.
    await click('invite', pendingReply);
    editBtnOf(1).click();
    editBtnOf(1).click(); // reopen while still in flight
    assert.equal(btnFor('invite').disabled, false);
    release();
    await tick();
    assert.equal(btnFor('invite').disabled, true, 'countdown applied to the open editor');
    assert.ok(editMsg().classList.contains('alert-success'), 'notice shown in the open editor');
    assert.equal(live.size, 2, 'exactly one interval per cooling button, none stray');
    editBtnOf(1).click();
    assert.equal(live.size, 0);

    // Tab switching: click Events → active class moves, panels toggle, rows load.
    const evTab = document.querySelector('[data-tab="events"]');
    evTab.click();
    await tick();
    assert.ok(evTab.classList.contains('active'));
    assert.equal(
      document.querySelector('[data-tab="members"]').classList.contains('active'),
      false,
    );
    assert.equal(document.querySelector('[data-panel="events"]').hidden, false);
    assert.equal(document.querySelector('[data-panel="members"]').hidden, true);
    const evBadge = document.querySelector('#caaci-events-body .badge');
    assert.ok(evBadge.classList.contains('bg-warning-lt'), 'draft → bg-warning-lt');

    // Payments tab renders Tabler stat cards.
    document.querySelector('[data-tab="payments"]').click();
    await tick();
    const stats = document.querySelectorAll('#caaci-pay-stats .card .h1');
    assert.equal(stats.length, 4);
    assert.equal(stats[0].textContent, '12');
    assert.ok(stats[0].classList.contains('text-success'));

    // Directory tab renders the pending-review stat.
    document.querySelector('[data-tab="directory"]').click();
    await tick();
    const pendingStat = document.querySelector('#caaci-biz-stats .h1');
    assert.equal(pendingStat.textContent, '2');
    assert.ok(pendingStat.classList.contains('text-orange'));

    // Language toggle flips data-en/data-zh labels on the new markup.
    document.querySelector('#caaci-lang').click();
    await tick();
    assert.equal(document.querySelector('[data-tab="members"]').textContent.trim(), '会员与订阅');
    assert.equal(document.documentElement.lang, 'zh');
    document.querySelector('#caaci-lang').click(); // back to EN for cleanliness
  } finally {
    restoreTimers();
    fetch.restore();
  }
});
