// 0034 — Honorable Membership by invitation code. Two halves:
//   1. the SQL as text: both tables server-only (RLS on, no policies, browser
//      roles revoked), invite_redeem() security definer with a pinned
//      search_path and executable by service_role alone — the shape every
//      earlier server-only migration keeps, and what the guardrail tests
//      (migration-hygiene, security-definer-grants) look for;
//   2. the SQL running in PGlite, after the token migrations it hooks into:
//      a code activates the tier once per person under its cap, refuses a
//      paid member, and the 20-token grant follows through the same
//      token_membership_grant() the Stripe webhook calls.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const SOURCES = [];
for (const file of FILES) SOURCES.push({ file, sql: await readFile(new URL(file, DIR), 'utf8') });
const OWN = SOURCES.find(({ sql }) =>
  /create table if not exists public\.invite_codes\b/i.test(sql),
);

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const statements = (sql) =>
  stripComments(sql)
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
const ALL = SOURCES.flatMap(({ sql }) => statements(sql));
const BROWSER = ['anon', 'authenticated'];
const rolesOf = (list) => {
  const names = list.split(',').map((s) => s.trim());
  return names.includes('public') ? [...BROWSER, 'public'] : names;
};

// ------------------------------------------------------------ as text ----
test('a migration creates the invitation tables and follows the paste-in-the-SQL-editor rule', () => {
  assert.ok(OWN, 'no migration creates public.invite_codes');
  assert.match(OWN.sql, /Apply by pasting into the Supabase SQL editor, in filename order/);
  const flat = stripComments(OWN.sql).replace(/\s+/g, ' ').toLowerCase();
  assert.match(flat, /create table if not exists public\.invite_redemptions\b/);
  assert.match(
    flat,
    /tier_id text not null default 'honorary' references public\.membership_tiers\(id\)/,
  );
  // A used code stays: the redemption's reference has no cascade.
  assert.match(flat, /code text not null references public\.invite_codes\(code\),/);
  assert.match(flat, /unique \(code, member_id\)/);
});

for (const table of ['invite_codes', 'invite_redemptions']) {
  test(`${table}: RLS on, no policies, every privilege revoked from anon and authenticated`, () => {
    const on = (s) => s.includes(` public.${table} `) || s.endsWith(` public.${table}`);
    let rls = false;
    const revoked = { anon: false, authenticated: false };
    for (const s of ALL) {
      if (/^alter table /.test(s) && on(s) && s.includes('enable row level security')) rls = true;
      assert.doesNotMatch(s, new RegExp(`^create policy \\w+ on (public\\.)?${table}\\b`));
      const m = s.match(/^(grant|revoke) (.+?) on (?:table )?(\S+) (?:to|from) (.+)$/);
      if (!m || (m[3] !== table && m[3] !== `public.${table}`)) continue;
      for (const r of rolesOf(m[4]).filter((x) => BROWSER.includes(x))) {
        if (m[1] === 'grant') revoked[r] = false;
        else if (/^all( privileges)?$/.test(m[2])) revoked[r] = true;
      }
    }
    assert.equal(rls, true, `RLS is not enabled on ${table}`);
    assert.deepEqual(revoked, { anon: true, authenticated: true });
  });
}

test('invite_redeem is security definer, pins search_path, locks the code row, and is service-role only', () => {
  const m = stripComments(OWN.sql).match(
    /create\s+or\s+replace\s+function\s+public\.invite_redeem\s*\(([^)]*)\)\s*returns([\s\S]*?)\$\$([\s\S]*?)\$\$/i,
  );
  assert.ok(m, 'invite_redeem not found');
  const header = m[2].replace(/\s+/g, ' ').toLowerCase();
  const body = m[3].replace(/\s+/g, ' ').toLowerCase();
  assert.match(header, /security definer set search_path = public, pg_temp as\s*$/);
  assert.match(
    body,
    /from public\.invite_codes where code = upper\(btrim\(coalesce\(p_code, ''\)\)\) for update/,
  );
  assert.match(body, /from public\.members where id = p_member for update/);
  assert.match(
    body,
    /c\.times_redeemed >= c\.max_redemptions then return jsonb_build_object\('ok', false, 'reason', 'used_up'\)/,
  );
  assert.match(body, /'paid_plan'/);
  // the cap is checked before the member is changed
  assert.ok(body.indexOf("'used_up'") < body.indexOf('update public.members'));

  const holders = new Set(['public', ...BROWSER, 'service_role']); // Supabase defaults
  for (const s of ALL) {
    const g = s.match(
      /^(grant|revoke) execute on function (?:public\.)?(\w+)\s*\(.*?\) (?:to|from) (.+)$/,
    );
    if (!g || g[2] !== 'invite_redeem') continue;
    for (const r of rolesOf(g[3])) g[1] === 'grant' ? holders.add(r) : holders.delete(r);
  }
  assert.deepEqual([...holders], ['service_role']);
});

