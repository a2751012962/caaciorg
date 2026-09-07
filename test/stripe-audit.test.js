import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { groupByPrice, isLive, keyMode, listAll, money, subscribersCsv } from '../stripe-audit.mjs';

const sub = (over = {}) => ({
  id: 'sub_1',
  status: 'active',
  created: 1700000000,
  cancel_at_period_end: false,
  current_period_end: 1800000000,
  customer: { id: 'cus_1', email: 'a@example.com', name: 'Ada' },
  items: {
    data: [
      {
        price: {
          id: 'price_ind',
          unit_amount: 3000,
          currency: 'usd',
          recurring: { interval: 'year' },
          product: 'prod_ind',
        },
      },
    ],
  },
  ...over,
});

test('the audit script never writes: no POST/DELETE anywhere in it', async () => {
  const source = await readFile(new URL('../stripe-audit.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'POST'|"POST"|'DELETE'|"DELETE"/);
  assert.match(source, /method: 'GET'/);
});

test('money formats cents and tolerates a missing amount', () => {
  assert.equal(money(3000), '30.00 USD');
  assert.equal(money(null), '—');
});

test('keyMode reads live/test off the key prefix', () => {
  assert.equal(keyMode('sk_live_abc'), 'live');
  assert.equal(keyMode('sk_test_abc'), 'test');
});

test('isLive counts the statuses that are still billing', () => {
  assert.deepEqual(
    ['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete_expired'].filter((s) =>
      isLive({ status: s }),
    ),
    ['active', 'trialing', 'past_due', 'unpaid'],
  );
});

test('listAll follows has_more until the last page', async () => {
  const pages = [
    { data: [{ id: 'a' }, { id: 'b' }], has_more: true },
    { data: [{ id: 'c' }], has_more: false },
  ];
  const seen = [];
  const get = async (path) => {
    seen.push(path);
    return pages.shift();
  };
  const all = await listAll(get, 'subscriptions?status=all');
  assert.deepEqual(
    all.map((x) => x.id),
    ['a', 'b', 'c'],
  );
  // Second request must resume after the last id, and keep the existing query.
  assert.equal(seen[0], 'subscriptions?status=all&limit=100');
  assert.equal(seen[1], 'subscriptions?status=all&limit=100&starting_after=b');
});

test('listAll stops at the cap instead of looping forever', async () => {
  const get = async () => ({ data: [{ id: 'x' }], has_more: true });
  assert.equal((await listAll(get, 'customers', { cap: 3 })).length, 3);
});

test('groupByPrice buckets subscriptions per price with a status breakdown', () => {
  const groups = groupByPrice([
    sub(),
    sub({ id: 'sub_2', status: 'canceled' }),
    sub({
      id: 'sub_3',
      items: {
        data: [
          {
            price: {
              id: 'price_fam',
              unit_amount: 5000,
              currency: 'usd',
              recurring: { interval: 'year' },
              product: { id: 'prod_fam' },
            },
          },
        ],
      },
    }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].priceId, 'price_ind'); // most subscriptions first
  assert.deepEqual(groups[0].statuses, { active: 1, canceled: 1 });
  assert.equal(groups[1].productId, 'prod_fam'); // expanded product object, not a string
});

test('subscribersCsv exports the ids the migration needs to link members', () => {
  const csv = subscribersCsv([sub()]);
  const [header, row] = csv.trim().split('\n');
  assert.equal(header.split(',')[0], 'stripe_customer_id');
  assert.match(row, /^cus_1,sub_1,a@example\.com,Ada,active,price_ind,3000,usd,year,/);
});

test('subscribersCsv reads the period off the item when the sub has none', () => {
  const s = sub({ current_period_end: undefined });
  s.items.data[0].current_period_end = 1800000000;
  assert.match(subscribersCsv([s]), /2027-01-15/);
});

test('subscribersCsv quotes fields containing commas', () => {
  const csv = subscribersCsv([
    sub({ customer: { id: 'cus_2', email: 'b@example.com', name: 'Lee, Wei' } }),
  ]);
  assert.match(csv, /"Lee, Wei"/);
});
