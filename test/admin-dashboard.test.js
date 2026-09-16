import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, EXPIRING_DAYS } from '../functions/api/admin/dashboard.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const STATUS_TOTALS = { active: 40, pending: 3, past_due: 2, expired: 10, cancelled: 5 };
const TIER_ACTIVE = { individual: 25, family: 15 };

const EXPIRING = [
  {
    id: 'm1',
    full_name: 'Mei Lin',
    email: 'mei@x.com',
    tier_id: 'family',
    status: 'active',
    expires_at: '2026-09-20T00:00:00Z',
  },
];
const RECENT_PAYMENTS = [
  {
    id: 'p1',
    kind: 'renewal',
    amount_cents: 3105,
    tier_id: 'individual',
    paid_at: '2026-09-10T00:00:00Z',
    members: { full_name: 'Wang Wei', email: 'ww@x.com' },
  },
];
const UPCOMING = [
  {
    id: 'e1',
    title: 'Mid-Autumn Festival',
    title_zh: '中秋晚会',
    slug: 'mid-autumn',
    starts_at: '2026-10-03T23:00:00Z',
    ends_at: null,
    location: 'Champaign',
    published: true,
    registration_questions: [],
  },
  {
    id: 'e2',
    title: 'Board meeting',
    title_zh: null,
    slug: 'board',
    starts_at: '2026-10-10T00:00:00Z',
    ends_at: null,
    location: null,
    published: true,
    registration_questions: null,
  },
];
const RECENT_REGISTRATIONS = [
  {
    id: 'r1',
    email: 'ann@x.com',
    created_at: '2026-09-15T12:00:00Z',
    events: { title: 'Mid-Autumn Festival', title_zh: '中秋晚会', slug: 'mid-autumn' },
  },
];

const range = (total) => ({ 'content-range': `0-0/${total}` });
const now = new Date();
const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
const hoursAfter = (iso, h) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();
// This year's ledger: two payments this month, one on New Year's Day (which is
// also this month when the test runs in January), one from last year that a
// correct filter would never have returned and the bucketing must ignore.
const YEAR_PAYMENTS = [
  { amount_cents: 3105, paid_at: hoursAfter(monthStart, 1) },
  { amount_cents: 6210, paid_at: hoursAfter(monthStart, 2) },
  { amount_cents: 5000, paid_at: hoursAfter(yearStart, 1) },
  { amount_cents: 9999, paid_at: hoursAfter(yearStart, -24) },
];
// Last year's ledger, for ?year=: a payment in March and one in December.
const lastYear = now.getFullYear() - 1;
const lastYearStart = new Date(lastYear, 0, 1).toISOString();
const LAST_YEAR_PAYMENTS = [
  { amount_cents: 1000, paid_at: `${lastYear}-03-15T12:00:00.000Z` },
  { amount_cents: 2500, paid_at: `${lastYear}-12-31T23:00:00.000Z` },
];

