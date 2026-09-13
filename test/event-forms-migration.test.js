// Pins 0018_event_forms.sql, which is pasted into the SQL editor of a database
// that already holds real Mid-Autumn registrations written by the code live at
// the time. There is no database in CI, so this reads the SQL as text: every
// schema change is guarded, the legacy column the live code still writes stays
// writable, and both backfills only touch rows nobody has filled in yet.
// (The migration was also executed, twice, in PGlite against live-shaped rows
// before it was committed; that check is not part of the suite.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateQuestions } from '../functions/api/_event-form.js';

const SQL = await readFile(
  new URL('../supabase/migrations/0018_event_forms.sql', import.meta.url),
  'utf8',
);

// Statements, lower-cased with whitespace collapsed; comments dropped and the
// $questions$ JSON replaced so its punctuation cannot split a statement.
const STATEMENTS = SQL.replace(/--[^\n]*/g, '')
  .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "'<json>'")
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);

test('0018 says how it is applied', () => {
  assert.match(
    SQL,
    /^-- Run via: paste into the Supabase SQL editor \(never supabase db push on this project; see SETUP\.md\)$/m,
  );
});

test('0018 adds the event and answer columns, each guarded', () => {
  for (const column of [
    'alter table public.events add column if not exists title_zh text',
    'alter table public.events add column if not exists registration_questions jsonb',
    'alter table public.events add column if not exists perk_item_zh text',
    'alter table public.events add column if not exists perk_item_en text',
    "alter table public.event_registrations add column if not exists answers jsonb not null default '{}'::jsonb",
  ]) {
    assert.ok(STATEMENTS.includes(column), column);
  }
  for (const s of STATEMENTS.filter((x) => /add column|^create /.test(x))) {
    assert.match(s, /if not exists/, s.slice(0, 80));
  }
});

test('0018 keeps the live code working: attending loses not-null, no legacy column is dropped', () => {
  assert.ok(
    STATEMENTS.includes(
      'alter table public.event_registrations alter column attending drop not null',
    ),
  );
  assert.equal(
    STATEMENTS.some((s) => /drop column|drop table|rename/.test(s)),
    false,
    'the legacy columns stay until a later migration',
  );
});

test('0018 adds no function, grant or policy', () => {
  for (const s of STATEMENTS) {
    assert.doesNotMatch(s, /^(create (or replace )?function|grant |create policy|alter policy)/, s);
  }
});

test('0018 only fills in the Mid-Autumn event while its questions are still null', () => {
  const updates = STATEMENTS.filter((s) => s.startsWith('update public.events'));
  assert.equal(updates.length, 1);
  const [u] = updates;
  assert.match(u, /where slug = 'mid-autumn-festival' and registration_questions is null$/);
  assert.match(u, /title_zh = coalesce\(title_zh, '中秋节'\)/);
  assert.match(u, /perk_item_zh = coalesce\(perk_item_zh, '月饼'\)/);
  assert.match(u, /perk_item_en = coalesce\(perk_item_en, 'mooncake'\)/);
});

test('0018 only builds answers for Mid-Autumn rows the old code wrote that have none yet', () => {
  const updates = STATEMENTS.filter((s) => s.startsWith('update public.event_registrations'));
  assert.equal(updates.length, 1);
  const [u] = updates;
  assert.match(u, /e\.slug = 'mid-autumn-festival'/);
  assert.match(u, /r\.answers = '\{\}'::jsonb/);
  assert.match(u, /r\.attending is not null/);
  // Every legacy value the live form stored has a mapping.
  for (const [label, id] of [
    ['Website', 'website'],
    ['Friend', 'friend'],
    ['Newsletter', 'newsletter'],
    ['Social Media', 'social'],
  ]) {
    assert.ok(
      u.includes(
        `when r.heard_from = '${label.toLowerCase()}' then jsonb_build_object('option', '${id}')`,
      ),
      label,
    );
  }
  assert.match(u, /else jsonb_build_object\('other', r\.heard_from\)/);
  assert.match(u, /'names', nullif\(btrim\(r\.attendee_names\), ''\)/);
  assert.match(u, /jsonb_strip_nulls/);
});

// The questions the page will render and /api/event-register will validate
// against: they must already be in the normalized shape, with the stable ids.
test('0018 Mid-Autumn questions are valid, normalized and keep the ids the answers use', () => {
  const json = SQL.match(/\$questions\$([\s\S]*?)\$questions\$/)?.[1];
  assert.ok(json, 'the $questions$ block');
  const raw = JSON.parse(json);
  const { questions, error } = validateQuestions(raw);
  assert.equal(error, undefined);
  assert.deepEqual(questions, raw, 'stored exactly as validateQuestions normalizes it');
  assert.deepEqual(
    questions.map((q) => [q.id, q.type, q.required, q.other ?? null]),
    [
      ['attending', 'single', true, false],
      ['names', 'textarea', true, null],
      ['heard_from', 'single', false, true],
      ['meal', 'single', false, false],
    ],
  );
  assert.deepEqual(
    questions[0].options.map((o) => [o.id, o.label_en, o.label_zh]),
    [
      ['yes', "Yes, I'll be there", '能，我会参加'],
      ['no', "Sorry, can't make it", '抱歉，无法参加'],
    ],
  );
  assert.deepEqual(
    questions[2].options.map((o) => o.id),
    ['website', 'friend', 'newsletter', 'social'],
  );
  assert.deepEqual(
    questions[3].options.map((o) => o.id),
    ['yes', 'no'],
  );
});
