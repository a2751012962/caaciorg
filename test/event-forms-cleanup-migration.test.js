// Pins the event-forms cleanup migration, pasted into the SQL editor of the live
// database once production runs the 0018 code. There is no database in CI, so
// this reads the SQL as text: a guard that stops the paste before anything is
// dropped if a registration's legacy values never reached `answers`, then
// exactly the trigger, the two functions and the four legacy columns 0018 left
// behind, each dropped with if exists, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const FILES = (await readdir(DIR)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const NAME = FILES.find((f) => f.endsWith('_drop_legacy_event_registration_columns.sql'));
const read = (name) => readFile(new URL(name, DIR), 'utf8');
const noComments = (sql) => sql.replace(/--[^\n]*/g, '');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

const SQL = await read(NAME);
const NO_COMMENTS = noComments(SQL);
// Statements, lower-cased with whitespace collapsed; the $…$ body of the guard
// replaced so its semicolons cannot split a statement.
const STATEMENTS = NO_COMMENTS.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "'<body>'")
  .split(';')
  .map((s) => collapse(s).toLowerCase())
  .filter(Boolean);

const LEGACY_COLUMNS = ['attending', 'attendee_names', 'heard_from', 'wants_meal'];

test('the cleanup migration comes after 0018 and says how it is applied', () => {
  assert.ok(NAME, 'supabase/migrations/NNNN_drop_legacy_event_registration_columns.sql');
  assert.ok(FILES.indexOf(NAME) > FILES.indexOf('0018_event_forms.sql'));
  assert.match(
    SQL,
    /^-- Run via: paste into the Supabase SQL editor \(never supabase db push on this project; see SETUP\.md\)$/m,
  );
});

test('the cleanup runs its guard, then drops exactly the 0018 trigger, both functions and the legacy columns', () => {
  assert.deepEqual(STATEMENTS, [
    "do '<body>'",
    // The trigger before the function it runs.
    'drop trigger if exists event_registrations_sync_answers on public.event_registrations',
    'drop function if exists public.event_registrations_sync_answers()',
    'drop function if exists public.event_registration_legacy_answers(boolean, text, text, boolean)',
    ...LEGACY_COLUMNS.map(
      (c) => `alter table public.event_registrations drop column if exists ${c}`,
    ),
  ]);
  assert.doesNotMatch(NO_COMMENTS, /\bcascade\b/i, 'nothing else goes with them');
});

test('the cleanup drops what 0018 created and 0015 added, keeping the columns the code uses', async () => {
  const created = noComments(await read('0018_event_forms.sql'));
  const args =
    /create or replace function public\.event_registration_legacy_answers\(([\s\S]*?)\)\s*returns/.exec(
      created,
    )?.[1];
  assert.ok(args, '0018 creates the mapping function');
  const types = args.split(',').map((a) => collapse(a).split(' ').pop());
  assert.ok(
    STATEMENTS.includes(
      `drop function if exists public.event_registration_legacy_answers(${types.join(', ')})`,
    ),
    'dropped with the signature 0018 created',
  );
  assert.match(created, /create or replace function public\.event_registrations_sync_answers\(\)/);
  assert.match(created, /create trigger event_registrations_sync_answers\b/);

  const table = /create table if not exists public\.event_registrations \(([\s\S]*?)\n\);/.exec(
    noComments(await read('0015_event_registrations.sql')),
  )?.[1];
  assert.ok(table, '0015 creates event_registrations');
  for (const column of LEGACY_COLUMNS) assert.match(table, new RegExp(`^\\s*${column}\\s`, 'm'));
  const dropped = STATEMENTS.filter((s) => s.includes('drop column'));
  for (const kept of [
    'id',
    'event_id',
    'email',
    'member_id',
    'created_at',
    'updated_at',
    'answers',
  ])
    assert.equal(
      dropped.some((s) => s.endsWith(` ${kept}`)),
      false,
      kept,
    );
});

test('the guard stops the paste before any drop while a registration has legacy values but no answers, and skips once the columns are gone', () => {
  const guard = /do \$guard\$([\s\S]*?)\$guard\$/.exec(NO_COMMENTS)?.[1];
  assert.ok(guard, 'the $guard$ block');
  const g = collapse(guard).toLowerCase();
  assert.equal(STATEMENTS[0], "do '<body>'", 'the guard runs first');
  assert.ok(
    g.includes(
      "if exists ( select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_registrations' and column_name = 'attending' ) then",
    ),
    'a second paste, after the columns are gone, skips the check',
  );
  assert.ok(
    g.includes(
      "select count(*) from public.event_registrations where answers = '{}'::jsonb and (attending is not null or nullif(btrim(attendee_names), '') is not null or nullif(btrim(heard_from), '') is not null or wants_meal is not null)",
    ),
  );
  // Dynamic, so the column references are only parsed when the columns exist.
  assert.match(g, /execute \$q\$ select count\(\*\)/);
  assert.match(g, /\$q\$ into unmapped; if unmapped > 0 then raise exception '/);
});
