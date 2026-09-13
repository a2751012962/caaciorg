import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPlan, main, maskEmail, planImport, stripeKeyFrom } from '../migrate-members.mjs';
import { fakeEnv, mockFetch } from './helpers.js';

const TIERS = ['free', 'student', 'individual', 'family', 'business', 'honorary'];
const NOW = Date.parse('2026-09-13T00:00:00Z');
const ts = (iso) => Date.parse(iso) / 1000;
const day = (iso) => new Date(Date.parse(iso)).toISOString();
// PostgREST hands timestamptz back as "+00:00", not "Z".
const pg = (iso) => iso && iso.replace('.000Z', '+00:00');
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const FIELDS = [
  'email',
  'tier_id',
  'status',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
  'source',
  'action',
];

const mp = (product) => ({
  memberpress_product: product,
  memberpress_product_id: product === 'Family Membership' ? '3164' : '3156',
  platform: 'MemberPress Connect acct_test',
  site_url: 'https://wp.example',
  transaction_id: '1',
});

const cus = (id, email, name = null) => ({ id, email, name, created: ts('2020-01-01') });

let seq = 0;
function charge({
  product,
  email = null,
  name = null,
  customer = 'cus_1',
  created = '2026-03-01',
  ...over
} = {}) {
  seq += 1;
  const metadata = product ? mp(product) : {};
  return {
    id: `ch_${seq}`,
    status: 'succeeded',
    refunded: false,
    amount: 3000,
    currency: 'usd',
    created: ts(created),
    customer,
    invoice: null,
    receipt_email: null,
    billing_details: { email, name },
    metadata,
    payment_intent: { id: `pi_${seq}`, metadata },
    ...over,
  };
}

function sub({
  product = 'Family Membership',
  customer = cus('cus_1', 'ada@example.com', 'Ada Lee'),
  ...over
} = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer,
    created: ts('2024-05-01'),
    start_date: ts('2024-05-01'),
    current_period_end: ts('2027-05-01'),
    metadata: product ? mp(product) : {},
    items: { data: [{ price: { id: 'plan_R3aheKqNoUbjU0', product: 'prod_fam' } }] },
    ...over,
  };
}

const plan = (input) =>
  planImport({
    subscriptions: [],
    charges: [],
    customers: [],
    users: [],
    members: [],
    tierIds: TIERS,
    now: NOW,
    ...input,
  });
const find = (entries, email) => entries.find((e) => e.email === email);

// --- planImport: who is a member, on what, until when -----------------------

test('a live subscription decides the membership; an extra one-time payment is a warning', () => {
  const ada = cus('cus_1', 'Ada@Example.com', 'Ada   Lee');
  const entries = plan({
    customers: [ada],
    subscriptions: [sub({ customer: ada })],
    charges: [
      charge({ product: 'Family Membership', created: '2026-05-01', invoice: 'in_1' }),
      charge({ product: 'Individual Membership', created: '2026-02-10', amount: 2500 }),
    ],
  });
  assert.equal(entries.length, 1);
  const [e] = entries;
  assert.deepEqual(pick(e, [...FIELDS, 'full_name', 'member_since']), {
    email: 'ada@example.com',
    tier_id: 'family',
    status: 'active',
    expires_at: day('2027-05-01'),
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    source: 'subscription',
    action: 'create',
    full_name: 'Ada Lee',
    member_since: day('2024-05-01'),
  });
  // The renewal invoice's own charge is part of the subscription, not a warning.
  assert.equal(e.warnings.length, 1);
  assert.match(e.warnings[0], /one-time/);
  assert.match(e.warnings[0], /2026-02-10.*25\.00 USD.*Individual Membership/);
});

test('current_period_end is read off the subscription item when the subscription has none', () => {
  const s = sub({ status: 'past_due', current_period_end: undefined });
  s.items.data[0].current_period_end = ts('2027-06-01');
  const [e] = plan({ subscriptions: [s] });
  assert.equal(e.expires_at, day('2027-06-01'));
  assert.equal(e.status, 'past_due');
});

