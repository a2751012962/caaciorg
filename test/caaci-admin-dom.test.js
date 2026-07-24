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

// The admin APIs the panel calls on boot and on tab clicks.
function apiRoutes(u) {
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
        ],
        total: 1,
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
    assert.match(document.querySelector('#caaci-page-info').textContent, /1–1 of 1/);

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
    fetch.restore();
  }
});
