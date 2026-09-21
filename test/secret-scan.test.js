// a2751012962/caaciorg is a public repository. A key committed here is a key
// published: pushing it is the disclosure, and deleting it in the next commit
// changes nothing, because the blob stays reachable and the mirrors have it
// already. The only fix is to roll the key with the provider — which on this
// project has meant a Resend key, once, by hand.
//
// So the scan runs before the push, not after. It reads tracked files only, and
// it is deliberately shape-based rather than entropy-based: the repo is full of
// keys on purpose — the Supabase anon key (public by design, in wrangler.toml
// and build.mjs), `sk_test_123` in the fixtures, `sk_live_…` in the SETUP.md
// instructions — and a scanner that cries wolf over those gets switched off.
// Every pattern below is written to match a real credential and miss a
// placeholder, and the unit tests hold it to both halves of that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'test/secret-scan.test.js';

// Anything bigger than this is a build artefact or an asset, not somewhere a
// key is typed, and reading them all makes the suite slow for nothing.
const MAX_BYTES = 2_000_000;

const PATTERNS = [
  {
    name: 'Stripe secret key',
    // Real keys carry ~24+ characters of payload; the fixtures (sk_test_123,
    // sk_live_x) and the docs (sk_live_…) are far shorter.
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  },
  {
    name: 'Stripe webhook signing secret',
    re: /\bwhsec_[A-Za-z0-9]{24,}\b/g,
  },
  {
    name: 'Resend API key',
    // re_<id>_<secret>, exactly two underscores. The fixture key
    // (re_SECRET_full_access_key_123) has five and does not match.
    re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: 'GitHub token',
    re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
  },
  {
    name: 'AWS access key id',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'private key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
];

// A JWT, looked at rather than pattern-matched: the Supabase anon key is one
// and belongs in the repo, the service-role key is one and must never be. The
// difference is a claim inside the payload, so read the payload.
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}\b/g;

export function serviceRoleJwts(text) {
  const found = [];
  for (const m of text.matchAll(JWT)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    } catch {
      continue; // an accidental base64 lookalike, e.g. an npm integrity hash
    }
    if (payload?.role === 'service_role') found.push(m[0].slice(0, 12) + '…');
  }
  return found;
}

export function findings(text) {
  const hits = [];
  for (const { name, re } of PATTERNS) {
    for (const m of text.matchAll(re)) hits.push(`${name}: ${m[0].slice(0, 12)}…`);
  }
  for (const jwt of serviceRoleJwts(text)) hits.push(`Supabase service-role key: ${jwt}`);
  return hits;
}

// A JWT with the given role, assembled here so no real-looking service-role
// token is ever stored in this repository.
const jwt = (role) => {
  const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({ iss: 'supabase', role })}.${'s'.repeat(43)}`;
};

// --- the detector ----------------------------------------------------------
test('a real-shaped credential is caught', () => {
  assert.deepEqual(findings(`STRIPE_SECRET_KEY=sk_live_${'A1b2C3d4'.repeat(6)}`), [
    'Stripe secret key: sk_live_A1b2…',
  ]);
  assert.equal(findings(`whsec_${'a1B2'.repeat(8)}`).length, 1);
  assert.equal(findings(`re_A1b2C3d4_${'e5F6g7H8'.repeat(3)}`).length, 1);
  assert.equal(findings(`ghp_${'a1B2c3D4'.repeat(4)}abcd`).length, 1);
  assert.equal(findings('AKIAIOSFODNN7EXAMPLE').length, 1);
  assert.equal(findings('-----BEGIN RSA PRIVATE KEY-----').length, 1);
});

test('the placeholders this repo is full of are not credentials', () => {
  assert.deepEqual(findings('STRIPE_SECRET_KEY=sk_test_...'), []);
  assert.deepEqual(findings("assert.equal(keyMode('sk_live_abc'), 'live')"), []);
  assert.deepEqual(findings("STRIPE_SECRET_KEY: 'sk_test_123'"), []);
  assert.deepEqual(findings("const KEY = 're_SECRET_full_access_key_123'"), []);
  assert.deepEqual(findings('`sk_live_…` at go-live'), []);
});

test('the anon key stays, the service-role key does not', () => {
  assert.deepEqual(findings(`SUPABASE_ANON_KEY = "${jwt('anon')}"`), []);
  assert.equal(findings(`SUPABASE_SERVICE_ROLE_KEY=${jwt('service_role')}`).length, 1);
});

test('an npm integrity hash is not a JWT', () => {
  assert.deepEqual(
    serviceRoleJwts(
      '"integrity": "sha512-V7Qr52IhZmdKPVr+Vtw8o+WLsQJYCTd8loIfpDaMRWGUZfBOYEJeyJIkqGIDMZPwPx24pUMfwSxxI8phr/MbOA=="',
    ),
    [],
  );
});

// --- the repository --------------------------------------------------------
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

test('git sees this working tree', () => {
  assert.ok(tracked.length > 100, `git ls-files returned ${tracked.length} files`);
});

test('no tracked file carries a credential', () => {
  const offenders = [];
  for (const file of tracked) {
    if (file === SELF) continue; // the fixtures above are built, not stored
    let size;
    try {
      size = statSync(`${ROOT}/${file}`).size;
    } catch {
      continue; // listed in the index, absent from this checkout
    }
    if (size > MAX_BYTES) continue;
    const text = readFileSync(`${ROOT}/${file}`, 'utf8');
    if (text.includes('\0')) continue; // binary
    for (const hit of findings(text)) offenders.push(`${file} — ${hit}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'roll the key with its provider; deleting the commit is not enough',
  );
});

// .env holds the real values on a developer's machine. .gitignore covers it,
// but `git add -f` and a renamed copy (.env.prod, live.env) both walk past
// that, and the one that got through would not be noticed until it was public.
test('the only tracked env file is the example', () => {
  const envFiles = tracked.filter((f) => /(^|[/.])[^/]*\.env$|(^|\/)\.env($|\.)/.test(f));
  assert.deepEqual(envFiles, ['.env.example']);
});

test('the example env file holds no value that looks real', () => {
  const text = readFileSync(`${ROOT}/.env.example`, 'utf8');
  assert.deepEqual(findings(text), []);
});
