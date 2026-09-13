// Pins the fix for a privilege escalation on public.members. 0002_rls.sql gave
// members a `members_self_update` policy with no column restriction, and Supabase
// grants every table privilege in `public` to anon and authenticated by default —
// so any signed-in member could PATCH /rest/v1/members?id=eq.<self> with
// is_admin=true (or a paid tier, status, expires_at) and from then on pass
// requireAdmin in functions/api/_lib.js and public.is_admin() in every admin RLS
// policy. The browser never writes members; every write is a service-role
// Function, which bypasses both RLS and these grants.
//
// There is no database in CI, so this replays the migrations as text, in order:
// the policies created and dropped on public.members, and the write privileges
// anon and authenticated hold on it, starting from Supabase's defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const ROLES = ['anon', 'authenticated'];
const WRITES = ['insert', 'update', 'delete', 'truncate'];
// Columns a member must never set on their own row: they decide admin access,
// what was paid for, whose household records are readable, and who the row is.
const PRIVILEGED = [
  'id',
  'email',
  'is_admin',
  'status',
  'tier_id',
  'member_since',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
  'household_id',
  'notes',
];

// Every statement, lower-cased with whitespace collapsed. Comments are removed
// first, then $$ function bodies, which carry semicolons of their own.
const statements = [];
for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = (await readFile(new URL(file, DIR), 'utf8'))
    .replace(/--[^\n]*/g, '')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''");
  for (const part of sql.split(';')) {
    const text = part.replace(/\s+/g, ' ').trim().toLowerCase();
    if (text) statements.push({ file, text });
  }
}

// Split on commas outside parentheses: "update (full_name, phone), select".
function splitList(s) {
  const out = [''];
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

// Which of anon/authenticated a TO/FROM list covers (PUBLIC covers both).
function rolesIn(list) {
  const names = splitList(
    list.replace(/ with grant option$| granted by \w+| cascade$| restrict$/g, ''),
  );
  return names.includes('public') ? ROLES : ROLES.filter((r) => names.includes(r));
}

const policies = new Map(); // name -> { cmd, roles, file }
const created = new Set();
// privilege -> role -> true (whole table) | Set of columns | false
const grants = Object.fromEntries(WRITES.map((p) => [p, { anon: true, authenticated: true }]));
const unhandled = [];

for (const { file, text } of statements) {
  let m;
  if ((m = text.match(/^create policy (\w+) on (?:public\.)?members (.*)$/))) {
    const head = m[2].split(/ using\b| with check\b/)[0];
    policies.set(m[1], {
      cmd: head.match(/\bfor (\w+)/)?.[1] ?? 'all',
      roles: rolesIn(head.match(/\bto (.+)$/)?.[1] ?? 'public'),
      file,
    });
    created.add(m[1]);
  } else if (
    (m = text.match(
      /^drop policy (?:if exists )?(\w+) on (?:public\.)?members(?: cascade| restrict)?$/,
    ))
  ) {
    policies.delete(m[1]);
  } else if ((m = text.match(/^(grant|revoke) (.+?) on (?:table )?(.+?) (?:to|from) (.+)$/))) {
    const [, verb, privs, on, to] = m;
    const onMembers =
      on === 'all tables in schema public' ||
      splitList(on).some((t) => t === 'members' || t === 'public.members');
    if (!onMembers) continue;
    for (const item of splitList(privs)) {
      const [, name, cols] = item.match(/^(\w+)(?: privileges)? ?(?:\((.*)\))?$/) ?? [];
      for (const p of name === 'all' ? WRITES : WRITES.filter((w) => w === name)) {
        for (const r of rolesIn(to)) {
          if (!cols) {
            grants[p][r] = verb === 'grant';
            continue;
          }
          // A column grant under a table-wide one changes nothing.
          if (grants[p][r] === true) continue;
          const set = new Set(grants[p][r] || []);
          for (const c of splitList(cols)) {
            if (verb === 'grant') set.add(c);
            else set.delete(c);
          }
          grants[p][r] = set.size ? set : false;
        }
      }
    }
  } else if (/^((create|alter|drop) policy|grant|revoke) /.test(text) && /\bmembers\b/.test(text)) {
    unhandled.push(`${file}: ${text}`);
  }
}

test('the replay understands every policy and grant statement on public.members', () => {
  assert.deepEqual(unhandled, [], 'teach this test the new statement form before relying on it');
  // Guards against a parser that silently matches nothing and passes everything.
  assert.ok(created.has('members_self_read'), 'did not see 0002_rls.sql create members_self_read');
  assert.ok(
    created.has('members_self_update'),
    'did not see 0002_rls.sql create members_self_update',
  );
});

test('no policy lets a signed-in member update public.members without a column restriction', () => {
  const updatable = grants.update.authenticated;
  for (const [name, p] of policies) {
    if (!['update', 'all'].includes(p.cmd) || !p.roles.includes('authenticated')) continue;
    assert.notEqual(
      updatable,
      true,
      `${p.file}: ${name} lets a member update every column of their row, is_admin included`,
    );
    const exposed = PRIVILEGED.filter((c) => updatable && updatable.has(c));
    assert.deepEqual(exposed, [], `${p.file}: ${name} lets a member set ${exposed.join(', ')}`);
  }
});

test('anon and authenticated hold no write privilege on privileged members columns', () => {
  for (const p of WRITES) {
    for (const r of ROLES) {
      const g = grants[p][r];
      assert.notEqual(g, true, `${r} still holds table-wide ${p.toUpperCase()} on public.members`);
      const exposed = PRIVILEGED.filter((c) => g && g.has(c));
      assert.deepEqual(exposed, [], `${r} can ${p} ${exposed.join(', ')} on public.members`);
    }
  }
});
