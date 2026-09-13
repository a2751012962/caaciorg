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
// Stored questions, already in the normalized shape the API keeps.
const MAF_QUESTIONS = [
  {
    id: 'attending',
    type: 'single',
    label_en: 'Will you attend?',
    label_zh: '您会参加吗？',
    required: true,
    options: [
      { id: 'yes', label_en: "Yes, I'll be there", label_zh: '能，我会参加' },
      { id: 'no', label_en: "Sorry, can't make it", label_zh: '抱歉，无法参加' },
    ],
    other: false,
  },
  {
    id: 'names',
    type: 'textarea',
    label_en: 'What are the names of people attending?',
    label_zh: '参加者的姓名是？',
    required: true,
  },
  {
    id: 'heard_from',
    type: 'single',
    label_en: 'How did you hear about the festival?',
    label_zh: '您是如何得知本次活动的？',
    required: false,
    options: [
      { id: 'website', label_en: 'Website', label_zh: '网站' },
      { id: 'friend', label_en: 'Friend', label_zh: '朋友' },
      { id: 'newsletter', label_en: 'Newsletter', label_zh: '通讯' },
      { id: 'social', label_en: 'Social Media', label_zh: '社交媒体' },
    ],
    other: true,
  },
  {
    id: 'meal',
    type: 'single',
    label_en: 'Would you like to purchase a meal?',
    label_zh: '您想购买餐食吗？',
    required: false,
    options: [
      { id: 'yes', label_en: 'Yes', label_zh: '要' },
      { id: 'no', label_en: 'No', label_zh: '不要' },
    ],
    other: false,
  },
];
const MAF = {
  id: 'ev-maf',
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival',
  title_zh: '中秋节',
  starts_at: '2026-09-27T19:00:00Z', // 2:00 PM Chicago (CDT)
  ends_at: '2026-09-27T23:00:00Z', // 6:00 PM Chicago
  location: 'Siebel Center for Design',
  published: true,
  perk_deadline: DEADLINE,
  perk_item_zh: '月饼',
  perk_item_en: 'mooncake',
  registration_questions: MAF_QUESTIONS,
  registration_count: 3,
};
const PICNIC = {
  id: 'ev-picnic',
  slug: 'picnic',
  title: 'Picnic',
  title_zh: null,
  starts_at: '2026-08-01T17:00:00Z',
  location: null,
  published: true,
  perk_deadline: null,
  perk_item_zh: null,
  perk_item_en: null,
  registration_questions: null, // takes no registrations
  registration_count: 0,
};
const FAIR = {
  id: 'ev-fair',
  slug: 'spring-fair',
  title: 'Spring Fair',
  title_zh: '春季集市',
  starts_at: '2099-04-01T15:00:00Z',
  ends_at: null,
  location: 'Urbana',
  published: true,
  perk_deadline: null,
  perk_item_zh: null,
  perk_item_en: null,
  registration_questions: [
    {
      id: 'note',
      type: 'text',
      label_en: 'Anything we should know?',
      label_zh: '还有什么需要告诉我们的吗？',
      required: false,
    },
  ],
  registration_count: 0,
};
// A multiple-choice question with an Other box, for the registrations panel and CSV.
const HELPING = {
  id: 'helping',
  type: 'multi',
  label_en: 'Can you help on the day?',
  label_zh: '当天能来帮忙吗？',
  required: false,
  options: [
    { id: 'setup', label_en: 'Setup & decor', label_zh: '布置' },
    { id: 'cleanup', label_en: 'Cleanup', label_zh: '清理' },
  ],
  other: true,
};
const [ATTENDING, NAMES, HEARD_FROM] = MAF_QUESTIONS;
// What /api/admin/event-registrations answers for the Mid-Autumn event.
const REGISTRATIONS = {
  event: {
    id: 'ev-maf',
    slug: 'mid-autumn-festival',
    title: 'Mid-Autumn Festival',
    title_zh: '中秋节',
    starts_at: MAF.starts_at,
    perk: { item_en: 'mooncake', item_zh: '月饼', deadline: DEADLINE },
  },
  questions: [ATTENDING, NAMES, HEARD_FROM, HELPING],
  rows: [
    {
      id: 'r1',
      email: 'mei@example.com',
      answers: {
        attending: { option: 'yes' },
        names: '<img src=x onerror=alert(1)>',
        heard_from: { option: 'friend' },
        helping: { options: ['setup', 'cleanup'], other: '<b>music</b>' },
      },
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
      answers: {
        attending: { option: 'yes' },
        names: 'Jun Wu',
        heard_from: { other: '<b>flyer</b>' },
      },
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
      answers: {
        attending: { option: 'no' },
        heard_from: { option: 'gone' }, // an option removed from the form since
        helping: { options: [], other: 'Photos' },
      },
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
  summary: {
    total: 3,
    with_account: 2,
    perk_eligible: 1,
    choices: {
      attending: { yes: 2, no: 1 },
      heard_from: { friend: 1, other: 1 },
      helping: { setup: 1, cleanup: 1, other: 2 },
    },
  },
};
// …and for Spring Fair: no free gift, one text question.
const FAIR_REGISTRATIONS = {
  event: {
    id: 'ev-fair',
    slug: 'spring-fair',
    title: 'Spring Fair',
    title_zh: '春季集市',
    starts_at: FAIR.starts_at,
    perk: null,
  },
  questions: FAIR.registration_questions,
  rows: [
    {
      id: 'r9',
      email: 'ann@example.com',
      answers: { note: 'Bringing "cake" & <2 kids>' },
      created_at: '2026-09-10T17:30:00Z',
      updated_at: '2026-09-10T17:30:00Z',
      member_id: null,
      account: null,
      perk_eligible: false,
    },
  ],
  summary: { total: 1, with_account: 0, perk_eligible: 0, choices: {} },
};

function eventRoutes(u, options = {}) {
  if (u.includes('/api/admin/event-registrations'))
    return { body: u.includes('event_id=ev-fair') ? FAIR_REGISTRATIONS : REGISTRATIONS };
  if (u.includes('/api/admin/events') && ['POST', 'PUT'].includes(options.method)) {
    // The API's own validation message comes back as is.
    if (JSON.parse(options.body).title === 'Refused')
      return { status: 400, body: { error: 'Question labels must be 1-200 characters.' } };
    return { body: { ok: true } };
  }
  if (u.includes('/api/admin/events')) return { body: { rows: [MAF, PICNIC, FAIR], total: 3 } };
  return { body: {} };
}
const eventRow = (title) =>
  [...document.querySelectorAll('#caaci-events-body tr')].find((tr) =>
    tr.cells[0].textContent.includes(title),
  );
const eventEditor = () => document.querySelector('#caaci-event-form-host form');
const editorField = (f) => eventEditor().querySelector(`[data-f="${f}"]`);
const builder = () => eventEditor().querySelector('[data-questions]');
const questionCard = (i) => builder().querySelectorAll('[data-q]')[i];
const optionRow = (card, j) => card.querySelectorAll('[data-o]')[j];
const saveEvent = async () => {
  eventEditor().querySelector('[type="submit"]').click();
  await tick();
};
const typeInto = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const choose = (select, value) => {
  select.value = value;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const sentEvents = (fetch, method) =>
  fetch.calls
    .filter((c) => c.url.includes('/api/admin/events') && c.options.method === method)
    .map((c) => JSON.parse(c.options.body));
// Records window.confirm prompts and answers them with `answer`.
function stubConfirm(answer) {
  const real = window.confirm;
  const asked = [];
  window.confirm = (m) => {
    asked.push(m);
    return answer;
  };
  asked.restore = () => {
    window.confirm = real;
  };
  return asked;
}

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

test('admin events: the Chinese title and gift names round-trip, and a gift needs both names or neither', async () => {
  const fetch = mockFetch(eventRoutes);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const form = () => document.querySelector('#caaci-event-form-host form');
    const input = (f) => form().querySelector(`[data-f="${f}"]`);
    const posts = () =>
      fetch.calls.filter((c) => c.url.includes('/api/admin/events') && c.options.method === 'POST');
    const submit = async () => {
      form().querySelector('[type="submit"]').click();
      await tick();
    };

    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    assert.equal(input('title_zh').value, '中秋节');
    assert.equal(input('perk_item_zh').value, '月饼');
    assert.equal(input('perk_item_en').value, 'mooncake');
    for (const f of ['title_zh', 'perk_item_zh', 'perk_item_en'])
      assert.ok(form().querySelector(`label[for="${input(f).id}"]`), `${f} is labelled`);
    await submit();
    let sent = JSON.parse(posts().at(-1).options.body);
    assert.equal(sent.title_zh, '中秋节');
    assert.equal(sent.perk_item_zh, '月饼');
    assert.equal(sent.perk_item_en, 'mooncake');

    // One name without the other is refused before any request, in the API's words.
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    input('perk_item_en').value = '   ';
    const before = posts().length;
    await submit();
    assert.equal(posts().length, before, 'nothing sent');
    const msg = form().querySelector('[data-msg]');
    assert.ok(msg.classList.contains('alert-danger'));
    assert.equal(msg.textContent, 'Enter the gift name in both languages, or neither.');

    // Both cleared (and the Chinese title) → '' each, which the API stores as null.
    input('perk_item_zh').value = '';
    input('title_zh').value = ' ';
    await submit();
    assert.equal(form(), null, 'saved');
    sent = JSON.parse(posts().at(-1).options.body);
    assert.equal(sent.perk_item_zh, '');
    assert.equal(sent.perk_item_en, '');
    assert.equal(sent.title_zh, '');

    // An event without them opens with empty fields.
    eventRow('Picnic').querySelector('[data-act="edit"]').click();
    assert.deepEqual(
      ['title_zh', 'perk_item_zh', 'perk_item_en'].map((f) => input(f).value),
      ['', '', ''],
    );
    form().querySelector('[data-act="cancel"]').click();
  } finally {
    fetch.restore();
  }
});

test('admin events: the question builder edits, adds and reorders questions and keeps every stored id', async () => {
  const fetch = mockFetch(eventRoutes);
  const asked = stubConfirm(true);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const lastPost = () => sentEvents(fetch, 'POST').at(-1);

    // The stored questions load into the builder…
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    assert.equal(editorField('accept_registrations').checked, true);
    assert.equal(builder().hidden, false);
    assert.equal(builder().querySelectorAll('[data-q]').length, 4);
    assert.equal(questionCard(0).querySelector('[data-qf="type"]').value, 'single');
    assert.equal(questionCard(0).querySelector('[data-qf="required"]').checked, true);
    assert.equal(questionCard(1).querySelector('[data-qf="type"]').value, 'textarea');
    assert.equal(questionCard(1).querySelector('[data-act="opt-add"]'), null, 'no options on text');
    assert.equal(questionCard(2).querySelector('[data-qf="other"]').checked, true);
    assert.equal(
      optionRow(questionCard(2), 3).querySelector('[data-of="label_zh"]').value,
      '社交媒体',
    );
    const en = questionCard(1).querySelector('[data-qf="label_en"]');
    assert.ok(eventEditor().querySelector(`label[for="${en.id}"]`), 'question labels are labelled');

    // …and saved untouched they go back exactly, without a registrations warning.
    await saveEvent();
    assert.deepEqual(lastPost().registration_questions, MAF_QUESTIONS);
    assert.equal(asked.length, 0);

    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    // Relabel a question (typed text survives the re-renders below).
    typeInto(questionCard(1).querySelector('[data-qf="label_en"]'), 'Who is coming?');
    // Add an option; focus lands in it.
    questionCard(3).querySelector('[data-act="opt-add"]').click();
    const added = optionRow(questionCard(3), 2).querySelector('[data-of="label_en"]');
    assert.equal(document.activeElement, added, 'focus moves to the new option');
    typeInto(added, ' Maybe ');
    typeInto(optionRow(questionCard(3), 2).querySelector('[data-of="label_zh"]'), '也许');
    // Move the meal question above "heard from", swap the attending options,
    // and drop the Social Media option.
    questionCard(3).querySelector('[data-act="q-up"]').click();
    optionRow(questionCard(0), 1).querySelector('[data-act="opt-up"]').click();
    optionRow(questionCard(3), 3).querySelector('[data-act="opt-remove"]').click();
    assert.equal(questionCard(0).querySelector('[data-act="q-up"]').disabled, true);
    assert.equal(questionCard(3).querySelector('[data-act="q-down"]').disabled, true);
    // A text question keeps no options; switching back restores them.
    choose(questionCard(2).querySelector('[data-qf="type"]'), 'text');
    assert.equal(questionCard(2).querySelector('[data-of]'), null);
    choose(questionCard(2).querySelector('[data-qf="type"]'), 'single');
    // A new multiple-choice question with an Other box, then a throwaway one.
    builder().querySelector('[data-act="q-add"]').click();
    choose(questionCard(4).querySelector('[data-qf="type"]'), 'multi');
    typeInto(questionCard(4).querySelector('[data-qf="label_en"]'), 'Dietary needs');
    typeInto(questionCard(4).querySelector('[data-qf="label_zh"]'), '饮食需求');
    typeInto(questionCard(4).querySelector('[data-of="label_en"]'), 'Vegetarian');
    typeInto(questionCard(4).querySelector('[data-of="label_zh"]'), '素食');
    questionCard(4).querySelector('[data-qf="other"]').click();
    questionCard(4).querySelector('[data-qf="required"]').click();
    builder().querySelector('[data-act="q-add"]').click();
    questionCard(5).querySelector('[data-act="q-remove"]').click();
    assert.equal(builder().querySelectorAll('[data-q]').length, 5);

    await saveEvent();
    assert.equal(eventEditor(), null, 'saved');
    assert.equal(asked.length, 1, 'people registered, so the change was confirmed first');
    const sent = lastPost().registration_questions;
    const newOption = sent[2].options[2].id;
    const newQuestion = sent[4].id;
    const newQuestionOption = sent[4].options[0].id;
    assert.match(newOption, /^o_[a-z0-9]{6}$/);
    assert.match(newQuestion, /^q_[a-z0-9]{6}$/);
    assert.match(newQuestionOption, /^o_[a-z0-9]{6}$/);
    const [attending, names, heardFrom, meal] = MAF_QUESTIONS;
    assert.deepEqual(sent, [
      { ...attending, options: [attending.options[1], attending.options[0]] },
      { ...names, label_en: 'Who is coming?' },
      {
        ...meal,
        options: [...meal.options, { id: newOption, label_en: 'Maybe', label_zh: '也许' }],
      },
      { ...heardFrom, options: heardFrom.options.slice(0, 3) },
      {
        id: newQuestion,
        type: 'multi',
        label_en: 'Dietary needs',
        label_zh: '饮食需求',
        required: true,
        options: [{ id: newQuestionOption, label_en: 'Vegetarian', label_zh: '素食' }],
        other: true,
      },
    ]);
  } finally {
    asked.restore();
    fetch.restore();
  }
});

test('admin events: registrations switched off send null; a new event gets fresh ids and client-side checks', async () => {
  const fetch = mockFetch(eventRoutes);
  const asked = stubConfirm(true);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();

    // Off → null, and the builder hides. Nobody has registered, so no warning.
    eventRow('Spring Fair').querySelector('[data-act="edit"]').click();
    editorField('accept_registrations').click();
    assert.equal(builder().hidden, true);
    await saveEvent();
    assert.equal(sentEvents(fetch, 'POST').at(-1).registration_questions, null);
    assert.equal(asked.length, 0);

    // Off and on again before saving keeps the questions.
    eventRow('Spring Fair').querySelector('[data-act="edit"]').click();
    editorField('accept_registrations').click();
    editorField('accept_registrations').click();
    assert.equal(builder().hidden, false);
    await saveEvent();
    assert.deepEqual(sentEvents(fetch, 'POST').at(-1).registration_questions, [
      FAIR.registration_questions[0],
    ]);

    // A new event takes no registrations until switched on.
    const newEvent = () => {
      document.querySelector('#caaci-event-add-btn').click();
      typeInto(editorField('title'), 'Lantern Walk');
      editorField('starts_at').value = '2099-02-01T18:00';
    };
    newEvent();
    assert.equal(editorField('accept_registrations').checked, false);
    assert.equal(builder().hidden, true);
    await saveEvent();
    assert.equal(sentEvents(fetch, 'PUT').at(-1).registration_questions, null);

    // Switched on with no questions: an open form that asks only for an email.
    newEvent();
    editorField('accept_registrations').click();
    assert.match(builder().textContent, /asks only for an email address/);
    builder().querySelector('[data-act="q-add"]').click();
    const card = questionCard(0);
    assert.equal(
      card.querySelector('[data-qf="type"]').value,
      'single',
      'new questions are single',
    );
    assert.equal(card.querySelectorAll('[data-o]').length, 1, 'with one option to fill in');

    // Client-side checks name the question, and nothing is sent.
    const msg = () => eventEditor().querySelector('[data-msg]');
    const puts = sentEvents(fetch, 'PUT').length;
    await saveEvent();
    assert.match(msg().textContent, /^Question 1: enter the question in both English and Chinese/);
    typeInto(questionCard(0).querySelector('[data-qf="label_en"]'), 'T-shirt size');
    typeInto(questionCard(0).querySelector('[data-qf="label_zh"]'), 'T恤尺码');
    await saveEvent();
    assert.match(msg().textContent, /^Question 1, option 1: enter the option in both English/);
    optionRow(questionCard(0), 0).querySelector('[data-act="opt-remove"]').click();
    await saveEvent();
    assert.match(msg().textContent, /^Question 1: give it 1 to 30 options\./);
    assert.equal(sentEvents(fetch, 'PUT').length, puts, 'nothing sent while invalid');

    questionCard(0).querySelector('[data-act="opt-add"]').click();
    typeInto(optionRow(questionCard(0), 0).querySelector('[data-of="label_en"]'), 'Medium');
    typeInto(optionRow(questionCard(0), 0).querySelector('[data-of="label_zh"]'), '中号');
    await saveEvent();
    const [q] = sentEvents(fetch, 'PUT').at(-1).registration_questions;
    assert.match(q.id, /^q_[a-z0-9]{6}$/);
    assert.match(q.options[0].id, /^o_[a-z0-9]{6}$/);
    assert.deepEqual(q, {
      id: q.id,
      type: 'single',
      label_en: 'T-shirt size',
      label_zh: 'T恤尺码',
      required: false,
      options: [{ id: q.options[0].id, label_en: 'Medium', label_zh: '中号' }],
      other: false,
    });

    // The API's own refusal is shown as returned.
    eventRow('Spring Fair').querySelector('[data-act="edit"]').click();
    typeInto(editorField('title'), 'Refused');
    await saveEvent();
    assert.ok(msg().classList.contains('alert-danger'));
    assert.equal(msg().textContent, 'Question labels must be 1-200 characters.');
    eventEditor().querySelector('[data-act="cancel"]').click();
  } finally {
    asked.restore();
    fetch.restore();
  }
});

