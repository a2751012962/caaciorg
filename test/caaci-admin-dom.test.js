// Boots the REAL admin page markup (admin-src/index.html) + the real admin
// module (src/caaci-admin.js) in jsdom, with Supabase and the admin APIs
// stubbed. Catches markup/selector drift between the HTML and the module —
// ids, data-tab/data-panel hooks, badge/stat rendering, i18n labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

// Run far from Chicago (UTC+8, no DST) so the Chicago-time assertions below
// prove the admin module sets the zone itself instead of inheriting it from a
// machine that happens to be in Champaign. Set before the module is imported;
// node --test gives each test file its own process, so this doesn't leak.
process.env.TZ = 'Asia/Shanghai';

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

    // Service console shortcuts: inside the admin-only app, each opens the CAACI
    // account's dashboard in a new tab without handing it window.opener.
    const consoles = [...document.querySelectorAll('#caaci-admin-app #caaci-consoles a')];
    assert.deepEqual(
      consoles.map((a) => a.getAttribute('href')),
      [
        'https://supabase.com/dashboard/project/wslzeqhipvibeflmxznh',
        'https://resend.com/emails',
        'https://dash.cloudflare.com/60fc7d5394f94e7cbe99e82e34cfc640/pages/view/caaci',
        'https://dashboard.stripe.com/acct_1PfYMiJ3oYxWrRWD/dashboard',
        'https://claude.ai/code/artifact/01c18fa5-6e1e-4a79-be06-7f6556eaf7b9',
      ],
    );
    for (const a of consoles) {
      assert.equal(a.getAttribute('target'), '_blank');
      assert.match(a.getAttribute('rel'), /noopener/);
    }

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
    assert.doesNotMatch(
      editRow().textContent,
      /never confirmed/,
      'no invite-only-unconfirmed hint',
    );
    assert.match(
      editRow().textContent,
      /already have one get a link to set their password/,
      'hint explains both invite outcomes',
    );

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

    // Success: bearer token sent, the notice names what was sent, 60s countdown.
    await click('invite', ({ action }) => ({ body: { ok: true, action, delivered: 'invite' } }));
    const okPost = emailPosts().at(-1);
    assert.equal(okPost.options.method, 'POST');
    assert.equal(okPost.options.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(okPost.options.body), { member_id: 'm1', action: 'invite' });
    assert.ok(editMsg().classList.contains('alert-success'));
    assert.match(editMsg().textContent, /Invitation sent to Mei Lin\./);
    assert.doesNotMatch(editMsg().textContent, /already has an account/);
    assert.equal(btnFor('invite').disabled, true);
    assert.match(btnFor('invite').textContent, /\(60s\)/);

    // A 429 also starts the countdown.
    await click('reset', () => ({ status: 429, body: { error: 'wait' } }));
    assert.ok(editMsg().classList.contains('alert-danger'));
    assert.equal(btnFor('reset').disabled, true);
    assert.match(btnFor('reset').textContent, /\(\d+s\)/);
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
    const pendingReply =
      (extra = {}) =>
      ({ action }) =>
        new Promise((resolve) => {
          release = () => resolve({ body: { ok: true, action, ...extra } });
        });
    editBtnOf(1).click();
    await click('reset', pendingReply());
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
    // The invite reached an existing account, so the notice says a password-setup
    // link went out instead of an invitation.
    await click('invite', pendingReply({ delivered: 'password_setup' }));
    editBtnOf(1).click();
    editBtnOf(1).click(); // reopen while still in flight
    assert.equal(btnFor('invite').disabled, false);
    release();
    await tick();
    assert.equal(btnFor('invite').disabled, true, 'countdown applied to the open editor');
    assert.ok(editMsg().classList.contains('alert-success'), 'notice shown in the open editor');
    assert.match(
      editMsg().textContent,
      /Jun Wu already has an account, so they were emailed a link to set their password\./,
    );
    assert.doesNotMatch(editMsg().textContent, /Invitation sent/);
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

    // The password_setup success notice must read correctly in Chinese too:
    // it should mention the member already having an account (已有账户).
    document.querySelector('[data-tab="members"]').click();
    await tick();
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000; // bypass cooldowns recorded earlier in this test
    try {
      editBtnOf(0).click();
      await click('invite', ({ action }) => ({
        body: { ok: true, action, delivered: 'password_setup' },
      }));
      assert.match(editMsg().textContent, /已有账户/);
      editBtnOf(0).click();
    } finally {
      Date.now = realNow;
    }

    document.querySelector('#caaci-lang').click(); // back to EN for cleanliness
  } finally {
    restoreTimers();
    fetch.restore();
  }
});