test('a one-time payment runs one calendar year from the charge, active or expired against now', () => {
  const entries = plan({
    charges: [
      charge({
        product: 'Individual Membership',
        customer: 'cus_b',
        email: 'bo@example.com',
        created: '2025-10-01T15:30:00Z',
      }),
      charge({
        product: 'Student Membership',
        customer: null,
        email: 'cy@example.com',
        created: '2025-09-01',
      }),
    ],
  });
  assert.deepEqual(pick(find(entries, 'bo@example.com'), FIELDS), {
    email: 'bo@example.com',
    tier_id: 'individual',
    status: 'active',
    expires_at: '2026-10-01T15:30:00.000Z',
    stripe_customer_id: 'cus_b',
    stripe_subscription_id: null,
    source: 'one-time',
    action: 'create',
  });
  assert.deepEqual(pick(find(entries, 'cy@example.com'), FIELDS), {
    email: 'cy@example.com',
    tier_id: 'student',
    status: 'expired',
    expires_at: day('2026-09-01'),
    stripe_customer_id: null,
    stripe_subscription_id: null,
    source: 'one-time',
    action: 'create',
  });
});

test('a last payment made through an invoice of a subscription that has ended is an ended-subscription', () => {
  const [e] = plan({
    subscriptions: [
      sub({
        id: 'sub_old',
        status: 'canceled',
        product: 'Individual Membership',
        customer: cus('cus_d', 'di@example.com'),
      }),
    ],
    charges: [
      charge({
        product: 'Individual Membership',
        customer: 'cus_d',
        email: 'di@example.com',
        created: '2025-12-01',
        invoice: 'in_9',
      }),
    ],
  });
  assert.deepEqual(pick(e, FIELDS), {
    email: 'di@example.com',
    tier_id: 'individual',
    status: 'active',
    expires_at: day('2026-12-01'),
    stripe_customer_id: 'cus_d',
    stripe_subscription_id: null,
    source: 'ended-subscription',
    action: 'create',
  });
});

test('when the product changed over time the latest payment decides, with a warning', () => {
  const [e] = plan({
    charges: [
      charge({
        product: 'Family Membership',
        customer: 'cus_f',
        email: 'fa@example.com',
        created: '2026-02-01',
      }),
      charge({
        product: 'Individual Membership',
        customer: 'cus_f',
        email: 'fa@example.com',
        created: '2025-01-15',
      }),
    ],
  });
  assert.equal(e.tier_id, 'family');
  assert.equal(e.expires_at, day('2027-02-01'));
  assert.equal(e.member_since, day('2025-01-15'));
  assert.ok(e.warnings.some((w) => /Individual Membership.*Family Membership/.test(w)));
});

test('refunded and failed charges do not count as payments', () => {
  const entries = plan({
    charges: [
      charge({ product: 'Family Membership', email: 'gu@example.com', customer: null }),
      charge({
        product: 'Family Membership',
        email: 'gu@example.com',
        customer: null,
        created: '2026-06-01',
        refunded: true,
      }),
      charge({
        product: 'Family Membership',
        email: 'gu@example.com',
        customer: null,
        created: '2026-07-01',
        status: 'failed',
      }),
      charge({
        product: 'Individual Membership',
        email: 'ho@example.com',
        customer: null,
        refunded: true,
      }),
    ],
  });
  const gu = find(entries, 'gu@example.com');
  assert.equal(gu.expires_at, day('2027-03-01'));
  assert.equal(gu.member_since, day('2026-03-01'));
  assert.equal(find(entries, 'ho@example.com'), undefined);
});

test('someone who only ever donated is skipped', () => {
  const [e] = plan({ charges: [charge({ email: 'dn@example.com', customer: null, amount: 500 })] });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /no MemberPress membership payment/);
});

