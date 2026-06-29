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
// These two values are PUBLIC by design: the anon key is meant to ship to every
// browser (Row Level Security, not secrecy, protects the data) and is already
// served in this very file. They are hardcoded as defaults so the Cloudflare Pages
// Git build always produces a working config: the project's wrangler.toml locks the
// dashboard to secrets-only, and Pages does not expose runtime secrets to the build
// step — so build-time env vars are unavailable there. process.env still overrides
// when set (local/manual builds, other environments). The SERVICE ROLE key is NOT
// here and never belongs in the build — it stays a Pages Function secret.
const SUPABASE_URL_DEFAULT = 'https://gczslluaxccbnftvfayn.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjenNsbHVheGNjYm5mdHZmYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTE3NDUsImV4cCI6MjA5NjU4Nzc0NX0.g3O_oBuAEI8Z9aut8I-u9zgkUfe-COhg9uoLdyRTgs8';
await mkdir(join(DIST, 'assets'), { recursive: true });
const config = `window.CAACI_CONFIG = ${JSON.stringify(
  {
    SUPABASE_URL: process.env.SUPABASE_URL || SUPABASE_URL_DEFAULT,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_DEFAULT,
  },
  null,
  2,
)};\n`;
await writeFile(join(DIST, 'assets', 'caaci-config.js'), config);
await copyFile(join(ROOT, 'src', 'caaci-app.js'), join(DIST, 'assets', 'caaci-app.js'));
await copyFile(join(ROOT, 'src', 'caaci-ui.css'), join(DIST, 'assets', 'caaci-ui.css'));
// Self-hosted Supabase client (UMD) — served from our own origin so the site has
// NO third-party CDN dependency at runtime. esm.sh and similar CDNs are blocked or
// unreliable on some networks (e.g. mainland China), which previously left the
// Supabase client unloaded and made login/account/checkout silently do nothing.
await copyFile(join(ROOT, 'src', 'supabase.js'), join(DIST, 'assets', 'supabase.js'));

// Admin back-office page (hand-authored; mirror/ stays pristine). The HTML loads
// /assets/caaci-admin.js itself; the inject loop below still adds config + CSS.
await cp(join(ROOT, 'admin-src'), join(DIST, 'admin'), { recursive: true });
await copyFile(join(ROOT, 'src', 'caaci-admin.js'), join(DIST, 'assets', 'caaci-admin.js'));

const inject =
  `\n<link rel="stylesheet" href="/assets/caaci-ui.css">\n` +
  `<script src="/assets/supabase.js"></script>\n` +
  `<script src="/assets/caaci-config.js"></script>\n` +
  `<script type="module" src="/assets/caaci-app.js"></script>\n`;

// Native-POST guard, injected at the TOP of <head> so it runs before the login
// form is ever interactive. The mirrored MemberPress forms carry
// method="post" action="/login-3/"; on the static host a native submit returns
// HTTP 405. caaci-app.js normally intercepts the submit to run the Supabase
// login, but it loads at end-of-body — behind the mirror's render-blocking
// third-party (GoDaddy/wsimg) scripts — so a visitor on a slow network (e.g.
// mainland China) can submit before it attaches and hit the 405. This
// dependency-free inline guard cancels the native submit of the auth forms
// immediately; the real handler, added later, still performs the login.
const guard =
  `<script>(function(){document.addEventListener('submit',function(e){` +
  `var f=e.target;` +
  `if(f&&f.tagName==='FORM'&&(f.id==='mepr_loginform'||/mepro?-form/.test(f.className||'')))e.preventDefault();` +
  `},true);})();</script>\n`;

let n = 0;
for (const f of await walk(DIST)) {
  if (extname(f) !== '.html') continue;
  let html = await readFile(f, 'utf8');
  if (html.includes('caaci-app.js')) continue;
  html = html.includes('</body>') ? html.replace('</body>', inject + '</body>') : html + inject;
  if (html.includes('<head>')) html = html.replace('<head>', '<head>\n' + guard);
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
