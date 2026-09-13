import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planTier,
  lookupKey,
  chargeCents,
  candidateProducts,
  pickProduct,
  main as catalog,
} from '../stripe-catalog.mjs';
import { tierPrice, tierLookupKey, stripe } from '../functions/api/_lib.js';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestPost as changePlan } from '../functions/api/change-plan.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const tier = { id: 'individual', name: 'Individual Membership', price_cents: 3000 };

test('catalog and runtime agree on the lookup_key and the fee-inclusive charge', () => {
  assert.equal(lookupKey('family'), tierLookupKey('family'));
  assert.equal(chargeCents(3000), 3105);
});

test('planTier: create when missing, ok when matching, reprice on drift', () => {
  assert.equal(planTier(tier, null).action, 'create');
  const price = { unit_amount: 3105, currency: 'usd', recurring: { interval: 'year' } };
  assert.equal(planTier(tier, price).action, 'ok');
  assert.deepEqual(planTier(tier, { ...price, unit_amount: 3000 }), {
    action: 'reprice',
    want: 3105,
    from: 3000,
    product: null,
  });
  assert.equal(planTier(tier, { ...price, recurring: { interval: 'month' } }).action, 'reprice');
});

const yearly = (id, cents, extra = {}) => ({
  id,
  unit_amount: cents,
  currency: 'usd',
  active: true,
  recurring: { interval: 'year', interval_count: 1 },
  ...extra,
});

test('planTier: $0 tiers get no Stripe price', () => {
  assert.equal(planTier({ ...tier, id: 'free', price_cents: 0 }, null).action, 'skip');
});

test('planTier: takes over an existing yearly Price of the right amount instead of creating one', () => {
  const prices = [yearly('plan_old', 3000, { active: false }), yearly('plan_cur', 3105)];
  assert.deepEqual(planTier(tier, null, { product: { id: 'prod_ind' }, prices }), {
    action: 'reuse',
    want: 3105,
    price: 'plan_cur',
    reactivate: false,
    product: 'prod_ind',
  });
});

test('planTier: re-activates an archived Price only if this script created it, and prefers an active one', () => {
  const ours = yearly('price_ours', 3105, { active: false, metadata: { base_cents: 3000 } });
  assert.equal(planTier(tier, null, { prices: [ours] }).reactivate, true);
  assert.equal(
    planTier(tier, null, { prices: [ours, yearly('plan_live', 3105)] }).price,
    'plan_live',
  );
  // An archived MemberPress plan is never revived — a new Price is created instead.
  const legacy = yearly('plan_arch', 3105, { active: false });
  assert.equal(planTier(tier, null, { prices: [legacy] }).action, 'create');
});

test('planTier: monthly or wrong-amount Prices are not reused — a Price goes on the existing Product', () => {
  const prices = [
    yearly('price_monthly', 3105, { recurring: { interval: 'month' } }),
    yearly('plan_legacy', 3000),
  ];
  assert.deepEqual(planTier(tier, null, { product: { id: 'prod_ind' }, prices }), {
    action: 'create',
    want: 3105,
    product: 'prod_ind',
  });
});

test('candidateProducts / pickProduct: tier_id tag wins, else same name; matching Price, then oldest', () => {
  const products = [
    { id: 'prod_b', name: 'individual membership ', active: true, created: 2 },
    { id: 'prod_a', name: 'Individual Membership', active: true, created: 1 },
    { id: 'prod_off', name: 'Individual Membership', active: false, created: 0 },
    { id: 'prod_don', name: 'Donate $25', active: true, created: 0 },
  ];
  const named = candidateProducts(tier, products);
  assert.deepEqual(
    named.map((p) => p.id),
    ['prod_b', 'prod_a'],
  );
  assert.equal(pickProduct(named, {}, 3105).id, 'prod_a');
  assert.equal(pickProduct(named, { prod_b: [yearly('p', 3105)] }, 3105).id, 'prod_b');
  const tagged = [
    ...products,
    { id: 'prod_t', name: 'x', active: true, metadata: { tier_id: 'individual' } },
  ];
  assert.deepEqual(
    candidateProducts(tier, tagged).map((p) => p.id),
    ['prod_t'],
  );
  assert.equal(pickProduct([], {}, 3105), null);
});