test('a guest checkout is keyed by its billing or receipt email; no email at all is skipped', () => {
  const entries = plan({
    charges: [
      charge({ product: 'Student Membership', customer: null, email: ' Guest@Example.COM ' }),
      charge({ product: 'Student Membership', customer: null, receipt_email: 'rc@example.com' }),
      charge({ product: 'Family Membership', customer: 'cus_ghost' }),
    ],
  });
  const guest = find(entries, 'guest@example.com');
  assert.equal(guest.action, 'create');
  assert.equal(guest.stripe_customer_id, null);
  assert.equal(find(entries, 'rc@example.com').action, 'create');
  const ghost = entries.find((e) => e.email === null);
  assert.equal(ghost.action, 'skip');
  assert.equal(ghost.stripe_customer_id, 'cus_ghost');
  assert.match(ghost.reason, /no email/);
});

test('one email paying through two Stripe customers is flagged; the latest customer is kept', () => {
  const [e] = plan({
    charges: [
      charge({
        product: 'Individual Membership',
        customer: 'cus_m1',
        email: 'mo@example.com',
        created: '2025-03-01',
      }),
      charge({
        product: 'Individual Membership',
        customer: 'cus_m2',
        email: 'mo@example.com',
        created: '2026-03-01',
      }),
    ],
  });
  assert.equal(e.stripe_customer_id, 'cus_m2');
  assert.ok(e.warnings.some((w) => /2 Stripe customers/.test(w)));
});

test('a typo-looking domain is a warning; a malformed email is skipped', () => {
  const entries = plan({
    charges: [
      charge({ product: 'Individual Membership', customer: null, email: 'ty@gmai.com' }),
      charge({ product: 'Individual Membership', customer: null, email: 'not an email' }),
    ],
  });
  const ty = find(entries, 'ty@gmai.com');
  assert.equal(ty.action, 'create');
  assert.ok(ty.warnings.some((w) => /gmai\.com.*typo/.test(w)));
  const bad = find(entries, 'not an email');
  assert.equal(bad.action, 'skip');
  assert.match(bad.reason, /malformed/);
});

test('a corrected email is the one matched in Supabase; an uncorrected typo still warns', () => {
  const entries = plan({
    emailFixes: new Map([['PA@gmai.com', 'pa@gmail.com']]),
    charges: [
      charge({
        product: 'Family Membership',
        customer: 'cus_pa',
        email: 'pa@gmai.com',
        created: '2026-04-01',
      }),
      charge({ product: 'Individual Membership', customer: null, email: 'qa@gmai.com' }),
    ],
    users: [{ id: 'u-pa', email: 'pa@gmail.com' }],
    members: [member({ id: 'u-pa', tier_id: 'free', status: 'active' })],
  });
  assert.equal(find(entries, 'pa@gmai.com'), undefined);
  const pa = find(entries, 'pa@gmail.com');
  assert.equal(pa.action, 'update');
  assert.equal(pa.user_id, 'u-pa');
  assert.equal(pa.tier_id, 'family');
  assert.ok(pa.warnings.includes('email corrected from p***@gmai.com to p***@gmail.com'));
  assert.ok(!pa.warnings.some((w) => /typo/.test(w)));
  assert.ok(find(entries, 'qa@gmai.com').warnings.some((w) => /typo/.test(w)));
  // A plain object works as well as a Map.
  const again = plan({
    emailFixes: { 'qa@gmai.com': 'qa@gmail.com' },
    charges: [charge({ product: 'Individual Membership', customer: null, email: 'qa@gmai.com' })],
  });
  assert.deepEqual(
    again.map((e) => e.email),
    ['qa@gmail.com'],
  );
});

test('an unknown product, or a tier the database lacks, is skipped', () => {
  const entries = plan({
    tierIds: TIERS.filter((t) => t !== 'business'),
    charges: [
      charge({ product: 'Gold Membership', customer: null, email: 'go@example.com' }),
      charge({ product: 'Business Membership', customer: null, email: 'bz@example.com' }),
    ],
  });
  assert.equal(find(entries, 'go@example.com').action, 'skip');
  assert.match(find(entries, 'go@example.com').reason, /unknown product/);
  assert.equal(find(entries, 'bz@example.com').action, 'skip');
  assert.match(find(entries, 'bz@example.com').reason, /business/);
});

test('two live subscriptions for one email are left for a human', () => {
  const [e] = plan({ subscriptions: [sub({ id: 'sub_a' }), sub({ id: 'sub_b' })] });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /multiple live subscriptions/);
});

