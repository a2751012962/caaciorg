// apply-supabase.mjs — provisions the Supabase project via the Management API.
// Usage: SBP=<personal access token> node apply-supabase.mjs
// Reads SQL from supabase/, runs it, fetches anon+service keys, writes .env.
// Never prints the token or the keys.
import { readFile, writeFile } from 'node:fs/promises';

const REF = 'gczslluaxccbnftvfayn';
const TOKEN = process.env.SBP;
if (!TOKEN) { console.error('Missing SBP env (personal access token).'); process.exit(1); }
const API = 'https://api.supabase.com/v1';
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

async function runSql(label, file) {
  const query = await readFile(new URL(`./supabase/${file}`, import.meta.url), 'utf8');
  const r = await fetch(`${API}/projects/${REF}/database/query`, {
    method: 'POST', headers: H, body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) { console.error(`✗ ${label} (${file}): ${r.status} ${text.slice(0, 400)}`); return false; }
  console.log(`✓ ${label} (${file})`);
  return true;
}

console.log('Checking project access…');
const proj = await fetch(`${API}/projects/${REF}`, { headers: H });
if (!proj.ok) { console.error(`Cannot access project: ${proj.status} ${await proj.text()}`); process.exit(1); }
const p = await proj.json();
console.log(`Project: ${p.name} (${p.region}) status=${p.status}`);

console.log('\nApplying migrations…');
const ok1 = await runSql('schema', 'migrations/0001_init.sql');
const ok2 = await runSql('RLS',    'migrations/0002_rls.sql');
const ok3 = await runSql('seed',   'seed.sql');

console.log('\nFetching API keys…');
let keysRes = await fetch(`${API}/projects/${REF}/api-keys?reveal=true`, { headers: H });
if (!keysRes.ok) keysRes = await fetch(`${API}/projects/${REF}/api-keys`, { headers: H });
if (!keysRes.ok) { console.error(`Cannot read keys: ${keysRes.status} ${await keysRes.text()}`); process.exit(1); }
const keys = await keysRes.json();
const find = (n) => (keys.find(k => k.name === n) || {}).api_key;
const anon = find('anon');
const service = find('service_role');
if (!anon || !service) { console.error('Keys not found in response:', keys.map(k => k.name)); process.exit(1); }

// Update .env in place (only the two SUPABASE key lines).
const envPath = new URL('./.env', import.meta.url);
let env = await readFile(envPath, 'utf8');
env = env.replace(/^SUPABASE_ANON_KEY=.*$/m, `SUPABASE_ANON_KEY=${anon}`)
         .replace(/^SUPABASE_SERVICE_ROLE_KEY=.*$/m, `SUPABASE_SERVICE_ROLE_KEY=${service}`);
await writeFile(envPath, env);
console.log('✓ Wrote anon + service_role keys to .env (values not shown)');

console.log(`\nDone. migrations: ${[ok1,ok2,ok3].filter(Boolean).length}/3 succeeded.`);