test('admin events: changing the questions of an event people registered for asks first', async () => {
  const fetch = mockFetch(eventRoutes);
  const asked = stubConfirm(false);
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const posts = () => sentEvents(fetch, 'POST').length;

    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    assert.match(
      eventEditor().querySelector('[data-reg-count]').textContent,
      /3 registration\(s\) so far/,
    );
    const before = posts();

    // Declined: nothing is sent and the editor stays open with the edit.
    typeInto(questionCard(0).querySelector('[data-qf="label_zh"]'), '您来吗？');
    await saveEvent();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /^3 people have already registered for this event\./);
    assert.equal(posts(), before);
    assert.ok(eventEditor(), 'still editing');

    // Switching registrations off is a change too.
    eventEditor().querySelector('[data-act="cancel"]').click();
    eventRow('Mid-Autumn').querySelector('[data-act="edit"]').click();
    editorField('accept_registrations').click();
    await saveEvent();
    assert.equal(asked.length, 2);
    assert.equal(posts(), before);

    // Accepted: sent.
    window.confirm = (m) => asked.push(m) > 0;
    await saveEvent();
    assert.equal(asked.length, 3);
    assert.equal(posts(), before + 1);
    assert.equal(sentEvents(fetch, 'POST').at(-1).registration_questions, null);

    // No registrations: no warning at all.
    eventRow('Spring Fair').querySelector('[data-act="edit"]').click();
    assert.equal(eventEditor().querySelector('[data-reg-count]'), null);
    typeInto(questionCard(0).querySelector('[data-qf="label_en"]'), 'Anything else?');
    await saveEvent();
    assert.equal(asked.length, 3);
    assert.equal(posts(), before + 2);
  } finally {
    asked.restore();
    fetch.restore();
  }
});