// A live-shaped account: MemberPress Family + Individual products, no Student.
function liveAccount({ failTag = false, lookup = [] } = {}) {
  let n = 0;
  return mockFetch((url, options = {}) => {
    const post = options.method === 'POST';
    if (url.includes('/rest/v1/membership_tiers'))
      return {
        body: [
          { id: 'free', name: 'Free Membership', price_cents: 0, active: true },
          { id: 'student', name: 'Student Membership', price_cents: 1000, active: true },
          { id: 'individual', name: 'Individual Membership', price_cents: 3000, active: true },
          { id: 'family', name: 'Family Membership', price_cents: 6000, active: true },
        ],
      };
    if (url.includes('lookup_keys')) return { body: { data: lookup } };
    if (url.includes('/v1/products?'))
      return {
        body: {
          data: [
            { id: 'prod_fam', name: 'Family Membership', active: true, created: 1 },
            { id: 'prod_ind', name: 'Individual Membership', active: true, created: 2 },
          ],
        },
      };
    if (url.includes('/v1/prices?product=prod_ind'))
      return {
        body: {
          data: [
            yearly('plan_ind', 3105),
            yearly('price_ind_m', 3105, { recurring: { interval: 'month' } }),
            yearly('plan_30', 3000, { active: false }),
          ],
        },
      };
    if (url.includes('/v1/prices?product=prod_fam'))
      return {
        body: {
          data: [
            yearly('plan_60', 6000),
            yearly('price_fam_m', 6210, { recurring: { interval: 'month' } }),
          ],
        },
      };
    if (post && url.endsWith('/v1/prices/plan_ind'))
      return failTag
        ? { status: 400, body: { error: { message: 'nope' } } }
        : { body: { id: 'plan_ind' } };
    if (post && url.endsWith('/v1/products')) return { body: { id: 'prod_new' } };
    if (post && url.endsWith('/v1/prices')) return { body: { id: `price_new_${++n}` } };
    if (post && /\/v1\/prices\/price_(cat|mp)_old$/.test(url)) return { body: {} };
    return { status: 500, body: { error: { message: `unexpected ${options.method} ${url}` } } };
  });
}

const posts = (fetch) =>
  fetch.calls
    .filter((c) => c.options.method === 'POST')
    .map((c) => ({
      path: c.url.replace('https://api.stripe.com/v1/', ''),
      body: Object.fromEntries(new URLSearchParams(c.options.body)),
    }));

async function runCatalog(fetch) {
  const log = console.log;
  console.log = () => {};
  try {
    return await catalog(['--apply'], fakeEnv({ STRIPE_SECRET_KEY: 'sk_live_x' }));
  } finally {
    console.log = log;
    fetch.restore();
  }
}

test('catalog --apply: reuses the legacy products and prices, creates only what is missing', async () => {
  const fetch = liveAccount();
  assert.equal(await runCatalog(fetch), 0);
  const writes = posts(fetch);

  // Individual: the existing $31.05/yr plan is tagged, nothing is created for it.
  const tag = writes.find((w) => w.path === 'prices/plan_ind');
  assert.equal(tag.body.lookup_key, 'caaci_individual_year');
  assert.equal(tag.body.transfer_lookup_key, 'true');
  assert.equal(tag.body.active, undefined);

  const created = writes.filter((w) => w.path === 'prices');
  // Family: one new $62.10/yr Price on the existing MemberPress product.
  const fam = created.find((w) => w.body.lookup_key === 'caaci_family_year');
  assert.equal(fam.body.product, 'prod_fam');
  assert.equal(fam.body.unit_amount, '6210');
  assert.equal(fam.body['recurring[interval]'], 'year');
  // Student: no legacy product, so exactly one Product is created for it.
  const stu = created.find((w) => w.body.lookup_key === 'caaci_student_year');
  assert.equal(stu.body.product, 'prod_new');
  assert.equal(stu.body.unit_amount, '1035');
  const newProducts = writes.filter((w) => w.path === 'products');
  assert.deepEqual(
    newProducts.map((w) => w.body.name),
    ['Student Membership'],
  );

  // Legacy prices subscribers are billed on are never touched; free gets nothing.
  assert.equal(created.length, 2);
  assert.ok(!writes.some((w) => /plan_60|plan_30|price_fam_m|price_ind_m/.test(w.path)));
  assert.ok(!fetch.calls.some((c) => c.url.includes('caaci_free_year')));
});

test('catalog --apply: a refused tag creates nothing for that tier and exits 1', async () => {
  const fetch = liveAccount({ failTag: true });
  assert.equal(await runCatalog(fetch), 1);
  const writes = posts(fetch);
  assert.ok(
    !writes.some((w) => w.path === 'prices' && w.body.lookup_key === 'caaci_individual_year'),
  );
  // The other tiers still go through.
  assert.ok(writes.some((w) => w.path === 'prices' && w.body.lookup_key === 'caaci_family_year'));
  assert.ok(writes.some((w) => w.path === 'prices' && w.body.lookup_key === 'caaci_student_year'));
});

