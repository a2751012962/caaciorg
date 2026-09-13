// Regression test: browsers must not be able to write business_directory or
// rsvps. The site writes both only from Pages Functions holding the
// service-role key (/api/business-listing, /api/admin/business, /api/rsvp),
// which bypasses RLS and table grants, so the client roles need no write path.
//
// Static, like the rest of `npm test`: it replays supabase/migrations/*.sql in
// file order (the SQL-editor order, which apply-supabase.mjs also uses) through
// a small model of the statements that decide who can write — create/drop
// policy, grant/revoke, enable/disable row level security. It checks what the
// migrations say, not what the live project holds; confirm that against
// pg_policies and information_schema.role_table_grants after applying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const LOCKDOWN = FILES.find((f) => f.endsWith('_business_rsvps_rls.sql'));

const TABLE_PRIVS = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];
const WRITE_PRIVS = ['insert', 'update', 'delete', 'truncate'];
const WRITE_CMDS = ['all', 'insert', 'update', 'delete'];
const CLIENT_ROLES = ['anon', 'authenticated'];
const LOCKED = ['public.business_directory', 'public.rsvps'];

// Split SQL into normalized statements, skipping -- comments and blanking
// 'string' literals and $$ bodies so their contents cannot hide or fake a ';'.
function statements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
    } else if (sql.startsWith('$$', i)) {
      const end = sql.indexOf('$$', i + 2);
      cur += ' $$ ';
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      cur += " '' ";
      i = j + 1;
    } else if (sql[i] === ';') {
      out.push(cur);
      cur = '';
      i++;
    } else {
      cur += sql[i++];
    }
  }
  out.push(cur);
  return out.map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
}

const qualify = (name) => (name.includes('.') ? name : `public.${name}`);

// Final state of every table the replayed migrations touch. A table starts the
// way Supabase creates one in `public`: RLS off, no policies, and every table
// privilege granted to anon and authenticated (the project's default privileges).
// A policy/grant/RLS statement the model cannot read fails the test rather than
// being skipped, so a new statement shape cannot slip past unnoticed.
function replay(files) {
  const tables = new Map();
  const table = (name) => {
    const key = qualify(name);
    if (!tables.has(key)) {
      tables.set(key, {
        rls: false,
        policies: new Map(),
        grants: Object.fromEntries(CLIENT_ROLES.map((r) => [r, new Set(TABLE_PRIVS)])),
      });
    }
    return tables.get(key);
  };

  for (const file of files) {
    for (const s of statements(readFileSync(new URL(file, DIR), 'utf8'))) {
      const where = `${file}: ${s.slice(0, 90)}`;
      let m;
      if ((m = s.match(/^create table (?:if not exists )?([\w.]+)/))) {
        table(m[1]);
      } else if (
        (m = s.match(
          /^alter table (?:if exists )?(?:only )?([\w.]+) (enable|disable) row level security$/,
        ))
      ) {
        table(m[1]).rls = m[2] === 'enable';
      } else if ((m = s.match(/^create policy (\w+) on ([\w.]+)(?: as \w+)?(?: for (\w+))?/))) {
        const t = table(m[2]);
        // Postgres rejects a duplicate policy name, so a re-run would fail here.
        assert.ok(!t.policies.has(m[1]), `${where} — policy already exists`);
        t.policies.set(m[1], m[3] || 'all');
      } else if ((m = s.match(/^drop policy (if exists )?(\w+) on ([\w.]+)$/))) {
        const t = table(m[3]);
        assert.ok(m[1] || t.policies.has(m[2]), `${where} — no such policy`);
        t.policies.delete(m[2]);
      } else if ((m = s.match(/^(grant|revoke) (.+?) on (?:table )?(.+?) (?:to|from) (.+)$/))) {
        const [, verb, privList, target, roleList] = m;
        if (/^(function|procedure|routine|sequence|schema|type|domain|all (?!tables))/.test(target))
          continue;
        if (verb === 'revoke' && privList.startsWith('grant option for')) continue;
        const privs = privList
          .replace(/\([^)]*\)/g, '') // a column list still grants the privilege
          .split(',')
          .map((p) => p.trim())
          .flatMap((p) => (/^all( privileges)?$/.test(p) ? TABLE_PRIVS : [p]));
        const roles = roleList
          .replace(/ (with grant option|granted by \w+|cascade|restrict)/g, '')
          .split(',')
          .map((r) => r.trim())
          // a grant to PUBLIC reaches every role; a revoke from PUBLIC leaves
          // anon's and authenticated's own grants in place
          .flatMap((r) => (r === 'public' && verb === 'grant' ? CLIENT_ROLES : [r]))
          .filter((r) => CLIENT_ROLES.includes(r));
        const targets = target.startsWith('all tables in schema ')
          ? [...tables.keys()].filter((k) =>
              k.startsWith(`${target.replace('all tables in schema ', '')}.`),
            )
          : target.split(',').map((t) => qualify(t.trim()));
        for (const key of targets) {
          for (const role of roles) {
            for (const p of privs) {
              if (verb === 'grant') table(key).grants[role].add(p);
              else table(key).grants[role].delete(p);
            }
          }
        }
      } else if (/^(create|drop|alter) policy |^(grant|revoke) |row level security/.test(s)) {
        assert.fail(`${where} — statement not modelled; extend replay()`);
      }
    }
  }
  return tables;
}