test('admin events: only events open for registration offer the registration link and its QR code', async () => {
  const LONG = {
    ...FAIR,
    id: 'ev-long',
    slug: 'long-fair',
    title: 'Long Fair',
    title_zh: null,
    starts_at: '2020-01-01T15:00:00Z',
    ends_at: '2099-01-01T15:00:00Z', // started long ago, still running
  };
  const DRAFT = {
    ...FAIR,
    id: 'ev-draft',
    slug: 'draft-fair',
    title: 'Draft Fair',
    published: false,
  };
  const OVER = {
    ...FAIR,
    id: 'ev-over',
    slug: 'old-fair',
    title: 'Old Fair',
    starts_at: '2020-04-01T15:00:00Z',
  };
  const fetch = mockFetch((u, o) =>
    u.includes('/api/admin/events?')
      ? { body: { rows: [MAF, PICNIC, FAIR, LONG, DRAFT, OVER], total: 6 } }
      : eventRoutes(u, o),
  );
  // The real vendored generator, with what it is asked to encode recorded.
  const src = await readFile(new URL('../src/vendor/qrcode.js', import.meta.url), 'utf8');
  const qrcode = new Function(`${src}\nreturn qrcode;`)();
  const encoded = [];
  window.qrcode = (type, level) => {
    const qr = qrcode(type, level);
    const addData = qr.addData;
    qr.addData = (text) => {
      encoded.push(text);
      addData(text);
    };
    return qr;
  };
  window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom does no layout
  const prompts = [];
  const realPrompt = window.prompt;
  window.prompt = (message, value) => prompts.push(value) && null;
  const url = 'https://caaci.example/events/spring-fair/register/';
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    const offers = (title) => [
      !!eventRow(title).querySelector('[data-act="reg-link"]'),
      !!eventRow(title).querySelector('[data-act="reg-qr"]'),
    ];
    assert.deepEqual(offers('Spring Fair'), [true, true]);
    assert.deepEqual(offers('Long Fair'), [true, true], 'open until the event ends');
    assert.deepEqual(offers('Picnic'), [false, false], 'takes no registrations');
    assert.deepEqual(offers('Draft Fair'), [false, false], 'not published');
    assert.deepEqual(offers('Old Fair'), [false, false], 'already over');

    // Copy uses the clipboard…
    const copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    });
    try {
      eventRow('Spring Fair').querySelector('[data-act="reg-link"]').click();
      await tick();
    } finally {
      delete navigator.clipboard;
    }
    assert.deepEqual(copied, [url]);
    const notb = document.querySelector('#caaci-events-notice');
    assert.equal(notb.textContent, `Registration link copied: ${url}`);
    // …or, without one, offers the link to copy by hand.
    eventRow('Long Fair').querySelector('[data-act="reg-link"]').click();
    await tick();
    assert.deepEqual(prompts, ['https://caaci.example/events/long-fair/register/']);

    // The QR encodes the registration link and can be downloaded.
    eventRow('Spring Fair').querySelector('[data-act="reg-qr"]').click();
    const host = document.querySelector('#caaci-event-qr-host');
    assert.deepEqual(encoded, [url]);
    assert.match(host.querySelector('img').getAttribute('src'), /^data:image\/gif;base64,/);
    assert.equal(host.querySelector('code').textContent, url);
    assert.equal(host.querySelector('h3').textContent, '春季集市 · Spring Fair');
    assert.equal(
      host.querySelector('a[download]').getAttribute('download'),
      'caaci-spring-fair-registration-qr.gif',
    );
    host.querySelector('[data-act="close"]').click();
    assert.equal(host.innerHTML, '');
  } finally {
    window.prompt = realPrompt;
    delete window.HTMLElement.prototype.scrollIntoView;
    delete window.qrcode;
    fetch.restore();
  }
});

