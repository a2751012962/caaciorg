import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeFor,
  currentSlot,
  verifyActionCode,
  requireActionCode,
  SLOT_MS,
} from '../functions/api/admin/_action-code.js';
import { onRequestPost } from '../functions/api/admin/action-code.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const env = fakeEnv({ RESEND_API_KEY: 're_test', NOTIFY_FROM: 'CAACI <no-reply@caaciorg.com>' });
const NOW = Date.UTC(2026, 8, 16, 15, 0, 0);

test('action code: six digits, fixed for an admin and a slot, different across both', async () => {
  const a = await codeFor(env, 'admin-1', 100);
  assert.match(a, /^\d{6}$/);
  assert.equal(await codeFor(env, 'admin-1', 100), a);
  assert.notEqual(await codeFor(env, 'admin-2', 100), a);
  assert.notEqual(await codeFor(env, 'admin-1', 101), a);
  // A different signing key gives different codes: the key is the secret.
  assert.notEqual(
    await codeFor(fakeEnv({ SUPABASE_SERVICE_ROLE_KEY: 'other' }), 'admin-1', 100),
    a,
  );
});

test('action code: valid for its slot and the next, then no longer; junk never', async () => {
  const slot = currentSlot(NOW);
  const code = await codeFor(env, 'admin-1', slot);
  assert.equal(await verifyActionCode(env, 'admin-1', code, NOW), true);
  assert.equal(await verifyActionCode(env, 'admin-1', ` ${code} `, NOW), true);
  assert.equal(await verifyActionCode(env, 'admin-1', code, NOW + SLOT_MS), true); // next slot
  assert.equal(await verifyActionCode(env, 'admin-1', code, NOW + 2 * SLOT_MS), false);
  assert.equal(await verifyActionCode(env, 'admin-1', code, NOW - SLOT_MS), false); // not yet
  assert.equal(await verifyActionCode(env, 'admin-2', code, NOW), false);
  for (const junk of [
    '',
    null,
    '12345',
    '1234567',
    'abcdef',
    code.replace(/./, (c) => (c === '9' ? '0' : '9')),
  ]) {
    assert.equal(await verifyActionCode(env, 'admin-1', junk, NOW), false, `junk ${junk}`);
  }
});

test('action code: the gate answers 428 + code_required, wording apart for missing vs wrong', async () => {
  const req = (headers) => fakeRequest({ headers });
  const missing = await requireActionCode(req({}), env, 'admin-1');
  assert.equal(missing.error.status, 428);
  const m = await missing.error.json();
  assert.equal(m.code_required, true);
  assert.match(m.error, /needs the verification code emailed to you/);
  const wrong = await requireActionCode(req({ 'x-admin-code': '000000' }), env, 'admin-1');
  assert.match((await wrong.error.json()).error, /wrong or has expired/);
  const code = await codeFor(env, 'admin-1', currentSlot());
  assert.deepEqual(await requireActionCode(req({ 'x-admin-code': code }), env, 'admin-1'), {});
});

function route({ email = 'admin@x.com', isAdmin = true } = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1', email } };
    if (u.includes('/rest/v1/members'))
      return { body: [{ id: 'admin-1', email, is_admin: isAdmin }] };
    if (u.includes('api.resend.com')) return { body: { id: 'em_1' } };
    return { body: [] };
  };
}
const post = (env_ = env) =>
  onRequestPost({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/action-code',
      headers: { authorization: 'Bearer tok' },
    }),
    env: env_,
  });

test('POST action-code: requires an admin session', async () => {
  let fetch = mockFetch(route());
  try {
    const r = await onRequestPost({ request: fakeRequest({}), env });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ isAdmin: false }));
  try {
    assert.equal((await post()).status, 403);
  } finally {
    fetch.restore();
  }
});

test('POST action-code: emails the current code to the admin themselves, and never returns it', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post();
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(data, { ok: true, sent_to: 'admin@x.com', valid_minutes: 10 });
    const sent = fetch.calls.find((c) => c.url.includes('api.resend.com'));
    assert.ok(sent, 'email sent');
    const body = JSON.parse(sent.options.body);
    const code = await codeFor(env, 'admin-1', currentSlot());
    assert.equal(body.to, 'admin@x.com');
    assert.match(body.subject, new RegExp(code));
    assert.match(body.html, new RegExp(`<strong>${code}</strong>`));
    assert.match(body.html, /管理后台验证码/);
    assert.equal(JSON.stringify(data).includes(code), false);
  } finally {
    fetch.restore();
  }
});

test('POST action-code: without email configured it says so instead of pretending', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await post(fakeEnv());
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /Email is not configured/);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('api.resend.com')),
      false,
    );
  } finally {
    fetch.restore();
  }
});
