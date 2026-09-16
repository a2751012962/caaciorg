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
  // Families fail to load at boot: the member editor must not unlink anyone.
  if (u.includes('/api/admin/households')) return { status: 500, body: { error: 'down' } };
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
  if (u.includes('/api/admin/dashboard')) {
    // ?year=2025 charts last year (a whole year, $50 over 2 payments); the
    // headline this-year/this-month figures stay the same either way.
    const year = Number(new URL(u, 'https://caaci.example').searchParams.get('year') || 2026);
    const revenueOf = (y) =>
      y === 2025
        ? {
            year: 2025,
            year_cents: 5000,
            year_payments: 2,
            by_month: Array.from({ length: 12 }, (_, i) => ({
              month: `2025-${String(i + 1).padStart(2, '0')}`,
              cents: i === 5 ? 5000 : 0,
              payments: i === 5 ? 2 : 0,
            })),
          }
        : {
            year: 2026,
            year_cents: 123400,
            year_payments: 26,
            by_month: [
              { month: '2026-01', cents: 40000, payments: 8 },
              { month: '2026-02', cents: 0, payments: 0 },
              { month: '2026-03', cents: 74085, payments: 15 },
              { month: '2026-04', cents: 9315, payments: 3 },
            ],
          };
    return {
      body: {
        generated_at: '2026-09-16T15:00:00Z',
        members: {
          total: 60,
          status_counts: { active: 40, pending: 3, past_due: 2, expired: 10, cancelled: 5 },
          new_this_month: 6,
          by_tier: [
            { id: 'individual', name: 'Individual', active: 25 },
            { id: 'family', name: 'Family', active: 15 },
          ],
          year,
          by_month: [
            { month: `${year}-01`, active: 30 },
            { month: `${year}-02`, active: 33 },
            { month: `${year}-03`, active: 38 },
            { month: `${year}-04`, active: 40 },
          ],
          expiring_days: 30,
          expiring_total: 1,
          expiring: [
            {
              id: 'm1',
              full_name: 'Mei Lin',
              email: 'mei@x.com',
              tier_id: 'individual',
              status: 'active',
              expires_at: '2026-09-30T00:00:00Z',
            },
          ],
        },
        revenue: {
          ytd_cents: 123400,
          month_cents: 9315,
          payments_this_month: 3,
          years: [2026, 2025, 2024],
          ...revenueOf(year),
          recent: [
            {
              id: 'p1',
              kind: 'renewal',
              amount_cents: 3105,
              tier_id: 'individual',
              paid_at: '2026-09-10T00:00:00Z',
              members: { full_name: 'Wang Wei', email: 'ww@x.com' },
            },
          ],
        },
        events: {
          upcoming_total: 1,
          upcoming: [
            {
              id: 'e1',
              title: 'Mid-Autumn Festival',
              title_zh: '中秋晚会',
              slug: 'mid-autumn',
              starts_at: '2026-10-03T23:00:00Z',
              ends_at: null,
              location: 'Champaign',
              takes_registrations: true,
              registration_count: 57,
            },
          ],
          drafts_total: 1,
          recent_registrations: [
            {
              id: 'r1',
              email: 'ann@x.com',
              created_at: '2026-09-15T12:00:00Z',
              events: { title: 'Mid-Autumn Festival', title_zh: '中秋晚会', slug: 'mid-autumn' },
            },
          ],
        },
        volunteers: { total: 12, this_month: 3 },
        business: { pending: 2 },
      },
    };
  }
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

    // The Dashboard is the landing tab: it alone is showing, filled from one
    // /api/admin/dashboard answer — stat tiles, status bars, tier counts, the
    // next events with registrations, expiring members, latest registrations
    // and payments.
    assert.ok(document.querySelector('[data-tab="dashboard"]').classList.contains('active'));
    assert.equal(document.querySelector('[data-panel="dashboard"]').hidden, false);
    assert.equal(document.querySelector('[data-panel="members"]').hidden, true);
    assert.equal(fetch.calls.filter((c) => c.url.includes('/api/admin/dashboard')).length, 1);
    const tiles = [...document.querySelectorAll('#caaci-dash-stats [data-goto]')];
    assert.equal(tiles.length, 6);
    const tileText = (i) => tiles[i].querySelector('.h1').textContent;
    assert.equal(tileText(0), '40');
    assert.ok(tiles[0].querySelector('.h1').classList.contains('text-success'));
    assert.match(tiles[0].textContent, /60 members in total/);
    assert.equal(tileText(1), '2'); // past due
    assert.equal(tileText(2), '1'); // expiring in 30 days
    assert.match(tiles[2].textContent, /Expiring in 30 days/);
    assert.equal(tileText(3), '6'); // new this month
    assert.equal(tileText(4), '12'); // volunteers
    assert.equal(tileText(5), '2'); // listings awaiting review
    assert.ok(tiles[5].querySelector('.h1').classList.contains('text-orange'));
    // Three colours at most: default ink, green (active), orange (follow-up queues).
    const tileColours = new Set(
      tiles.flatMap((tile) =>
        [...tile.querySelector('.h1').classList].filter((c) => c.startsWith('text-')),
      ),
    );
    assert.deepEqual([...tileColours].sort(), ['text-orange', 'text-success']);
    // Status bars: share of everyone, width set from the data.
    const activeBar = document.querySelector('#caaci-dash-status [data-status="active"]');
    assert.match(activeBar.textContent, /40/);
    assert.match(activeBar.textContent, /\(67%\)/);
    assert.equal(activeBar.querySelector('.progress-bar').style.width, '67%');
    assert.ok(activeBar.querySelector('.badge').classList.contains('bg-success-lt'));
    // Revenue card: both totals, then the year as a line chart — one dot per
    // month bucket, labelled, the last one carrying its value — no chart library.
    const totals = document.querySelector('#caaci-dash-revenue-totals');
    assert.match(totals.textContent, /Revenue this year\s*\$1234\.00/);
    assert.match(totals.textContent, /Revenue this month\s*\$93\.15\s*3 payments/);
    const chartHost = document.querySelector('#caaci-dash-revenue-chart');
    const line = chartHost.querySelector('svg');
    assert.ok(line, 'line chart drawn');
    assert.equal(line.querySelectorAll('circle').length, 4);
    assert.equal(line.querySelectorAll('polyline').length, 1);
    const monthTexts = [...line.querySelectorAll('text')].map((x) => x.textContent);
    // Month labels, the 1-2-5 gridline ticks (top $1,000 for a $740.85 peak) and
    // the latest month's own value.
    for (const label of ['Jan', 'Feb', 'Mar', 'Apr', '$0', '$500', '$1,000', '$93']) {
      assert.ok(monthTexts.includes(label), `chart shows ${label}`);
    }
    // Hover: idle read-out is the year; a month's column reads that month out
    // and grows its dot; leaving the chart restores the idle text.
    const hover = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
    const readout = () => chartHost.querySelector('[data-readout]').textContent;
    assert.match(readout(), /^2026: \$1234\.00 over 26 payments/);
    const columns = line.querySelectorAll('rect[data-i]');
    assert.equal(columns.length, 4);
    hover(columns[0], 'mouseover');
    assert.equal(readout(), 'Jan: $400.00 (8 payments)');
    assert.equal(line.querySelector('[data-dot="0"]').getAttribute('r'), '6');
    assert.equal(line.querySelector('[data-dot="1"]').getAttribute('r'), '4');
    hover(line, 'mouseleave');
    assert.match(readout(), /^2026: \$1234\.00/);
    assert.equal(line.querySelector('[data-dot="0"]').getAttribute('r'), '4');
    // The year select lists the years with payments (newest first) and asks the
    // API for the chosen one.
    // Active members card: live count + newcomers beside the month line.
    const membersHost = document.querySelector('#caaci-dash-members-chart');
    assert.match(
      document.querySelector('#caaci-dash-members-totals').textContent,
      /Active now\s*40\s*60 members in total\s*New this month\s*6/,
    );
    const memberCols = membersHost.querySelectorAll('rect[data-i]');
    assert.equal(memberCols.length, 4);
    assert.equal(membersHost.querySelector('[data-readout]').textContent, '');
    hover(memberCols[0], 'mouseover');
    assert.equal(membersHost.querySelector('[data-readout]').textContent, 'Jan: 30 active members');
    hover(membersHost.querySelector('svg'), 'mouseleave');
    assert.equal(membersHost.querySelector('[data-readout]').textContent, '');
    const memberTicks = [...membersHost.querySelectorAll('text')].map((x) => x.textContent);
    assert.ok(memberTicks.includes('50'), 'count axis, not dollars');
    assert.ok(!memberTicks.some((x) => x.startsWith('$')));
    const yearSel = document.querySelector('#caaci-dash-year');
    assert.deepEqual(
      [...yearSel.options].map((o) => o.value),
      ['2026', '2025', '2024'],
    );
    assert.equal(yearSel.value, '2026');
    assert.equal(yearSel.hidden, false);
    yearSel.value = '2025';
    hover(yearSel, 'change');
    await tick();
    const yearCalls = fetch.calls.filter((c) => c.url.includes('/api/admin/dashboard?year=2025'));
    assert.equal(yearCalls.length, 1);
    assert.match(totals.textContent, /Revenue in 2025\s*\$50\.00\s*Payments\s*2/);
    assert.match(readout(), /^2025: \$50\.00 over 2 payments/);
    assert.equal(chartHost.querySelectorAll('circle').length, 12);
    yearSel.value = '2026';
    hover(yearSel, 'change');
    await tick();
    assert.match(totals.textContent, /Revenue this year\s*\$1234\.00/);
    // Charts are classes + SVG attributes only: no inline styles, no hex colours.
    for (const host of ['#caaci-dash-revenue-chart', '#caaci-dash-tiers']) {
      assert.equal(document.querySelectorAll(`${host} [style]`).length, 0, `${host} styles`);
      assert.doesNotMatch(document.querySelector(host).innerHTML, /#[0-9a-f]{3,8}\b/i);
    }
    // Active members by tier: a pie (one slice per tier with members) + legend.
    const tiersHost = document.querySelector('#caaci-dash-tiers');
    const pie = tiersHost.querySelector('svg[role="img"]');
    assert.ok(pie, 'pie chart drawn');
    const slicePaths = [...pie.querySelectorAll('path')];
    assert.equal(slicePaths.length, 2);
    assert.deepEqual(
      slicePaths.map((p) => [p.getAttribute('class'), p.dataset.i]),
      [
        ['text-primary', '0'],
        ['text-orange', '1'],
      ],
    );
    assert.match(
      tiersHost.querySelector('[data-tier="individual"]').textContent,
      /Individual\s*25\s*\(63%\)/,
    );
    assert.match(
      tiersHost.querySelector('[data-tier="family"]').textContent,
      /Family\s*15\s*\(38%\)/,
    );
    // Hover a slice (or its legend row): the read-out names it, the other slice
    // and row dim, the row goes bold; leaving restores the head-count.
    const pieReadout = () => tiersHost.querySelector('[data-readout]').textContent;
    assert.equal(pieReadout(), ''); // nothing until something is hovered
    hover(slicePaths[1], 'mouseover');
    assert.equal(pieReadout(), 'Family: 15 (38%)');
    assert.ok(slicePaths[0].classList.contains('opacity-50'));
    assert.ok(!slicePaths[1].classList.contains('opacity-50'));
    assert.ok(tiersHost.querySelector('[data-tier="individual"]').classList.contains('opacity-50'));
    assert.ok(tiersHost.querySelector('[data-tier="family"]').classList.contains('fw-bold'));
    hover(tiersHost, 'mouseleave');
    assert.equal(pieReadout(), '');
    assert.equal(tiersHost.querySelectorAll('.opacity-50, .fw-bold').length, 0);
    hover(tiersHost.querySelector('[data-tier="individual"]'), 'mouseover');
    assert.equal(pieReadout(), 'Individual: 25 (63%)');
    assert.ok(slicePaths[1].classList.contains('opacity-50'));
    hover(tiersHost, 'mouseleave');
    const dashEvent = document.querySelector('#caaci-dash-events tr');
    assert.match(dashEvent.textContent, /Mid-Autumn Festival/);
    assert.match(dashEvent.textContent, /Champaign/);
    assert.match(dashEvent.querySelector('td:last-child').textContent, /^57$/);
    assert.match(document.querySelector('#caaci-dash-drafts').textContent, /1 unpublished/);
    const expiringRow = document.querySelector('#caaci-dash-expiring tr');
    assert.match(expiringRow.textContent, /Mei Lin/);
    assert.match(expiringRow.textContent, /Individual/); // tier id → name via loadTiers
    assert.match(document.querySelector('#caaci-dash-registrations').textContent, /ann@x\.com/);
    const dashPay = document.querySelector('#caaci-dash-payments tr');
    assert.match(dashPay.textContent, /Wang Wei/);
    assert.match(dashPay.textContent, /Auto-renewal/);
    assert.match(dashPay.textContent, /\$31\.05/);
    assert.match(document.querySelector('#caaci-dash-updated').textContent, /^Updated /);

    // A tile is a shortcut to its tab: the Past-due tile opens Payments, which
    // loads as if clicked in the nav. Refresh asks the API again.
    document.querySelectorAll('#caaci-dash-stats [data-goto]')[1].click(); // re-queried: the year switch re-rendered the tiles
    await tick();
    assert.ok(document.querySelector('[data-tab="payments"]').classList.contains('active'));
    assert.equal(document.querySelector('[data-panel="payments"]').hidden, false);
    assert.equal(document.querySelector('[data-panel="dashboard"]').hidden, true);
    assert.equal(document.querySelectorAll('#caaci-pay-stats .card .h1').length, 4);
    document.querySelector('[data-tab="dashboard"]').click();
    await tick();
    assert.equal(document.querySelector('[data-panel="dashboard"]').hidden, false);
    assert.equal(fetch.calls.filter((c) => c.url.includes('/api/admin/dashboard')).length, 4); // boot + two year switches + this tab click
    document.querySelector('#caaci-dash-refresh').click();
    await tick();
    assert.equal(fetch.calls.filter((c) => c.url.includes('/api/admin/dashboard')).length, 5);

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

    // Families never loaded, so the Family field is locked and saving leaves the
    // member's family alone (an empty household_id would unlink them).
    assert.equal(editRow().querySelector('[data-f="household_id"]').disabled, true);
    assert.match(
      editRow().querySelector('[data-household-unavailable]').textContent,
      /Families couldn't be loaded, so family is unchanged/,
    );

    // Save re-renders the table (editor gone); the cooldown survives that too.
    editRow().querySelector('[data-act="save"]').click();
    await tick();
    const memberSave = fetch.calls
      .filter((c) => c.url.includes('/api/admin/members') && c.options.method === 'POST')
      .at(-1);
    assert.ok(memberSave, 'member saved');
    assert.equal(
      'household_id' in JSON.parse(memberSave.options.body),
      false,
      'no household_id when families failed to load',
    );
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
    // The dashboard's own (JS-built) content follows without another request.
    assert.equal(document.querySelector('[data-tab="dashboard"]').textContent.trim(), '看板');
    assert.equal(
      document.querySelector('#caaci-dash-stats [data-goto] .subheader').textContent,
      '有效会员',
    );
    assert.match(document.querySelector('#caaci-dash-events tr').textContent, /中秋晚会/);
    assert.equal(fetch.calls.filter((c) => c.url.includes('/api/admin/dashboard')).length, 5);

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

    // Copy uses the clipboard… The admin code reads the global navigator, which
    // Node 21+ has and Node 20 (CI) does not, so lend it jsdom's there.
    const copied = [];
    const ownNavigator = !('navigator' in globalThis);
    if (ownNavigator) globalThis.navigator = window.navigator;
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    });
    try {
      eventRow('Spring Fair').querySelector('[data-act="reg-link"]').click();
      await tick();
    } finally {
      delete globalThis.navigator.clipboard;
      if (ownNavigator) delete globalThis.navigator;
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

test('admin news: the event announcement template fills subject and message, which stay editable in the sandboxed editor', async () => {
  // The API's rendering of an announcement, per event (a script in it must never run).
  const rendered = (id) => ({
    subject: `${id} · 报名开始 / Registration open`,
    html: `<h1>${id}</h1><script>parent.hacked = true</script><a href="https://caaci.example/events/${id}/register/">报名 · Register</a>`,
  });
  const fetch = mockFetch((u) => {
    if (u.includes('/api/admin/news-template'))
      return u.endsWith('event_id=ev-gone')
        ? { status: 404, body: { error: 'Event not found.' } }
        : { body: rendered(new URL(u, 'https://x').searchParams.get('event_id')) };
    if (u === '/api/admin/news') return { body: { ok: true, sent: 2, failed: 0, total: 2 } };
    if (u.includes('/api/admin/events'))
      return { body: { rows: [MAF, FAIR, { ...PICNIC, id: 'ev-gone', title: 'Gone' }], total: 3 } };
    return { body: {} };
  });
  const asked = stubConfirm(false);
  const $ = (s) => document.querySelector(s);
  const subject = $('#caaci-news-subject');
  const body = $('#caaci-news-body');
  const templateCalls = () => fetch.calls.filter((c) => c.url.includes('/api/admin/news-template'));
  try {
    $('[data-tab="news"]').click();
    await tick();

    // Blank by default: no event picker, and no Preview button (the editor is the preview).
    assert.equal($('#caaci-news-template').value, '');
    assert.equal($('#caaci-news-event-wrap').hidden, true);
    assert.equal($('#caaci-news-preview-btn'), null);

    // Event announcement lists the published events.
    choose($('#caaci-news-template'), 'event');
    await tick();
    assert.equal($('#caaci-news-event-wrap').hidden, false);
    const listCall = fetch.calls.find((c) => c.url.includes('/api/admin/events'));
    assert.match(listCall.url, /[?&]published=true(&|$)/);
    const options = [...$('#caaci-news-event').options];
    assert.deepEqual(
      options.map((o) => o.value),
      ['', 'ev-maf', 'ev-fair', 'ev-gone'],
    );
    assert.match(options[1].textContent, /^中秋节 · Mid-Autumn Festival \(/);
    assert.equal(templateCalls().length, 0, 'nothing to fill until an event is chosen');

    // Choosing one fills the empty boxes without asking.
    choose($('#caaci-news-event'), 'ev-maf');
    await tick();
    assert.equal(
      templateCalls()[0].url,
      '/api/admin/news-template?template=announcement&event_id=ev-maf',
    );
    assert.equal(templateCalls()[0].options.headers.authorization, 'Bearer tok');
    assert.equal(subject.value, rendered('ev-maf').subject);
    assert.equal(body.value, rendered('ev-maf').html);
    assert.equal(asked.length, 0);

    // The filled message stays editable.
    body.value += '<p>See you there!</p>';

    // An edited message is not replaced unless the admin agrees.
    choose($('#caaci-news-event'), 'ev-fair');
    await tick();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /Replace the subject and message/);
    assert.equal(templateCalls().length, 1, 'declined: nothing fetched');
    assert.equal(body.value, `${rendered('ev-maf').html}<p>See you there!</p>`, 'edit kept');
    window.confirm = (m) => asked.push(m) > 0; // now agree
    choose($('#caaci-news-event'), 'ev-fair');
    await tick();
    assert.equal(asked.length, 2);
    assert.equal(subject.value, rendered('ev-fair').subject);
    assert.equal(body.value, rendered('ev-fair').html);

    // Untouched template text is swapped without asking.
    choose($('#caaci-news-event'), 'ev-maf');
    await tick();
    assert.equal(asked.length, 2);
    assert.equal(body.value, rendered('ev-maf').html);

    // The API's error is shown as returned and the boxes are left alone.
    choose($('#caaci-news-event'), 'ev-gone');
    await tick();
    assert.equal($('#caaci-news-notice').textContent, 'Event not found.');
    assert.equal(body.value, rendered('ev-maf').html);

    // Blank hides the picker and keeps the text; sending is the usual flow.
    choose($('#caaci-news-template'), '');
    assert.equal($('#caaci-news-event-wrap').hidden, true);
    assert.equal(subject.value, rendered('ev-maf').subject);
    $('#caaci-news-confirm').checked = true;
    $('#caaci-news-send').click();
    await tick();
    const send = fetch.calls.find(
      (c) => c.url === '/api/admin/news' && c.options.method === 'POST',
    );
    assert.equal(send.options.method, 'POST');
    assert.deepEqual(JSON.parse(send.options.body), {
      subject: rendered('ev-maf').subject,
      body_html: rendered('ev-maf').html,
      audience: 'active',
      confirm: true,
    });
    assert.match($('#caaci-news-notice').textContent, /Sent to 2 member\(s\)/);
  } finally {
    asked.restore();
    fetch.restore();
  }
});

test('admin news: general and renewal need no event, event templates send their name, and placeholder text is never sent', async () => {
  const fetch = mockFetch((u) => {
    if (u.includes('/api/admin/news-template')) {
      const q = new URL(u, 'https://x').searchParams;
      const name = q.get('template');
      if (name === 'renewal') return { body: { subject: 'Renew', html: '<p>Renew now</p>' } };
      return {
        body: {
          subject: `${name} ${q.get('event_id') || ''}`.trim(),
          html: `<p>${name} 【待填写：正文】</p>`,
        },
      };
    }
    if (u === '/api/admin/news') return { body: { ok: true, sent: 1, failed: 0, total: 1 } };
    if (u.includes('/api/admin/events')) return { body: { rows: [MAF, FAIR], total: 2 } };
    return { body: {} };
  });
  const asked = stubConfirm(true);
  const $ = (s) => document.querySelector(s);
  const subject = $('#caaci-news-subject');
  const body = $('#caaci-news-body');
  const lastTemplateUrl = () =>
    fetch.calls.filter((c) => c.url.includes('/api/admin/news-template')).at(-1)?.url;
  const newsPosts = () =>
    fetch.calls.filter((c) => c.url === '/api/admin/news' && c.options.method === 'POST');
  const send = async () => {
    $('#caaci-news-confirm').checked = true;
    $('#caaci-news-send').click();
    await tick();
  };
  try {
    $('[data-tab="news"]').click();
    await tick();
    subject.value = '';
    body.value = '';

    // General: no event picker, filled at once.
    choose($('#caaci-news-template'), 'general');
    await tick();
    assert.equal($('#caaci-news-event-wrap').hidden, true);
    assert.equal(lastTemplateUrl(), '/api/admin/news-template?template=general');
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/api/admin/events')),
      false,
      'no events loaded',
    );
    assert.equal(body.value, '<p>general 【待填写：正文】</p>');
    assert.equal(asked.length, 0, 'empty boxes are filled without asking');

    // Placeholder text left in the message or the subject is never sent.
    await send();
    assert.equal(newsPosts().length, 0);
    assert.match(
      $('#caaci-news-notice').textContent,
      /Replace the 【待填写】 \/ \[To fill in\] text before sending/,
    );
    subject.value = '[To fill in: English heading]';
    body.value = '<p>Hello</p>';
    await send();
    assert.equal(newsPosts().length, 0);

    // Event reminder waits for an event, then asks before replacing the edited boxes.
    choose($('#caaci-news-template'), 'reminder');
    await tick();
    assert.equal($('#caaci-news-event-wrap').hidden, false);
    assert.equal(lastTemplateUrl(), '/api/admin/news-template?template=general', 'no event yet');
    choose($('#caaci-news-event'), 'ev-fair');
    await tick();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /Replace the subject and message with the event reminder\?/);
    assert.equal(lastTemplateUrl(), '/api/admin/news-template?template=reminder&event_id=ev-fair');
    assert.equal(subject.value, 'reminder ev-fair');

    // The thank-you keeps the chosen event and swaps untouched template text without asking.
    choose($('#caaci-news-template'), 'thanks');
    await tick();
    assert.equal(asked.length, 1);
    assert.equal(lastTemplateUrl(), '/api/admin/news-template?template=thanks&event_id=ev-fair');
    assert.equal(subject.value, 'thanks ev-fair');

    // Renewal: no event and nothing to replace, so it sends as filled.
    choose($('#caaci-news-template'), 'renewal');
    await tick();
    assert.equal($('#caaci-news-event-wrap').hidden, true);
    assert.equal(lastTemplateUrl(), '/api/admin/news-template?template=renewal');
    await send();
    assert.equal(newsPosts().length, 1);
    assert.deepEqual(JSON.parse(newsPosts()[0].options.body), {
      subject: 'Renew',
      body_html: '<p>Renew now</p>',
      audience: 'active',
      confirm: true,
    });
  } finally {
    asked.restore();
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

// ---------- families: founder, seats, invitations, activity ----------
const HOSTILE = '<img src=x onerror=alert(1)>';
const FAMILY = {
  id: 'h1',
  name: `Lin ${HOSTILE}`,
  status: 'active',
  tier_id: 'family',
  expires_at: null,
  notes: null,
  founder_member_id: 'a1',
  founder: { id: 'a1', full_name: 'Mei Lin', email: 'mei@x.com' },
  accounts: [
    { id: 'a1', full_name: 'Mei Lin', email: 'mei@x.com', status: 'active', tier_id: 'family' },
    { id: 'a2', full_name: '<b>Jun</b>', email: 'jun@x.com', status: 'active', tier_id: 'family' },
  ],
  people: [
    {
      id: 'p-a2',
      member_id: 'a2',
      full_name: '<b>Jun</b>',
      relationship: 'spouse',
      email: 'jun@x.com',
      phone: null,
      is_primary: false,
    },
    {
      id: 'p1',
      member_id: null,
      full_name: `Kai ${HOSTILE}`,
      relationship: 'child',
      email: null,
      phone: null,
      is_primary: false,
    },
  ],
  invites: [
    {
      id: 'i1',
      email: `ann${HOSTILE}@x.com`,
      full_name: 'Ann',
      relationship: 'parent',
      created_at: '2026-09-10T00:00:00Z',
      expires_at: '2026-09-24T00:00:00Z',
      person_id: null,
    },
  ],
  events: [
    {
      type: 'invite_sent',
      actor_email: 'mei@x.com',
      subject_email: `ann${HOSTILE}@x.com`,
      subject_name: null,
      created_at: '2026-09-10T00:00:00Z',
    },
    {
      type: 'person_added',
      actor_email: 'mei@x.com',
      subject_email: null,
      subject_name: `Kai ${HOSTILE}`,
      created_at: '2026-09-09T00:00:00Z',
    },
    {
      type: 'member_removed',
      actor_email: null,
      subject_email: 'zed@x.com',
      subject_name: null,
      created_at: '2026-09-08T00:00:00Z',
    },
  ],
  seats_used: 3,
  seats_limit: 3,
};
const familiesAvailable = () => ({ body: { rows: [FAMILY], invites_available: true } });
let familiesReply = familiesAvailable;
const familyRoutes = (u) =>
  u.includes('/api/admin/households') ? familiesReply() : { body: { ok: true } };
const familyCardEl = () => document.querySelector('#caaci-families-list section.card');
const openFamilies = async () => {
  document.querySelector('[data-tab="families"]').click();
  await tick();
};
const day = (iso) => new Date(iso).toLocaleDateString();

test('admin families: founder and not-linked badges, seats, pending invitations and activity, all escaped', async () => {
  familiesReply = familiesAvailable;
  const fetch = mockFetch(familyRoutes);
  try {
    await openFamilies();
    const c = familyCardEl();
    assert.ok(c, 'family card rendered');
    assert.equal(c.querySelector('img, b'), null, 'hostile text never becomes markup');
    assert.equal(c.querySelector('.card-title').textContent, FAMILY.name);

    // Founder badge on the founder's account only.
    const accts = [...c.querySelectorAll('[data-accounts] li')];
    assert.equal(accts.length, 2);
    assert.match(accts[0].textContent, /Mei Lin[\s\S]*Founder/);
    assert.doesNotMatch(accts[1].textContent, /Founder/);
    assert.match(accts[1].textContent, /<b>Jun<\/b>/);

    // Not-linked badge on name-only people only.
    const people = [...c.querySelectorAll('tbody tr')];
    assert.equal(people.length, 2);
    assert.doesNotMatch(people[0].textContent, /Not linked/);
    assert.match(
      people[1].cells[0].textContent,
      /^Kai <img src=x onerror=alert\(1\)>\s*Not linked to an account$/,
    );

    assert.equal(c.querySelector('[data-seats]').textContent.trim(), 'Seats: 3 / 3');

    const inv = [...c.querySelectorAll('[data-invites] li')];
    assert.equal(inv.length, 1);
    assert.ok(inv[0].textContent.includes(`ann${HOSTILE}@x.com`));
    assert.match(inv[0].textContent, /Parent/);
    assert.ok(inv[0].textContent.includes(`expires ${day('2026-09-24T00:00:00Z')}`));
    assert.equal(c.querySelector('[data-invites-unavailable]'), null);
    assert.equal(c.querySelector('[data-founder-outside]'), null, 'founder is a linked account');

    const act = c.querySelector('details[data-activity]');
    assert.ok(act, 'activity is collapsible');
    assert.equal(act.open, false, 'collapsed by default');
    assert.match(act.querySelector('summary').textContent, /Activity/);
    const items = [...act.querySelectorAll('li')].map((li) => li.textContent);
    assert.equal(items.length, 3);
    assert.ok(items[0].includes(day('2026-09-10T00:00:00Z')));
    assert.match(items[0], /Invitation sent/);
    assert.ok(items[0].includes(`ann${HOSTILE}@x.com`));
    assert.match(items[0], /by mei@x\.com/);
    assert.match(items[1], /Person added/);
    assert.ok(items[1].includes(`Kai ${HOSTILE}`));
    assert.match(items[2], /Removed from the family[\s\S]*zed@x\.com/);
    assert.doesNotMatch(items[2], /by /, 'no actor, no "by"');

    // Chinese labels after switching language and reloading the tab.
    document.querySelector('#caaci-lang').click();
    await openFamilies();
    const zh = familyCardEl().textContent;
    for (const label of [
      '\u521B\u59CB\u4EBA',
      '\u672A\u5173\u8054\u8D26\u53F7',
      '\u540D\u989D',
      '\u5F85\u63A5\u53D7\u7684\u9080\u8BF7',
      '\u7236\u6BCD',
      '\u52A8\u6001',
      '\u5DF2\u53D1\u9001\u9080\u8BF7',
    ])
      assert.ok(zh.includes(label), `zh label ${label}`);
    document.querySelector('#caaci-lang').click();
    await tick();
  } finally {
    fetch.restore();
  }
});

test('admin families: an unavailable invitations feed shows a note, and the family and person editors still work', async () => {
  familiesReply = () => ({
    body: {
      rows: [{ ...FAMILY, founder: null, invites: [], events: [] }],
      invites_available: false,
    },
  });
  const fetch = mockFetch(familyRoutes);
  const realConfirm = window.confirm;
  try {
    await openFamilies();
    let c = familyCardEl();
    assert.match(
      c.querySelector('[data-invites-unavailable]').textContent,
      /Invitations and activity are unavailable/,
    );
    assert.equal(c.querySelector('[data-invites]'), null);
    assert.equal(c.querySelector('details[data-activity]'), null);
    assert.equal(c.querySelector('[data-seats]').textContent.trim(), 'Seats: 3 / 3');
    assert.match(
      c.querySelector('[data-accounts] li').textContent,
      /Founder/,
      'from founder_member_id',
    );

    // Edit family: opens prefilled with the literal name and saves by POST.
    c.querySelector('[data-act="edit"]').click();
    const form = c.querySelector('[data-edit-host] form');
    assert.equal(form.querySelector('[data-f="name"]').value, FAMILY.name);
    form.querySelector('[type="submit"]').click();
    await tick();
    const post = fetch.calls.find(
      (x) => x.url.includes('/api/admin/households') && x.options.method === 'POST',
    );
    assert.equal(JSON.parse(post.options.body).id, 'h1');

    // Person editor opens for the name-only person; delete sends its id.
    c = familyCardEl();
    c.querySelector('[data-act="edit-person"][data-person="p1"]').click();
    assert.equal(
      c.querySelector('[data-person-host] [data-f="full_name"]').value,
      FAMILY.people[1].full_name,
    );
    window.confirm = () => true;
    c.querySelector('[data-act="del-person"][data-person="p1"]').click();
    await tick();
    const del = fetch.calls.find(
      (x) => x.url.includes('/api/admin/household-members') && x.options.method === 'DELETE',
    );
    assert.deepEqual(JSON.parse(del.options.body), { id: 'p1' });
  } finally {
    window.confirm = realConfirm;
    familiesReply = familiesAvailable;
    fetch.restore();
  }
});

test('admin families: a founder outside the family, hostile actors, unknown event types and relationships render as text', async () => {
  familiesReply = () => ({
    body: {
      invites_available: true,
      rows: [
        {
          ...FAMILY,
          founder_member_id: 'a9',
          founder: { id: 'a9', full_name: `Wen ${HOSTILE}`, email: `wen${HOSTILE}@x.com` },
          invites: [{ ...FAMILY.invites[0], email: 'ann@x.com', relationship: '<u>cousin</u>' }],
          events: [
            {
              type: 'invite_sent',
              actor_email: '<b>boss</b>@x.com',
              subject_email: 'ann@x.com',
              subject_name: null,
              created_at: '2026-09-10T00:00:00Z',
            },
            {
              type: '<i>mystery</i>',
              actor_email: null,
              subject_email: null,
              subject_name: null,
              created_at: '2026-09-09T00:00:00Z',
            },
          ],
        },
      ],
    },
  });
  const fetch = mockFetch(familyRoutes);
  try {
    await openFamilies();
    let c = familyCardEl();
    assert.equal(c.querySelector('img, b, i, u'), null, 'nothing hostile becomes markup');

    // The founder was moved out of the family: still named, clearly marked.
    assert.equal(
      c.querySelector('[data-founder-outside]').textContent.trim(),
      `Founder: Wen ${HOSTILE} — wen${HOSTILE}@x.com (not in this family)`,
    );
    assert.doesNotMatch(c.querySelector('[data-accounts]').textContent, /Founder/);

    const inv = c.querySelector('[data-invites] li').textContent;
    assert.ok(inv.includes('ann@x.com · <u>cousin</u> · expires'), inv);

    const items = [...c.querySelectorAll('details[data-activity] li')].map((li) => li.textContent);
    assert.match(items[0], /Invitation sent[\s\S]*by <b>boss<\/b>@x\.com/);
    assert.ok(items[1].includes(' · <i>mystery</i>'), 'unknown type shown raw, not blank');

    document.querySelector('#caaci-lang').click();
    await openFamilies();
    c = familyCardEl();
    assert.equal(
      c.querySelector('[data-founder-outside]').textContent.trim(),
      `创始人：Wen ${HOSTILE} — wen${HOSTILE}@x.com（不在此家庭）`,
    );
    document.querySelector('#caaci-lang').click();
    await tick();
  } finally {
    familiesReply = familiesAvailable;
    fetch.restore();
  }
});

// ---------- families: family-plan members without a family ----------
const PLAN_MEMBERS = [
  {
    id: 'f1',
    full_name: `Zheng ${HOSTILE}`,
    email: 'zg@x.com',
    status: 'active',
    expires_at: '2026-03-01T00:00:00Z',
  },
  { id: 'f2', full_name: null, email: `yun${HOSTILE}@x.com`, status: 'expired', expires_at: null },
];
const planMembersEl = () =>
  document.querySelector('#caaci-family-plan-members [data-plan-members]');

test('admin families: family-plan members without a family are listed with no families, escaped, and Create family starts one', async () => {
  let plan = PLAN_MEMBERS;
  const fetch = mockFetch((u, o) => {
    if (!u.includes('/api/admin/households')) return { body: { ok: true } };
    if (o.method === 'PUT') {
      plan = plan.filter((m) => m.id !== JSON.parse(o.body).founder_member_id);
      return { body: { ok: true, household_id: 'h9' } };
    }
    return { body: { rows: [], invites_available: true, family_plan_members: plan } };
  });
  const realConfirm = window.confirm;
  try {
    await openFamilies();
    assert.match(document.querySelector('#caaci-families-list').textContent, /No families yet\./);
    let s = planMembersEl();
    assert.ok(s, 'list rendered');
    assert.equal(s.querySelector('img, b'), null, 'hostile text never becomes markup');
    assert.match(
      s.querySelector('.card-title').textContent,
      /Family-plan members without a family/,
    );
    assert.equal(s.querySelector('[data-plan-members-count]').textContent, '2');
    let rows = [...s.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].cells[0].textContent, `Zheng ${HOSTILE}`);
    assert.equal(rows[0].cells[1].textContent, 'zg@x.com');
    assert.equal(rows[0].cells[2].textContent, 'Active');
    assert.equal(rows[0].cells[3].textContent, day('2026-03-01T00:00:00Z'));
    assert.equal(rows[1].cells[0].textContent, '—');
    assert.equal(rows[1].cells[1].textContent, `yun${HOSTILE}@x.com`);
    assert.equal(rows[1].cells[2].textContent, 'Expired');
    assert.equal(rows[1].cells[3].textContent, '—');

    // Declining the confirm sends nothing.
    let asked = '';
    window.confirm = (m) => ((asked = m), false);
    rows[0].querySelector('[data-act="create-family"]').click();
    await tick();
    assert.match(asked, /Create a family for zg@x\.com\?/);
    const puts = () => fetch.calls.filter((c) => c.options.method === 'PUT');
    assert.equal(puts().length, 0);

    window.confirm = () => true;
    rows[0].querySelector('[data-act="create-family"]').click();
    await tick();
    assert.equal(puts().length, 1);
    assert.equal(puts()[0].url.includes('/api/admin/households'), true);
    assert.deepEqual(JSON.parse(puts()[0].options.body), { founder_member_id: 'f1' });
    const notb = document.querySelector('#caaci-families-notice');
    assert.equal(notb.hidden, false);
    assert.equal(notb.textContent, 'Family created for zg@x.com.');
    s = planMembersEl();
    rows = [...s.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 1, 'reloaded without the new founder');
    assert.equal(rows[0].cells[1].textContent, `yun${HOSTILE}@x.com`);

    document.querySelector('#caaci-lang').click();
    await openFamilies();
    const zh = planMembersEl().textContent;
    for (const label of ['还没建家庭的家庭会员', '建家庭', '已过期', '邮箱'])
      assert.ok(zh.includes(label), `zh label ${label}`);
    document.querySelector('#caaci-lang').click();
    await tick();
  } finally {
    window.confirm = realConfirm;
    fetch.restore();
  }
});

test('admin families: Create family shows the server refusal, and the list has unavailable, empty and absent states', async () => {
  let reply = { rows: [], invites_available: true, family_plan_members: PLAN_MEMBERS };
  const fetch = mockFetch((u, o) => {
    if (!u.includes('/api/admin/households')) return { body: { ok: true } };
    if (o.method === 'PUT')
      return { status: 409, body: { error: 'That member is already in a family.' } };
    return { body: reply };
  });
  const realConfirm = window.confirm;
  try {
    window.confirm = () => true;
    await openFamilies();
    const btn = planMembersEl().querySelector('[data-act="create-family"]');
    btn.click();
    await tick();
    const notb = document.querySelector('#caaci-families-notice');
    assert.equal(notb.textContent, 'That member is already in a family.');
    assert.ok(notb.classList.contains('alert-danger'));
    assert.equal(btn.disabled, false, 'button usable again');

    reply = { rows: [], invites_available: true, family_plan_members: null };
    await openFamilies();
    assert.match(
      planMembersEl().querySelector('[data-plan-members-unavailable]').textContent,
      /Couldn't load family-plan members\./,
    );

    reply = { rows: [], invites_available: true, family_plan_members: [] };
    await openFamilies();
    assert.match(planMembersEl().textContent, /Every family-plan member has a family\./);
    assert.equal(planMembersEl().querySelector('[data-plan-members-count]'), null);

    reply = { rows: [FAMILY], invites_available: true };
    await openFamilies();
    assert.equal(planMembersEl(), null, 'no list from a server that does not send one');
    assert.ok(familyCardEl(), 'families still render');
  } finally {
    window.confirm = realConfirm;
    fetch.restore();
  }
});

test('admin members: once families load, the member editor offers them and saves the chosen family', async () => {
  familiesReply = familiesAvailable;
  const fetch = mockFetch((u, o) =>
    u.includes('/api/admin/households') ? familiesReply() : apiRoutes(u, o),
  );
  try {
    await openFamilies();
    document.querySelector('[data-tab="members"]').click();
    await tick();
    const row = () => document.querySelector('tr[data-edit-row]');
    document.querySelector('#caaci-members-body tr button').click();
    const select = row().querySelector('[data-f="household_id"]');
    assert.equal(select.disabled, false);
    assert.equal(row().querySelector('[data-household-unavailable]'), null);
    select.value = 'h1';
    // Save asks first, naming what changes; declining writes nothing.
    const asked = [];
    window.confirm = (q) => asked.push(q) && false;
    row().querySelector('[data-act="save"]').click();
    await tick();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /Save these changes to Mei Lin\?/);
    assert.match(asked[0], /family/);
    const posts = () =>
      fetch.calls.filter(
        (c) => c.url.includes('/api/admin/members') && c.options.method === 'POST',
      );
    assert.equal(posts().length, 0);
    window.confirm = () => true;
    row().querySelector('[data-act="save"]').click();
    await tick();
    assert.equal(JSON.parse(posts().at(-1).options.body).household_id, 'h1');
  } finally {
    fetch.restore();
  }
});

