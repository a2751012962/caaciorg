// Runs the token migrations (0024, then 0027) in a real Postgres (PGlite, in
// process) and drives the ledger functions the way the API does. The token
// ledger is money CAACI owes, so its rules are pinned against a database, not
// only against the migration's text: balances, lot order, the caps, voids,
// disputes, statements and the root guard.
//
// Only what 0024 needs from earlier migrations is stubbed here (auth.users,
// members, business_directory and the three Supabase roles).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = [
  new URL('../supabase/migrations/0024_tokens.sql', import.meta.url),
  new URL('../supabase/migrations/0027_tokens_never_expire.sql', import.meta.url),
  new URL('../supabase/migrations/0028_token_purchase_bonus.sql', import.meta.url),
  new URL('../supabase/migrations/0029_admin_cash_cap.sql', import.meta.url),
];

// Open the bonus window around now() so the rate rules can be driven directly.
const openBonus = (pct = 50, capCents = 10000) =>
  db.query(
    `update public.token_settings
        set bonus_pct = $1, bonus_cap_cents = $2,
            bonus_from = now() - interval '1 hour', bonus_to = now() + interval '1 hour'`,
    [pct, capCents],
  );

let db;
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
// Call a jsonb-returning ledger function.
const call = async (fn, ...args) => {
  const marks = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await one(`select public.${fn}(${marks}) as r`, args)).r;
};
const balance = async (id) => (await one('select public.token_balance($1) as b', [id])).b;

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function member({
  tier = null,
  status = 'active',
  expires = '1 year',
  admin = false,
  root = false,
  household = null,
} = {}) {
  const id = uuid();
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into public.members (id, full_name, tier_id, status, expires_at, is_admin, is_root, household_id)
     values ($1, $2, $3, $4, case when $5::text is null then null else now() + $5::interval end, $6, $7, $8)`,
    [id, `Member ${seq}`, tier, status, expires, admin, root, household],
  );
  return id;
}

async function merchant({ kind = 'partner', staff = [] } = {}) {
  const { id } = await one(
    `insert into public.merchants (name, kind) values ($1, $2) returning id`,
    [`Shop ${++seq}`, kind],
  );
  for (const m of staff)
    await db.query('insert into public.merchant_staff (merchant_id, member_id) values ($1, $2)', [
      id,
      m,
    ]);
  return id;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.business_directory (id uuid primary key default gen_random_uuid());
    create table public.members (
      id uuid primary key references auth.users(id) on delete cascade,
      full_name text, email text, tier_id text, status text not null default 'pending',
      expires_at timestamptz, is_admin boolean not null default false, household_id uuid
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
    truncate public.token_tx_lots, public.token_lots, public.token_tx, public.merchant_settlements,
             public.merchant_items, public.merchant_staff, public.merchants cascade;
    delete from auth.users;
    update public.token_settings set grants = '{"student":150,"individual":450,"family":900}'::jsonb,
           max_charge = 500, admin_mint_cap = 500, admin_daily_cap = 2000, cash_min_cents = 500,
           void_hours = 24, settle_min_cents = 2000, suspend_after = 3,
           bonus_pct = 0, bonus_from = null, bonus_to = null, bonus_cap_cents = 10000,
           admin_cash_cap_cents = 20000;
  `);
});

// ---------------------------------------------------------------- grants ----
test('the yearly grant follows the plan and is granted once per membership year', async () => {
  const student = await member({ tier: 'student' });
  const first = await call('token_membership_grant', student, null);
  assert.equal(first.ok, true);
  assert.equal(first.granted, 150);
  assert.equal(await balance(student), 150);

  const again = await call('token_membership_grant', student, null);
  assert.equal(again.granted, 0, 'a second call in the same year grants nothing');
  assert.equal(await balance(student), 150);
});

test('free, business and honorary plans get no tokens; an inactive plan is refused', async () => {
  for (const tier of ['free', 'business', 'honorary']) {
    const m = await member({ tier, expires: tier === 'business' ? '1 year' : null });
    const r = await call('token_membership_grant', m, null);
    assert.equal(r.ok, true);
    assert.equal(r.granted, 0, tier);
    assert.equal(await balance(m), 0);
  }
  const lapsed = await member({ tier: 'individual', status: 'expired' });
  assert.equal((await call('token_membership_grant', lapsed, null)).error, 'membership_not_active');
  const pastExpiry = await member({ tier: 'individual', expires: '-1 day' });
  assert.equal(
    (await call('token_membership_grant', pastExpiry, null)).error,
    'membership_not_active',
  );
});

