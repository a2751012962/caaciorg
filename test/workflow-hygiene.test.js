// CI is the last thing that reads a change before it reaches caaciorg.com, and
// it is also the least-read code in the repo: a workflow file is edited when
// something is red, in a hurry, and nobody reviews it the way they review a
// handler. Two failure modes follow from that, and both are silent.
//
//   * A check quietly stops running. Deleting the `npm run typecheck` line does
//     not turn anything red — it turns something green that should not be. The
//     gates in package.json are therefore asserted against ci.yml here, so the
//     suite fails when a step goes missing rather than when it is needed.
//   * A workflow becomes the way in. An action referenced by a moving tag runs
//     whatever that tag points at tomorrow; an untrusted value interpolated into
//     `run:` executes as shell; pull_request_target hands a fork's branch the
//     repository's secrets. None of the three looks wrong in a diff.
//
// The workflows are read as text. That is enough for rules about what is
// written in them, and it keeps the suite free of a YAML dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}/.github/workflows`;

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const sources = new Map(files.map((f) => [f, readFileSync(`${DIR}/${f}`, 'utf8')]));

test('there are workflows to check', () => {
  assert.ok(files.length >= 2, `found ${files.length} workflow files`);
});

// --- least privilege -------------------------------------------------------
// Without a permissions block the job gets the repository default, which on an
// older repository is write to everything. Naming it is the whole point.
test('every workflow declares its permissions', () => {
  const missing = files.filter((f) => !/^permissions:/m.test(sources.get(f)));
  assert.deepEqual(missing, []);
});

test('no workflow is triggered by pull_request_target', () => {
  const risky = files.filter((f) => /^\s*pull_request_target:/m.test(sources.get(f)));
  assert.deepEqual(
    risky,
    [],
    "pull_request_target runs with the repository secrets on a fork's code — use pull_request",
  );
});

test('every workflow cancels its own superseded runs', () => {
  const missing = files.filter((f) => !/^concurrency:/m.test(sources.get(f)));
  assert.deepEqual(missing, []);
});

// --- supply chain ----------------------------------------------------------
// A tag is a pointer the action's owner can move. A commit SHA is the code.
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm;

export function unpinned(source) {
  const bad = [];
  for (const m of source.matchAll(USES)) {
    const ref = m[1];
    if (ref.startsWith('./')) continue; // an action kept in this repository
    const at = ref.lastIndexOf('@');
    const sha = at === -1 ? '' : ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(sha)) bad.push(`${ref} — not pinned to a commit SHA`);
    // The SHA says nothing about which release it is; the comment is how a
    // reviewer (and Dependabot's update) keeps track.
    else if (!/#\s*v?\d/.test(m[2])) bad.push(`${ref} — no version comment`);
  }
  return bad;
}

test('the pinning reader reads pins', () => {
  assert.deepEqual(unpinned(`      - uses: actions/checkout@${'a'.repeat(40)} # v7.0.0`), []);
  assert.deepEqual(unpinned('      - uses: actions/checkout@v4'), [
    'actions/checkout@v4 — not pinned to a commit SHA',
  ]);
  assert.deepEqual(unpinned(`      - uses: actions/checkout@${'a'.repeat(40)}`), [
    `actions/checkout@${'a'.repeat(40)} — no version comment`,
  ]);
  assert.deepEqual(unpinned('      - uses: ./.github/actions/local'), []);
});

test('every action is pinned to a commit SHA and says which version that is', () => {
  const bad = [];
  for (const [f, source] of sources) for (const b of unpinned(source)) bad.push(`${f}: ${b}`);
  assert.deepEqual(bad, []);
});

// --- script injection ------------------------------------------------------
// Anything a stranger can type. Interpolated into `run:` it is not a string,
// it is the next command.
const UNTRUSTED =
  /github\.(head_ref|event\.(pull_request\.(title|body|head\.(ref|label))|issue\.(title|body)|comment\.body|review\.body|head_commit\.message))/;

// The lines of every `run:` block: from a line ending in `run: |` (or `run: >`)
// until the indentation falls back to that of the `run:` key itself.
export function runBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    if (m[2] && !/^[|>]/.test(m[2])) body.push(m[2]); // a one-line run:
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= indent) break;
      body.push(lines[j]);
    }
    blocks.push({ line: i + 1, body: body.join('\n') });
  }
  return blocks;
}

test('the run-block reader stops at the next step', () => {
  const yml = [
    '    steps:',
    '      - name: one',
    '        run: |',
    '          echo a',
    '          echo b',
    '      - name: two',
    '        run: echo c',
    '      - uses: actions/checkout@abc',
  ].join('\n');
  assert.deepEqual(
    runBlocks(yml).map((b) => b.body.trim()),
    ['echo a\n          echo b', 'echo c'],
  );
});

test('no run: step interpolates something a stranger can type', () => {
  const bad = [];
  for (const [f, source] of sources) {
    for (const block of runBlocks(source)) {
      if (UNTRUSTED.test(block.body)) bad.push(`${f}:${block.line}`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    'pass the value through env: and quote "$VAR" — interpolated into run: it is shell, not a string',
  );
});

// --- the gates actually run ------------------------------------------------
// Every command that has to pass before a change is merged. If one of these is
// removed from ci.yml, this is what says so.
const GATES = [
  'npm run lint',
  'npm run typecheck',
  'npm run format:check',
  'npm test',
  'npm run build',
  // The browser suite. Listed here for the same reason as the rest: deleting
  // its step from ci.yml is a change nothing else would notice.
  'npm run test:ui',
];

test('each gate is a real npm script', () => {
  const { scripts } = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8'));
  const missing = GATES.map((g) => g.replace(/^npm (?:run )?/, '')).filter(
    (s) => !Object.hasOwn(scripts, s),
  );
  assert.deepEqual(missing, []);
});

test('ci.yml still runs every gate', () => {
  const ci = sources.get('ci.yml');
  assert.ok(ci, 'ci.yml is gone');
  const commands = runBlocks(ci)
    .map((b) => b.body)
    .join('\n');
  const missing = GATES.filter((g) => !commands.includes(g));
  assert.deepEqual(missing, [], 'a check was removed from CI — put it back, or remove it here too');
});

test('ci.yml runs on pull requests', () => {
  assert.match(sources.get('ci.yml'), /^\s*pull_request:/m);
});