// --- planImport against Supabase: create, update, or leave alone ------------

const member = (over = {}) => ({
  id: 'u-1',
  email: 'x@example.com',
  full_name: null,
  phone: null,
  tier_id: null,
  status: 'pending',
  member_since: null,
  expires_at: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  household_id: null,
  notes: null,
  is_admin: false,
  ...over,
});

test('an existing free member is upgraded to the paid tier, keeping the earlier member_since', () => {
  const [e] = plan({
    charges: [
      charge({
        product: 'Individual Membership',
        customer: 'cus_e',
        email: 'eve@example.com',
        created: '2026-04-01',
      }),
    ],
    users: [{ id: 'u-eve', email: 'Eve@Example.com' }],
    members: [
      member({
        id: 'u-eve',
        tier_id: 'free',
        status: 'active',
        member_since: '2023-01-01T00:00:00+00:00',
        phone: '555',
        notes: 'n',
        household_id: 'h1',
        is_admin: true,
      }),
    ],
  });
  assert.equal(e.action, 'update');
  assert.equal(e.user_id, 'u-eve');
  assert.equal(e.tier_id, 'individual');
  assert.equal(e.status, 'active');
  assert.equal(e.member_since, day('2023-01-01'));
  assert.equal(e.expires_at, day('2027-04-01'));
  assert.deepEqual([...e.changes].sort(), ['expires_at', 'stripe_customer_id', 'tier_id']);
  for (const key of ['is_admin', 'household_id', 'phone', 'notes']) assert.equal(key in e, false);
});

test('an update never nulls out a stored stripe_customer_id', () => {
  const [e] = plan({
    charges: [charge({ product: 'Student Membership', customer: null, email: 'ki@example.com' })],
    users: [{ id: 'u-ki', email: 'ki@example.com' }],
    members: [member({ id: 'u-ki', stripe_customer_id: 'cus_old' })],
  });
  assert.equal(e.action, 'update');
  assert.equal(e.stripe_customer_id, 'cus_old');
  assert.deepEqual(
    [...e.changes].sort(),
    ['expires_at', 'member_since', 'status', 'tier_id'].sort(),
  );
});

test('a member already linked to a different subscription is skipped', () => {
  const [e] = plan({
    subscriptions: [sub()],
    users: [{ id: 'u-ada', email: 'ada@example.com' }],
    members: [
      member({
        id: 'u-ada',
        tier_id: 'family',
        status: 'active',
        stripe_subscription_id: 'sub_other',
      }),
    ],
  });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /different subscription/);
});

test('a longer paid membership is never shortened', () => {
  const [e] = plan({
    charges: [
      charge({ product: 'Individual Membership', customer: null, email: 'lo@example.com' }),
    ],
    users: [{ id: 'u-lo', email: 'lo@example.com' }],
    members: [
      member({
        id: 'u-lo',
        tier_id: 'family',
        status: 'active',
        expires_at: '2027-12-01T00:00:00+00:00',
      }),
    ],
  });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /longer membership/);
});

test('an expired MemberPress membership does not replace an account that is active today', () => {
  const [e] = plan({
    charges: [
      charge({
        product: 'Individual Membership',
        customer: null,
        email: 'ex@example.com',
        created: '2024-02-01',
      }),
    ],
    users: [{ id: 'u-ex', email: 'ex@example.com' }],
    members: [member({ id: 'u-ex', tier_id: 'free', status: 'active' })],
  });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /already active/);
});

test('honorary members are left alone', () => {
  const [e] = plan({
    charges: [charge({ product: 'Family Membership', customer: null, email: 'hn@example.com' })],
    users: [{ id: 'u-hn', email: 'hn@example.com' }],
    members: [member({ id: 'u-hn', tier_id: 'honorary', status: 'active' })],
  });
  assert.equal(e.action, 'skip');
  assert.match(e.reason, /honorary/);
});