test('an upgrade tops up to the new plan; a renewal starts a new year; a nudged expiry does not', async () => {
  const m = await member({ tier: 'student' });
  await call('token_membership_grant', m, null);

  await db.query(`update public.members set tier_id = 'family' where id = $1`, [m]);
  const up = await call('token_membership_grant', m, null);
  assert.equal(up.granted, 750, '900 for family minus the 150 already granted this year');
  assert.equal(await balance(m), 900);

  await db.query(
    `update public.members set expires_at = expires_at + interval '20 days' where id = $1`,
    [m],
  );
  assert.equal((await call('token_membership_grant', m, null)).granted, 0, 'same membership year');

  await db.query(
    `update public.members set expires_at = expires_at + interval '1 year' where id = $1`,
    [m],
  );
  const renewed = await call('token_membership_grant', m, null);
  assert.equal(renewed.granted, 900, 'a renewal is a new membership year');
});

test('no token expires, and the DB refuses to give one an expiry (0027)', async () => {
  const m = await member({ tier: 'individual', expires: '10 days' });
  await call('token_membership_grant', m, null);
  await call('token_purchase_credit', m, 200, 2000, 'cs_test_1');
  assert.equal(await balance(m), 650);

  const lots = await q(`select source, expires_at from public.token_lots where member_id = $1`, [
    m,
  ]);
  assert.equal(lots.length, 2);
  for (const l of lots) assert.equal(l.expires_at, null, `${l.source} must never expire`);

  // The membership year ending no longer touches the tokens.
  await db.query(`update public.members set expires_at = now() - interval '1 day' where id = $1`, [
    m,
  ]);
  assert.equal(await balance(m), 650, 'a lapsed membership does not burn the balance');

  // token_lots_never_expires makes the escheat exemption structural, not a habit.
  await assert.rejects(
    () => db.query(`update public.token_lots set expires_at = now() + interval '1 day'`),
    /token_lots_never_expires/,
  );
});

test('a purchase is credited once per Stripe session', async () => {
  const m = await member({ tier: 'free', expires: null });
  const a = await call('token_purchase_credit', m, 100, 1000, 'cs_test_dup');
  const b = await call('token_purchase_credit', m, 100, 1000, 'cs_test_dup');
  assert.equal(a.ok, true);
  assert.equal(b.duplicate, true);
  assert.equal(await balance(m), 100);
});

// ----------------------------------------------------------------- bonus ----
test('outside the bonus window a dollar buys the plain rate (0028)', async () => {
  const m = await member({ tier: 'free', expires: null });
  const { q } = await one('select public.token_quote($1, 1000) as q', [m]);
  assert.equal(q.bonus_active, false);
  assert.deepEqual([q.base, q.bonus, q.total], [100, 0, 100]);

  await call('token_purchase_credit', m, 100, 1000, 'cs_plain');
  assert.equal(await balance(m), 100);
  const tx = await one('select amount, bonus_tokens from public.token_tx where member_id = $1', [
    m,
  ]);
  assert.deepEqual(tx, { amount: 100, bonus_tokens: 0 });
});

test('inside the window a purchase gets 50% more, booked apart from what was paid for', async () => {
  const m = await member({ tier: 'free', expires: null });
  await openBonus();
  const r = await call('token_purchase_credit', m, 100, 1000, 'cs_bonus');
  assert.equal(r.bonus, 50);
  assert.equal(await balance(m), 150, '$10 buys 150 during the promotion');
  const tx = await one(
    'select amount, bonus_tokens, cash_cents from public.token_tx where member_id = $1',
    [m],
  );
  assert.deepEqual(tx, { amount: 150, bonus_tokens: 50, cash_cents: 1000 });
});

test('the cash desk gives the bonus too, and refuses tokens that do not match the money', async () => {
  const root = await member({ root: true });
  const m = await member({ tier: 'free', expires: null });
  await openBonus();

  const wrong = await call('token_admin_credit', m, 'cash', 100, 1000, root, null);
  assert.equal(wrong.error, 'cash_amount_mismatch');
  assert.equal(wrong.expected, 150, 'the desk has to hand over the bonus');

  const ok = await call('token_admin_credit', m, 'cash', 150, 1000, root, null);
  assert.equal(ok.bonus, 50);
  assert.equal(await balance(m), 150);
});

