// /api/admin/invites: making an Honorable Membership invitation code hands a
// membership to whoever holds the link, so it is guarded the way a plan change
// is — by the emailed verification code — and a used code is never deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPut,
  onRequestPost,
  onRequestDelete,
  generateCode,
  opensSeats,
  CODE_RE,
} from '../functions/api/admin/invites.js';
import { codeFor, currentSlot } from '../functions/api/admin/_action-code.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const ROW = {
  code: 'HM-EXISTS',
  tier_id: 'honorary',
  note: null,
  active: true,
  expires_at: null,
  max_redemptions: 3,
  times_redeemed: 0,
  created_at: '2026-09-24T00:00:00Z',
};

// Supabase: the admin gate, one existing code (ROW) and an insert that echoes.
function route({ admin = true, existing = ROW } = {}) {
  return (u, o = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/invite_codes')) {
      if (o.method === 'POST') return { body: [{ ...JSON.parse(o.body), times_redeemed: 0 }] };
      if (o.method === 'PATCH' || o.method === 'DELETE') return { body: {} };
      const m = u.match(/code=eq\.([^&]+)/);
      if (m)
        return {
          body: existing && decodeURIComponent(m[1]) === existing.code ? [existing] : [],
        };
      return { body: existing ? [existing] : [] };
    }
    if (u.includes('/rest/v1/invite_redemptions'))
      return {
        body: [{ code: 'HM-EXISTS', member_id: 'm1', redeemed_at: '2026-09-24T01:00:00Z' }],
      };
    return { body: [] };
  };
}

const calls = (fetch, method) =>
  fetch.calls.filter((c) => c.url.includes('/rest/v1/invite_codes') && c.options.method === method);
const withCode = async () => ({
  'x-admin-code': await codeFor(fakeEnv(), 'admin-1', currentSlot()),
});
const req = (body, headers = {}, url = 'https://caaci.example/api/admin/invites') =>
  fakeRequest({ url, headers: { authorization: 'Bearer tok', ...headers }, body });

test('admin invites: a non-admin is refused on every verb', async () => {
  const fetch = mockFetch(route({ admin: false }));
  try {
    for (const [handler, body] of [
      [onRequestGet, undefined],
      [onRequestPut, { note: 'x' }],
      [onRequestPost, { code: 'HM-EXISTS', active: false }],
      [onRequestDelete, { code: 'HM-EXISTS' }],
    ]) {
      const r = await handler({ request: req(body), env: fakeEnv() });
      assert.equal(r.status, 403, handler.name);
    }
    assert.equal(calls(fetch, 'POST').length + calls(fetch, 'PATCH').length, 0);
  } finally {
    fetch.restore();
  }
});

test('admin invites: GET lists the codes and who used them', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: req(), env: fakeEnv() });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.rows, [ROW]);
    assert.equal(body.redemptions[0].member_id, 'm1');
    const q = fetch.calls.find((c) => c.url.includes('/rest/v1/invite_redemptions'));
    assert.match(q.url, /members\(full_name,email\)/, 'names come with the redemption rows');
  } finally {
    fetch.restore();
  }
});

test('admin invites: creating a code without the emailed code is refused (428) and writes nothing', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPut({ request: req({ note: 'Board 2026' }), env: fakeEnv() });
    assert.equal(r.status, 428);
    assert.equal((await r.json()).code_required, true);
    assert.equal(calls(fetch, 'POST').length, 0);
  } finally {
    fetch.restore();
  }
});