test('planning again after the import has been applied changes nothing', () => {
  const input = {
    customers: [cus('cus_1', 'ada@example.com', 'Ada Lee')],
    subscriptions: [sub({ customer: 'cus_1' })],
    charges: [
      charge({
        product: 'Individual Membership',
        customer: 'cus_b',
        email: 'bo@example.com',
        created: '2026-01-05',
      }),
      charge({
        product: 'Student Membership',
        customer: null,
        email: 'cy@example.com',
        created: '2025-01-05',
      }),
    ],
  };
  const first = plan(input);
  assert.deepEqual(
    first.map((e) => e.action),
    ['create', 'create', 'create'],
  );
  const users = first.map((e, i) => ({ id: `u${i}`, email: e.email }));
  const members = first.map((e, i) =>
    member({
      id: `u${i}`,
      email: e.email,
      full_name: e.full_name,
      tier_id: e.tier_id,
      status: e.status,
      member_since: pg(e.member_since),
      expires_at: pg(e.expires_at),
      stripe_customer_id: e.stripe_customer_id,
      stripe_subscription_id: e.stripe_subscription_id,
    }),
  );
  assert.deepEqual(
    plan({ ...input, users, members }).map((e) => e.action),
    ['unchanged', 'unchanged', 'unchanged'],
  );
});

// --- applyPlan: service-role writes, never an email --------------------------

const entry = (over = {}) => ({
  email: 'ada@example.com',
  full_name: 'Ada Lee',
  tier_id: 'family',
  status: 'active',
  member_since: '2024-05-01T00:00:00.000Z',
  expires_at: '2027-05-01T00:00:00.000Z',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  source: 'subscription',
  action: 'create',
  reason: '',
  warnings: [],
  user_id: null,
  changes: [],
  ...over,
});

function fakeSupabase({ patchRows = 1, fail } = {}) {
  const calls = [];
  let n = 0;
  const reply = (status, body) => ({
    ok: status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  async function fetch(url, options = {}) {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method, headers: options.headers || {}, body });
    if (fail?.(url, method)) return reply(500, { message: 'boom' });
    if (method === 'POST' && url.endsWith('/auth/v1/admin/users'))
      return reply(200, { id: `user-${++n}`, email: body.email });
    if (method === 'PATCH' && url.includes('/rest/v1/members?'))
      return reply(200, patchRows ? [{ ...body }] : []);
    if (method === 'POST' && url.endsWith('/rest/v1/members')) return reply(201, [{ ...body }]);
    return reply(404, { message: 'unexpected request' });
  }
  return { fetch, calls };
}
const OPTS = { supabaseUrl: 'https://db.example', serviceKey: 'service-key', log: () => {} };
const MEMBERSHIP = [
  'full_name',
  'email',
  'tier_id',
  'status',
  'member_since',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
];

test('create makes a confirmed auth user tagged as imported, then fills its members row', async () => {
  const sbx = fakeSupabase();
  const result = await applyPlan([entry()], { ...OPTS, fetch: sbx.fetch });
  assert.equal(result.failed, null);
  assert.deepEqual(result.done, [
    { email: 'ada@example.com', action: 'create', user_id: 'user-1' },
  ]);
  assert.equal(sbx.calls.length, 2);
  const [create, patch] = sbx.calls;
  assert.equal(create.method, 'POST');
  assert.equal(create.url, 'https://db.example/auth/v1/admin/users');
  assert.deepEqual(create.body, {
    email: 'ada@example.com',
    email_confirm: true,
    user_metadata: { full_name: 'Ada Lee', imported_from: 'memberpress' },
  });
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.url, 'https://db.example/rest/v1/members?id=eq.user-1');
  assert.equal(patch.headers.apikey, 'service-key');
  assert.equal(patch.headers.authorization, 'Bearer service-key');
  assert.equal(patch.headers.prefer, 'return=representation');
  assert.deepEqual(patch.body, pick(entry(), MEMBERSHIP));
});

