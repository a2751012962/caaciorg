// Pins the access model of public.event_registrations (0015). The table holds
// registrants' email addresses, the names of who they are bringing and how they
// heard about the event; only /api/event-register and
// /api/admin/event-registrations touch it, with the service-role key, which
// bypasses RLS and table grants. Supabase grants anon and authenticated every
// privilege on a new table in `public` by default, so without 0015's lockdown
// anyone holding the anon key could read or rewrite it through PostgREST.
//
// There is no database in CI, so this replays supabase/migrations/*.sql as text,
// in file order: RLS on/off, the policies created and dropped, and the table
// privileges anon and authenticated hold, starting from Supabase's defaults.
// It checks what the migrations say; confirm the live project against
// pg_policies and information_schema.role_table_grants after applying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const TABLE = 'event_registrations';
const ROLES = ['anon', 'authenticated'];
const PRIVS = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

// Statements of one file, lower-cased with whitespace collapsed. Comments are
// removed first, then $$ function bodies, which carry semicolons of their own.
const statements = (sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);

const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = FILES.find((f) => f.endsWith('_event_registrations.sql'));
const ALL = [];
for (const file of FILES) ALL.push(...statements(await readFile(new URL(file, DIR), 'utf8')));
const OWN = MIGRATION ? statements(await readFile(new URL(MIGRATION, DIR), 'utf8')) : [];

const isTable = (name) => name === TABLE || name === `public.${TABLE}`;

// Final state of public.event_registrations after `list`. A policy/grant/RLS
// statement naming the table that the model cannot read lands in `unhandled`,
// so a new statement shape fails the test instead of slipping past.
function replay(list) {
  const state = {
    created: false,
    rls: false,
    policies: new Set(),
    grants: Object.fromEntries(ROLES.map((r) => [r, new Set(PRIVS)])),
    unhandled: [],
  };
  for (const s of list) {
    let m;
    if ((m = s.match(/^create table (?:if not exists )?([\w.]+)/))) {
      if (isTable(m[1])) state.created = true;
    } else if (
      (m = s.match(
        /^alter table (?:if exists )?(?:only )?([\w.]+) (enable|disable) row level security$/,
      ))
    ) {
      if (isTable(m[1])) state.rls = m[2] === 'enable';
    } else if ((m = s.match(/^create policy (\w+) on ([\w.]+)/))) {
      if (isTable(m[2])) state.policies.add(m[1]);
    } else if ((m = s.match(/^drop policy (?:if exists )?(\w+) on ([\w.]+)/))) {
      if (isTable(m[2])) state.policies.delete(m[1]);
    } else if ((m = s.match(/^(grant|revoke) (.+?) on (?:table )?(.+?) (?:to|from) (.+)$/))) {
      const [, verb, privList, target, roleList] = m;
      const hit =
        target === 'all tables in schema public' ||
        target.split(',').some((t) => isTable(t.trim()));
      // Before the table exists a schema-wide grant does not reach it.
      if (!hit || !state.created) continue;
      const privs = privList
        .replace(/\([^)]*\)/g, '') // a column list still grants the privilege
        .split(',')
        .map((p) => p.trim())
        .flatMap((p) => (/^all( privileges)?$/.test(p) ? PRIVS : [p]));
      const names = roleList
        .replace(/ (with grant option|granted by \w+|cascade|restrict)/g, '')
        .split(',')
        .map((r) => r.trim());
      // A grant to PUBLIC reaches every role; a revoke from PUBLIC leaves the
      // roles' own grants in place.
      const roles =
        verb === 'grant' && names.includes('public')
          ? ROLES
          : ROLES.filter((r) => names.includes(r));
      for (const r of roles) {
        for (const p of privs) {
          if (verb === 'grant') state.grants[r].add(p);
          else state.grants[r].delete(p);
        }
      }
    } else if (/^((create|alter|drop) policy|grant|revoke) |row level security/.test(s)) {
      if (s.includes(TABLE)) state.unhandled.push(s);
    }
  }
  return state;
}

const snapshot = (st) => ({
  rls: st.rls,
  policies: [...st.policies].sort(),
  grants: Object.fromEntries(ROLES.map((r) => [r, [...st.grants[r]].sort()])),
});

test('the replay understands every RLS, policy and grant statement on event_registrations', () => {
  assert.ok(MIGRATION, 'expected supabase/migrations/NNNN_event_registrations.sql');
  const st = replay(ALL);
  assert.deepEqual(st.unhandled, [], 'teach replay() the new statement form before relying on it');
  assert.equal(st.created, true, `did not see ${MIGRATION} create the table`);
});

test('without its lockdown statements, the replay sees full browser access (negative control)', () => {
  const unlocked = OWN.filter((s) => !/^revoke |row level security$/.test(s));
  const st = replay(unlocked);
  assert.equal(st.rls, false);
  for (const r of ROLES) assert.deepEqual([...st.grants[r]].sort(), [...PRIVS].sort(), r);
});

test('after every migration: RLS on, no policies, and anon/authenticated hold no privilege', () => {
  const st = replay(ALL);
  assert.equal(st.rls, true, 'RLS enabled');
  assert.deepEqual([...st.policies], [], 'no policies — server-only');
  for (const r of ROLES) assert.deepEqual([...st.grants[r]], [], `${r} table privileges`);
});

test('0015 is safe to paste twice: every create is guarded and the end state is unchanged', () => {
  for (const s of OWN.filter((x) => /^create (table|index|unique index)|add column/.test(x))) {
    assert.match(s, /if not exists/, s.slice(0, 80));
  }
  assert.equal(
    OWN.some((s) => s.startsWith('create policy')),
    false,
    'a bare create policy fails on re-run',
  );
  assert.deepEqual(snapshot(replay([...ALL, ...OWN])), snapshot(replay(ALL)));
});

test('the table has the unique key and first-submission time /api/event-register relies on', () => {
  const create = OWN.find((s) =>
    /^create table (if not exists )?(public\.)?event_registrations/.test(s),
  );
  assert.ok(create, 'create table statement');
  // PostgREST's on_conflict=event_id,email needs a unique constraint on exactly these columns.
  assert.match(create, /unique \(event_id, email\)/);
  assert.match(create, /email text not null check \(email = lower\(email\)\)/);
  assert.match(create, /created_at timestamptz not null default now\(\)/);
  assert.match(create, /event_id uuid not null references public\.events\(id\) on delete cascade/);
  assert.ok(
    OWN.some((s) =>
      /^alter table public\.events add column if not exists perk_deadline timestamptz$/.test(s),
    ),
    'events.perk_deadline',
  );
});