// ---------- events: free-gift deadline + registrations ----------
// These reuse the page the first test booted: the module's boot IIFE runs once
// per process, on its first import.
const DEADLINE = '2026-09-21T04:59:00.000Z'; // 2026-09-20 23:59:00 in Chicago (CDT)
const MAF = {
  id: 'ev-maf',
  title: 'Mid-Autumn Festival',
  starts_at: '2026-09-27T19:00:00Z', // 2:00 PM Chicago (CDT)
  ends_at: '2026-09-27T23:00:00Z', // 6:00 PM Chicago
  location: 'Siebel Center for Design',
  published: true,
  perk_deadline: DEADLINE,
};
const PICNIC = {
  id: 'ev-picnic',
  title: 'Picnic',
  starts_at: '2026-08-01T17:00:00Z',
  location: null,
  published: true,
  perk_deadline: null,
};
const REGISTRATIONS = {
  event: {
    id: 'ev-maf',
    title: 'Mid-Autumn Festival',
    starts_at: MAF.starts_at,
    perk_deadline: DEADLINE,
    deadline: DEADLINE,
  },
  rows: [
    {
      id: 'r1',
      email: 'mei@example.com',
      attending: true,
      attendee_names: '<img src=x onerror=alert(1)>',
      heard_from: 'Friend',
      wants_meal: true,
      created_at: '2026-09-13T15:05:07Z',
      updated_at: '2026-09-13T15:05:07Z',
      member_id: 'm1',
      account: {
        id: 'm1',
        created_at: '2026-09-25T00:00:00Z',
        status: 'active',
        tier_id: 'free',
        confirmed: true,
      },
      perk_eligible: false,
    },
    {
      id: 'r2',
      email: 'jun@example.com',
      attending: true,
      attendee_names: 'Jun Wu',
      heard_from: '<b>flyer</b>',
      wants_meal: null,
      created_at: '2026-09-14T16:00:00Z',
      updated_at: '2026-09-14T16:00:00Z',
      member_id: null,
      account: {
        id: 'm2',
        created_at: '2026-09-01T12:00:00Z',
        status: 'active',
        tier_id: 'free',
        confirmed: true,
      },
      perk_eligible: true,
    },
    {
      id: 'r3',
      email: 'kai@example.com',
      attending: false,
      attendee_names: null,
      heard_from: null,
      wants_meal: false,
      created_at: '2026-09-22T01:02:03Z',
      updated_at: '2026-09-22T01:02:03Z',
      member_id: null,
      // signed up, never confirmed the email: shown, not counted
      account: {
        id: 'm3',
        created_at: '2026-09-02T12:00:00Z',
        status: 'pending',
        tier_id: null,
        confirmed: false,
      },
      perk_eligible: false,
    },
  ],
  summary: { total: 3, attending: 2, not_attending: 1, meal: 1, with_account: 2, perk_eligible: 1 },
};

function eventRoutes(u, options = {}) {
  if (u.includes('/api/admin/event-registrations')) return { body: REGISTRATIONS };
  if (u.includes('/api/admin/events') && options.method === 'POST') return { body: { ok: true } };
  if (u.includes('/api/admin/events')) return { body: { rows: [MAF, PICNIC], total: 2 } };
  return { body: {} };
}
const eventRow = (title) =>
  [...document.querySelectorAll('#caaci-events-body tr')].find((tr) =>
    tr.cells[0].textContent.includes(title),
  );

