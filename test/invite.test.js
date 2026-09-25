// POST /api/invite: the signed-in member redeems an Honorable Membership
// invitation code. The rules live in invite_redeem() (0034, pinned in
// honorary-invites-migration.test.js); this checks the handler around it —
// who may call, how a refusal is worded, and that the 华协币 grant follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, normalizeInviteCode, REFUSALS } from '../functions/api/invite.js';
import { fakeRequest, mockFetch, fakeEnv, asUser, authRoute } from './helpers.js';

function route({
  redeem = { ok: true, code: 'HM-ABC', tier_id: 'honorary' },
  grant = { ok: true, granted: 20 },
} = {}) {
  return (url) => {
    const auth = authRoute(url, 'u1');
    if (auth) return auth;
    if (url.endsWith('/rest/v1/rpc/invite_redeem')) return { body: redeem };
    if (url.endsWith('/rest/v1/rpc/token_membership_grant'))
      return grant instanceof Error
        ? { status: 500, body: { message: grant.message } }
        : { body: grant };
    return { body: [] };
  };
}

const rpc = (fetch, fn) => fetch.calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${fn}`));
const post = (body, { env = fakeEnv({ TOKENS_ENABLED: '1' }), headers = asUser('u1') } = {}) =>
  onRequestPost({ request: fakeRequest({ body, headers }), env });

test('invite: normalizeInviteCode trims and uppercases', () => {
  assert.equal(normalizeInviteCode('  hm-abc '), 'HM-ABC');
  assert.equal(normalizeInviteCode(null), '');
});

test('invite: a visitor without a session is refused before anything is looked up', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ code: 'HM-ABC' }, { headers: {} });
    assert.equal(r.status, 401);
    assert.equal(rpc(fetch, 'invite_redeem').length, 0);
  } finally {
    fetch.restore();
  }
});

test('invite: an empty code is refused in both languages, without a database call', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ code: '   ' });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.error, /Enter your invitation code/);
    assert.equal(body.error_zh, '请输入邀请码。');
    assert.equal(rpc(fetch, 'invite_redeem').length, 0);

    const bad = await post('not json');
    assert.equal(bad.status, 400);
  } finally {
    fetch.restore();
  }
});

test('invite: a good code activates the tier and grants its tokens to the caller', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ code: ' hm-abc ' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, tier_id: 'honorary', tokens_granted: 20 });

    const [redeem] = rpc(fetch, 'invite_redeem');
    assert.deepEqual(JSON.parse(redeem.options.body), { p_code: 'HM-ABC', p_member: 'u1' });
    // the service-role key, never the caller's token
    assert.equal(redeem.options.headers.authorization, 'Bearer service-key');

    const [grant] = rpc(fetch, 'token_membership_grant');
    assert.deepEqual(JSON.parse(grant.options.body), { p_member: 'u1', p_actor: null });
  } finally {
    fetch.restore();
  }
});

test('invite: with tokens switched off the membership still activates and nothing is granted', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post({ code: 'HM-ABC' }, { env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, tier_id: 'honorary', tokens_granted: 0 });
    assert.equal(rpc(fetch, 'token_membership_grant').length, 0);
  } finally {
    fetch.restore();
  }
});

test('invite: a failed grant does not undo the activation', async () => {
  const fetch = mockFetch(route({ grant: new Error('ledger down') }));
  try {
    const r = await post({ code: 'HM-ABC' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, tier_id: 'honorary', tokens_granted: 0 });
  } finally {
    fetch.restore();
  }
});

test('invite: every reason invite_redeem can give is a sentence in both languages, and grants nothing', async () => {
  for (const [reason, [en, zh, status]] of Object.entries(REFUSALS)) {
    const fetch = mockFetch(route({ redeem: { ok: false, reason } }));
    try {
      const r = await post({ code: 'HM-ABC' });
      assert.equal(r.status, status, reason);
      const body = await r.json();
      assert.equal(body.error, en);
      assert.equal(body.error_zh, zh);
      assert.equal(body.code, reason);
      assert.equal(rpc(fetch, 'token_membership_grant').length, 0, reason);
    } finally {
      fetch.restore();
    }
  }
});

test('invite: an answer the handler does not recognise is still a refusal, not a success', async () => {
  for (const redeem of [{ ok: false, reason: 'something_new' }, {}, null]) {
    const fetch = mockFetch(route({ redeem }));
    try {
      const r = await post({ code: 'HM-ABC' });
      assert.equal(r.status, 409);
      const body = await r.json();
      assert.equal(body.code, 'refused');
      assert.ok(body.error && body.error_zh);
      assert.equal(rpc(fetch, 'token_membership_grant').length, 0);
    } finally {
      fetch.restore();
    }
  }
});
