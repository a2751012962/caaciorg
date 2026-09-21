// Every Pages Function is a public URL the moment it is deployed. Nothing in
// the framework asks who is calling: a handler that forgets to check is simply
// open, and it looks exactly like one that doesn't need to. That is how
// /api/change-plan and /api/checkout shipped readable by anyone (fixed in #75),
// and how an admin endpoint shipped without requireAdmin (fixed in #79) — in
// both cases the code read fine and the hole was in what wasn't written.
//
// So the rule is inverted here: a handler is assumed to need a gate, and one
// that doesn't has to say so out loud, in UNGATED below, with what protects it
// instead. Adding an endpoint without a gate is not a thing that can happen
// quietly — it fails this test until someone writes the sentence.
//
// Three of the claims are checked against the code, not taken on trust:
//   'turnstile'   — the handler really does call requireHuman()
//   'read-only'   — it really is a GET, and it writes nothing
//   'lookup-only' — a POST used as a question: it writes nothing either
// The rest ('signature', 'link-key', 'own-token') name a mechanism this test
// cannot verify; they exist so the reviewer knows which one to go and read.
//
// functions/api/admin/** gets no allowlist at all: those handlers must call
// requireAdmin or requireRoot, full stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The shared gates. Each returns { error } | { user, DB, … }; a handler that
// calls one has established who the caller is.
const GATES = ['requireUser', 'requireAdmin', 'requireRoot', 'tokenGate', 'tokenGateOptional'];
const ADMIN_GATES = ['requireAdmin', 'requireRoot'];

// Handlers that deliberately call none of them. Key is "<path> <handler>".
const UNGATED = {
  'functions/api/business-listing.js onRequestPost': {
    by: 'turnstile',
    why: 'anyone may submit a business for the directory; it lands pending approval.',
  },
  'functions/api/contact.js onRequestPost': {
    by: 'turnstile',
    why: 'the public contact form — requiring an account would defeat its purpose.',
  },
  'functions/api/discount.js onRequestPost': {
    by: 'lookup-only',
    why: 'the checkout UI asking whether one code is usable. discount_codes is service-role only, so this is the single public window onto it — and it answers for an exact code, never lists them.',
  },
  'functions/api/event-register.js onRequestGet': {
    by: 'read-only',
    why: 'the public event page. It reads the Bearer token itself and returns an email only to the account that owns it; signed out it says nothing about any email.',
  },
  'functions/api/event-register.js onRequestPost': {
    by: 'turnstile',
    why: 'registration needs no account (the printed QR codes go straight here).',
  },
  'functions/api/rsvp.js onRequestPost': {
    by: 'own-token',
    why: 'authenticated, but with its own userFromToken() helper, written before requireUser existed. Folding it into requireUser is a separate change.',
  },
  'functions/api/stripe-webhook.js onRequestPost': {
    by: 'signature',
    why: 'Stripe is the caller. Its signature over the raw body is the credential; there is no session.',
  },
  'functions/api/tokens/dispute.js onRequestGet': {
    by: 'read-only',
    why: 'the "this wasn\'t me" link from a charge receipt. It shows the charge and changes nothing, because mail scanners open every link in an email.',
  },
  'functions/api/tokens/dispute.js onRequestPost': {
    by: 'link-key',
    why: "the dispute_key in the link is the proof, and it only ever went to the member's own mailbox.",
  },
  'functions/api/verify.js onRequestGet': {
    by: 'read-only',
    why: 'the QR on a membership card. A restaurant scans it without an account; it reveals name, tier and validity, nothing else.',
  },
  'functions/api/volunteer.js onRequestGet': {
    by: 'read-only',
    why: 'lists published, upcoming events so the sign-up page can offer them. Never says anything about volunteers.',
  },
  'functions/api/volunteer.js onRequestPost': {
    by: 'turnstile',
    why: 'volunteer sign-up needs no account.',
  },
  'functions/api/wallet-pass.js onRequestGet': {
    by: 'read-only',
    why: 'a capability probe: 204 when the APPLE_* secrets exist, 503 when they do not. It returns no data about anyone.',
  },
};

const CLAIMS = ['turnstile', 'read-only', 'lookup-only', 'signature', 'link-key', 'own-token'];

// The sb() writers. A handler claiming it only reads must call none of them.
const WRITES = ['insert', 'upsert', 'update', 'del', 'rpc'];

// --- finding the handlers -------------------------------------------------
// Cloudflare Pages routes a file by its exported onRequest* functions. Chunking
// the source at top-level `export` keeps each handler's body separate; prettier
// guarantees those start at column 0. A non-exported helper written after the
// last handler is folded into it, so don't put a gate call in one.
const HANDLER = /^export\s+(?:async\s+)?function\s+(onRequest\w*)\s*\(/gm;
const TOP_LEVEL_EXPORT = /^export\s/gm;
// Any other way of exporting a handler — `export const onRequestGet = …`, or a
// re-export — is refused rather than skipped: a form this test cannot read is a
// handler it cannot check.
const OTHER_FORM = /^export\s+(?!(?:async\s+)?function\s+onRequest)[^\n]*\bonRequest\w*/gm;

export function handlers(source) {
  const found = [];
  for (const m of source.matchAll(HANDLER)) {
    TOP_LEVEL_EXPORT.lastIndex = m.index + m[0].length;
    const next = TOP_LEVEL_EXPORT.exec(source);
    found.push({ name: m[1], body: source.slice(m.index, next ? next.index : source.length) });
  }
  return found;
}

const calls = (body, names) => names.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));