test('the 20-token grant is added only when the key is absent, so a later edit survives a re-paste', () => {
  const flat = stripComments(OWN.sql).replace(/\s+/g, ' ').toLowerCase();
  assert.match(
    flat,
    /update public\.token_settings set grants = grants \|\| '\{"honorary": 20\}'::jsonb where not \(grants \? 'honorary'\)/,
  );
});

// ------------------------------------------------------------ in Postgres ----
const MIGRATIONS = ['0024_tokens.sql', '0027_tokens_never_expire.sql', OWN.file].map(
  (f) => new URL(f, DIR),
);

let db;
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const redeem = async (code, member) =>
  (await one('select public.invite_redeem($1, $2) as r', [code, member])).r;
const memberRow = (id) =>
  one(
    'select tier_id, status, expires_at, member_since, stripe_subscription_id from public.members where id = $1',
    [id],
  );

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function member({ tier = null, status = 'pending', expires = null, sub = null } = {}) {
  const id = uuid();
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into public.members (id, full_name, tier_id, status, expires_at, stripe_subscription_id)
     values ($1, $2, $3, $4, case when $5::text is null then null else now() + $5::interval end, $6)`,
    [id, `Member ${seq}`, tier, status, expires, sub],
  );
  return id;
}

async function code(code, { active = true, cap = null, expires = null } = {}) {
  await db.query(
    `insert into public.invite_codes (code, active, max_redemptions, expires_at)
     values ($1, $2, $3, case when $4::text is null then null else now() + $4::interval end)`,
    [code, active, cap, expires],
  );
  return code;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.business_directory (id uuid primary key default gen_random_uuid());
    create table public.membership_tiers (
      id text primary key, name text, price_cents integer not null default 0,
      invite_only boolean not null default false
    );
    insert into public.membership_tiers (id, name, price_cents, invite_only) values
      ('free', 'Free Membership', 0, false), ('student', 'Student', 1500, false),
      ('individual', 'Individual', 3000, false), ('family', 'Family', 6000, false),
      ('honorary', 'Honorable Membership', 0, true);
    create table public.members (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text, email text, tier_id text references public.membership_tiers(id),
      status text not null default 'pending', member_since timestamptz, expires_at timestamptz,
      stripe_subscription_id text, is_admin boolean not null default false, household_id uuid
    );
    -- Supabase hands every new table and function in public to the browser roles
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to service_role;
  `);
  for (const m of MIGRATIONS) await db.exec(await readFile(m, 'utf8'));
  // pasting them twice must be safe
  for (const m of MIGRATIONS) await db.exec(await readFile(m, 'utf8'));
  await db.exec('grant all on all tables in schema public to service_role;');
});

beforeEach(async () => {
  await db.exec(`
    truncate public.invite_redemptions, public.invite_codes, public.token_tx_lots, public.token_lots, public.token_tx cascade;
    delete from auth.users;
    update public.token_settings set grants = '{"student":150,"individual":450,"family":900,"honorary":20}'::jsonb;
  `);
});

test('db: the browser roles can neither read the tables nor call invite_redeem; service_role can', async () => {
  for (const role of BROWSER) {
    for (const table of ['invite_codes', 'invite_redemptions']) {
      const { ok } = await one(
        `select has_table_privilege($1, 'public.${table}', 'select') as ok`,
        [role],
      );
      assert.equal(ok, false, `${role} can read ${table}`);
    }
    const { ok } = await one(
      `select has_function_privilege($1, 'public.invite_redeem(text, uuid)', 'execute') as ok`,
      [role],
    );
    assert.equal(ok, false, `${role} can call invite_redeem`);
  }
  const { ok } = await one(
    `select has_function_privilege('service_role', 'public.invite_redeem(text, uuid)', 'execute') as ok`,
  );
  assert.equal(ok, true);
});

test('db: 0034 adds the honorary grant once and leaves a changed value alone', async () => {
  await db.query(`update public.token_settings set grants = grants - 'honorary'`);
  await db.exec(await readFile(MIGRATIONS[2], 'utf8'));
  assert.equal((await one('select grants from public.token_settings')).grants.honorary, 20);
  await db.query(`update public.token_settings set grants = grants || '{"honorary": 99}'::jsonb`);
  await db.exec(await readFile(MIGRATIONS[2], 'utf8'));
  assert.equal((await one('select grants from public.token_settings')).grants.honorary, 99);
});