test('the bonus stops at the cap, and splitting the spend does not get around it', async () => {
  const root = await member({ root: true });
  const m = await member({ tier: 'free', expires: null });
  await openBonus(50, 10000); // the first $100 each member spends

  await call('token_purchase_credit', m, 600, 6000, 'cs_cap_1');
  assert.equal(await balance(m), 900, '$60 -> 600 paid + 300 bonus');

  const second = await call('token_purchase_credit', m, 600, 6000, 'cs_cap_2');
  assert.equal(second.bonus, 200, 'only the $40 still inside the cap earns 50%');
  assert.equal(await balance(m), 1700);

  const third = await call('token_admin_credit', m, 'cash', 100, 1000, root, null);
  assert.equal(third.bonus, 0, 'past the cap it is the plain rate again');
  assert.equal(await balance(m), 1800);
});

test('a bonus token is still only worth ten cents to a merchant', async () => {
  const clerk = await member();
  const shop = await merchant({ staff: [clerk] });
  const admin = await member({ admin: true });
  const m = await member({ tier: 'free', expires: null });
  await openBonus();

  await call('token_purchase_credit', m, 100, 1000, 'cs_settle'); // $10 -> 150
  assert.equal(await balance(m), 150);
  await call('token_charge', m, shop, clerk, 150, null, 'dinner', 'idem-bonus');

  // CAACI took $10 and owes the shop $15: the promotion comes out of margin,
  // it does not devalue the token at settlement.
  const s = await call('token_settlement_close', shop, new Date().toISOString(), admin);
  assert.equal(s.tokens, 150);
  assert.equal(s.amount_cents, 1500, '150 tokens settle at the plain rate, not the bonus one');
});

// --------------------------------------------------------------- charges ----
test('a charge draws the oldest tokens first and a void puts them back', async () => {
  const clerk = await member();
  const shop = await merchant({ staff: [clerk] });
  const m = await member({ tier: 'student', expires: '30 days' });
  await call('token_purchase_credit', m, 100, 1000, 'cs_fifo'); // bought first
  await call('token_membership_grant', m, null); // 150, granted second

  // Since 0027 nothing expires, so "earliest-expiring" is plain FIFO by age.
  const c = await call('token_charge', m, shop, clerk, 180, null, 'two teas', 'idem-1');
  assert.equal(c.ok, true);
  assert.equal(c.balance, 70);
  const lots = await q(
    `select source, remaining from public.token_lots where member_id = $1 order by source`,
    [m],
  );
  assert.deepEqual(lots, [
    { source: 'grant', remaining: 70 },
    { source: 'purchase', remaining: 0 },
  ]);

  const v = await call('token_void', c.tx_id, clerk, 'wrong customer');
  assert.equal(v.ok, true);
  assert.equal(v.balance, 250);
  const after = await q(
    `select source, remaining from public.token_lots where member_id = $1 order by source`,
    [m],
  );
  assert.deepEqual(after, [
    { source: 'grant', remaining: 150 },
    { source: 'purchase', remaining: 100 },
  ]);
  assert.equal((await call('token_void', c.tx_id, clerk, 'again')).error, 'already_undone');
  assert.equal(
    (await one('select state from public.token_tx where id = $1', [c.tx_id])).state,
    'voided',
  );
});

test('a charge is refused without enough tokens, over the cap, by a stranger, or against oneself', async () => {
  const clerk = await member();
  const stranger = await member();
  const shop = await merchant({ staff: [clerk] });
  const m = await member({ tier: 'student' });
  await call('token_membership_grant', m, null);

  assert.equal(
    (await call('token_charge', m, shop, clerk, 151, null, null, null)).error,
    'insufficient_balance',
  );
  assert.equal(
    (await call('token_charge', m, shop, clerk, 501, null, null, null)).error,
    'over_max_charge',
  );
  assert.equal(
    (await call('token_charge', m, shop, clerk, 0, null, null, null)).error,
    'invalid_amount',
  );
  assert.equal(
    (await call('token_charge', m, shop, stranger, 10, null, null, null)).error,
    'not_staff',
  );
  assert.equal(
    (await call('token_charge', clerk, shop, clerk, 10, null, null, null)).error,
    'cannot_charge_self',
  );
  assert.equal(await balance(m), 150, 'nothing was taken');
});

test('a retried charge with the same key lands once', async () => {
  const clerk = await member();
  const shop = await merchant({ staff: [clerk] });
  const m = await member({ tier: 'student' });
  await call('token_membership_grant', m, null);
  const a = await call('token_charge', m, shop, clerk, 30, null, null, 'same-key');
  const b = await call('token_charge', m, shop, clerk, 30, null, null, 'same-key');
  assert.equal(b.duplicate, true);
  assert.equal(b.tx_id, a.tx_id);
  assert.equal(await balance(m), 120);
});

