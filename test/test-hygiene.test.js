// The suite is the only thing standing between a change and a live site that
// takes membership payments, so the ways a test can quietly stop testing are
// worth naming.
//
//   * `assert.equal` from plain node:assert is ==. '1' equals 1, null equals
//     undefined, and a test written against the wrong type passes. Every file
//     in this suite imports node:assert/strict, and that stays true here.
//   * `.only` narrows a run to one test. Node ignores it without --test-only,
//     which is exactly why it survives a commit: nothing goes red, and the day
//     the runner or the flag changes, the rest of the file stops running.
//   * A file that registers no test is green in the tally and proves nothing —
//     usually a rename, an early `return`, or an import that threw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SELF = 'test-hygiene.test.js';

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const sources = new Map(files.map((f) => [f, readFileSync(`${DIR}/${f}`, 'utf8')]));
const testFiles = files.filter((f) => f.endsWith('.test.js'));

test('the suite is where it is expected to be', () => {
  assert.ok(testFiles.length > 50, `found ${testFiles.length} test files`);
});

test('every test file asserts strictly', () => {
  const loose = testFiles.filter((f) => {
    const source = sources.get(f);
    return /from\s+'node:assert'/.test(source) || !/from\s+'node:assert\/strict'/.test(source);
  });
  assert.deepEqual(loose, [], "import assert from 'node:assert/strict'");
});

test('no test file is left narrowed to one case', () => {
  const narrowed = files.filter(
    (f) => f !== SELF && /\b(?:test|describe|it|suite)\.only\s*\(/.test(sources.get(f)),
  );
  assert.deepEqual(narrowed, [], 'remove the .only before committing');
});

test('every test file registers at least one test', () => {
  const empty = testFiles.filter(
    (f) => !/^\s*(?:await\s+)?(?:test|describe|suite)\s*\(/m.test(sources.get(f)),
  );
  assert.deepEqual(empty, []);
});
