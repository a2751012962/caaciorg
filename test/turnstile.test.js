// The human check in front of the public forms (functions/api/_turnstile.js).
// What matters here is what it REFUSES: `success: true` on its own would accept
// a token minted on any page of any site that holds this sitekey, and a missing
// secret must break the form rather than quietly reopen the mail relay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireHuman, turnstileToken, NOT_HUMAN } from '../functions/api/_turnstile.js';
import { fakeRequest, mockFetch, fakeEnv, TURNSTILE_TOKEN } from './helpers.js';

const req = (headers = {}) => fakeRequest({ url: 'https://caaci.example/api/volunteer', headers });

// siteverify answers with `answer`; anything else is an unexpected call.
const route = (answer) => (url) => {
  if (url.includes('challenges.cloudflare.com')) return { body: answer };
  return { status: 500, body: { error: `unexpected ${url}` } };
};

const check = async (answer, { env = {}, token = TURNSTILE_TOKEN, action = 'volunteer' } = {}) => {
  const fetch = mockFetch(route(answer));
  try {
    const r = await requireHuman(req(), fakeEnv(env), action, token);
    return { gate: r, calls: fetch.calls };
  } finally {
    fetch.restore();
  }
};

const GOOD = { success: true, action: 'volunteer', hostname: 'caaci.example' };

test('turnstile: a valid token for this action on this host passes', async () => {
  const { gate, calls } = await check(GOOD);
  assert.deepEqual(gate, {});
  const sent = new URLSearchParams(calls[0].options.body);
  assert.equal(sent.get('secret'), 'turnstile-secret');
  assert.equal(sent.get('response'), TURNSTILE_TOKEN);
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
});

test('turnstile: without the secret nothing is accepted, and siteverify is never called', async () => {
  const { gate, calls } = await check(GOOD, { env: { TURNSTILE_SECRET: '' } });
  assert.equal(gate.error.status, 403);
  assert.equal((await gate.error.json()).error, NOT_HUMAN);
  assert.equal(calls.length, 0, 'no token can be valid when none can be checked');
});

test('turnstile: a missing, empty or oversized token is refused before the call', async () => {
  // requireHuman directly, not the check() helper: its default would replace an
  // explicit `undefined` with a good token and the case would test nothing.
  for (const token of [undefined, null, '', 123, 'x'.repeat(2049)]) {
    const fetch = mockFetch(route(GOOD));
    try {
      const gate = await requireHuman(req(), fakeEnv(), 'volunteer', token);
      assert.equal(gate.error?.status, 403, JSON.stringify(token));
      assert.equal(fetch.calls.length, 0, 'siteverify is not asked about a non-token');
    } finally {
      fetch.restore();
    }
  }
});

test('turnstile: a token minted for another form, or on another site, is refused', async () => {
  for (const answer of [
    { ...GOOD, success: false, 'error-codes': ['invalid-input-response'] },
    { ...GOOD, action: 'contact' }, // a token from a cheaper form, replayed here
    { ...GOOD, hostname: 'evil.example' }, // same sitekey, someone else's page
    { ...GOOD, hostname: undefined },
    {},
  ]) {
    const { gate } = await check(answer);
    assert.equal(gate.error?.status, 403, JSON.stringify(answer));
  }
});

test('turnstile: siteverify being unreachable, slow or not JSON refuses, never passes', async () => {
  for (const handler of [
    () => ({ status: 500, body: { success: true } }),
    () => ({ body: 'not json' }),
    () => {
      throw new Error('network');
    },
  ]) {
    const fetch = mockFetch(handler);
    try {
      const gate = await requireHuman(req(), fakeEnv(), 'volunteer', TURNSTILE_TOKEN);
      assert.equal(gate.error?.status, 403);
    } finally {
      fetch.restore();
    }
  }
});

test("turnstile: the hostname allowed is this deployment's own, unless TURNSTILE_HOSTNAMES says otherwise", async () => {
  // Default: the host serving the API — the widget runs on the page calling it.
  assert.deepEqual((await check({ ...GOOD, hostname: 'caaci.example' })).gate, {});

  // Configured: only the listed hosts, whatever host served the request.
  const fetch = mockFetch(route({ ...GOOD, hostname: 'caaciorg.com' }));
  try {
    const env = fakeEnv({ TURNSTILE_HOSTNAMES: 'caaciorg.com, www.caaciorg.com' });
    assert.deepEqual(await requireHuman(req(), env, 'volunteer', TURNSTILE_TOKEN), {});
    const narrow = fakeEnv({ TURNSTILE_HOSTNAMES: 'caaci-8s2.pages.dev' });
    assert.equal(
      (await requireHuman(req(), narrow, 'volunteer', TURNSTILE_TOKEN)).error.status,
      403,
    );
  } finally {
    fetch.restore();
  }
});

test("turnstile: Cloudflare's own client IP is passed on; a client-supplied one is not", async () => {
  const fetch = mockFetch(route(GOOD));
  try {
    await requireHuman(
      req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' }),
      fakeEnv(),
      'volunteer',
      TURNSTILE_TOKEN,
    );
    const sent = new URLSearchParams(fetch.calls[0].options.body);
    assert.equal(sent.get('remoteip'), '203.0.113.7');
  } finally {
    fetch.restore();
  }
});

test('turnstileToken: reads the field a plain form post would send, and nothing else', () => {
  assert.equal(turnstileToken({ 'cf-turnstile-response': 'abc' }), 'abc');
  assert.equal(turnstileToken({ 'cf-turnstile-response': 42 }), '');
  assert.equal(turnstileToken({ token: 'abc' }), '');
  assert.equal(turnstileToken(undefined), '');
});