test('an admin charges at the internal merchant without being staff, but not at a partner shop', async () => {
  const admin = await member({ admin: true });
  const internal = await merchant({ kind: 'internal' });
  const partner = await merchant();
  const m = await member({ tier: 'student' });
  await call('token_membership_grant', m, null);
  assert.equal((await call('token_charge', m, internal, admin, 10, null, null, null)).ok, true);
  assert.equal(
    (await call('token_charge', m, partner, admin, 10, null, null, null)).error,
    'not_staff',
  );
});

test('staff void only their own shop, only inside the window; an admin voids any time', async () => {
  const clerk = await member();
  const other = await member();
  const admin = await member({ admin: true });
  const shop = await merchant({ staff: [clerk] });
  await merchant({ staff: [other] });
  const m = await member({ tier: 'individual' });
  await call('token_membership_grant', m, null);
  const c = await call('token_charge', m, shop, clerk, 40, null, null, null);

  assert.equal((await call('token_void', c.tx_id, other, null)).error, 'not_staff');
  await db.query(
    `update public.token_tx set created_at = now() - interval '25 hours' where id = $1`,
    [c.tx_id],
  );
  assert.equal((await call('token_void', c.tx_id, clerk, null)).error, 'void_window_closed');
  assert.equal((await call('token_void', c.tx_id, admin, 'late fix')).ok, true);
  assert.equal(await balance(m), 450);
});

// ------------------------------------------------------------ admin mint ----
test('an admin is capped per action and per day; root is not; cash must match the rate', async () => {
  const admin = await member({ admin: true });
  const root = await member({ admin: true, root: true });
  const plain = await member();
  const m = await member({ tier: 'free', expires: null });

  assert.equal(
    (await call('token_admin_credit', m, 'mint', 50, null, plain, 'x')).error,
    'not_admin',
  );
  assert.equal(
    (await call('token_admin_credit', m, 'mint', 50, null, admin, ' ')).error,
    'reason_required',
  );
  assert.equal(
    (await call('token_admin_credit', m, 'mint', 501, null, admin, 'x')).error,
    'over_admin_cap',
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (await call('token_admin_credit', m, 'mint', 500, null, admin, 'event prize')).ok,
      true,
    );
  assert.equal(
    (await call('token_admin_credit', m, 'mint', 1, null, admin, 'one more')).error,
    'over_daily_cap',
  );
  assert.equal(
    (await call('token_admin_credit', m, 'mint', 5000, null, root, 'root is exempt')).ok,
    true,
  );

  assert.equal(
    (await call('token_admin_credit', m, 'cash', 40, 400, admin, null)).error,
    'cash_below_minimum',
  );
  assert.equal(
    (await call('token_admin_credit', m, 'cash', 100, 500, admin, null)).error,
    'cash_amount_mismatch',
  );
  // cash is not a free mint: it does not count against the daily cap
  const cash = await call('token_admin_credit', m, 'cash', 100, 1000, admin, null);
  assert.equal(cash.ok, true);
  const row = await one('select kind, cash_cents from public.token_tx where id = $1', [cash.tx_id]);
  assert.deepEqual(row, { kind: 'cash', cash_cents: 1000 });
  const lot = await one('select expires_at from public.token_lots where tx_id = $1', [cash.tx_id]);
  assert.equal(lot.expires_at, null, 'cash-bought tokens never expire');
});

test('cash has its own $200 ceiling, measured on the money and not moved by a promotion (0029)', async () => {
  const admin = await member({ admin: true });
  const root = await member({ admin: true, root: true });
  const m = await member({ tier: 'free', expires: null });

  // $200 is 2000 tokens -- four times the 500-token mint cap, which used to
  // stop the desk at $50.
  assert.equal((await call('token_admin_credit', m, 'cash', 2000, 20000, admin, null)).ok, true);
  assert.equal(await balance(m), 2000);

  const over = await call('token_admin_credit', m, 'cash', 2010, 20100, admin, null);
  assert.equal(over.error, 'over_cash_cap');
  assert.equal(over.cap_cents, 20000);
  assert.equal((await call('token_admin_credit', m, 'cash', 2010, 20100, root, null)).ok, true);

  // The ceiling is on the cash, so the launch-day bonus cannot raise or lower
  // it: $200 still goes through, and $200.01 still does not. A fresh member,
  // because the bonus cap counts spending already done inside the window and
  // the buys above would eat it.
  await openBonus();
  const fresh = await member({ tier: 'free', expires: null });
  const bonused = await call('token_admin_credit', fresh, 'cash', 2500, 20000, admin, null);
  assert.equal(bonused.ok, true, '$200 buys 2000 + 500 bonus on the first $100');
  assert.equal(bonused.bonus, 500);
  assert.equal(
    (await call('token_admin_credit', fresh, 'cash', 2010, 20100, admin, null)).error,
    'over_cash_cap',
  );

  // Minting is unchanged: still 500 tokens per action.
  assert.equal(
    (await call('token_admin_credit', m, 'mint', 501, null, admin, 'x')).error,
    'over_admin_cap',
  );
});