test('admin events: the registrations panel shows a column and option counts per question, escaped answers and an eligible-only filter', async () => {
  const fetch = mockFetch(eventRoutes);
  window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom does no layout
  const text = (sel) => document.querySelector(sel).textContent;
  const stats = () =>
    [...document.querySelectorAll('#caaci-reg-stats .h1')].map((el) => el.textContent);
  const counts = (questionId) =>
    [...document.querySelectorAll(`#caaci-reg-stats [data-choice="${questionId}"] .d-flex`)].map(
      (line) => [...line.children].map((el) => el.textContent),
    );
  const head = () =>
    [...document.querySelectorAll('#caaci-reg-head th')].map((th) => th.textContent.trim());
  const rows = () => [...document.querySelectorAll('#caaci-reg-body tr')];
  const cells = (tr) => [...tr.cells].map((td) => td.textContent.trim());
  const open = async (title) => {
    eventRow(title).querySelector('[data-act="registrations"]').click();
    await tick();
  };
  try {
    document.querySelector('[data-tab="events"]').click();
    await tick();
    await open('Mid-Autumn');

    const panel = document.querySelector('#caaci-reg-panel');
    assert.equal(panel.hidden, false);
    const call = fetch.calls.find((c) => c.url.includes('/api/admin/event-registrations'));
    assert.equal(call.url, '/api/admin/event-registrations?event_id=ev-maf');
    assert.equal(call.options.headers.authorization, 'Bearer tok');
    assert.equal(text('#caaci-reg-title'), 'Mid-Autumn Festival');
    assert.equal(
      text('#caaci-reg-deadline'),
      'Free gift: mooncake · deadline 2026-09-20 23:59:00 (Chicago)',
    );

    // Head-counts, then how many picked each option (Other where the question allows it).
    assert.deepEqual(stats(), ['3', '2', '1']);
    assert.match(text('#caaci-reg-stats'), /Free mooncake eligible/);
    assert.deepEqual(counts('attending'), [
      ["Yes, I'll be there", '2'],
      ["Sorry, can't make it", '1'],
    ]);
    assert.deepEqual(counts('heard_from'), [
      ['Website', '0'],
      ['Friend', '1'],
      ['Newsletter', '0'],
      ['Social Media', '0'],
      ['Other', '1'],
    ]);
    assert.deepEqual(counts('helping'), [
      ['Setup & decor', '1'],
      ['Cleanup', '1'],
      ['Other', '2'],
    ]);
    assert.deepEqual(counts('names'), [], 'text questions have no counts');

    // A column per question, in form order.
    assert.deepEqual(head(), [
      '#',
      'Registered (Chicago)',
      'Email',
      'Will you attend?',
      'What are the names of people attending?',
      'How did you hear about the festival?',
      'Can you help on the day?',
      'Account',
      'Free mooncake',
    ]);
    assert.equal(rows().length, 3);
    // Times in Chicago; registrant text shown literally, never parsed as markup.
    assert.deepEqual(cells(rows()[0]), [
      '1',
      '2026-09-13 10:05:07',
      'mei@example.com',
      "Yes, I'll be there",
      '<img src=x onerror=alert(1)>',
      'Friend',
      'Setup & decor; Cleanup; Other: <b>music</b>',
      '✓',
      '—',
    ]);
    assert.deepEqual(cells(rows()[1]), [
      '2',
      '2026-09-14 11:00:00',
      'jun@example.com',
      "Yes, I'll be there",
      'Jun Wu',
      'Other: <b>flyer</b>',
      '—',
      '✓',
      '✓',
    ]);
    assert.deepEqual(cells(rows()[2]), [
      '3',
      '2026-09-21 20:02:03',
      'kai@example.com',
      "Sorry, can't make it",
      '—',
      'gone',
      'Other: Photos',
      'Unconfirmed',
      '—',
    ]);
    assert.equal(document.querySelector('#caaci-reg-body img, #caaci-reg-body b'), null);

    // Eligible only: just Jun, still numbered by registration order.
    assert.equal(document.querySelector('#caaci-reg-eligible-wrap').hidden, false);
    const toggle = document.querySelector('#caaci-reg-eligible');
    toggle.click();
    assert.equal(toggle.checked, true);
    assert.deepEqual(
      rows().map((tr) => cells(tr).slice(0, 3)),
      [['2', '2026-09-14 11:00:00', 'jun@example.com']],
    );
    toggle.click();
    assert.equal(rows().length, 3);

    // In Chinese: the Chinese title and labels, and "其他：" for a typed Other.
    document.querySelector('#caaci-lang').click();
    try {
      await open('Mid-Autumn');
      assert.equal(text('#caaci-reg-title'), '中秋节');
      assert.equal(
        text('#caaci-reg-deadline'),
        '福利：月饼 · 截止时间 2026-09-20 23:59:00（芝加哥时间）',
      );
      assert.deepEqual(head().slice(3), [
        '您会参加吗？',
        '参加者的姓名是？',
        '您是如何得知本次活动的？',
        '当天能来帮忙吗？',
        '账户',
        '免费月饼',
      ]);
      assert.deepEqual(cells(rows()[1]).slice(3, 6), [
        '能，我会参加',
        'Jun Wu',
        '其他：<b>flyer</b>',
      ]);
      assert.deepEqual(counts('helping').at(-1), ['其他', '2']);
    } finally {
      document.querySelector('#caaci-lang').click();
    }

    // No free gift: no gift stat, column or filter.
    await open('Spring Fair');
    assert.equal(text('#caaci-reg-deadline'), 'No free gift for this event.');
    assert.equal(document.querySelector('#caaci-reg-eligible-wrap').hidden, true);
    assert.deepEqual(stats(), ['1', '0']);
    assert.deepEqual(head(), [
      '#',
      'Registered (Chicago)',
      'Email',
      'Anything we should know?',
      'Account',
    ]);
    assert.deepEqual(cells(rows()[0]), [
      '1',
      '2026-09-10 12:30:00',
      'ann@example.com',
      'Bringing "cake" & <2 kids>',
      '—',
    ]);

    document.querySelector('#caaci-reg-close').click();
    assert.equal(panel.hidden, true);
  } finally {
    delete window.HTMLElement.prototype.scrollIntoView;
    fetch.restore();
  }
});