// Every PostgREST read the handler makes, told apart by table + filter.
function route() {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/membership_tiers'))
      return {
        body: [
          { id: 'individual', name: 'Individual' },
          { id: 'family', name: 'Family' },
        ],
      };
    if (u.includes('/rest/v1/members') && u.includes('expires_at=gte'))
      return { body: EXPIRING, headers: range(4) };
    if (u.includes('/rest/v1/members') && u.includes('created_at=gte'))
      return { body: [{ id: 'x' }], headers: range(6) };
    if (u.includes('/rest/v1/members') && u.includes('tier_id=eq.')) {
      const tier = decodeURIComponent(u.match(/tier_id=eq\.([^&]+)/)[1]);
      return { body: [{ id: 'x' }], headers: range(TIER_ACTIVE[tier] ?? 0) };
    }
    if (u.includes('/rest/v1/members') && u.includes('status=eq.')) {
      const status = u.match(/status=eq\.([^&]+)/)[1];
      return { body: [{ id: 'x' }], headers: range(STATUS_TOTALS[status] ?? 0) };
    }
    if (u.includes('/rest/v1/payments') && u.includes(`paid_at=gte.${yearStart}`))
      return { body: YEAR_PAYMENTS };
    if (u.includes('/rest/v1/payments') && u.includes(`paid_at=gte.${lastYearStart}`))
      return { body: LAST_YEAR_PAYMENTS };
    if (u.includes('/rest/v1/payments') && u.includes('order=paid_at.asc'))
      return { body: [{ paid_at: hoursAfter(lastYearStart, -24) }] }; // first ever: 2 years ago
    if (u.includes('/rest/v1/payments')) return { body: RECENT_PAYMENTS };
    if (u.includes('/rest/v1/events') && u.includes('published=eq.false'))
      return { body: [{ id: 'x' }], headers: range(1) };
    if (u.includes('/rest/v1/events')) return { body: UPCOMING, headers: range(2) };
    if (u.includes('/rest/v1/event_registrations') && u.includes('event_id=in.'))
      return { body: [{ event_id: 'e1' }, { event_id: 'e1' }, { event_id: 'e1' }] };
    if (u.includes('/rest/v1/event_registrations')) return { body: RECENT_REGISTRATIONS };
    if (u.includes('/rest/v1/event_volunteers') && u.includes('created_at=gte'))
      return { body: [{ id: 'x' }], headers: range(3) };
    if (u.includes('/rest/v1/event_volunteers')) return { body: [{ id: 'x' }], headers: range(12) };
    if (u.includes('/rest/v1/business_directory'))
      return { body: [{ id: 'x' }], headers: range(2) };
    return { body: [] };
  };
}

const get = (env = fakeEnv()) =>
  onRequestGet({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/dashboard',
      headers: { authorization: 'Bearer tok' },
    }),
    env,
  });

test('admin dashboard: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin dashboard: refuses a signed-in non-admin', async () => {
  const fetch = mockFetch((u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'u-2' } };
    if (u.includes('/rest/v1/members')) return { body: [{ id: 'u-2', is_admin: false }] };
    return { body: [] };
  });
  try {
    const r = await get();
    assert.equal(r.status, 403);
  } finally {
    fetch.restore();
  }
});

test('admin dashboard: counts members, revenue, events, volunteers and listings', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get();
    assert.equal(r.status, 200);
    const d = await r.json();

    // Members: one head-count per status, summed; new this month; per-tier actives.
    assert.deepEqual(d.members.status_counts, STATUS_TOTALS);
    assert.equal(d.members.total, 60);
    assert.equal(d.members.new_this_month, 6);
    assert.deepEqual(d.members.by_tier, [
      { id: 'individual', name: 'Individual', active: 25 },
      { id: 'family', name: 'Family', active: 15 },
    ]);
    // Expiring: active members only, inside the window, soonest first.
    assert.equal(d.members.expiring_days, EXPIRING_DAYS);
    assert.equal(d.members.expiring_total, 4);
    assert.deepEqual(d.members.expiring, EXPIRING);
    const expiringCall = fetch.calls.find((c) => c.url.includes('expires_at=gte')).url;
    assert.match(expiringCall, /status=eq\.active/);
    assert.match(expiringCall, /expires_at=lte\./);
    assert.match(expiringCall, /order=expires_at\.asc/);

    // Revenue: summed from the rows, this year and this month.
    // (a year ago is outside the year even when the test runs in January)
    const january = now.getMonth() === 0;
    assert.equal(d.revenue.ytd_cents, 3105 + 6210 + 5000);
    assert.equal(d.revenue.month_cents, 3105 + 6210 + (january ? 5000 : 0));
    assert.equal(d.revenue.payments_this_month, january ? 3 : 2);
    // One bucket per month, January through this month, for the line chart.
    assert.equal(d.revenue.by_month.length, now.getMonth() + 1);
    assert.equal(d.revenue.by_month[0].month, `${now.getFullYear()}-01`);
    assert.deepEqual(d.revenue.by_month[0], {
      month: `${now.getFullYear()}-01`,
      cents: january ? 3105 + 6210 + 5000 : 5000,
      payments: january ? 3 : 1,
    });
    const thisMonth = d.revenue.by_month[d.revenue.by_month.length - 1];
    assert.equal(thisMonth.cents, d.revenue.month_cents);
    assert.equal(thisMonth.payments, d.revenue.payments_this_month);
    assert.equal(
      d.revenue.by_month.reduce((s, b) => s + b.cents, 0),
      d.revenue.ytd_cents,
    );
    // Without ?year the chart shows this year; the years on offer run from the
    // first payment's year (two years back) to this one, newest first.
    assert.equal(d.revenue.year, now.getFullYear());
    assert.deepEqual(d.revenue.years, [now.getFullYear(), lastYear, lastYear - 1]);
    assert.equal(d.revenue.year_cents, d.revenue.ytd_cents);
    assert.equal(d.revenue.year_payments, 3);
    assert.deepEqual(d.revenue.recent, RECENT_PAYMENTS);

    // Events: published + future only, with registrations counted per event;
    // an event without a form takes no registrations.
    const upcomingCall = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/events') && c.url.includes('published=eq.true'),
    ).url;
    assert.match(upcomingCall, /starts_at=gte\./);
    assert.match(upcomingCall, /order=starts_at\.asc/);
    assert.equal(d.events.upcoming_total, 2);
    assert.deepEqual(
      d.events.upcoming.map((e) => [e.id, e.takes_registrations, e.registration_count]),
      [
        ['e1', true, 3],
        ['e2', false, 0],
      ],
    );
    assert.equal(d.events.upcoming[0].title_zh, '中秋晚会');
    assert.equal(d.events.drafts_total, 1);
    assert.deepEqual(d.events.recent_registrations, RECENT_REGISTRATIONS);

    assert.deepEqual(d.volunteers, { total: 12, this_month: 3 });
    assert.deepEqual(d.business, { pending: 2 });
    assert.ok(!isNaN(Date.parse(d.generated_at)));
  } finally {
    fetch.restore();
  }
});

