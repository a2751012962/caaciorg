// POST /api/admin/members: a plan (tier) change needs the emailed verification
// code; every other edit — and re-sending the plan the member already has —
// does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/admin/members.js';
import { codeFor, currentSlot } from '../functions/api/admin/_action-code.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const MEMBER = { id: 'm1', tier_id: 'individual', status: 'active' };

function route() {
  return (u, o = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/membership_tiers')) return { body: [{ id: 'family' }] };
    if (u.includes('/rest/v1/members') && o.method === 'PATCH') return { body: {} };
    if (u.includes('/rest/v1/members')) return { body: [MEMBER] };
    return { body: [] };
  };
}
const patched = (fetch) =>
  fetch.calls.filter((c) => c.url.includes('/rest/v1/members') && c.options.method === 'PATCH');
const post = (body, headers = {}) =>
  onRequestPost({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/members',
      headers: { authorization: 'Bearer tok', ...headers },
      body,
    }),
    env: fakeEnv(),
  });

test('members: a plan change without the code is refused (428) and writes nothing', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ id: 'm1', tier_id: 'family' });
    assert.equal(r.status, 428);
    assert.equal((await r.json()).code_required, true);
    assert.equal(patched(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('members: a plan change with the code goes through', async () => {
  const fetch = mockFetch(route());
  try {
    const code = await codeFor(fakeEnv(), 'admin-1', currentSlot());
    const r = await post({ id: 'm1', tier_id: 'family' }, { 'x-admin-code': code });
    assert.equal(r.status, 200);
    assert.equal(patched(fetch).length, 1);
    assert.equal(JSON.parse(patched(fetch)[0].options.body).tier_id, 'family');
  } finally {
    fetch.restore();
  }
});

test('members: the same plan again, or any other field, needs no code', async () => {
  for (const body of [
    { id: 'm1', tier_id: 'individual', status: 'past_due' },
    { id: 'm1', status: 'expired', expires_at: '2026-12-31' },
    { id: 'm1', household_id: 'h1' },
  ]) {
    const fetch = mockFetch(route());
    try {
      const r = await post(body);
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.equal(patched(fetch).length, 1);
    } finally {
      fetch.restore();
    }
  }
});