test('admin invites: with the emailed code, a blank code is generated and the row is honorary', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPut({
      request: req({ code: '', note: ' Board 2026 ', max_redemptions: '5' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const { invite } = await r.json();
    assert.match(invite.code, /^HM-[A-HJ-NP-Z2-9]{8}$/);
    const inserted = JSON.parse(calls(fetch, 'POST')[0].options.body);
    assert.equal(inserted.tier_id, 'honorary');
    assert.equal(inserted.created_by, 'admin-1');
    assert.equal(inserted.active, true);
    assert.equal(inserted.note, 'Board 2026');
    assert.equal(inserted.max_redemptions, 5);
    assert.equal(inserted.expires_at, null);
  } finally {
    fetch.restore();
  }
});

test('admin invites: a chosen code is upper-cased, checked for shape, and must be new', async () => {
  const fetch = mockFetch(route());
  try {
    let r = await onRequestPut({
      request: req({ code: 'board-2026' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(calls(fetch, 'POST')[0].options.body).code, 'BOARD-2026');

    r = await onRequestPut({
      request: req({ code: 'board 2026' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /letters, digits, dashes or underscores/);

    r = await onRequestPut({
      request: req({ code: 'hm-exists' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /already exists/);
    assert.equal(calls(fetch, 'POST').length, 1);

    r = await onRequestPut({
      request: req({ code: 'HM-NEW', max_redemptions: '0' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
    r = await onRequestPut({
      request: req({ code: 'HM-NEW', expires_at: 'never' }, await withCode()),
      env: fakeEnv(),
    });
    assert.equal(r.status, 400);
  } finally {
    fetch.restore();
  }
});

test('admin invites: switching a code off or editing its note needs no emailed code', async () => {
  for (const body of [
    { code: 'HM-EXISTS', active: false },
    { code: 'HM-EXISTS', note: 'renamed' },
  ]) {
    const fetch = mockFetch(route());
    try {
      const r = await onRequestPost({ request: req(body), env: fakeEnv() });
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.equal(calls(fetch, 'PATCH').length, 1);
    } finally {
      fetch.restore();
    }
  }
});

test('admin invites: switching a code on, or changing its cap or expiry, needs the emailed code', async () => {
  for (const body of [
    { code: 'HM-EXISTS', active: true },
    { code: 'HM-EXISTS', max_redemptions: 10 },
    { code: 'HM-EXISTS', max_redemptions: '' },
    { code: 'HM-EXISTS', expires_at: '2030-01-01' },
    { code: 'HM-EXISTS', expires_at: null },
  ]) {
    const fetch = mockFetch(route());
    try {
      let r = await onRequestPost({ request: req(body), env: fakeEnv() });
      assert.equal(r.status, 428, JSON.stringify(body));
      assert.equal(calls(fetch, 'PATCH').length, 0);
      r = await onRequestPost({ request: req(body, await withCode()), env: fakeEnv() });
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.equal(calls(fetch, 'PATCH').length, 1);
    } finally {
      fetch.restore();
    }
  }
});

test('admin invites: an empty patch and an unknown code are refused', async () => {
  const fetch = mockFetch(route());
  try {
    let r = await onRequestPost({ request: req({ code: 'HM-EXISTS' }), env: fakeEnv() });
    assert.equal(r.status, 400);
    r = await onRequestPost({ request: req({ code: 'HM-NOPE', note: 'x' }), env: fakeEnv() });
    assert.equal(r.status, 404);
  } finally {
    fetch.restore();
  }
});

test('admin invites: a used code is never deleted; an unused one is; an unknown one is 404', async () => {
  const used = mockFetch(route({ existing: { ...ROW, times_redeemed: 2 } }));
  try {
    const r = await onRequestDelete({
      request: req(undefined, {}, 'https://caaci.example/api/admin/invites?code=hm-exists'),
      env: fakeEnv(),
    });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Switch it off/);
    assert.equal(calls(used, 'DELETE').length, 0);
  } finally {
    used.restore();
  }

  const fresh = mockFetch(route());
  try {
    let r = await onRequestDelete({ request: req({ code: 'HM-EXISTS' }), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.equal(calls(fresh, 'DELETE').length, 1);
    assert.match(calls(fresh, 'DELETE')[0].url, /code=eq\.HM-EXISTS/);

    r = await onRequestDelete({ request: req({ code: 'HM-NOPE' }), env: fakeEnv() });
    assert.equal(r.status, 404);
    r = await onRequestDelete({ request: req({}), env: fakeEnv() });
    assert.equal(r.status, 400);
  } finally {
    fresh.restore();
  }
});

test('admin invites: generated codes are eight characters from an unambiguous alphabet', () => {
  const fixed = (bytes) => bytes.fill(0);
  assert.equal(generateCode(fixed), 'HM-AAAAAAAA');
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    assert.match(code, /^HM-[A-HJ-NP-Z2-9]{8}$/, code);
    assert.ok(CODE_RE.test(code));
  }
});

test('admin invites: opensSeats names exactly the fields that let more people in', () => {
  assert.equal(opensSeats({ active: true }), true);
  assert.equal(opensSeats({ active: false }), false);
  assert.equal(opensSeats({ note: 'x' }), false);
  assert.equal(opensSeats({ max_redemptions: 1 }), true);
  assert.equal(opensSeats({ max_redemptions: null }), true);
  assert.equal(opensSeats({ expires_at: null }), true);
  assert.equal(opensSeats({ expires_at: '2030-01-01T00:00:00.000Z' }), true);
});
