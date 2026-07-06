import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/admin/payments.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const PAYMENTS = [
  {
    id: 'p1',
    kind: 'membership',
    amount_cents: 6210,
    tier_id: 'family',
    discount_code: 'SPRING20',
    paid_at: '2026-06-01T00:00:00Z',
    members: { full_name: 'Mei Lin', email: 'mei@x.com' },
  },
  {
    id: 'p2',
    kind: 'renewal',
    amount_cents: 3105,
    tier_id: 'individual',
    discount_code: null,
    paid_at: '2026-05-01T00:00:00Z',
    members: { full_name: 'Wang Wei', email: 'ww@x.com' },
  },
];

function route() {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/payments') && u.includes('amount_cents') && u.includes('paid_at=gte'))
      return { body: PAYMENTS.map((p) => ({ amount_cents: p.amount_cents })) };
    if (u.includes('/rest/v1/payments'))
      return { body: PAYMENTS, headers: { 'content-range': '0-1/2' } };
    if (u.includes('/rest/v1/members') && u.includes('status=eq.'))
      return { body: [{ id: 'x' }], headers: { 'content-range': '0-0/7' } };
    return { body: [] };
  };
}

test('admin payments: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin payments: returns the ledger, status counts, and YTD revenue', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({
      request: fakeRequest({
        url: 'https://caaci.example/api/admin/payments?limit=50',
        headers: { authorization: 'Bearer tok' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.rows.length, 2);
    assert.equal(data.rows[0].members.full_name, 'Mei Lin');
    // 5 statuses counted, each mocked at 7
    assert.deepEqual(Object.keys(data.status_counts).sort(), [
      'active',
      'cancelled',
      'expired',
      'past_due',
      'pending',
    ]);
    assert.equal(data.revenue_ytd_cents, 6210 + 3105);
  } finally {
    fetch.restore();
  }
});
