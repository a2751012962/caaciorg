// supabase/migrations/ is applied by hand: each file is pasted into the
// Supabase SQL editor of the live project, in filename order, and once pasted
// it is history — nothing replays it and nothing checks it afterwards. A
// mistake here is not a failing build, it is a production database in a state
// no file describes. Three have already happened on this project:
//
//   * public.members shipped readable and writable by any signed-in visitor,
//     because the table was created and RLS was never switched on for it.
//   * public.redeem_discount_code was SECURITY DEFINER and callable by a
//     stranger (0026 closed it).
//   * two branches developed in parallel both picked the next free number, so
//     the same NNNN named two different migrations.
//
// This reads the SQL as text and refuses all three. No database is involved, so
// it runs in the ordinary unit suite on every PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../supabase/migrations', import.meta.url));

// Files that drop data, and why that was the right call. A migration that takes
// a table or a column away has to be argued for in writing — it is the one kind
// of change nobody can undo from a backup of the file.
const DESTRUCTIVE = {
  '0019_drop_legacy_event_registration_columns.sql':
    'drops the four pre-0018 event_registrations columns once every live row has been copied into answers; 0018 kept writing both for a release so the running site never read a column that had gone.',
};

// --- reading SQL as text ---------------------------------------------------
// Comments go first: half the words this test looks for ("truncate", "drop
// column") appear in the prose explaining why a migration does NOT do that.
export const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

// $$ … $$ / $fn$ … $fn$ bodies hold semicolons and their own statements, so
// they are blanked (newlines kept) before anything is split on `;`.
export const blankBodies = (sql) =>
  sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, (m) => m.replace(/[^\n]/g, ' '));