const writePolicies = (t) =>
  [...t.policies].filter(([, cmd]) => WRITE_CMDS.includes(cmd)).map(([name]) => name);
const writeGrants = (t, role) => WRITE_PRIVS.filter((p) => t.grants[role].has(p));
const snapshot = (t) => ({
  rls: t.rls,
  policies: Object.fromEntries([...t.policies].sort()),
  grants: Object.fromEntries(CLIENT_ROLES.map((r) => [r, [...t.grants[r]].sort()])),
});

test('without the lockdown migration, the replay sees browser write access on both tables', () => {
  // Negative control: the checks below would be vacuous if the model could not
  // see the hole 0002_rls.sql opened.
  assert.ok(LOCKDOWN, 'expected supabase/migrations/NNNN_business_rsvps_rls.sql');
  const before = replay(FILES.filter((f) => f < LOCKDOWN));
  assert.deepEqual(writePolicies(before.get('public.business_directory')), ['biz_owner_write']);
  assert.deepEqual(writePolicies(before.get('public.rsvps')), ['rsvps_self']);
  for (const name of LOCKED) {
    for (const role of CLIENT_ROLES) {
      assert.deepEqual(writeGrants(before.get(name), role), WRITE_PRIVS, `${name}: ${role}`);
    }
  }
});

test('anon and authenticated have no write policy or write privilege on business_directory and rsvps', () => {
  const after = replay(FILES);
  for (const name of LOCKED) {
    const t = after.get(name);
    assert.equal(t.rls, true, `${name}: RLS enabled`);
    assert.deepEqual(writePolicies(t), [], `${name}: write policies`);
    for (const role of CLIENT_ROLES) {
      assert.deepEqual(writeGrants(t, role), [], `${name}: ${role} write privileges`);
    }
  }
});

test('the read policies and select grants survive the lockdown', () => {
  const after = replay(FILES);
  assert.equal(after.get('public.business_directory').policies.get('biz_read'), 'select');
  assert.equal(after.get('public.rsvps').policies.get('rsvps_self_read'), 'select');
  for (const name of LOCKED) {
    for (const role of CLIENT_ROLES) {
      assert.ok(after.get(name).grants[role].has('select'), `${name}: ${role} select`);
    }
  }
});

test('re-running every migration on top of itself (as apply-supabase.mjs does) ends in the same state', () => {
  const once = replay(FILES);
  const twice = replay([...FILES, ...FILES]);
  for (const name of LOCKED) {
    assert.deepEqual(snapshot(twice.get(name)), snapshot(once.get(name)), name);
  }
});
