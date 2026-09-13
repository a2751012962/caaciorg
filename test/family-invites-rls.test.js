// Pins the access model and the seat lock of the family-invitation migration.
// household_invites holds invitees' email addresses and household_events a
// family's join/leave history; only /api/family (and admin Functions) touch
// them, with the service-role key. The family_* functions are security definer,
// so EXECUTE for a browser role would let anyone holding the anon key link
// themselves into a family or fill one up through PostgREST /rpc.
//
// There is no database in CI, so this reads supabase/migrations/*.sql as text.
// The migration is found by what it creates, not by its number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const TABLES = ['household_invites', 'household_events'];
const SEAT_FUNCTIONS = ['family_create_invite', 'family_add_person', 'family_accept_invite'];
// Each seat-claiming function's exact cap check, so `> 3` cannot pass for `>= 3`.
const CAP_CHECK = {
  family_create_invite: /elsif public\.family_seats_used\(p_household\) >= 3 then/,
  family_add_person: /if public\.family_seats_used\(p_household\) >= 3 then/,
  family_accept_invite:
    /if public\.family_seats_used\(v_household, p_invite\) \+ \(case when v_person is null then 1 else 0 end\) > 3 then/,
};
const BROWSER = ['anon', 'authenticated'];

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const flat = (sql) => stripComments(sql).replace(/\s+/g, ' ').toLowerCase();
// Statements, lower-cased with whitespace collapsed; $$ bodies carry semicolons.
const statements = (sql) =>
  stripComments(sql)
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);

const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const SOURCES = [];
for (const file of FILES) SOURCES.push({ file, sql: await readFile(new URL(file, DIR), 'utf8') });
const ALL = SOURCES.flatMap(({ sql }) => statements(sql));
const OWN = SOURCES.find(({ sql }) =>
  /create table if not exists public\.household_invites\b/i.test(sql),
);