test('admin members: changing a plan needs the emailed code — asked inline, sent once, retried with it', async () => {
  familiesReply = familiesAvailable;
  const codeSends = [];
  const memberPosts = [];
  const fetch = mockFetch((u, o) => {
    if (u.includes('/api/admin/action-code')) {
      codeSends.push(o);
      return { body: { ok: true, sent_to: 'admin@x.com', valid_minutes: 10 } };
    }
    if (u.includes('/api/admin/members') && o.method === 'POST') {
      memberPosts.push(o);
      const code = o.headers['x-admin-code'];
      if (code === '246810') return { body: { ok: true, member: {} } };
      return {
        status: 428,
        body: {
          error: code
            ? 'That verification code is wrong or has expired.'
            : 'This action needs the verification code emailed to you.',
          code_required: true,
        },
      };
    }
    return apiRoutes(u, o);
  });
  try {
    await openFamilies();
    document.querySelector('[data-tab="members"]').click();
    await tick();
    const row = () => document.querySelector('tr[data-edit-row]');
    document.querySelector('#caaci-members-body tr button').click();
    row().querySelector('[data-f="tier_id"]').value = ''; // Individual → none
    let asked = '';
    window.confirm = (q) => ((asked = q), true);
    row().querySelector('[data-act="save"]').click();
    await tick();
    assert.match(asked, /plan: Individual → none/);
    // 428 → the code step appears inside the editor and one code is sent.
    const step = () => row().querySelector('[data-code-step]');
    assert.ok(step(), 'code step shown');
    assert.equal(codeSends.length, 1);
    assert.equal(memberPosts.length, 1);
    assert.equal('x-admin-code' in memberPosts[0].headers, false);
    assert.match(step().textContent, /Code sent to admin@x\.com/);
    const typeCode = async (code) => {
      step().querySelector('[data-f="code"]').value = code;
      step().querySelector('[data-act="confirm-code"]').click();
      await tick();
    };
    // Not six digits: refused locally, nothing sent.
    await typeCode('12');
    assert.match(step().querySelector('[data-code-error]').textContent, /6-digit/);
    assert.equal(memberPosts.length, 1);
    // A wrong code: the server's refusal is shown, the step stays, no new email.
    await typeCode('000000');
    assert.equal(memberPosts.length, 2);
    assert.equal(memberPosts[1].headers['x-admin-code'], '000000');
    assert.ok(step(), 'code step still shown');
    assert.match(step().querySelector('[data-code-error]').textContent, /wrong or has expired/);
    assert.equal(codeSends.length, 1);
    // The right code: saved, and the editor closes with the table reload.
    await typeCode('246810');
    assert.equal(memberPosts.length, 3);
    assert.equal(memberPosts[2].headers['x-admin-code'], '246810');
    assert.equal(row(), null, 'saved: table re-rendered');
    // The next guarded action reuses the code without asking again.
    document.querySelector('#caaci-members-body tr button').click();
    row().querySelector('[data-f="tier_id"]').value = 'family';
    row().querySelector('[data-act="save"]').click();
    await tick();
    assert.equal(memberPosts.length, 4);
    assert.equal(memberPosts[3].headers['x-admin-code'], '246810');
    assert.equal(codeSends.length, 1);
  } finally {
    fetch.restore();
  }
});

