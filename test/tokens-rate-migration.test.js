// 0036 — $1 buys 50 tokens. The rate lives in one row, token_settings, and
// every reader takes it from there, so the migration is a single update. This
// runs it in PGlite after the token migrations it changes, and checks the two
// readers that matter most for money: what a purchase credits, and what a
// partner shop is settled. Nothing else is rescaled — that was the owner's
// call, and the file says so.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const OWN = '0036_tokens_per_dollar_50.sql';
const MIGRATIONS = [
  '0024_tokens.sql',
  '0027_tokens_never_expire.sql',
  '0028_token_purchase_bonus.sql',
  OWN,
];

let db;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

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
});

test('0036 sets the live rate and the column default to 50, and a re-paste changes nothing', async () => {
  assert.equal((await one('select tokens_per_dollar as r from public.token_settings')).r, 50);
  const { d } = await one(`
    select column_default as d from information_schema.columns
     where table_schema = 'public' and table_name = 'token_settings' and column_name = 'tokens_per_dollar'`);
  assert.equal(d, '50');

  const { t } = await one('select updated_at as t from public.token_settings');
  await db.exec(await readFile(new URL(OWN, DIR), 'utf8'));
  assert.equal((await one('select tokens_per_dollar as r from public.token_settings')).r, 50);
  assert.deepEqual(
    (await one('select updated_at as t from public.token_settings')).t,
    t,
    'no-op re-paste',
  );
});

test('0036 leaves every other setting alone: grants, caps and packs are still token counts, not rescaled', async () => {
  const s = await one(
    'select grants, max_charge, admin_mint_cap, packs_cents from public.token_settings',
  );
  assert.deepEqual(s.grants, { student: 150, individual: 450, family: 900 });
  assert.equal(s.max_charge, 500);
  assert.equal(s.admin_mint_cap, 500);
  assert.deepEqual(s.packs_cents, [1000, 2000, 5000, 10000]);
});

test('a $10 pack now quotes 500 tokens outside the bonus window', async () => {
  await db.exec(
    `update public.token_settings set bonus_pct = 0, bonus_from = null, bonus_to = null`,
  );
  const { q } = await one('select public.token_quote(null, 1000) as q');
  assert.equal(q.rate, 50);
  assert.equal(q.base, 500);
  assert.equal(q.total, 500);
});

test('a partner shop is settled at 2¢ a token: 5,000 tokens taken becomes a $100 statement', async () => {
  const uid = '00000000-0000-4000-8000-000000000001';
  await db.exec(`insert into auth.users (id) values ('${uid}')`);
  await db.exec(
    `insert into public.members (id, full_name, status, is_admin) values ('${uid}', 'Wei', 'active', true)`,
  );
  const { id } = await one(
    `insert into public.merchants (name, kind) values ('Bubble Tea', 'partner') returning id`,
  );
  await db.exec(`update public.token_settings set settle_min_cents = 0`);
  await db.exec(`
    insert into public.token_tx (member_id, kind, amount, merchant_id, state, created_at)
    values ('${uid}', 'charge', -5000, '${id}', 'ok', now() - interval '1 hour')`);
  const { r } = await one(`select public.token_settlement_close($1, now(), $2) as r`, [id, uid]);
  assert.equal(r.ok, true);
  assert.equal(r.tokens, 5000);
  assert.equal(r.amount_cents, 10000);
});