export function statements(sql) {
  return blankBodies(stripComments(sql))
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const read = (f) => readFileSync(`${DIR}/${f}`, 'utf8');
const sources = new Map(files.map((f) => [f, read(f)]));
const allSql = stripComments([...sources.values()].join('\n'));

test('there are migrations to check', () => {
  assert.ok(files.length > 20, `found only ${files.length} migrations — has the scan broken?`);
});

// --- names and numbers -----------------------------------------------------
test('every migration is NNNN_lower_snake_case.sql', () => {
  const odd = files.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
  assert.deepEqual(odd, []);
});

// Gaps are fine and expected: 0016 was claimed by a branch that was never
// merged, and renumbering an applied migration would be far worse than a hole.
// What is never fine is two files sharing a number — the SQL editor is driven
// by this filename order, so one of them silently goes first, or not at all.
test('no two migrations share a number', () => {
  const byNumber = new Map();
  for (const f of files) {
    const n = f.slice(0, 4);
    byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }
  const clashes = [...byNumber.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([n, group]) => `${n}: ${group.join(' + ')}`);
  assert.deepEqual(
    clashes,
    [],
    'two branches picked the same number — renumber the one that has not been applied yet',
  );
});

test('every migration ends with exactly one newline and holds no CR', () => {
  const odd = [];
  for (const [f, sql] of sources) {
    if (!sql.endsWith('\n') || sql.endsWith('\n\n')) odd.push(`${f}: trailing newline`);
    if (sql.includes('\r')) odd.push(`${f}: CRLF`);
  }
  assert.deepEqual(odd, []);
});

// --- row level security ----------------------------------------------------
const CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi;
const ENABLE_RLS = /alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security/gi;

export const tablesCreated = (sql) => [...sql.matchAll(CREATE_TABLE)].map((m) => m[1]);
export const tablesWithRls = (sql) => [...sql.matchAll(ENABLE_RLS)].map((m) => m[1]);

test('the table/RLS readers see what is in the SQL', () => {
  const sql = stripComments(
    [
      '-- create table public.pretend (never really created)',
      'create table if not exists public.widgets (id uuid);',
      'alter table public.widgets enable row level security;',
      'create table public.gadgets (id uuid);',
    ].join('\n'),
  );
  assert.deepEqual(tablesCreated(sql), ['widgets', 'gadgets']);
  assert.deepEqual(tablesWithRls(sql), ['widgets']);
});

test('every table created in public has row level security switched on', () => {
  const guarded = new Set(tablesWithRls(allSql));
  const open = [...new Set(tablesCreated(allSql))].filter((t) => !guarded.has(t));
  assert.deepEqual(
    open,
    [],
    'PostgREST serves every table in public to anon and authenticated; without RLS the whole table is readable from a browser',
  );
});

// --- SECURITY DEFINER ------------------------------------------------------
// A SECURITY DEFINER function runs as its owner, i.e. past RLS. If its
// search_path is not pinned, the caller chooses which schema the names inside
// it resolve to, and can point them at tables of their own.
const DEFINER = /security\s+definer/gi;

export function definersWithoutSearchPath(sql) {
  const clean = stripComments(sql);
  const bad = [];
  for (const m of clean.matchAll(DEFINER)) {
    // The function header: back to the `create` that opened it, forward to the
    // $tag$ that opens its body. search_path has to be set in there.
    const start = clean.lastIndexOf('create', m.index);
    const bodyAt = clean.indexOf('$', m.index);
    const header = clean.slice(start === -1 ? 0 : start, bodyAt === -1 ? clean.length : bodyAt);
    if (!/search_path\s*=/i.test(header)) {
      bad.push(clean.slice(0, m.index).split('\n').length);
    }
  }
  return bad;
}

test('the SECURITY DEFINER reader spots an unpinned function', () => {
  const pinned =
    'create function public.f()\nreturns void language sql security definer set search_path = public as $$ select 1 $$;';
  const loose =
    'create function public.f()\nreturns void language sql security definer as $$ select 1 $$;';
  assert.deepEqual(definersWithoutSearchPath(pinned), []);
  assert.deepEqual(definersWithoutSearchPath(loose), [2]);
});

test('every SECURITY DEFINER function pins its search_path', () => {
  const offenders = [];
  for (const [f, sql] of sources) {
    for (const line of definersWithoutSearchPath(sql)) offenders.push(`${f}:${line}`);
  }
  assert.deepEqual(offenders, []);
});

// --- dropping data ---------------------------------------------------------
const DROPS_DATA = [
  /^drop\s+(table|schema)\b/,
  /^truncate\b/,
  /^alter\s+table\b.*\bdrop\s+column\b/,
  // DELETE with no WHERE — the whole table.
  /^delete\s+from\s+[\w.]+$/,
];

export const dropsData = (sql) =>
  statements(sql).filter((s) => DROPS_DATA.some((re) => re.test(s)));

test('the data-loss reader ignores the word and catches the statement', () => {
  const prose = '-- revoke insert, update, delete, truncate on public.x from anon;\nselect 1;';
  assert.deepEqual(dropsData(prose), []);
  assert.deepEqual(dropsData('revoke truncate on public.x from anon;'), []);
  assert.deepEqual(dropsData('drop policy if exists p on public.x;'), []);
  assert.deepEqual(dropsData('alter table public.x drop column y;'), [
    'alter table public.x drop column y',
  ]);
  assert.deepEqual(dropsData('delete from public.x;'), ['delete from public.x']);
  assert.deepEqual(dropsData('delete from public.x where id = 1;'), []);
});

test('only a migration listed in DESTRUCTIVE drops data', () => {
  const undeclared = [];
  for (const [f, sql] of sources) {
    if (Object.hasOwn(DESTRUCTIVE, f)) continue;
    for (const s of dropsData(sql)) undeclared.push(`${f}: ${s}`);
  }
  assert.deepEqual(
    undeclared,
    [],
    'dropping a table or a column cannot be undone on the live project — add a DESTRUCTIVE entry saying why it is safe',
  );
});

test('no DESTRUCTIVE entry outlives its migration, or excuses one that drops nothing', () => {
  const stale = Object.keys(DESTRUCTIVE).filter(
    (f) => !sources.has(f) || dropsData(sources.get(f)).length === 0,
  );
  assert.deepEqual(stale, []);
});

test('every DESTRUCTIVE entry explains itself', () => {
  for (const [f, why] of Object.entries(DESTRUCTIVE)) {
    assert.ok(why.length > 40, `${f}: say why the drop is safe, in a sentence`);
  }
});