// ---------- news: message editor ----------
test('admin news: without Jodit the message box itself is the editor, and sending reads it', async () => {
  const fetch = mockFetch((u) =>
    u === '/api/admin/news' ? { body: { ok: true, sent: 2, failed: 0, total: 2 } } : { body: {} },
  );
  const $ = (s) => document.querySelector(s);
  const body = $('#caaci-news-body');
  const newsPosts = () =>
    fetch.calls.filter((c) => c.url === '/api/admin/news' && c.options.method === 'POST');
  try {
    $('[data-tab="news"]').click();
    await tick();

    // No Jodit in jsdom: no editor chrome, and the box is shown and labelled.
    assert.equal(window.Jodit, undefined);
    assert.equal(body.hidden, false);
    assert.ok($('label[for="caaci-news-body"]'), 'the box is labelled');
    for (const gone of [
      '#caaci-news-preview-btn',
      '#caaci-news-source-btn',
      '#caaci-news-toolbar',
      '#caaci-news-editor',
    ])
      assert.equal($(gone), null, gone);

    const html = '<p>Hello members</p>';
    $('#caaci-news-subject').value = 'Hello';
    body.value = html;
    $('#caaci-news-confirm').checked = true;
    $('#caaci-news-send').click();
    await tick();
    assert.equal(newsPosts().length, 1);
    assert.deepEqual(JSON.parse(newsPosts()[0].options.body), {
      subject: 'Hello',
      body_html: html,
      audience: 'active',
      confirm: true,
    });
  } finally {
    fetch.restore();
  }
});

