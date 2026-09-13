// Pins 0018_event_forms.sql, which is pasted into the SQL editor of a database
// that already holds real Mid-Autumn registrations written by the code live at
// the time — code that keeps writing only the legacy columns until this
// release is deployed. There is no database in CI, so this reads the SQL as
// text: every schema change is guarded, the legacy column the live code still
// writes stays writable, both backfills only touch rows nobody has filled in
// yet, and one mapping function feeds both the backfill and the trigger that
// keeps the live code's writes in step.
// (The migration was also executed in PGlite — pasted repeatedly, with
// old-code and new-code upserts through the trigger — before it was
// committed; that check is not part of the suite.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateQuestions } from '../functions/api/_event-form.js';

const SQL = await readFile(
  new URL('../supabase/migrations/0018_event_forms.sql', import.meta.url),
  'utf8',
);
const NO_COMMENTS = SQL.replace(/--[^\n]*/g, '');

// Statements, lower-cased with whitespace collapsed; comments dropped and the
// $…$ bodies (the questions JSON, function bodies) replaced so their
// punctuation cannot split a statement.
const STATEMENTS = NO_COMMENTS.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "'<body>'")
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter(Boolean);

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
// The declaration (arguments … `as`) and the $fn$ body of one function.
function fn(name) {
  const m = new RegExp(
    `create or replace function public\\.${name}\\(([\\s\\S]*?)\\$fn\\$([\\s\\S]*?)\\$fn\\$`,
  ).exec(NO_COMMENTS);
  assert.ok(m, `function public.${name}`);
  return { header: collapse(m[1]), body: collapse(m[2]) };
}

const MAPPING = 'event_registration_legacy_answers';
const SYNC = 'event_registrations_sync_answers';
const MAPPING_SIG = `public.${MAPPING}(boolean, text, text, boolean)`;

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
  for (const s of STATEMENTS.filter((x) =>
    /add column|^create (table|index|unique index)/.test(x),
  )) {
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
    STATEMENTS.some((s) => /drop column|drop table|drop function|rename/.test(s)),
    false,
    'the legacy columns, trigger and functions stay until a later cleanup migration',
  );
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

test('0018 maps legacy columns to answers in one function', () => {
  const { header, body } = fn(MAPPING);
  assert.match(
    header,
    /^attending boolean, attendee_names text, heard_from text, wants_meal boolean \) returns jsonb language sql immutable set search_path = '' as$/,
  );
  assert.match(body, /^select jsonb_strip_nulls\(jsonb_build_object\(/);
  assert.ok(
    body.includes(
      "'attending', case when attending is null then null else jsonb_build_object('option', case when attending then 'yes' else 'no' end) end",
    ),
  );
  assert.ok(body.includes("'names', nullif(btrim(attendee_names), '')"));
  // Every legacy value the live form stored has a mapping; anything else was typed as Other.
  for (const [label, id] of [
    ['Website', 'website'],
    ['Friend', 'friend'],
    ['Newsletter', 'newsletter'],
    ['Social Media', 'social'],
  ]) {
    assert.ok(
      body.includes(`when heard_from = '${label}' then jsonb_build_object('option', '${id}')`),
      label,
    );
  }
  assert.ok(body.includes("when heard_from is null or btrim(heard_from) = '' then null"));
  assert.ok(body.includes("else jsonb_build_object('other', heard_from)"));
  assert.ok(
    body.includes(
      "'meal', case when wants_meal is null then null else jsonb_build_object('option', case when wants_meal then 'yes' else 'no' end) end",
    ),
  );
  // A single source: the mapping is written once in the file.
  assert.equal(NO_COMMENTS.split("jsonb_build_object('option', 'website')").length - 1, 1);
});

test('0018 backfills only Mid-Autumn rows the old code wrote that have no answers yet, through the mapping', () => {
  const updates = STATEMENTS.filter((s) => s.startsWith('update public.event_registrations'));
  assert.equal(updates.length, 1);
  assert.equal(
    updates[0],
    'update public.event_registrations r set answers = public.event_registration_legacy_answers( r.attending, r.attendee_names, r.heard_from, r.wants_meal) ' +
      "from public.events e where e.id = r.event_id and e.slug = 'mid-autumn-festival' and r.answers = '{}'::jsonb and r.attending is not null",
  );
});

test('0018 trigger maps an old-code insert or resubmission, and leaves new-code writes alone', () => {
  const { header, body } = fn(SYNC);
  assert.match(header, /^\) returns trigger language plpgsql set search_path = '' as$/);
  const call = `new.answers := public.${MAPPING}( new.attending, new.attendee_names, new.heard_from, new.wants_meal);`;
  assert.equal(
    body,
    'begin ' +
      // No attending value: not an old-code write (the new code never sends one).
      'if new.attending is null then return new; end if; ' +
      // Insert: legacy values and no answers.
      `if tg_op = 'INSERT' then if new.answers = '{}'::jsonb then ${call} end if; ` +
      // Update: a legacy column changed and answers did not — including an
      // old-code resubmission of a row that already has answers.
      'elsif (new.attending, new.attendee_names, new.heard_from, new.wants_meal) ' +
      'is distinct from (old.attending, old.attendee_names, old.heard_from, old.wants_meal) ' +
      `and new.answers is not distinct from old.answers then ${call} end if; ` +
      'return new; end;',
  );

  const drop = STATEMENTS.indexOf(`drop trigger if exists ${SYNC} on public.event_registrations`);
  const create = STATEMENTS.indexOf(
    `create trigger ${SYNC} before insert or update on public.event_registrations for each row execute function public.${SYNC}()`,
  );
  assert.ok(drop >= 0, 'drop trigger if exists');
  assert.ok(create > drop, 'created after being dropped, so a second paste succeeds');
  assert.ok(
    create > STATEMENTS.findIndex((s) => s.startsWith('update public.event_registrations')),
    'created after the backfill',
  );
});

test('0018 functions are replaceable, not security definer, and only service_role may run the mapping', () => {
  const creates = STATEMENTS.filter((s) => /^create (or replace )?function/.test(s));
  assert.equal(creates.length, 2);
  for (const s of creates) assert.match(s, /^create or replace function /);
  assert.doesNotMatch(NO_COMMENTS.toLowerCase(), /security\s+definer/);

  const privileges = STATEMENTS.filter((s) => /^(grant|revoke) /.test(s));
  assert.deepEqual(privileges, [
    `revoke all on function ${MAPPING_SIG} from public, anon, authenticated`,
    `revoke all on function public.${SYNC}() from public, anon, authenticated`,
    // /api writes as service_role, and the security-invoker trigger calls the
    // mapping as the writer.
    `grant execute on function ${MAPPING_SIG} to service_role`,
  ]);
  assert.equal(
    STATEMENTS.some((s) => /^(create|alter|drop) policy/.test(s)),
    false,
    'no policies',
  );
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
