import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/admin/tiers.js';
import { codeFor, currentSlot } from '../functions/api/admin/_action-code.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const TIERS = {
  free: { id: 'free', name: 'Free Membership', price_cents: 0, invite_only: false },
  honorary: { id: 'honorary', name: 'Honorable Membership', price_cents: 0, invite_only: true },
  family: { id: 'family', name: 'Family Membership', price_cents: 6000, invite_only: false },
};

const yearly = (id, cents, extra = {}) => ({
  id,
  object: 'price',
  unit_amount: cents,
  currency: 'usd',
  active: true,
  recurring: { interval: 'year' },
  product: 'prod_family',
  ...extra,
});

// Supabase admin gate + membership_tiers, and a Stripe account where the family
// tier's lookup_key sits on `current` (a catalogue Price at $62.10 by default).
function route({
  current = yearly('price_old', 6210, { metadata: { source: 'stripe-catalog.mjs' } }),
  stripeFails = false,
} = {}) {
  return (u, options = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/membership_tiers') && options.method === 'PATCH') return { body: [] };
    if (u.includes('/rest/v1/membership_tiers')) {
      const id = u.match(/id=eq\.(\w+)/)?.[1];
      return { body: id ? (TIERS[id] ? [TIERS[id]] : []) : Object.values(TIERS) };
    }
    if (u.startsWith('https://api.stripe.com/')) {
      if (stripeFails && options.method === 'POST')
        return { status: 400, body: { error: { message: 'No such product' } } };
      if (u.includes('/prices?active=true&lookup_keys'))
        return { body: { data: current ? [current] : [] } };
      if (u.includes('/products?active=true'))
        return {
          body: {
            data: [{ id: 'prod_family', name: 'Family Membership', active: true, metadata: {} }],
          },
        };
      if (u.includes('/prices?product=prod_family'))
        return { body: { data: current ? [current] : [] } };
      if (u.endsWith('/v1/prices') && options.method === 'POST')
        return { body: { id: 'price_new' } };
      return { body: {} };
    }
    return { body: [] };
  };
}

const authed = (body) => fakeRequest({ headers: { authorization: 'Bearer tok' }, body });
const stripePosts = (fetch) =>
  fetch.calls
    .filter((c) => c.url.startsWith('https://api.stripe.com/') && c.options.method === 'POST')
    .map((c) => ({
      path: c.url.replace('https://api.stripe.com/v1/', ''),
      body: Object.fromEntries(new URLSearchParams(c.options.body)),
    }));
const tierPatch = (fetch) =>
  fetch.calls.find(
    (c) => c.url.includes('/rest/v1/membership_tiers') && c.options.method === 'PATCH',
  );

// Price changes carry the emailed admin code unless a test says otherwise.
async function post(body, opts = {}) {
  const fetch = mockFetch(route(opts));
  try {
    const code = opts.noCode
      ? {}
      : { 'x-admin-code': await codeFor(fakeEnv(), 'admin-1', currentSlot()) };
    const request = fakeRequest({ headers: { authorization: 'Bearer tok', ...code }, body });
    const r = await onRequestPost({ request, env: fakeEnv() });
    return { r, data: await r.json(), fetch };
  } finally {
    fetch.restore();
  }
}

test('admin tiers: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin tiers: lists every tier', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: authed(), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rows.length, 3);
  } finally {
    fetch.restore();
  }
});