test('create inserts the members row when the signup trigger did not', async () => {
  const sbx = fakeSupabase({ patchRows: 0 });
  const result = await applyPlan([entry({ user_id: 'u-existing' })], {
    ...OPTS,
    fetch: sbx.fetch,
  });
  assert.equal(result.failed, null);
  assert.deepEqual(
    sbx.calls.map((c) => `${c.method} ${c.url}`),
    [
      'PATCH https://db.example/rest/v1/members?id=eq.u-existing',
      'POST https://db.example/rest/v1/members',
    ],
  );
  assert.deepEqual(sbx.calls[1].body, { id: 'u-existing', ...pick(entry(), MEMBERSHIP) });
});

test('update patches only the fields that changed', async () => {
  const sbx = fakeSupabase();
  const result = await applyPlan(
    [entry({ action: 'update', user_id: 'u-eve', changes: ['tier_id', 'expires_at'] })],
    { ...OPTS, fetch: sbx.fetch },
  );
  assert.equal(result.failed, null);
  assert.equal(sbx.calls.length, 1);
  assert.equal(sbx.calls[0].url, 'https://db.example/rest/v1/members?id=eq.u-eve');
  assert.deepEqual(sbx.calls[0].body, {
    tier_id: 'family',
    expires_at: '2027-05-01T00:00:00.000Z',
  });
});

test('applying never calls an auth endpoint that sends mail, and skips write nothing', async () => {
  const sbx = fakeSupabase();
  await applyPlan(
    [
      entry(),
      entry({ email: 'b@example.com', action: 'update', user_id: 'u-b', changes: ['status'] }),
      entry({ email: 'c@example.com', action: 'skip' }),
      entry({ email: 'd@example.com', action: 'unchanged', user_id: 'u-d' }),
    ],
    { ...OPTS, fetch: sbx.fetch },
  );
  assert.equal(sbx.calls.length, 3);
  for (const c of sbx.calls) assert.doesNotMatch(c.url, /\/(invite|recover|otp|magiclink)\b/);
  const source = await readFile(new URL('../migrate-members.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auth\/v1\/(invite|recover|otp|magiclink)/);
});

test('applying stops at the first error and reports what was already done', async () => {
  const sbx = fakeSupabase({ fail: (url) => url.includes('u-b') });
  const update = (email, id) =>
    entry({ email, action: 'update', user_id: id, changes: ['status'] });
  const result = await applyPlan(
    [
      update('a@example.com', 'u-a'),
      update('b@example.com', 'u-b'),
      update('c@example.com', 'u-c'),
    ],
    { ...OPTS, fetch: sbx.fetch },
  );
  assert.deepEqual(result.done, [{ email: 'a@example.com', action: 'update', user_id: 'u-a' }]);
  assert.equal(result.failed.email, 'b@example.com');
  assert.match(result.failed.message, /500/);
  assert.equal(sbx.calls.length, 2);
  assert.ok(sbx.calls.every((c) => !c.url.includes('u-c')));
});

// --- CLI ---------------------------------------------------------------------

test('maskEmail keeps the first letter and the domain only', () => {
  assert.equal(maskEmail('ada@example.com'), 'a***@example.com');
  assert.equal(maskEmail(null), '(no email)');
});

test('stripeKeyFrom finds a live or test key in an env file or a bare key', () => {
  assert.equal(stripeKeyFrom('# prod\nSTRIPE_SECRET_KEY=sk_live_Abc123\n'), 'sk_live_Abc123');
  assert.equal(stripeKeyFrom('rk_test_XYZ9\n'), 'rk_test_XYZ9');
  assert.equal(stripeKeyFrom('nothing here'), null);
});

function quiet(fn) {
  const lines = [];
  const { log, warn, error } = console;
  const capture =
    (kind) =>
    (...args) =>
      lines.push(`${kind}: ${args.join(' ')}`);
  console.log = capture('log');
  console.warn = capture('warn');
  console.error = capture('err');
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, lines }))
    .finally(() => {
      Object.assign(console, { log, warn, error });
    });
}

const ADA = cus('cus_1', 'ada@example.com', 'Ada Lee');
const WORLD = {
  customers: [ADA],
  subs: [sub({ customer: ADA })],
  charges: [
    charge({ product: 'Individual Membership', customer: 'cus_b', email: 'bo@example.com' }),
    charge({ customer: null, email: 'dn@example.com', amount: 500 }),
  ],
};