// ---------- volunteers: one list for both sign-up sources ----------
const VOL_EVENT = {
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival',
  title_zh: '中秋节',
  starts_at: MAF.starts_at,
};
const VOLUNTEERS = [
  {
    id: 'v1',
    event_id: null,
    event: null, // "any event"
    name: 'Ann <b>Lee</b>', // the panel escapes what a volunteer typed
    email: 'ann@example.com',
    phone: null,
    message: 'Weekends, please',
    source: 'volunteer',
    member_id: null,
    created_at: '2026-09-13T15:05:07Z',
    updated_at: '2026-09-13T15:05:07Z',
    account: null,
  },
  {
    id: 'v2',
    event_id: 'ev-maf',
    event: VOL_EVENT,
    name: 'Mei Lin',
    email: 'mei@example.com',
    phone: '217-555-0100',
    message: null,
    source: 'registration',
    member_id: 'm-mei',
    created_at: '2026-09-12T15:00:00Z',
    updated_at: '2026-09-12T15:00:00Z',
    account: { id: 'm-mei', status: 'active', tier_id: 'family' },
  },
  {
    id: 'v3',
    event_id: 'ev-maf',
    event: VOL_EVENT,
    name: 'Kai',
    email: 'kai@example.com',
    phone: null,
    message: null,
    source: 'volunteer',
    member_id: null,
    created_at: '2026-09-11T15:00:00Z',
    updated_at: '2026-09-11T15:00:00Z',
    account: null,
  },
];