test('admin events: the free-gift deadline round-trips through the event editor', async () => {
  const fetch = mockFetch(eventRoutes);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const form = () => document.querySelector('#caaci-event-form-host form');
    const deadline = () => form().querySelector('[data-f="perk_deadline"]');
    const lastPost = () =>
      JSON.parse(
        fetch.calls
          .filter((c) => c.url.includes('/api/admin/events') && c.options.method === 'POST')
          .at(-1).options.body,
      );

    // Shown as the admin's own wall-clock time (whatever zone this runs in).
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    const d = new Date(DEADLINE);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    assert.equal(deadline().value, local);
    assert.ok(form().querySelector(`label[for="${deadline().id}"]`), 'the field is labelled');
    assert.match(
      deadline().closest('.col').textContent,
      /Free-gift deadline[\s\S]*Empty = event start/,
    );

    // Saved unchanged → the same instant goes back, as ISO.
    form().querySelector('[type="submit"]').click();
    await tick();
    assert.equal(form(), null, 'editor closed after saving');
    assert.equal(lastPost().perk_deadline, DEADLINE);

    // Cleared → '' (the API stores null, i.e. "the event start").
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    deadline().value = '';
    form().querySelector('[type="submit"]').click();
    await tick();
    assert.equal(lastPost().perk_deadline, '');

    // An event without one opens with an empty field.
    eventRow('Picnic').querySelector('[data-act="edit"]').click();
    assert.equal(deadline().value, '');
    form().querySelector('[data-act="cancel"]').click();
  } finally {
    fetch.restore();
  }
});

test('admin events: saving an event sends its start and end as real instants, so it never drifts', async () => {
  const fetch = mockFetch(eventRoutes);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const form = () => document.querySelector('#caaci-event-form-host form');
    const input = (f) => form().querySelector(`[data-f="${f}"]`);
    const save = async () => {
      form().querySelector('[type="submit"]').click();
      await tick();
      const post = fetch.calls
        .filter((c) => c.url.includes('/api/admin/events') && c.options.method === 'POST')
        .at(-1);
      return JSON.parse(post.options.body);
    };

    // Stored 19:00Z–23:00Z shows as this process's wall-clock (Asia/Shanghai, UTC+8).
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    assert.equal(input('starts_at').value, '2026-09-28T03:00');
    assert.equal(input('ends_at').value, '2026-09-28T07:00');

    // Saved unchanged → exactly the stored instants (not the wall-clock read as UTC).
    let sent = await save();
    assert.equal(sent.starts_at, '2026-09-27T19:00:00.000Z');
    assert.equal(sent.ends_at, '2026-09-27T23:00:00.000Z');

    // Newly typed local times → the matching instants; a cleared end → ''.
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    input('starts_at').value = '2026-09-28T03:30';
    input('ends_at').value = '';
    sent = await save();
    assert.equal(sent.starts_at, '2026-09-27T19:30:00.000Z');
    assert.equal(sent.ends_at, '');
  } finally {
    fetch.restore();
  }
});

test('admin events: registrations panel shows the summary, escaped rows and an eligible-only filter', async () => {
  const fetch = mockFetch(eventRoutes);
  window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom does no layout
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    eventRow('Mid-Autumn').querySelector('[data-act="registrations"]').click();
    await tick();

    const panel = document.querySelector('#caaci-reg-panel');
    assert.equal(panel.hidden, false);
    const call = fetch.calls.find((c) => c.url.includes('/api/admin/event-registrations'));
    assert.equal(call.url, '/api/admin/event-registrations?event_id=ev-maf');
    assert.equal(call.options.headers.authorization, 'Bearer tok');
    assert.equal(document.querySelector('#caaci-reg-title').textContent, 'Mid-Autumn Festival');
    assert.match(document.querySelector('#caaci-reg-deadline').textContent, /2026-09-20 23:59:00/);
    assert.deepEqual(
      [...document.querySelectorAll('#caaci-reg-stats .h1')].map((el) => el.textContent),
      ['3', '2', '1', '1', '2', '1'],
    );

    const rows = () => [...document.querySelectorAll('#caaci-reg-body tr')];
    const cells = (tr) => [...tr.cells].map((td) => td.textContent.trim());
    assert.equal(rows().length, 3);
    // Times in Chicago; registrant text shown literally, never parsed as markup.
    assert.deepEqual(cells(rows()[0]), [
      '1',
      '2026-09-13 10:05:07',
      'mei@example.com',
      'Yes',
      '<img src=x onerror=alert(1)>',
      'Friend',
      'Yes',
      '✓',
      '—',
    ]);
    assert.deepEqual(cells(rows()[1]), [
      '2',
      '2026-09-14 11:00:00',
      'jun@example.com',
      'Yes',
      'Jun Wu',
      '<b>flyer</b>',
      '—',
      '✓',
      '✓',
    ]);
    assert.deepEqual(cells(rows()[2]), [
      '3',
      '2026-09-21 20:02:03',
      'kai@example.com',
      'No',
      '—',
      '—',
      'No',
      'Unconfirmed',
      '—',
    ]);
    assert.equal(document.querySelector('#caaci-reg-body img, #caaci-reg-body b'), null);

    // Eligible only: just Jun, still numbered by registration order.
    const toggle = document.querySelector('#caaci-reg-eligible');
    toggle.click();
    assert.equal(toggle.checked, true);
    assert.deepEqual(
      rows().map((tr) => cells(tr).slice(0, 3)),
      [['2', '2026-09-14 11:00:00', 'jun@example.com']],
    );
    toggle.click();
    assert.equal(rows().length, 3);

    document.querySelector('#caaci-reg-close').click();
    assert.equal(panel.hidden, true);
  } finally {
    delete window.HTMLElement.prototype.scrollIntoView;
    fetch.restore();
  }
});