// Stripe + Supabase stand-in for main(). Writes land in `stored` so the
// post-apply verification reads back what was written.
function world({ subs = [], charges = [], customers = [] } = {}) {
  const users = [];
  const stored = new Map();
  let n = 0;
  return (url, options = {}) => {
    const method = options.method || 'GET';
    const u = new URL(url);
    if (u.host === 'api.stripe.com') {
      if (u.pathname === '/v1/account') return { body: { id: 'acct_caaci' } };
      const lists = {
        '/v1/subscriptions': subs,
        '/v1/charges': charges,
        '/v1/customers': customers,
        '/v1/products': [],
      };
      if (method === 'GET' && lists[u.pathname])
        return { body: { data: lists[u.pathname], has_more: false } };
      return { status: 404, body: { error: { message: 'no route' } } };
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'GET') return { body: { users } };
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      const id = `user-${++n}`;
      const { email } = JSON.parse(options.body);
      users.push({ id, email });
      stored.set(id, member({ id, email }));
      return { body: { id } };
    }
    if (u.pathname === '/rest/v1/membership_tiers') return { body: TIERS.map((id) => ({ id })) };
    if (u.pathname === '/rest/v1/members' && method === 'GET') {
      const only = u.searchParams.get('id');
      const ids = only ? only.slice('in.('.length, -1).split(',') : null;
      return { body: [...stored.values()].filter((r) => !ids || ids.includes(r.id)) };
    }
    if (u.pathname === '/rest/v1/members' && method === 'PATCH') {
      const row = stored.get(u.searchParams.get('id').slice('eq.'.length));
      if (!row) return { body: [] };
      Object.assign(row, JSON.parse(options.body));
      return { body: [row] };
    }
    return { status: 404, body: { message: 'no route' } };
  };
}

test('the dry run only reads, and prints no email address or name', async () => {
  const stub = mockFetch(world(WORLD));
  try {
    const { value, lines } = await quiet(() => main([], fakeEnv()));
    const out = lines.join('\n');
    assert.equal(value, 0, out);
    assert.ok(stub.calls.length > 0);
    assert.deepEqual(
      stub.calls.filter((c) => (c.options.method || 'GET') !== 'GET').map((c) => c.url),
      [],
    );
    assert.match(out, /acct_caaci.*TEST/);
    assert.match(out, /a\*\*\*@example\.com/);
    assert.doesNotMatch(out, /[\w.+-]@/);
    assert.doesNotMatch(out, /Ada Lee/);
    assert.match(out, /dry run — nothing written\. Re-run with --apply/);
  } finally {
    stub.restore();
  }
});

test('--only restricts the plan, and --report writes it in full', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-members-'));
  const report = join(dir, 'migrate-report.json');
  const stub = mockFetch(world(WORLD));
  try {
    const { value, lines } = await quiet(() =>
      main(['--only=BO@example.com', `--report=${report}`], fakeEnv()),
    );
    const out = lines.join('\n');
    assert.equal(value, 0, out);
    assert.match(out, /b\*\*\*@example\.com/);
    assert.doesNotMatch(out, /a\*\*\*@example\.com/);
    const written = JSON.parse(await readFile(report, 'utf8'));
    assert.deepEqual(
      written.map((e) => e.email),
      ['bo@example.com'],
    );
  } finally {
    stub.restore();
  }
});

test('--stripe-env takes the key from a file over the environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-members-'));
  const file = join(dir, 'stripe-live.env');
  await writeFile(file, '# live\nSTRIPE_SECRET_KEY=sk_live_Abc123\n');
  const stub = mockFetch(world(WORLD));
  try {
    const { value, lines } = await quiet(() => main([`--stripe-env=${file}`], fakeEnv()));
    assert.equal(value, 0, lines.join('\n'));
    assert.match(lines.join('\n'), /LIVE/);
    const stripeCalls = stub.calls.filter((c) => c.url.startsWith('https://api.stripe.com/'));
    assert.ok(stripeCalls.length > 0);
    for (const c of stripeCalls)
      assert.equal(c.options.headers.authorization, 'Bearer sk_live_Abc123');
  } finally {
    stub.restore();
  }
});

