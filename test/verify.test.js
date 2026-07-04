import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/verify.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const url = (m) => `https://caaci.example/api/verify?m=${m}`;

function route(member) {
  return (u) => {
    // membership_tiers first — "/rest/v1/members" is a substring of it.
    if (u.includes('membership_tiers')) return { body: [{ name: 'Family Membership' }] };
    if (u.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    return {};
  };
}

test('verify: active unexpired member renders the green VALID page', async () => {
  const fetch = mockFetch(
    route({
      full_name: 'Mei Lin',
      tier_id: 'family',
      status: 'active',
      expires_at: '2999-01-01T00:00:00Z',
    }),
  );
  try {
    const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    assert.match(html, /VALID MEMBER/);
    assert.match(html, /Mei Lin/);
    assert.match(html, /Family Membership/);
  } finally {
    fetch.restore();
  }
});

test('verify: expired or cancelled membership renders NOT VALID', async () => {
  for (const member of [
    {
      full_name: 'Old Guy',
      tier_id: 'family',
      status: 'active',
      expires_at: '2020-01-01T00:00:00Z',
    },
    { full_name: 'Quit Guy', tier_id: 'family', status: 'cancelled', expires_at: null },
    null, // no such member
  ]) {
    const fetch = mockFetch(route(member));
    try {
      const r = await onRequestGet({ request: fakeRequest({ url: url(UUID) }), env: fakeEnv() });
      const html = await r.text();
      assert.match(html, /NOT VALID/);
      assert.doesNotMatch(html, /Old Guy|Quit Guy/, 'no name leaked for invalid members');
    } finally {
      fetch.restore();
    }
  }
});

test('verify: a malformed id never hits the database', async () => {
  const fetch = mockFetch(route(null));
  try {
    const r = await onRequestGet({
      request: fakeRequest({ url: url('not-a-uuid') }),
      env: fakeEnv(),
    });
    assert.match(await r.text(), /NOT VALID/);
    assert.equal(fetch.calls.length, 0, 'no DB query for junk input');
  } finally {
    fetch.restore();
  }
});