test('admin tiers: copy edit trims text, drops blank lines, never touches Stripe', async () => {
  const { r, fetch } = await post({
    id: 'family',
    description: '  Covers your household. ',
    description_zh: '',
    features: [' Up to 3 people ', '', '  '],
    features_zh: ['最多 3 人'],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(tierPatch(fetch).options.body), {
    description: 'Covers your household.',
    description_zh: null,
    features: ['Up to 3 people'],
    features_zh: ['最多 3 人'],
  });
  assert.equal(fetch.calls.filter((c) => c.url.startsWith('https://api.stripe.com/')).length, 0);
});

test('admin tiers: too many benefit lines is refused', async () => {
  const { r, fetch } = await post({ id: 'family', features: Array(13).fill('x') });
  assert.equal(r.status, 400);
  assert.equal(tierPatch(fetch), undefined);
});

test('admin tiers: new price moves the lookup_key to a new Stripe Price, then saves', async () => {
  const { r, data, fetch } = await post({ id: 'family', price_cents: 8000 });
  assert.equal(r.status, 200);
  assert.equal(data.stripe.action, 'reprice');
  const posts = stripePosts(fetch);
  assert.equal(posts[0].path, 'prices');
  assert.equal(posts[0].body.unit_amount, '8280'); // $80 + 3.5% card fee
  assert.equal(posts[0].body.product, 'prod_family');
  assert.equal(posts[0].body.lookup_key, 'caaci_family_year');
  assert.equal(posts[0].body.transfer_lookup_key, 'true');
  assert.equal(posts[0].body['recurring[interval]'], 'year');
  // the old catalogue Price is archived (subscriptions on it keep billing)
  assert.deepEqual(posts[1], { path: 'prices/price_old', body: { active: 'false' } });
  // Stripe first, database second
  const patchAt = fetch.calls.indexOf(tierPatch(fetch));
  const lastStripeAt = fetch.calls.findLastIndex((c) =>
    c.url.startsWith('https://api.stripe.com/'),
  );
  assert.ok(patchAt > lastStripeAt);
  assert.deepEqual(JSON.parse(tierPatch(fetch).options.body), { price_cents: 8000 });
});

test('admin tiers: a price change needs the emailed code; a copy edit does not', async () => {
  const priced = await post({ id: 'family', price_cents: 8000 }, { noCode: true });
  assert.equal(priced.r.status, 428);
  assert.equal(tierPatch(priced.fetch), undefined);
  assert.equal(stripePosts(priced.fetch).length, 0);
  const copy = await post({ id: 'family', features: ['a'] }, { noCode: true });
  assert.equal(copy.r.status, 200);
});

test('admin tiers: a MemberPress Price holding the key is left active', async () => {
  const { r, fetch } = await post(
    { id: 'family', price_cents: 8000 },
    { current: yearly('price_mp', 6210, { metadata: {} }) },
  );
  assert.equal(r.status, 200);
  assert.equal(
    stripePosts(fetch).some((p) => p.path === 'prices/price_mp'),
    false,
  );
});

test('admin tiers: Stripe refusing the price does not save it', async () => {
  const { r, data, fetch } = await post({ id: 'family', price_cents: 8000 }, { stripeFails: true });
  assert.equal(r.status, 502);
  assert.match(data.error, /not saved/);
  assert.equal(tierPatch(fetch), undefined);
});

test('admin tiers: same price is not a price change', async () => {
  const { r, fetch } = await post({ id: 'family', price_cents: 6000, features: ['a'] });
  assert.equal(r.status, 200);
  assert.equal(fetch.calls.filter((c) => c.url.startsWith('https://api.stripe.com/')).length, 0);
  assert.deepEqual(JSON.parse(tierPatch(fetch).options.body), { features: ['a'] });
});

test('admin tiers: $0 plans stay $0 and paid plans stay paid', async () => {
  for (const [id, cents] of [
    ['free', 1000],
    ['honorary', 1000],
    ['family', 0],
    ['family', 50],
    ['family', 12.5],
  ]) {
    const { r, fetch } = await post({ id, price_cents: cents });
    assert.equal(r.status, 400, `${id} → ${cents}`);
    assert.equal(tierPatch(fetch), undefined);
  }
});

test('admin tiers: unknown plan and empty edits are refused', async () => {
  assert.equal((await post({ id: 'nope', features: ['a'] })).r.status, 404);
  assert.equal((await post({ id: 'family' })).r.status, 400);
  assert.equal((await post({ features: ['a'] })).r.status, 400);
});

test('admin tiers: without a Stripe key prices are locked', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: authed({ id: 'family', price_cents: 8000 }),
      env: fakeEnv({ STRIPE_SECRET_KEY: '' }),
    });
    assert.equal(r.status, 503);
    assert.equal(tierPatch(fetch), undefined);
  } finally {
    fetch.restore();
  }
});