test('--apply writes the plan and verifies the members rows it wrote', async () => {
  const stub = mockFetch(world(WORLD));
  try {
    const { value, lines } = await quiet(() =>
      main(['--apply', '--only=bo@example.com'], fakeEnv()),
    );
    const out = lines.join('\n');
    assert.equal(value, 0, out);
    assert.deepEqual(
      stub.calls
        .filter((c) => (c.options.method || 'GET') !== 'GET')
        .map((c) => `${c.options.method} ${new URL(c.url).pathname}`),
      ['POST /auth/v1/admin/users', 'PATCH /rest/v1/members'],
    );
    assert.match(out, /Verified 1\/1/);
    assert.doesNotMatch(out, /[\w.+-]@/);
  } finally {
    stub.restore();
  }
});

test('--fix-email imports under the corrected address, and the output masks both', async () => {
  const stub = mockFetch(
    world({
      charges: [
        charge({ product: 'Individual Membership', customer: 'cus_b', email: 'bo@exampel.com' }),
      ],
    }),
  );
  try {
    const { value, lines } = await quiet(() =>
      main(['--fix-email=bo@exampel.com=bo@example.com'], fakeEnv()),
    );
    const out = lines.join('\n');
    assert.equal(value, 0, out);
    assert.match(out, /b\*\*\*@exampel\.com/);
    assert.match(out, /b\*\*\*@example\.com/);
    assert.doesNotMatch(out, /[\w.+-]@/);
  } finally {
    stub.restore();
  }
});

test('a malformed --fix-email exits 1 before any request', async () => {
  const stub = mockFetch(world(WORLD));
  try {
    for (const arg of [
      '--fix-email=pa@gmai.com',
      '--fix-email=pa@gmai.com=not-an-email',
      '--fix-email==pa@gmail.com',
    ]) {
      const { value, lines } = await quiet(() => main([arg], fakeEnv()));
      assert.equal(value, 1, arg);
      assert.doesNotMatch(lines.join('\n'), /[\w.+-]@/);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('reading Supabase pages past a short page, so a lower server page cap loses nobody', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-members-'));
  const report = join(dir, 'migrate-report.json');
  const base = world(WORLD);
  // A server that returns one row per page, whatever per_page or limit asks for.
  const users = [
    { id: 'u-ada', email: 'ada@example.com' },
    { id: 'u-bo', email: 'bo@example.com' },
  ];
  const rows = users.map((u) => member({ id: u.id, email: u.email }));
  const stub = mockFetch((url, options = {}) => {
    const u = new URL(url);
    const get = (options.method || 'GET') === 'GET';
    if (get && u.pathname === '/auth/v1/admin/users') {
      const page = Number(u.searchParams.get('page'));
      return { body: { users: users.slice(page - 1, page) } };
    }
    if (get && u.pathname === '/rest/v1/members') {
      const offset = Number(u.searchParams.get('offset') || 0);
      return { body: rows.slice(offset, offset + 1) };
    }
    return base(url, options);
  });
  try {
    const { value, lines } = await quiet(() => main([`--report=${report}`], fakeEnv()));
    assert.equal(value, 0, lines.join('\n'));
    const written = JSON.parse(await readFile(report, 'utf8'));
    assert.deepEqual(
      written.filter((e) => e.email !== 'dn@example.com').map((e) => [e.email, e.action]),
      [
        ['ada@example.com', 'update'],
        ['bo@example.com', 'update'],
      ],
    );
  } finally {
    stub.restore();
  }
});

test('main refuses an unknown option or missing Supabase credentials before any request', async () => {
  const stub = mockFetch(world(WORLD));
  try {
    assert.equal((await quiet(() => main(['--aply'], fakeEnv()))).value, 1);
    assert.equal(
      (await quiet(() => main([], fakeEnv({ SUPABASE_SERVICE_ROLE_KEY: '' })))).value,
      1,
    );
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