test('catalog --apply: a re-run after a successful apply writes nothing', async () => {
  const tagged = (id, key, cents) => ({ ...yearly(id, cents), lookup_key: key });
  const fetch = liveAccount({
    lookup: [
      tagged('plan_ind', 'caaci_individual_year', 3105),
      tagged('price_new_1', 'caaci_family_year', 6210),
      tagged('price_new_2', 'caaci_student_year', 1035),
    ],
  });
  assert.equal(await runCatalog(fetch), 0);
  assert.deepEqual(posts(fetch), []);
});

test('catalog --apply: on a price change, archives the old Price only if this script created it', async () => {
  const old = (id, key, metadata) => ({
    ...yearly(id, 2900),
    lookup_key: key,
    product: 'prod_x',
    ...(metadata ? { metadata } : {}),
  });
  const fetch = liveAccount({
    lookup: [
      old('price_cat_old', 'caaci_student_year', { base_cents: 2800 }),
      old('price_mp_old', 'caaci_family_year'),
    ],
  });
  assert.equal(await runCatalog(fetch), 0);
  const writes = posts(fetch);
  assert.deepEqual(
    writes.find((w) => w.path === 'prices/price_cat_old'),
    { path: 'prices/price_cat_old', body: { active: 'false' } },
  );
  assert.ok(!writes.some((w) => w.path === 'prices/price_mp_old'));
});

test('tierPrice: resolves the catalogue Price by lookup_key', async () => {
  const fetch = mockFetch((url) =>
    url.includes('lookup_keys') ? { body: { data: [{ id: 'price_cat' }] } } : {},
  );
  try {
    assert.deepEqual(await tierPrice(stripe(fakeEnv()), tier), { price: 'price_cat' });
    assert.match(fetch.calls[0].url, /lookup_keys\[\]=caaci_individual_year/);
  } finally {
    fetch.restore();
  }
});

test('tierPrice: falls back to inline price_data when the catalogue is empty', async () => {
  const fetch = mockFetch(() => ({ body: { data: [] } }));
  try {
    const r = await tierPrice(stripe(fakeEnv()), tier);
    assert.equal(r.price, undefined);
    assert.equal(r.price_data.unit_amount, 3105);
    assert.equal(r.price_data.product_data.name, 'Individual Membership');
  } finally {
    fetch.restore();
  }
});

test('tierPrice: a failing lookup does not break checkout', async () => {
  const fetch = mockFetch((url) => (url.includes('lookup_keys') ? { status: 500 } : {}));
  try {
    assert.ok((await tierPrice(stripe(fakeEnv()), tier)).price_data);
  } finally {
    fetch.restore();
  }
});

test('checkout: membership session uses the catalogue Price when present', async () => {
  const fetch = mockFetch((url) => {
    if (url.includes('lookup_keys')) return { body: { data: [{ id: 'price_cat' }] } };
    if (url.includes('checkout/sessions')) return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
    if (url.includes('membership_tiers')) return { body: [tier] };
    return { body: [] };
  });
  try {
    const r = await checkout({
      request: fakeRequest({ body: { tier_id: 'individual', member_id: 'u1' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const session = fetch.calls.find((c) => c.url.includes('checkout/sessions'));
    const params = new URLSearchParams(session.options.body);
    assert.equal(params.get('line_items[0][price]'), 'price_cat');
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), null);
  } finally {
    fetch.restore();
  }
});

test('change-plan: swaps the subscription item onto the catalogue Price without minting one', async () => {
  const fetch = mockFetch((url, options = {}) => {
    if (url.includes('lookup_keys')) return { body: { data: [{ id: 'price_cat' }] } };
    if (url.includes('/rest/v1/membership_tiers')) return { body: [tier] };
    if (url.includes('/rest/v1/members'))
      return options.method === 'PATCH'
        ? { body: [] }
        : { body: [{ id: 'u1', tier_id: 'student', stripe_subscription_id: 'sub_1' }] };
    if (url.includes('/subscriptions/sub_1') && !options.method)
      return { body: { id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1' }] } } };
    if (url.includes('/subscriptions/sub_1')) return { body: { id: 'sub_1' } };
    return {};
  });
  try {
    const r = await changePlan({
      request: fakeRequest({ body: { member_id: 'u1', tier_id: 'individual' } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal(
      fetch.calls.find((c) => c.url.endsWith('/v1/prices') && c.options.method === 'POST'),
      undefined,
    );
    const swap = fetch.calls.find(
      (c) => c.url.includes('/subscriptions/sub_1') && c.options.method === 'POST',
    );
    assert.equal(new URLSearchParams(swap.options.body).get('items[0][price]'), 'price_cat');
  } finally {
    fetch.restore();
  }
});
