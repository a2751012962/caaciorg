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
const config = `window.CAACI_CONFIG = ${JSON.stringify({
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
}, null, 2)};\n`;
await writeFile(join(DIST, 'assets', 'caaci-config.js'), config);
await copyFile(join(ROOT, 'src', 'caaci-app.js'), join(DIST, 'assets', 'caaci-app.js'));

const inject = `\n<script src="/assets/caaci-config.js"></script>\n` +
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
console.log('dist/ ready. Deploy with:  npx wrangler pages deploy dist');