const volunteerRoutes =
  (rows) =>
  (u, options = {}) => {
    if (u.includes('/api/admin/event-volunteers'))
      return options.method === 'DELETE' ? { body: { ok: true } } : { body: { rows, summary: {} } };
    if (u.includes('/api/admin/events')) return { body: { rows: [MAF, PICNIC], total: 2 } };
    return { body: {} };
  };

test('admin volunteers: the tab lists every sign-up, filters by event and deletes a row', async () => {
  let rows = VOLUNTEERS;
  const fetch = mockFetch((u, o) => volunteerRoutes(rows)(u, o));
  const asked = stubConfirm(true);
  const $ = (s) => document.querySelector(s);
  const bodyRows = () => [...document.querySelectorAll('#caaci-vol-body tr')];
  try {
    $('[data-tab="volunteers"]').click();
    await tick();

    // The tab's own panel is the visible one.
    assert.equal(document.querySelector('[data-panel="volunteers"]').hidden, false);
    assert.equal(document.querySelector('[data-panel="events"]').hidden, true);
    assert.match(
      fetch.calls.find((c) => c.url.includes('/api/admin/event-volunteers')).url,
      /scope=all/,
    );

    // Every row, newest first as the API returns them.
    assert.equal(bodyRows().length, 3);
    const cells = bodyRows()[0].querySelectorAll('td');
    assert.equal(cells[0].textContent, 'Ann <b>Lee</b>'); // escaped, not parsed
    assert.equal(cells[0].querySelector('b'), null);
    assert.equal(cells[1].textContent, 'ann@example.com');
    assert.equal(cells[2].textContent, '—'); // no phone
    assert.equal(cells[3].textContent, 'Any event');
    assert.equal(cells[4].textContent, 'Volunteer page');
    assert.equal(cells[5].textContent, 'Weekends, please');
    assert.equal(cells[6].textContent, '2026-09-13 10:05:07'); // Chicago, not the test TZ
    assert.equal(cells[7].textContent, '—');
    assert.equal(bodyRows()[1].querySelectorAll('td')[4].textContent, 'Registration form');
    assert.equal(bodyRows()[1].querySelector('.badge').textContent, 'Active');
    assert.match($('#caaci-vol-count').textContent, /3 sign-up\(s\)/);

    // The filter is built from the rows: each event once, plus "any event".
    assert.deepEqual(
      [...$('#caaci-vol-event').options].map((o) => [o.value, o.textContent]),
      [
        ['', 'All events'],
        ['mid-autumn-festival', 'Mid-Autumn Festival'],
        ['__any__', 'Any event'],
      ],
    );
    const calls = fetch.calls.length;
    choose($('#caaci-vol-event'), 'mid-autumn-festival');
    assert.deepEqual(
      bodyRows().map((tr) => tr.querySelectorAll('td')[1].textContent),
      ['mei@example.com', 'kai@example.com'],
    );
    assert.equal(fetch.calls.length, calls, 'filtering is local — nothing is refetched');
    choose($('#caaci-vol-event'), '__any__');
    assert.deepEqual(
      bodyRows().map((tr) => tr.querySelectorAll('td')[1].textContent),
      ['ann@example.com'],
    );

    // Delete asks first, then removes the row and reloads the list.
    rows = VOLUNTEERS.filter((r) => r.id !== 'v1');
    bodyRows()[0].querySelector('[data-act="delete"]').click();
    await tick();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /Remove Ann <b>Lee<\/b> from the volunteer list\?/);
    const del = fetch.calls.find((c) => c.options.method === 'DELETE');
    assert.ok(del.url.startsWith('/api/admin/event-volunteers'));
    assert.deepEqual(JSON.parse(del.options.body), { id: 'v1' });
    // The "any event" option went with its only row, so the filter falls back to all.
    assert.equal($('#caaci-vol-event').value, '');
    assert.equal(bodyRows().length, 2);

    // Nothing left to export: the CSV button is disabled.
    rows = [];
    $('[data-tab="volunteers"]').click();
    await tick();
    assert.equal(bodyRows()[0].textContent, 'No volunteers yet.');
    assert.equal($('#caaci-vol-csv').disabled, true);
  } finally {
    asked.restore();
    fetch.restore();
  }
});

