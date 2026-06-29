// build.mjs — assemble the Cloudflare Pages deploy directory (./dist)
//   1. copy the pristine mirror/  ->  dist/
//   2. add the enhancement client (caaci-app.js) + public runtime config
//   3. inject both scripts before </body> on every HTML page
// Frontend stays byte-identical to the live site; only behaviour is layered on.
import { cp, rm, mkdir, readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = new URL('./', import.meta.url).pathname;
const MIRROR = join(ROOT, 'mirror');
const DIST = join(ROOT, 'dist');

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

console.log('Cleaning dist/…');
await rm(DIST, { recursive: true, force: true });
await cp(MIRROR, DIST, { recursive: true });

// Public runtime config — ONLY the public anon values are exposed to the browser.
await mkdir(join(DIST, 'assets'), { recursive: true });
const config = `window.CAACI_CONFIG = ${JSON.stringify(
  {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  },
  null,
  2,
)};\n`;
await writeFile(join(DIST, 'assets', 'caaci-config.js'), config);
await copyFile(join(ROOT, 'src', 'caaci-app.js'), join(DIST, 'assets', 'caaci-app.js'));
await copyFile(join(ROOT, 'src', 'caaci-ui.css'), join(DIST, 'assets', 'caaci-ui.css'));

// Admin back-office page (hand-authored; mirror/ stays pristine). The HTML loads
// /assets/caaci-admin.js itself; the inject loop below still adds config + CSS.
await cp(join(ROOT, 'admin-src'), join(DIST, 'admin'), { recursive: true });
await copyFile(join(ROOT, 'src', 'caaci-admin.js'), join(DIST, 'assets', 'caaci-admin.js'));

const inject =
  `\n<link rel="stylesheet" href="/assets/caaci-ui.css">\n` +
  `<script src="/assets/caaci-config.js"></script>\n` +
  `<script type="module" src="/assets/caaci-app.js"></script>\n`;

let n = 0;
for (const f of await walk(DIST)) {
  if (extname(f) !== '.html') continue;
  let html = await readFile(f, 'utf8');
  if (html.includes('caaci-app.js')) continue;
  html = html.includes('</body>') ? html.replace('</body>', inject + '</body>') : html + inject;
  await writeFile(f, html);
  n++;
}
console.log(`Injected enhancement into ${n} HTML pages.`);

// Consolidate the duplicate WordPress login/account pages.
//   The mirror captured five "login" pages and two "account" pages. Only
//   /login-3/ and /account/ are wired into the site navigation; the rest are
//   orphan MemberPress drafts (login-2/4/5 and account-5 have no form at all).
//   Auth is handled by caaci-app.js (Supabase), so the old form pages were
//   interchangeable — funnel every duplicate to the single canonical pair.
const CANON_LOGIN = 'login-3';
const CANON_ACCOUNT = 'account';
const REDIRECTS = {
  login: CANON_LOGIN,
  'login-2': CANON_LOGIN,
  'login-4': CANON_LOGIN,
  'login-5': CANON_LOGIN,
  'account-5': CANON_ACCOUNT,
};
const redirectStub = (to) => {
  const url = `/${to}/`;
  // Single template literal (no concatenation) so the markup stays on one line.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Redirecting…</title><link rel="canonical" href="${url}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${url}"><script>location.replace(${JSON.stringify(url)} + location.search + location.hash)</script></head><body>Redirecting to <a href="${url}">${url}</a>…</body></html>\n`;
};
let r = 0;
for (const base of ['', 'zh/']) {
  for (const [from, to] of Object.entries(REDIRECTS)) {
    const dir = join(DIST, base + from);
    try {
      await stat(dir); // skip if not in the mirror
      await writeFile(join(dir, 'index.html'), redirectStub(base + to));
      console.log(`Redirect: /${base + from}/ -> /${base + to}/`);
      r++;
    } catch {
      /* page absent — nothing to consolidate */
    }
  }
}
console.log(`Consolidated ${r} duplicate login/account pages.`);

console.log('dist/ ready. Deploy with:  npx wrangler pages deploy dist');
