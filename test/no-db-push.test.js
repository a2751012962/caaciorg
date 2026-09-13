// The live Supabase project (wslzeqhipvibeflmxznh) has no
// supabase_migrations.schema_migrations table: every migration was applied by
// pasting it into the SQL editor. The CLI therefore believes none of them has
// run, and pushing from it would replay supabase/migrations/ from 0001_init.sql
// onward against production. This keeps every tracked file from telling anyone
// to do that. Saying not to ("never supabase db push") is fine; the warning in
// SETUP.md, between its db-push-warning markers, may name the command freely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'test/no-db-push.test.js';
const PUSH = /supabase\s+db\s+push|npm\s+run\s+db:push/gi;
const NEGATED = /\b(never|not)\s+(run\s+)?[`(]*$/i;
const WARNING = /<!-- db-push-warning -->[\s\S]*?<!-- \/db-push-warning -->/g;

const read = (file) => readFileSync(`${ROOT}/${file}`, 'utf8');

// Line numbers of every mention that is not preceded by "never" / "not (run)".
function recommendations(text) {
  return [...text.matchAll(PUSH)]
    .filter((m) => !NEGATED.test(text.slice(Math.max(0, m.index - 40), m.index)))
    .map((m) => text.slice(0, m.index).split('\n').length);
}

test('a mention counts unless it says not to run the command', () => {
  assert.deepEqual(
    recommendations('-- Run via: supabase db push   (or paste into the Supabase SQL editor)'),
    [1],
  );
  assert.deepEqual(recommendations('x\n`npm run db:push` runs them all'), [2]);
  assert.deepEqual(recommendations('-- paste it (never supabase db push on this project)'), []);
  assert.deepEqual(recommendations('Do not run `supabase db push`.'), []);
});

test('no tracked file tells anyone to run a db push, outside the SETUP.md warning', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && f !== SELF && existsSync(`${ROOT}/${f}`));
  const offenders = [];
  for (const file of files) {
    let text = read(file);
    if (text.includes('\0')) continue; // binary
    // Blank the warning but keep its newlines, so reported line numbers stay true.
    if (file === 'SETUP.md') text = text.replace(WARNING, (m) => m.replace(/[^\n]/g, ''));
    for (const line of recommendations(text)) offenders.push(`${file}:${line}`);
  }
  assert.deepEqual(offenders, []);
});

test('SETUP.md keeps exactly one warning, and it names the command and the live project', () => {
  const blocks = read('SETUP.md').match(WARNING) ?? [];
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /supabase db push/);
  assert.match(blocks[0], /wslzeqhipvibeflmxznh/);
});

test('no npm script drives the Supabase CLI against the linked database', () => {
  const { scripts } = JSON.parse(read('package.json'));
  const offenders = Object.entries(scripts).filter(([, cmd]) =>
    /\bsupabase\s+(db|migration|link)\b/.test(cmd),
  );
  assert.deepEqual(offenders, []);
});