test('admin volunteers: an event row opens the tab already filtered to that event', async () => {
  const fetch = mockFetch(volunteerRoutes(VOLUNTEERS));
  const $ = (s) => document.querySelector(s);
  try {
    $('[data-tab="events"]').click();
    await tick();
    const row = document.querySelector('#caaci-events-body tr');
    assert.equal(row.querySelectorAll('td')[0].textContent.startsWith('Mid-Autumn Festival'), true);
    row.querySelector('[data-act="volunteers"]').click();
    await tick();

    assert.equal(document.querySelector('[data-panel="volunteers"]').hidden, false);
    assert.equal($('#caaci-vol-event').value, 'mid-autumn-festival');
    assert.deepEqual(
      [...document.querySelectorAll('#caaci-vol-body tr')].map(
        (tr) => tr.querySelectorAll('td')[1].textContent,
      ),
      ['mei@example.com', 'kai@example.com'],
    );
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: an event nobody has volunteered for gets its own empty state, not the whole list', async () => {
  const fetch = mockFetch(volunteerRoutes(VOLUNTEERS));
  const $ = (s) => document.querySelector(s);
  try {
    $('[data-tab="events"]').click();
    await tick();
    // The filter is built from the sign-ups that exist, so Picnic is not in it;
    // without adding it, the button fell back to the unfiltered list and
    // answered "here is everyone" to a question about one event.
    const row = document.querySelectorAll('#caaci-events-body tr')[1];
    assert.equal(row.querySelectorAll('td')[0].textContent.startsWith('Picnic'), true);
    row.querySelector('[data-act="volunteers"]').click();
    await tick();

    const sel = $('#caaci-vol-event');
    assert.equal(sel.value, 'picnic');
    assert.equal(sel.selectedOptions[0].textContent, 'Picnic');
    const bodyRows = [...document.querySelectorAll('#caaci-vol-body tr')];
    assert.equal(bodyRows.length, 1);
    assert.equal(bodyRows[0].textContent, 'No volunteers for Picnic yet.');
    assert.equal($('#caaci-vol-csv').disabled, true);
  } finally {
    fetch.restore();
  }
});

test('admin volunteers: the CSV has a BOM, Chicago times, RFC 4180 quoting and "Any event"', async () => {
  const { volunteersCsv } = await import('../src/caaci-admin.js'); // already booted
  const csv = volunteersCsv({
    rows: [
      {
        created_at: '2026-09-13T15:05:07Z',
        name: 'Ann, "A"',
        email: 'ann@example.com',
        phone: null,
        event: null,
        source: 'volunteer',
        message: '=cmd()', // a formula-looking message is defused
        account: null,
      },
      {
        created_at: '2026-01-15T18:00:00Z', // CST (UTC−6) in winter
        name: '林美',
        email: 'mei@example.com',
        phone: '217-555-0100',
        event: VOL_EVENT,
        source: 'registration',
        message: 'Can drive\na van',
        account: { id: 'm-mei', status: 'active', tier_id: 'family' },
      },
    ],
  });
  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM first');
  assert.equal(
    csv,
    '\uFEFF' +
      [
        '#,signed_up_at (Chicago),name,email,phone,event,source,message,has_account,account_status',
        '1,2026-09-13 10:05:07,"Ann, ""A""",ann@example.com,,Any event,volunteer,\'=cmd(),no,',
        '2,2026-01-15 12:00:00,林美,mei@example.com,217-555-0100,Mid-Autumn Festival,registration,"Can drive\na van",yes,active',
      ].join('\r\n') +
      '\r\n',
  );
});