const files = execFileSync('git', ['ls-files', '-z', 'functions'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((f) => f.endsWith('.js'))
  .sort();

const ALL = files.flatMap((file) => {
  const source = readFileSync(`${ROOT}/${file}`, 'utf8');
  return handlers(source).map((h) => ({ ...h, file, key: `${file} ${h.name}` }));
});

// --- the extractor itself -------------------------------------------------
test('a handler body stops at the next top-level export', () => {
  const src = [
    'import { requireUser } from "./_lib.js";',
    'export async function onRequestGet({ request, env }) {',
    '  const gate = await requireUser(request, env);',
    '}',
    'export async function onRequestPost({ request, env }) {',
    '  return bad("no");',
    '}',
  ].join('\n');
  const found = handlers(src);
  assert.deepEqual(
    found.map((h) => h.name),
    ['onRequestGet', 'onRequestPost'],
  );
  assert.deepEqual(calls(found[0].body, GATES), ['requireUser']);
  assert.deepEqual(calls(found[1].body, GATES), []);
});

test('the import line alone is not a gate call', () => {
  const src = 'import { requireAdmin } from "../_lib.js";\nexport async function onRequestGet() {}';
  assert.deepEqual(calls(handlers(src)[0].body, GATES), []);
});

// --- the rules ------------------------------------------------------------
test('the repo still has handlers to check', () => {
  assert.ok(ALL.length > 40, `found only ${ALL.length} handlers — has the scan broken?`);
});

test('every handler is declared as an exported function, so this test can read it', () => {
  const odd = [];
  for (const file of files) {
    const source = readFileSync(`${ROOT}/${file}`, 'utf8');
    for (const m of source.matchAll(OTHER_FORM)) {
      odd.push(`${file}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(odd, []);
});

test('every handler under functions/api/admin/ calls requireAdmin or requireRoot', () => {
  const open = ALL.filter(
    (h) => h.file.startsWith('functions/api/admin/') && calls(h.body, ADMIN_GATES).length === 0,
  ).map((h) => h.key);
  assert.deepEqual(open, []);
});

test('every other handler calls a shared gate, or is listed in UNGATED', () => {
  const open = ALL.filter(
    (h) => calls(h.body, GATES).length === 0 && !Object.hasOwn(UNGATED, h.key),
  ).map((h) => h.key);
  assert.deepEqual(open, [], 'add a gate, or add an UNGATED entry saying what protects it instead');
});

test('no UNGATED entry outlives the handler it excuses', () => {
  const live = new Set(ALL.map((h) => h.key));
  const stale = Object.keys(UNGATED).filter((k) => !live.has(k));
  assert.deepEqual(stale, []);
});

test('no UNGATED entry excuses a handler that is in fact gated', () => {
  const pointless = ALL.filter(
    (h) => Object.hasOwn(UNGATED, h.key) && calls(h.body, GATES).length > 0,
  ).map((h) => h.key);
  assert.deepEqual(pointless, []);
});

test('every UNGATED entry names a known protection and says why', () => {
  for (const [key, entry] of Object.entries(UNGATED)) {
    assert.ok(CLAIMS.includes(entry.by), `${key}: unknown protection "${entry.by}"`);
    assert.ok(entry.why.length > 30, `${key}: say why in a sentence`);
  }
});

test("a 'turnstile' claim means the handler really calls requireHuman", () => {
  const lying = Object.entries(UNGATED)
    .filter(([, e]) => e.by === 'turnstile')
    .map(([key]) => key)
    .filter((key) => {
      const h = ALL.find((x) => x.key === key);
      return !h || calls(h.body, ['requireHuman']).length === 0;
    });
  assert.deepEqual(lying, []);
});

test("a 'read-only' claim means the handler really is a GET", () => {
  const lying = Object.entries(UNGATED)
    .filter(([, e]) => e.by === 'read-only')
    .map(([key]) => key)
    .filter((key) => !key.endsWith('onRequestGet'));
  assert.deepEqual(lying, []);
});

test("a 'read-only' or 'lookup-only' claim means the handler writes nothing", () => {
  const lying = Object.entries(UNGATED)
    .filter(([, e]) => e.by === 'read-only' || e.by === 'lookup-only')
    .map(([key]) => key)
    .flatMap((key) => {
      const h = ALL.find((x) => x.key === key);
      if (!h) return [key];
      // `.insert(`, `.rpc(` … on anything: the only writer in a handler is the
      // sb() client, and naming the method is enough to spot the call.
      const written = WRITES.filter((w) => new RegExp(`\\.${w}\\s*\\(`).test(h.body));
      return written.length ? [`${key} → ${written.join(', ')}`] : [];
    });
  assert.deepEqual(lying, []);
});
