// Every SECURITY DEFINER function runs as its owner, so RLS never sees the
// caller. Postgres hands EXECUTE on a new function to PUBLIC, which on Supabase
// includes anon and authenticated — and the anon key is published in every
// browser. A function that is meant for the Pages Functions (service-role) and
// is left executable is therefore a public endpoint: that is how
// redeem_discount_code could be run up until every discount code read "fully
// redeemed" (fixed in 0026).
//
// 0017, 0018, 0024 and 0026 revoke; this test is what keeps the next one from
// forgetting. There is no database in CI, so the migrations are read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);

// Helpers that RLS policies call, so a browser role MUST keep EXECUTE — the
// policy runs as the caller. Neither takes an argument or writes anything: they
// answer "is this caller an admin" and "which household is the caller in".
const RLS_HELPERS = new Set(['is_admin', 'current_household_id']);

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

const FILES = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const SOURCES = [];
for (const file of FILES) SOURCES.push({ file, sql: await readFile(new URL(file, DIR), 'utf8') });

// Every `create [or replace] function public.name(args) returns <type>`, with
// the `security definer` marker read from the header that follows.
const defined = new Map(); // name -> { file, returns, definer }
for (const { file, sql } of SOURCES) {
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([^)]*)\)\s*returns\s+([\w.]+)([\s\S]{0,200})/gi;
  for (const m of stripComments(sql).matchAll(re)) {
    const name = m[1].toLowerCase();
    const header = m[4].toLowerCase();
    const definer = /security\s+definer/.test(header) || /security\s+definer/.test(m[3]);
    const prev = defined.get(name);
    // A later migration replacing the function decides; `definer` sticks once set
    // so a replacement that drops the marker is still checked.
    defined.set(name, {
      file,
      returns: m[3].toLowerCase(),
      definer: definer || !!prev?.definer,
    });
  }
}

// Every function name a `revoke … on function public.name(…)` names.
const revoked = new Set();
for (const { sql } of SOURCES) {
  const re = /revoke\s+(?:all|execute)[\s\S]{0,40}?on\s+function\s+public\.(\w+)\s*\(/gi;
  for (const m of stripComments(sql).matchAll(re)) revoked.add(m[1].toLowerCase());
}

test('the migrations really do define security definer functions (the parser works)', () => {
  assert.ok(defined.size > 20, `only ${defined.size} functions parsed`);
  for (const name of ['redeem_discount_code', 'token_charge', 'family_accept_invite', 'is_admin'])
    assert.ok(defined.get(name)?.definer, `${name} not seen as security definer`);
});

test('no security definer function is left callable by anon or authenticated', () => {
  const exposed = [];
  for (const [name, { file, returns, definer }] of defined) {
    if (!definer) continue;
    if (returns === 'trigger') continue; // PostgREST never exposes a trigger function
    if (RLS_HELPERS.has(name)) continue; // policies call these as the caller
    if (!revoked.has(name)) exposed.push(`${name} (${file})`);
  }
  assert.deepEqual(
    exposed,
    [],
    `security definer functions with no "revoke … from public, anon, authenticated":\n  ${exposed.join('\n  ')}`,
  );
});

test('the discount redemption counter is service-role only', () => {
  // assert.ok, not assert.match: a failed match would print all of the SQL.
  const sql = SOURCES.map((s) => stripComments(s.sql))
    .join('\n')
    .toLowerCase();
  assert.ok(
    /revoke all on function public\.redeem_discount_code\(text\) from public, anon, authenticated;/.test(
      sql,
    ),
    'no migration revokes redeem_discount_code from the browser roles',
  );
  assert.ok(
    /grant execute on function public\.redeem_discount_code\(text\) to service_role;/.test(sql),
    'redeem_discount_code is revoked but never granted to service_role — the webhook would break',
  );
});

test('every RLS helper left executable is read-only and takes no argument', () => {
  for (const name of RLS_HELPERS) {
    const { sql } = SOURCES.find((s) =>
      new RegExp(`function public\\.${name}\\(`, 'i').test(s.sql),
    );
    const body = stripComments(sql).match(
      new RegExp(
        `function\\s+public\\.${name}\\s*\\(([^)]*)\\)([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$`,
        'i',
      ),
    );
    assert.equal(body[1].trim(), '', `${name} takes an argument`);
    assert.match(body[2], /\bstable\b/, `${name} is not marked stable`);
    assert.doesNotMatch(body[3], /\b(insert|update|delete)\b/, `${name} writes`);
  }
});