test('admin dashboard: ?year= charts an earlier year, this year and month stay current', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({
      request: fakeRequest({
        url: `https://caaci.example/api/admin/dashboard?year=${lastYear}`,
        headers: { authorization: 'Bearer tok' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.revenue.year, lastYear);
    // A whole past year: twelve buckets, March and December filled.
    assert.equal(d.revenue.by_month.length, 12);
    assert.deepEqual(d.revenue.by_month[2], { month: `${lastYear}-03`, cents: 1000, payments: 1 });
    assert.deepEqual(d.revenue.by_month[11], { month: `${lastYear}-12`, cents: 2500, payments: 1 });
    assert.equal(d.revenue.year_cents, 3500);
    assert.equal(d.revenue.year_payments, 2);
    // The headline figures still describe now.
    assert.equal(d.revenue.ytd_cents, 3105 + 6210 + 5000);
    assert.equal(d.revenue.payments_this_month, now.getMonth() === 0 ? 3 : 2);
    // The year's read is bounded on both sides.
    const yearCall = fetch.calls.find((c) => c.url.includes(`paid_at=gte.${lastYearStart}`)).url;
    assert.match(yearCall, new RegExp(`paid_at=lt\\.${now.getFullYear()}-01-01`));
  } finally {
    fetch.restore();
  }
});

test('admin dashboard: a future or malformed year falls back to this year', async () => {
  for (const bad of ['2999', 'abc', '1999']) {
    const fetch = mockFetch(route());
    try {
      const r = await onRequestGet({
        request: fakeRequest({
          url: `https://caaci.example/api/admin/dashboard?year=${bad}`,
          headers: { authorization: 'Bearer tok' },
        }),
        env: fakeEnv(),
      });
      const d = await r.json();
      assert.equal(d.revenue.year, now.getFullYear(), `year=${bad}`);
      assert.equal(d.revenue.by_month.length, now.getMonth() + 1);
    } finally {
      fetch.restore();
    }
  }
});

test('admin dashboard: a database error is a 500 with the message', async () => {
  const fetch = mockFetch((u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    return { status: 503, body: 'down' };
  });
  try {
    const r = await get();
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /supabase select members: 503/);
  } finally {
    fetch.restore();
  }
});