// name -> { header, body } for every `create or replace function public.family_*`.
const FUNCTIONS = new Map();
for (const { sql } of SOURCES) {
  const re =
    /create\s+or\s+replace\s+function\s+public\.(family_\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;
  for (const m of stripComments(sql).matchAll(re)) {
    FUNCTIONS.set(m[1].toLowerCase(), {
      header: m[3].replace(/\s+/g, ' ').toLowerCase(),
      body: m[5].replace(/\s+/g, ' ').toLowerCase(),
    });
  }
}

const rolesOf = (list) => {
  const names = list.split(',').map((s) => s.trim());
  return names.includes('public') ? [...BROWSER, 'public'] : names;
};

test('a migration creates both family tables and follows the paste-in-the-SQL-editor rule', () => {
  assert.ok(OWN, 'no migration creates public.household_invites');
  const sql = flat(OWN.sql);
  assert.match(OWN.sql, /Apply by pasting into the Supabase SQL editor, in filename order/);
  assert.match(sql, /create table if not exists public\.household_events\b/);
  assert.match(
    sql,
    /add column if not exists founder_member_id uuid references public\.members\(id\) on delete set null/,
  );
  assert.match(
    sql,
    /create unique index if not exists \w+ on public\.household_invites \(household_id, lower\(email\)\) where status = 'pending'/,
  );
  // A name-only person being given a login, and at most one pending invitation for them.
  assert.match(sql, /person_id uuid references public\.household_members\(id\) on delete set null/);
  assert.match(
    sql,
    /create unique index if not exists \w+ on public\.household_invites \(person_id\) where status = 'pending' and person_id is not null/,
  );
  assert.match(sql, /subject_email text, subject_name text, created_at/);
});

for (const table of TABLES) {
  test(`${table}: RLS on, no policies, every privilege revoked from anon and authenticated`, () => {
    const on = (s) => s.includes(` public.${table} `) || s.endsWith(` public.${table}`);
    let rls = false;
    let revoked = { anon: false, authenticated: false };
    for (const s of ALL) {
      if (/^alter table /.test(s) && on(s) && s.includes('enable row level security')) rls = true;
      if (/^alter table /.test(s) && on(s) && s.includes('disable row level security')) rls = false;
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

test('every family_* function is security definer with search_path = public, pg_temp', () => {
  assert.ok(FUNCTIONS.size >= 7, `found only ${[...FUNCTIONS.keys()].join(', ')}`);
  for (const [name, { header }] of FUNCTIONS) {
    assert.match(header, /security definer/, `${name} is not security definer`);
    // pg_temp last: left implicit, Postgres searches it FIRST for relations.
    assert.match(
      header,
      /security definer set search_path = public, pg_temp as\s*$/,
      `${name} must pin search_path = public, pg_temp`,
    );
  }
});

test('seat-claiming functions lock the household row and enforce the 3-person cap', () => {
  for (const name of SEAT_FUNCTIONS) {
    const fn = FUNCTIONS.get(name);
    assert.ok(fn, `missing function ${name}`);
    assert.match(
      fn.body,
      /from public\.households where id = \w+ and status <> 'cancelled' for update/,
      `${name} does not lock the household row`,
    );
    assert.match(fn.body, CAP_CHECK[name], `${name} does not check the cap exactly`);
    assert.match(fn.body, /'family_full'/, `${name} never refuses a full family`);
  }
  // The count covers accounts, name-only people and live pending invitations,
  // except an invitation riding on a name-only person still in the family.
  const seats = FUNCTIONS.get('family_seats_used').body;
  assert.match(seats, /from public\.members where household_id = p_household/);
  assert.match(
    seats,
    /from public\.household_members where household_id = p_household and member_id is null/,
  );
  assert.match(seats, /i\.status = 'pending' and i\.expires_at > now\(\)/);
  assert.match(
    seats,
    /and not exists \(select 1 from public\.household_members p where p\.id = i\.person_id and p\.household_id = i\.household_id and p\.member_id is null\)/,
  );
});

test('inviting a name-only person is checked under the household lock and takes no new seat', () => {
  const body = FUNCTIONS.get('family_create_invite').body;
  const lock = body.indexOf("status <> 'cancelled' for update");
  const person = body.indexOf(
    'from public.household_members where id = p_person_id and household_id = p_household and member_id is null for update',
  );
  assert.ok(lock >= 0 && person > lock, 'the person must be checked after the household lock');
  assert.match(body, /'person_not_found'/);
  // Only an invitation WITHOUT a person needs a free seat.
  assert.match(body, /elsif public\.family_seats_used\(p_household\) >= 3 then/);
  assert.match(
    body,
    /where person_id = p_person_id and status = 'pending'\) then return jsonb_build_object\('ok', false, 'reason', 'person_already_invited'\)/,
  );
  // Stale invitations are expired before any duplicate check runs.
  const expire = body.indexOf("set status = 'expired'");
  const personCheck = body.indexOf("'person_already_invited'");
  assert.ok(expire >= 0 && personCheck >= 0, 'expiry update or person check missing');
  assert.ok(expire < personCheck, 'stale invitations must be expired before the person check');
});

test('accepting links the name-only row it rides on and counts the invitation once', () => {
  const body = FUNCTIONS.get('family_accept_invite').body;
  assert.match(
    body,
    /where id = v_invite\.person_id and household_id = v_household and member_id is null for update/,
  );
  assert.match(
    body,
    /family_seats_used\(v_household, p_invite\) \+ \(case when v_person is null then 1 else 0 end\) > 3/,
  );
  assert.match(
    body,
    /if v_person is not null then update public\.household_members set member_id = p_member, email = lower\(p_email\) where id = v_person; else insert into public\.household_members/,
  );
});

test('accepting checks the invite email, NULL included, and locks the member before linking', () => {
  const body = FUNCTIONS.get('family_accept_invite').body;
  assert.match(
    body,
    /if p_email is null or lower\(v_invite\.email\) is distinct from lower\(p_email\) then return jsonb_build_object\('ok', false, 'reason', 'wrong_email'\)/,
  );
  assert.match(
    body,
    /select household_id into v_current from public\.members where id = p_member for update; if not found then return jsonb_build_object\('ok', false, 'reason', 'no_member'\); end if; if v_current is not null then return jsonb_build_object\('ok', false, 'reason', 'already_in_household'\)/,
  );
  const memberLock = body.indexOf('from public.members where id = p_member for update');
  const link = body.indexOf('update public.members set household_id = v_household');
  assert.ok(memberLock >= 0 && link >= 0, 'member lock or link missing');
  assert.ok(memberLock < link, 'the member must be locked before it is linked');
});

test('removing a person and leaving recheck the family under the household lock', () => {
  for (const name of ['family_remove_person', 'family_leave']) {
    const fn = FUNCTIONS.get(name);
    assert.ok(fn, `missing function ${name}`);
    assert.match(
      fn.body,
      /from public\.households where id = p_household and status <> 'cancelled' for update/,
      `${name} does not lock the household row`,
    );
  }
  const remove = FUNCTIONS.get('family_remove_person').body;
  const at = {
    lock: remove.indexOf("status <> 'cancelled' for update"),
    rule: remove.indexOf("'last_person'"),
    unlink: remove.indexOf('update public.members set household_id = null'),
    del: remove.indexOf('delete from public.household_members'),
  };
  for (const [what, i] of Object.entries(at)) assert.ok(i >= 0, `family_remove_person: ${what}`);
  assert.ok(
    at.lock < at.rule && at.rule < at.unlink && at.rule < at.del,
    'the last-person rule must be checked under the lock, before any change',
  );
  // Other people = linked accounts except the founder + name-only people; invitations are not people.
  assert.match(
    remove,
    /\(select count\(\*\) from public\.members where household_id = p_household and id is distinct from v_founder\) \+ \(select count\(\*\) from public\.household_members where household_id = p_household and member_id is null\)/,
  );
  const leave = FUNCTIONS.get('family_leave').body;
  const lock = leave.indexOf("status <> 'cancelled' for update");
  const unlink = leave.indexOf(
    'update public.members set household_id = null where id = p_member and household_id = p_household',
  );
  assert.ok(lock >= 0 && unlink >= 0 && lock < unlink, 'family_leave must unlink under the lock');
});

test('only service_role may execute the family_* functions', () => {
  for (const name of FUNCTIONS.keys()) {
    const holders = new Set(['public', ...BROWSER, 'service_role']); // Supabase defaults
    for (const s of ALL) {
      const m = s.match(
        /^(grant|revoke) execute on function (?:public\.)?(\w+)\s*\(.*?\) (?:to|from) (.+)$/,
      );
      if (!m || m[2] !== name) continue;
      for (const r of rolesOf(m[3])) m[1] === 'grant' ? holders.add(r) : holders.delete(r);
    }
    assert.deepEqual([...holders], ['service_role'], `${name} is executable by ${[...holders]}`);
  }
});

test('each family_* function has its own explicit revoke from public, anon, authenticated and grant to service_role', () => {
  for (const name of FUNCTIONS.keys()) {
    const fn = new RegExp(`^(grant|revoke) execute on function public\\.${name}\\s*\\([^)]*\\) `);
    const own = ALL.filter((s) => fn.test(s));
    assert.ok(
      own.some((s) => s.endsWith(' from public, anon, authenticated')),
      `${name}: no "revoke execute ... from public, anon, authenticated"`,
    );
    assert.ok(
      own.some((s) => s.startsWith('grant ') && s.endsWith(' to service_role')),
      `${name}: no "grant execute ... to service_role"`,
    );
  }
  // The revoked/granted signature must be the one created, or the new overload stays open.
  const create = /create or replace function public\.family_create_invite\s*\(([^)]*)\)/.exec(
    flat(OWN.sql),
  );
  const types = create[1]
    .split(',')
    .map((p) => p.trim().split(' ')[1])
    .join(', ');
  assert.ok(
    ALL.includes(
      `revoke execute on function public.family_create_invite(${types}) from public, anon, authenticated`,
    ),
    `no revoke for family_create_invite(${types})`,
  );
});
