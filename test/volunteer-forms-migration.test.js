// Pins 0035: the volunteer forms. events.volunteer_questions and
// event_volunteers.answers are added (never dropped), form_templates is a
// server-only table with one default per kind, and the two seeds are guarded so
// re-pasting neither duplicates them nor overwrites an admin's edit. The
// seeded questions must be ones validateQuestions accepts, or the dialog would
// ask nothing.
//
// There is no database in CI, so this reads supabase/migrations/*.sql as text
// and checks what the migration says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateQuestions } from '../functions/api/_event-form.js';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION = FILES.find((f) => f.endsWith('_volunteer_forms.sql'));
const SQL = MIGRATION ? await readFile(new URL(MIGRATION, DIR), 'utf8') : '';

// The seeded question lists, as JSON, in file order.
const seeds = () => [...SQL.matchAll(/\$q\$([\s\S]*?)\$q\$/g)].map((m) => JSON.parse(m[1]));

// Statements, lower-cased with whitespace collapsed, comments out; the $q$
// bodies blanked first so their text is not split or searched.
const statements = (sql) =>
  sql
    .replace(/\$q\$[\s\S]*?\$q\$/g, "'…'")
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
const OWN = statements(SQL);

test('supabase/migrations/0035_volunteer_forms.sql exists', () => {
  assert.equal(MIGRATION, '0035_volunteer_forms.sql');
});

test('the two columns are added, guarded, and nothing is dropped', () => {
  assert.ok(
    OWN.includes('alter table public.events add column if not exists volunteer_questions jsonb'),
  );
  assert.ok(
    OWN.includes(
      "alter table public.event_volunteers add column if not exists answers jsonb not null default '{}'::jsonb",
    ),
  );
  assert.equal(
    OWN.some((s) => /\bdrop\b/.test(s)),
    false,
  );
});

test('form_templates: one default per kind, checked kind and name, server-only', () => {
  const create = OWN.find((s) => s.startsWith('create table if not exists public.form_templates'));
  assert.ok(create, 'create table statement');
  assert.match(create, /kind text not null check \(kind in \('volunteer', 'registration'\)\)/);
  assert.match(create, /name text not null check \(length\(btrim\(name\)\) between 1 and 80\)/);
  assert.match(create, /questions jsonb not null default '\[\]'::jsonb/);
  assert.match(create, /is_default boolean not null default false/);
  const index = OWN.find((s) => s.startsWith('create unique index'));
  assert.match(index, /on public\.form_templates \(kind\) where is_default/);
  assert.ok(OWN.includes('alter table public.form_templates enable row level security'));
  assert.ok(OWN.includes('revoke all on table public.form_templates from anon, authenticated'));
  for (const s of OWN) {
    if (!s.includes('form_templates')) continue;
    assert.equal(/^create policy/.test(s), false, s);
    assert.equal(/^grant /.test(s), false, s);
  }
});

test('the seeds: a default general template and a reference event template, both valid, both guarded', () => {
  const lists = seeds();
  assert.equal(lists.length, 2);
  for (const list of lists) {
    const { questions, error } = validateQuestions(list);
    assert.equal(error, undefined);
    // Normalization changes nothing: what is pasted is exactly what is stored.
    assert.deepEqual(questions, list);
  }
  // The dialog's old chips live on as the default template's first questions.
  const [general, reference] = lists;
  assert.deepEqual(
    general.map((q) => q.id),
    ['interests', 'availability', 'notes'],
  );
  assert.ok(general[0].options.some((o) => o.label_zh === '活动现场协调'));
  // The festival's shift and station questions, for an admin to copy and re-time.
  assert.deepEqual(
    reference.map((q) => q.id),
    ['certificate_name', 'wechat', 'about_you', 'shifts', 'roles', 'notes'],
  );
  assert.equal(reference.find((q) => q.id === 'shifts').required, true);

  const inserts = OWN.filter((s) => s.startsWith('insert into public.form_templates'));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0], /'volunteer', 'general volunteer', true/);
  assert.match(
    inserts[0],
    /where not exists \(select 1 from public\.form_templates where kind = 'volunteer'\)/,
  );
  assert.match(inserts[1], /'volunteer', 'event volunteer \(reference\)', false/);
  assert.match(inserts[1], /and name = 'event volunteer \(reference\)'\)/);
});

test('every create is guarded, and the header says how to run it', () => {
  for (const s of OWN.filter((x) => /^create (table|index|unique index)/.test(x)))
    assert.match(s, /if not exists/, s.slice(0, 80));
  const header = SQL.slice(0, SQL.indexOf('alter table'));
  assert.match(header, /Run via: paste into the Supabase SQL editor/);
  assert.match(header, /Idempotent/);
  assert.match(header, /server-only/);
});