test('db: a new account activates Honorable Membership and then receives its 20 tokens', async () => {
  await code('HM-BOARD', { cap: 2 });
  const m = await member();
  const r = await redeem(' hm-board ', m);
  assert.deepEqual(r, { ok: true, code: 'HM-BOARD', tier_id: 'honorary' });

  const row = await memberRow(m);
  assert.equal(row.tier_id, 'honorary');
  assert.equal(row.status, 'active');
  assert.equal(row.expires_at, null);
  assert.ok(row.member_since, 'member_since is set for a first membership');
  assert.equal((await one('select times_redeemed from public.invite_codes')).times_redeemed, 1);
  assert.equal(
    (
      await one('select count(*)::int as n from public.invite_redemptions where member_id = $1', [
        m,
      ])
    ).n,
    1,
  );

  // what /api/invite does next
  const grant = (await one('select public.token_membership_grant($1, null) as r', [m])).r;
  assert.equal(grant.ok, true);
  assert.equal(grant.granted, 20);
  assert.equal((await one('select public.token_balance($1) as b', [m])).b, 20);
  const again = (await one('select public.token_membership_grant($1, null) as r', [m])).r;
  assert.equal(again.granted, 0, 'the grant is once per membership year');
});

test('db: a capped code stops at its cap, and the same person cannot use it twice', async () => {
  await code('HM-TWO', { cap: 2 });
  const a = await member();
  const b = await member();
  const c = await member();
  assert.equal((await redeem('HM-TWO', a)).ok, true);
  assert.equal((await redeem('HM-TWO', a)).reason, 'already_member');
  assert.equal((await redeem('HM-TWO', b)).ok, true);
  assert.equal((await redeem('HM-TWO', c)).reason, 'used_up');
  assert.equal((await one('select times_redeemed from public.invite_codes')).times_redeemed, 2);
  assert.equal((await memberRow(c)).tier_id, null, 'the refused member is untouched');

  // Honorable already, through another code: the second code is not consumed.
  await code('HM-OTHER');
  assert.equal((await redeem('HM-OTHER', a)).reason, 'already_member');
  assert.equal(
    (await one(`select times_redeemed from public.invite_codes where code = 'HM-OTHER'`))
      .times_redeemed,
    0,
  );
});

test('db: an unknown, switched-off or expired code is refused without touching the member', async () => {
  await code('HM-OFF', { active: false });
  await code('HM-OLD', { expires: '-1 day' });
  const m = await member();
  assert.equal((await redeem('HM-NOPE', m)).reason, 'invalid');
  assert.equal((await redeem('HM-OFF', m)).reason, 'invalid');
  assert.equal((await redeem('HM-OLD', m)).reason, 'expired');
  assert.equal((await redeem('', m)).reason, 'invalid');
  assert.equal((await redeem(null, m)).reason, 'invalid');
  assert.equal((await memberRow(m)).status, 'pending');
  assert.equal((await one('select count(*)::int as n from public.invite_redemptions')).n, 0);
});

test('db: a paid member is refused; a free, lapsed or new member is not', async () => {
  await code('HM-ALL');
  const paid = await member({ tier: 'individual', status: 'active', expires: '1 year' });
  assert.equal((await redeem('HM-ALL', paid)).reason, 'paid_plan');
  assert.equal((await memberRow(paid)).tier_id, 'individual');

  const billing = await member({ tier: 'student', status: 'past_due', sub: 'sub_1' });
  assert.equal((await redeem('HM-ALL', billing)).reason, 'paid_plan');

  const free = await member({ tier: 'free', status: 'active' });
  assert.equal((await redeem('HM-ALL', free)).ok, true);
  assert.equal((await memberRow(free)).tier_id, 'honorary');

  const lapsed = await member({ tier: 'individual', status: 'active', expires: '-1 day' });
  assert.equal((await redeem('HM-ALL', lapsed)).ok, true);

  const expired = await member({ tier: 'family', status: 'expired', expires: '-1 year' });
  assert.equal((await redeem('HM-ALL', expired)).ok, true);
  const row = await memberRow(expired);
  assert.equal(row.status, 'active');
  assert.equal(row.expires_at, null);

  assert.equal((await redeem('HM-ALL', uuid())).reason, 'no_member');
});

test('db: a used code cannot be deleted; an unused one can', async () => {
  await code('HM-USED');
  await code('HM-FRESH');
  await redeem('HM-USED', await member());
  await assert.rejects(
    db.query(`delete from public.invite_codes where code = 'HM-USED'`),
    /violates foreign key/,
  );
  await db.query(`delete from public.invite_codes where code = 'HM-FRESH'`);
  assert.equal((await one('select count(*)::int as n from public.invite_codes')).n, 1);
});

test('db: a stored code is always upper-case', async () => {
  await assert.rejects(
    db.query(`insert into public.invite_codes (code) values ('hm-lower')`),
    /check constraint/,
  );
});
