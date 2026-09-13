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
const BROWSER = ['anon', 'authenticated'];

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
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
  assert.match(OWN.sql, /Apply by pasting into the Supabase SQL editor, in filename order/);
  assert.match(OWN.sql, /create table if not exists public\.household_events\b/i);
  assert.match(
    OWN.sql,
    /add column if not exists founder_member_id uuid references public\.members\(id\) on delete set null/i,
  );
  assert.match(
    stripComments(OWN.sql).replace(/\s+/g, ' '),
    /create unique index if not exists \w+ on public\.household_invites \(household_id, lower\(email\)\) where status = 'pending'/i,
  );
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

test('every family_* function is security definer with a pinned search_path', () => {
  assert.ok(FUNCTIONS.size >= 4, `found only ${[...FUNCTIONS.keys()].join(', ')}`);
  for (const [name, { header }] of FUNCTIONS) {
    assert.match(header, /security definer/, `${name} is not security definer`);
    assert.match(header, /set search_path = public/, `${name} has no pinned search_path`);
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
    assert.match(fn.body, /family_seats_used\([^)]*\) >= 3/, `${name} does not check the cap`);
    assert.match(fn.body, /'family_full'/, `${name} never refuses a full family`);
  }
  // Accepting must not count its own invitation on top of the account it links.
  assert.match(
    FUNCTIONS.get('family_accept_invite').body,
    /family_seats_used\(v_household, p_invite\)/,
  );
  // The count covers accounts, name-only people and live pending invitations.
  const seats = FUNCTIONS.get('family_seats_used').body;
  assert.match(seats, /from public\.members where household_id = p_household/);
  assert.match(
    seats,
    /from public\.household_members where household_id = p_household and member_id is null/,
  );
  assert.match(seats, /status = 'pending' and expires_at > now\(\)/);
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