test('admin events: registrations CSV has a column per question, a BOM, Chicago times and RFC 4180 quoting', async () => {
  const { registrationsCsv } = await import('../src/caaci-admin.js'); // already booted
  const data = {
    event: { perk: { item_en: 'mooncake', item_zh: '月饼', deadline: DEADLINE } },
    questions: [ATTENDING, NAMES, HEARD_FROM, HELPING],
    rows: [
      {
        email: 'mei@example.com',
        created_at: '2026-09-13T15:05:07Z',
        answers: {
          attending: { option: 'yes' },
          names: 'Mei, "Jun"\nand Kai',
          heard_from: { option: 'friend' },
          helping: { options: ['setup', 'cleanup'], other: 'Lion dance' },
        },
        account: { created_at: '2026-09-01T12:00:00Z', confirmed: true },
        perk_eligible: true,
      },
      {
        email: 'kai@example.com',
        created_at: '2026-09-22T01:02:03Z',
        answers: {
          attending: { option: 'no' },
          names: '=HYPERLINK("http://x")',
          heard_from: { other: 'WeChat, group' },
        },
        account: { created_at: '2026-09-02T12:00:00Z', confirmed: false }, // never confirmed
        perk_eligible: false,
      },
      {
        email: 'lin@example.com',
        created_at: '2026-01-15T18:00:00Z', // CST (UTC−6) in winter
        answers: {
          attending: { option: 'yes' },
          names: '林美',
          heard_from: { option: 'social' },
          helping: { options: ['cleanup'] },
        },
        account: { created_at: '2026-01-10T06:00:00Z', confirmed: true }, // midnight → 00, not 24
        perk_eligible: true,
      },
      {
        email: 'zoe@example.com',
        created_at: '2026-09-23T00:00:00Z',
        answers: {}, // nothing answered: blank cells
        account: null, // no account: account_confirmed is blank, not "no"
        perk_eligible: false,
      },
    ],
  };
  const header =
    '#,registered_at (Chicago),email,Will you attend?,What are the names of people attending?,How did you hear about the festival?,Can you help on the day?,has_account,account_confirmed,account_created_at (Chicago),gift_eligible (mooncake)';
  const mei = `1,2026-09-13 10:05:07,mei@example.com,"Yes, I'll be there","Mei, ""Jun""\nand Kai",Friend,Setup & decor; Cleanup; Other: Lion dance,yes,yes,2026-09-01 07:00:00,yes`;
  // A formula-looking answer is defused with a leading ' (then quoted for its quotes);
  // a typed Other reads "Other: <text>".
  const kai = `2,2026-09-21 20:02:03,kai@example.com,"Sorry, can't make it","'=HYPERLINK(""http://x"")","Other: WeChat, group",,yes,no,2026-09-02 07:00:00,no`;
  const lin = `3,2026-01-15 12:00:00,lin@example.com,"Yes, I'll be there",林美,Social Media,Cleanup,yes,yes,2026-01-10 00:00:00,yes`;
  const zoe = '4,2026-09-22 19:00:00,zoe@example.com,,,,,no,,,no';

  // No free gift: no eligibility column.
  const bom = String.fromCharCode(0xfeff);
  assert.equal(
    registrationsCsv({
      event: { perk: null },
      questions: FAIR.registration_questions,
      rows: [
        {
          email: 'ann@example.com',
          created_at: '2026-09-10T17:30:00Z',
          answers: { note: '-1 seat, thanks' },
          account: null,
          perk_eligible: false,
        },
      ],
    }),
    `${bom}#,registered_at (Chicago),email,Anything we should know?,has_account,account_confirmed,account_created_at (Chicago)\r\n1,2026-09-10 12:30:00,ann@example.com,"'-1 seat, thanks",no,,\r\n`,
  );

  const csv = registrationsCsv(data);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM first');
  assert.equal(csv, `\uFEFF${[header, mei, kai, lin, zoe].join('\r\n')}\r\n`);

  // Eligible only keeps each row's registration number.
  assert.equal(
    registrationsCsv(data, { eligibleOnly: true }),
    `\uFEFF${[header, mei, lin].join('\r\n')}\r\n`,
  );
});