test('an admin can take tokens back, with a reason, never below zero', async () => {
  const admin = await member({ admin: true });
  const m = await member({ tier: 'free', expires: null });
  await call('token_purchase_credit', m, 200, 2000, 'cs_refunded');

  assert.equal((await call('token_admin_debit', m, 50, admin, '')).error, 'reason_required');
  assert.equal(
    (await call('token_admin_debit', m, 201, admin, 'refund')).error,
    'insufficient_balance',
  );
  assert.equal((await call('token_admin_debit', m, 501, admin, 'refund')).error, 'over_admin_cap');
  const d = await call('token_admin_debit', m, 200, admin, 'Stripe refund cs_refunded');
  assert.equal(d.ok, true);
  assert.equal(d.balance, 0);
  const row = await one('select kind, amount from public.token_tx where id = $1', [d.tx_id]);
  assert.deepEqual(row, { kind: 'adjust', amount: -200 });
});

// -------------------------------------------------------------- disputes ----
test('a dispute needs the secret from the receipt; upheld ones reverse and suspend a shop at three', async () => {
  const clerk = await member();
  const admin = await member({ admin: true });
  const shop = await merchant({ staff: [clerk] });
  const m = await member({ tier: 'individual' });
  await call('token_membership_grant', m, null);

  const charges = [];
  for (let i = 0; i < 4; i++)
    charges.push(await call('token_charge', m, shop, clerk, 20, null, null, null));
  assert.equal(await balance(m), 370);

  const key = async (id) =>
    (await one('select dispute_key from public.token_tx where id = $1', [id])).dispute_key;
  assert.equal(
    (await call('token_dispute_open', charges[0].tx_id, uuid(), 'not me')).error,
    'charge_not_found',
  );
  assert.equal(
    (await call('token_dispute_resolve', charges[0].tx_id, admin, true, null)).error,
    'not_disputed',
  );

  // rejected: the charge stands
  await call('token_dispute_open', charges[3].tx_id, await key(charges[3].tx_id), 'hmm');
  assert.equal(
    (await call('token_dispute_resolve', charges[3].tx_id, clerk, true, null)).error,
    'not_admin',
  );
  const rej = await call(
    'token_dispute_resolve',
    charges[3].tx_id,
    admin,
    false,
    'member remembered',
  );
  assert.equal(rej.upheld, false);
  assert.equal(await balance(m), 370);

  let last;
  for (let i = 0; i < 3; i++) {
    assert.equal(
      (await call('token_dispute_open', charges[i].tx_id, await key(charges[i].tx_id), 'not me'))
        .ok,
      true,
    );
    last = await call('token_dispute_resolve', charges[i].tx_id, admin, true, 'confirmed');
    assert.equal(last.upheld, true);
  }
  assert.equal(last.merchant_suspended, true);
  assert.equal(await balance(m), 430, 'three charges of 20 came back');
  assert.equal(
    (await one('select status from public.merchants where id = $1', [shop])).status,
    'suspended',
  );
  assert.equal(
    (await call('token_charge', m, shop, clerk, 10, null, null, null)).error,
    'merchant_suspended',
  );
});