test('admin events: registrations CSV has a BOM, Chicago times and RFC 4180 quoting', async () => {
  const { registrationsCsv } = await import('../src/caaci-admin.js'); // already booted
  const rows = [
    {
      email: 'mei@example.com',
      created_at: '2026-09-13T15:05:07Z',
      attending: true,
      attendee_names: 'Mei, "Jun"\nand Kai',
      heard_from: 'Friend',
      wants_meal: true,
      account: { created_at: '2026-09-01T12:00:00Z', confirmed: true },
      perk_eligible: true,
    },
    {
      email: 'kai@example.com',
      created_at: '2026-09-22T01:02:03Z',
      attending: false,
      attendee_names: null,
      heard_from: '=HYPERLINK("http://x")',
      wants_meal: null,
      account: { created_at: '2026-09-02T12:00:00Z', confirmed: false }, // never confirmed
      perk_eligible: false,
    },
    {
      email: 'lin@example.com',
      created_at: '2026-01-15T18:00:00Z', // CST (UTC−6) in winter
      attending: true,
      attendee_names: '林美',
      heard_from: 'Social Media',
      wants_meal: false,
      account: { created_at: '2026-01-10T06:00:00Z', confirmed: true }, // midnight → 00, not 24
      perk_eligible: true,
    },
    {
      email: 'zoe@example.com',
      created_at: '2026-09-23T00:00:00Z',
      attending: true,
      attendee_names: 'Zoe',
      heard_from: 'Website',
      wants_meal: null,
      account: null, // no account: account_confirmed is blank, not "no"
      perk_eligible: false,
    },
  ];
  const header =
    '#,registered_at (Chicago),email,attending,names,heard_from,wants_meal,has_account,account_confirmed,account_created_at (Chicago),mooncake_eligible';
  const mei =
    '1,2026-09-13 10:05:07,mei@example.com,yes,"Mei, ""Jun""\nand Kai",Friend,yes,yes,yes,2026-09-01 07:00:00,yes';
  // A formula-looking answer is defused with a leading ' (then quoted for its quotes).
  const kai = `2,2026-09-21 20:02:03,kai@example.com,no,,"'=HYPERLINK(""http://x"")",,yes,no,2026-09-02 07:00:00,no`;
  const lin =
    '3,2026-01-15 12:00:00,lin@example.com,yes,林美,Social Media,no,yes,yes,2026-01-10 00:00:00,yes';
  const zoe = '4,2026-09-22 19:00:00,zoe@example.com,yes,Zoe,Website,,no,,,no';

  const csv = registrationsCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM first');
  assert.equal(csv, `\uFEFF${[header, mei, kai, lin, zoe].join('\r\n')}\r\n`);

  // Eligible only keeps each row's registration number.
  assert.equal(
    registrationsCsv(rows, { eligibleOnly: true }),
    `\uFEFF${[header, mei, lin].join('\r\n')}\r\n`,
  );
});
