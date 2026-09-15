// Pins the shape and the access model of public.event_volunteers (0021). The
// table holds volunteers' names, email addresses and phone numbers; only
// /api/volunteer, /api/event-register and /api/admin/event-volunteers touch it,
// with the service-role key, which bypasses RLS and table grants. Supabase
// grants anon and authenticated every privilege on a new table in `public` by
// default, so without 0021's lockdown anyone holding the anon key could read or
// rewrite it through PostgREST.
//
// There is no database in CI, so this reads supabase/migrations/*.sql as text.
// It checks what the migration says; confirm the live project against
// pg_policies and information_schema.role_table_grants after applying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const TABLE = 'event_volunteers';

// Statements of one file, lower-cased with whitespace collapsed, comments out.
const statements = (sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);

const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = FILES.find((f) => f.endsWith('_event_volunteers.sql'));
const OWN = MIGRATION ? statements(await readFile(new URL(MIGRATION, DIR), 'utf8')) : [];
const ALL = [];
for (const file of FILES) ALL.push(...statements(await readFile(new URL(file, DIR), 'utf8')));

const create = () =>
  OWN.find((s) => new RegExp(`^create table (if not exists )?(public\\.)?${TABLE}`).test(s));

test('supabase/migrations/NNNN_event_volunteers.sql exists and creates the table', () => {
  assert.ok(MIGRATION, 'expected supabase/migrations/NNNN_event_volunteers.sql');
  assert.equal(MIGRATION, '0021_event_volunteers.sql');
  assert.ok(create(), 'create table statement');
});

test('the columns /api/volunteer relies on', () => {
  const sql = create();
  // event_id is nullable on purpose: null is the "no particular event" sign-up.
  assert.match(sql, /event_id uuid references public\.events\(id\) on delete cascade/);
  assert.equal(/event_id uuid not null/.test(sql), false, 'event_id must stay nullable');
  assert.match(sql, /name text not null/);
  assert.match(sql, /email text not null check \(email = lower\(email\)\)/);
  assert.match(sql, /member_id uuid references auth\.users\(id\) on delete set null/);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
  assert.match(sql, /updated_at timestamptz not null default now\(\)/);
  // source says which form made the row, and only those two forms exist.
  assert.match(sql, /source text not null default 'volunteer'/);
  assert.match(sql, /check \(source in \('volunteer', 'registration'\)\)/);
});

test('the unique key upsert on_conflict=event_id,email needs, with nulls not distinct', () => {
  const index = OWN.find((s) => /^create unique index/.test(s));
  assert.ok(index, 'unique index statement');
  assert.match(index, new RegExp(`on public\\.${TABLE} \\(event_id, email\\)`));
  // Without this Postgres treats every null event_id as distinct, so the
  // "any event" sign-up would stack up a new row on every submission.
  assert.match(index, /nulls not distinct/);
});

test('server-only: RLS enabled, no policies, and anon/authenticated revoked', () => {
  assert.ok(OWN.includes(`alter table public.${TABLE} enable row level security`), 'RLS enabled');
  assert.ok(
    OWN.includes(`revoke all on table public.${TABLE} from anon, authenticated`),
    'privileges revoked from both browser roles',
  );
  // No migration, now or later, may hand the table back to a browser role.
  for (const s of ALL) {
    if (!s.includes(TABLE)) continue;
    assert.equal(/^create policy/.test(s), false, `unexpected policy: ${s}`);
    assert.equal(/^grant /.test(s), false, `unexpected grant on ${TABLE}: ${s}`);
    assert.equal(/disable row level security/.test(s), false, `RLS must stay enabled: ${s}`);
  }
});

test('0021 is safe to paste twice: every create is guarded', () => {
  for (const s of OWN.filter((x) => /^create (table|index|unique index)/.test(x))) {
    assert.match(s, /if not exists/, s.slice(0, 80));
  }
});

test('the header explains itself in the 0015/0018 style', async () => {
  const text = await readFile(new URL(MIGRATION, DIR), 'utf8');
  const header = text.slice(0, text.indexOf('create table'));
  assert.match(header, /Run via: paste into the Supabase SQL editor/);
  assert.match(header, /Idempotent/);
  assert.match(header, /service-role/);
});