// ------------------------------------------------------------ statements ----
test('a statement stamps what it covers; small months roll over; late reversals come off the next one', async () => {
  const clerk = await member();
  const admin = await member({ admin: true });
  const shop = await merchant({ staff: [clerk] });
  const internal = await merchant({ kind: 'internal' });
  const m = await member({ tier: 'family' });
  await call('token_membership_grant', m, null);

  const small = await call('token_charge', m, shop, clerk, 100, null, null, null); // $10
  let r = await call('token_settlement_close', shop, new Date().toISOString(), admin);
  assert.equal(r.rolled_over, true, '$10 is under the $20 minimum');
  assert.equal(r.amount_cents, 1000);

  const big = await call('token_charge', m, shop, clerk, 300, null, null, null); // +$30
  const disputed = await call('token_charge', m, shop, clerk, 50, null, null, null);
  const dk = (await one('select dispute_key from public.token_tx where id = $1', [disputed.tx_id]))
    .dispute_key;
  await call('token_dispute_open', disputed.tx_id, dk, 'not me');

  r = await call('token_settlement_close', shop, new Date().toISOString(), admin);
  assert.equal(r.ok, true);
  assert.equal(r.tokens, 400, 'the disputed 50 waits for its outcome');
  assert.equal(r.amount_cents, 4000);
  const stamped = await q('select id from public.token_tx where settlement_id = $1', [
    r.settlement_id,
  ]);
  assert.deepEqual(stamped.map((x) => x.id).sort(), [small.tx_id, big.tx_id].sort());

  // after the statement: the dispute is upheld and a paid charge is voided
  await call('token_dispute_resolve', disputed.tx_id, admin, true, null);
  await call('token_void', big.tx_id, admin, 'refund after payment');
  const open = (
    await one("select public.token_merchant_open($1, now() + interval '1 second') as t", [shop])
  ).t;
  assert.equal(open, -300, 'the shop owes back the voided 300; the upheld dispute nets to zero');

  assert.equal(
    (await call('token_settlement_close', internal, new Date().toISOString(), admin)).error,
    'internal_not_settled',
  );
  assert.equal(
    (await call('token_settlement_close', shop, new Date().toISOString(), clerk)).error,
    'not_admin',
  );
});

// -------------------------------------------------------------- transfer ----
test('tokens move inside one family and stay non-expiring', async () => {
  const household = uuid();
  const founder = await member({ tier: 'family', household });
  const kid = await member({ household });
  const outsider = await member({ household: uuid() });
  await call('token_membership_grant', founder, null);

  assert.equal((await call('token_transfer', founder, outsider, 100)).error, 'not_same_family');
  assert.equal((await call('token_transfer', founder, kid, 901)).error, 'insufficient_balance');
  const t = await call('token_transfer', founder, kid, 300);
  assert.equal(t.ok, true);
  assert.equal(await balance(founder), 600);
  assert.equal(await balance(kid), 300);
  // Both sides are null since 0027, and `null = null` is null -- not true.
  const same = await one(
    `select (select expires_at from public.token_lots where member_id = $1 limit 1)
          is not distinct from
            (select expires_at from public.token_lots where member_id = $2 limit 1) as same`,
    [founder, kid],
  );
  assert.equal(same.same, true);
});

// ------------------------------------------------------------------ root ----
test('is_root cannot be changed by the API role, only from the SQL editor', async () => {
  const m = await member({ admin: true });
  await db.exec('set role service_role');
  try {
    await assert.rejects(
      db.query('update public.members set is_root = true where id = $1', [m]),
      /is_root can only be changed from the SQL editor/,
    );
    // everything else on the row is still writable by the API
    await db.query(`update public.members set full_name = 'Renamed' where id = $1`, [m]);
  } finally {
    await db.exec('reset role');
  }
  await db.query('update public.members set is_root = true where id = $1', [m]);
  assert.equal((await one('select is_root from public.members where id = $1', [m])).is_root, true);
});

test('the ledger is server-only: RLS on, no policies, nothing for the browser roles', async () => {
  const tables = [
    'token_settings',
    'merchants',
    'merchant_staff',
    'merchant_items',
    'merchant_settlements',
    'token_tx',
    'token_lots',
    'token_tx_lots',
  ];
  for (const t of tables) {
    const r = await one(
      `select (select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass) as rls,
              (select count(*)::int from pg_policies where schemaname = 'public' and tablename = $1) as policies,
              has_table_privilege('anon', 'public.' || $1, 'select') as anon_read,
              has_table_privilege('authenticated', 'public.' || $1, 'select, insert, update, delete') as auth_any`,
      [t],
    );
    assert.deepEqual(r, { rls: true, policies: 0, anon_read: false, auth_any: false }, t);
  }
  const fns = await q(
    `select p.proname,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'token\\_%' or p.proname = 'members_guard_root')`,
  );
  assert.ok(fns.length >= 14, `expected the token functions, saw ${fns.length}`);
  for (const f of fns)
    assert.deepEqual({ anon: f.anon, auth: f.auth }, { anon: false, auth: false }, f.proname);
});
