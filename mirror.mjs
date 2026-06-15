// mirror.mjs — public mirror of caaciorg.com (pages + same-host assets)
// Node 22+ (uses global fetch). Output: ./mirror
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ORIGIN = 'https://caaciorg.com';
const OUT = new URL('./mirror/', import.meta.url).pathname;
const UA = { 'user-agent': 'Mozilla/5.0 (mirror; caaci migration)' };
const CONCURRENCY = 8;

const seen = new Set(); // urls already queued/handled
const assetQueue = new Set(); // same-host asset urls to fetch
const log = [];

const isAsset = (u) =>
  /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|json|xml|txt|map|pdf)(\?|#|$)/i.test(
    u,
  );

function abs(u, base = ORIGIN) {
  try {
    if (u.startsWith('//')) u = 'https:' + u;
    return new URL(u, base).href;
  } catch {
    return null;
  }
}
function sameHost(u) {
  try {
    return new URL(u).host === 'caaciorg.com';
  } catch {
    return false;
  }
}
// map a same-host URL to a local file path under mirror/
function localPath(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/') || p === '') p += 'index.html';
  // pages without extension -> dir/index.html
  else if (!/\.[a-z0-9]{1,8}$/i.test(p)) p += '/index.html';
  return join(OUT, p);
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchBuf(u) {
  const r = await fetch(u, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return Buffer.from(await r.arrayBuffer());
}

async function save(p, buf) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
}

// rewrite same-host absolute/protocol-relative URLs to root-relative so the
// mirror is portable; leave cross-origin (Google Fonts, etc.) untouched.
function rewrite(text) {
  return text
    .replaceAll('https://caaciorg.com', '')
    .replaceAll('http://caaciorg.com', '')
    .replaceAll('//caaciorg.com', '');
}

// extract candidate same-host asset URLs from HTML or CSS text
function extractAssets(text, baseUrl) {
  const out = new Set();
  const patterns = [
    /(?:src|href|content|data-src|poster)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /["']([^"']+\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm))["']/gi,
    /srcset\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1];
      // srcset: split on commas -> "url width"
      const parts = re.source.startsWith('srcset')
        ? raw.split(',').map((s) => s.trim().split(/\s+/)[0])
        : [raw];
      for (let part of parts) {
        if (
          !part ||
          part.startsWith('data:') ||
          part.startsWith('mailto:') ||
          part.startsWith('tel:') ||
          part.startsWith('#')
        )
          continue;
        const a = abs(part, baseUrl);
        if (a && sameHost(a) && isAsset(a)) out.add(a.split('#')[0]);
      }
    }
  }
  return out;
}

async function handlePage(u) {
  const buf = await fetchBuf(u);
  let html = buf.toString('utf8');
  for (const a of extractAssets(html, u)) assetQueue.add(a);
  html = rewrite(html);
  await save(localPath(u), Buffer.from(html, 'utf8'));
  log.push(`PAGE ${u}`);
}

async function handleAsset(u) {
  const p = localPath(u);
  if (await exists(p)) return;
  let buf;
  try {
    buf = await fetchBuf(u);
  } catch (e) {
    log.push(`MISS ${u} (${e.message})`);
    return;
  }
  // CSS: parse for nested url() assets, then rewrite
  if (/\.css(\?|$)/i.test(u)) {
    let css = buf.toString('utf8');
    for (const a of extractAssets(css, u)) assetQueue.add(a);
    css = rewrite(css);
    buf = Buffer.from(css, 'utf8');
  }
  await save(p, buf);
  log.push(`ASSET ${u}`);
}

async function pool(items, worker) {
  const arr = [...items];
  let i = 0;
  const run = async () => {
    while (i < arr.length) {
      const idx = i++;
      await worker(arr[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, arr.length) }, run));
}

async function getSitemapUrls() {
  const idx = (await fetchBuf(`${ORIGIN}/wp-sitemap.xml`)).toString('utf8');
  const subs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = new Set();
  for (const s of subs) {
    if (/users|taxonomies/.test(s)) continue; // skip user/category author pages
    try {
      const xml = (await fetchBuf(s)).toString('utf8');
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) if (sameHost(m[1])) urls.add(m[1]);
    } catch {
      log.push(`SITEMAP MISS ${s}`);
    }
  }
  return urls;
}

// ---- run ----
console.log('Collecting sitemap URLs…');
const pages = await getSitemapUrls();
// also mirror the Chinese (TranslatePress) variants
for (const p of [...pages]) {
  const u = new URL(p);
  pages.add(`${ORIGIN}/zh${u.pathname}`);
}
console.log(`Pages to mirror: ${pages.size}`);

console.log('Downloading pages…');
await pool(pages, async (u) => {
  try {
    await handlePage(u);
  } catch (e) {
    log.push(`PAGE MISS ${u} (${e.message})`);
  }
});

console.log(`Downloading assets… (${assetQueue.size} discovered so far)`);
// assets discover more assets (CSS->fonts); loop until drained
let round = 0;
while (assetQueue.size) {
  const batch = [...assetQueue];
  assetQueue.clear();
  const fresh = batch.filter((u) => !seen.has(u));
  fresh.forEach((u) => seen.add(u));
  if (!fresh.length) break;
  console.log(`  round ${++round}: ${fresh.length} assets`);
  await pool(fresh, handleAsset);
}

await save(join(OUT, '_mirror-log.txt'), Buffer.from(log.join('\n'), 'utf8'));
const pageCount = log.filter((l) => l.startsWith('PAGE ')).length;
const assetCount = log.filter((l) => l.startsWith('ASSET ')).length;
const miss = log.filter((l) => l.includes('MISS')).length;
console.log(`\nDone. pages=${pageCount} assets=${assetCount} misses=${miss}`);
console.log(`Log: mirror/_mirror-log.txt`);
