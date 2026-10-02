// 0038 — members.is_test keeps a developer or demo account out of the token
// finance reports. Run in PGlite after the migrations whose functions it
// recreates (0024 overview + cash report, 0030 pay_item_id, 0032 item report,
// 0033 merchant sales): a real member and a test member do the same things,
// and only the real one shows up in the four reports. The ledger itself and
// what a partner shop is owed are deliberately untouched, and checked so.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const OWN = '0038_members_is_test.sql';
const MIGRATIONS = [
  '0024_tokens.sql',
  '0027_tokens_never_expire.sql',
  '0028_token_purchase_bonus.sql',
  '0030_token_pay_codes.sql',
  '0031_token_collected.sql',
  '0032_token_item_report.sql',
  '0033_token_merchant_sales.sql',
  OWN,
];

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const REAL = '00000000-0000-4000-8000-000000000001';
const DEV = '00000000-0000-4000-8000-000000000002';

let db;
let shop; // CAACI's own merchant
let partner;
let item;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function member(id, name, extra = '') {
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into public.members (id, full_name, status ${extra ? ',' + extra : ''})
     values ($1, $2, 'active' ${extra ? ', true' : ''})`,
    [id, name],
  );
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.business_directory (id uuid primary key default gen_random_uuid());
    create table public.membership_tiers (id text primary key, name text, price_cents integer not null default 0);
    create table public.members (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text, email text, tier_id text references public.membership_tiers(id),
      status text not null default 'pending', expires_at timestamptz,
      is_admin boolean not null default false, household_id uuid
    );
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  for (const f of MIGRATIONS) await db.exec(await readFile(new URL(f, DIR), 'utf8'));
  // pasting it twice must be safe
  await db.exec(await readFile(new URL(OWN, DIR), 'utf8'));

  // no promotion running, so a dollar buys exactly tokens_per_dollar
  await db.exec(
    `update public.token_settings set bonus_pct = 0, bonus_from = null, bonus_to = null, settle_min_cents = 0`,
  );

  await member(ADMIN, 'Desk Admin', 'is_admin');
  await member(REAL, 'Real Member');
  await member(DEV, 'dev LNU', 'is_test');

  shop = (
    await one(
      `insert into public.merchants (name, kind) values ('CAACI Events', 'internal') returning id`,
    )
  ).id;
  partner = (
    await one(
      `insert into public.merchants (name, kind) values ('Bubble Tea', 'partner') returning id`,
    )
  ).id;
  item = (
    await one(
      `insert into public.merchant_items (merchant_id, name, tokens) values ($1, 'Orange juice', 1) returning id`,
      [shop],
    )
  ).id;

  // the same four things, done by both accounts
  for (const [who, tag] of [
    [REAL, 'r'],
    [DEV, 'd'],
  ]) {
    // bought online: $10 → 100 tokens, a lot that never expires
    await db.query('select public.token_purchase_credit($1, 100, 1000, $2)', [who, `cs_${tag}`]);
    // cash at the desk: $5 → 50 tokens
    const cash = (
      await one('select public.token_admin_credit($1, $2, 50, 500, $3, null) as r', [
        who,
        'cash',
        ADMIN,
      ])
    ).r;
    assert.equal(cash.ok, true, JSON.stringify(cash));
    // a scan-to-pay charge at CAACI's own stall, and one at a partner
    await db.query(
      `insert into public.token_tx (member_id, kind, amount, merchant_id, state, pay_item_id, self_serve)
       values ($1, 'charge', -1, $2, 'ok', $3, true)`,
      [who, shop, item],
    );
    await db.query(
      `insert into public.token_tx (member_id, kind, amount, merchant_id, state)
       values ($1, 'charge', -30, $2, 'ok')`,
      [who, partner],
    );
  }
});

test('is_test exists, defaults to false, and the migration is a no-op the second time', async () => {
  const rows = (await db.query('select id, is_test from public.members order by id')).rows;
  assert.deepEqual(
    rows.map((r) => [r.id, r.is_test]),
    [
      [REAL, false],
      [DEV, true],
      [ADMIN, false],
    ],
  );
});

test('overview: unspent balances and holders count the real member only; a partner is owed for both', async () => {
  const o = (await one('select public.token_overview() as o')).o;
  // real member: 100 bought + 50 cash, minus nothing drawn from lots here
  // (the charges were inserted as bare rows, so lots are untouched)
  assert.deepEqual(o.outstanding, { purchase: 100, cash: 50 });
  assert.equal(o.holders, 1);
  // the partner took 30 from each account and is owed for both
  assert.equal(o.owed_to_partners, 60);
});

test('cash report: the desk took $10 today, but only $5 of it was real', async () => {
  const rows = (
    await one(
      `select public.token_cash_report(now() - interval '1 hour', now() + interval '1 hour') as r`,
    )
  ).r;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_name, 'Desk Admin');
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].cash_cents, 500);
  assert.equal(rows[0].tokens, 50);
});

test('merchant sales and the item report count the real charge only', async () => {
  const sales = (
    await db.query(
      'select * from public.token_merchant_sales() order by merchant_id, item_id nulls first',
    )
  ).rows;
  const own = sales.find((s) => s.merchant_id === shop && s.item_id === null);
  assert.deepEqual([own.charges, own.tokens], [1, 1]);
  const line = sales.find((s) => s.merchant_id === shop && s.item_id === item);
  assert.deepEqual([line.units, line.tokens], [1, 1]);
  const theirs = sales.find((s) => s.merchant_id === partner && s.item_id === null);
  assert.deepEqual(
    [theirs.charges, theirs.tokens],
    [1, 30],
    'the sales FIGURE skips the test row too',
  );

  const report = (await one('select public.token_item_report($1) as r', [item])).r;
  assert.equal(report.sold, 1);
  assert.equal(report.tokens, 1);
  assert.equal(report.total, 1);
  assert.equal(report.ids.length, 1);
});

test('the ledger keeps every row, and settlement pays the partner for the test charge as well', async () => {
  const { n } = await one(`select count(*)::int as n from public.token_tx where member_id = $1`, [
    DEV,
  ]);
  assert.equal(n, 4, 'purchase, cash, two charges — nothing hidden or deleted');
  const r = (
    await one(`select public.token_settlement_close($1, now(), $2) as r`, [partner, ADMIN])
  ).r;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.tokens, 60, 'a third party’s claim does not depend on who paid');
});

test('the four reports stay service-role only', async () => {
  for (const fn of [
    'public.token_overview()',
    'public.token_cash_report(timestamptz, timestamptz)',
    'public.token_item_report(uuid, integer, integer)',
    'public.token_merchant_sales()',
  ]) {
    for (const role of ['anon', 'authenticated']) {
      const { ok } = await one(`select has_function_privilege($1, '${fn}', 'execute') as ok`, [
        role,
      ]);
      assert.equal(ok, false, `${role} can call ${fn}`);
    }
    const { ok } = await one(
      `select has_function_privilege('service_role', '${fn}', 'execute') as ok`,
    );
    assert.equal(ok, true, fn);
  }
});
