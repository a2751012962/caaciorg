// Minimal static file server for ./mirror (verification only)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.argv[2] || 'mirror';
// fileURLToPath, not .pathname — see build.mjs.
const ROOT = fileURLToPath(new URL(`./${DIR}/`, import.meta.url));
const PORT = Number(process.argv[3] || 8799);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.xml': 'application/xml',
};

// Like Cloudflare Pages: an address that matches nothing gets dist/404.html
// (the React not-found page) with a 404 status, the /zh/ copy under /zh/. The
// plain text answer stays for a dist without one (the bare mirror).
async function notFound(res, path) {
  for (const candidate of [/^\/zh(\/|$)/.test(path) ? 'zh/404.html' : null, '404.html']) {
    if (!candidate) continue;
    try {
      const buf = await readFile(join(ROOT, candidate));
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      return res.end(buf);
    } catch {
      /* no such page: try the next */
    }
  }
  res.writeHead(404);
  res.end('Not found');
}

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    let p = path;
    // The dist/_redirects rewrites Pages applies: /events/<slug>/register(/)
    // serves /event-register/, and the /zh/ copy likewise.
    p = p.replace(/^(\/zh)?\/events\/[^/]+\/register\/?$/, '$1/event-register/');
    let fp = join(ROOT, p);
    let s;
    try {
      s = await stat(fp);
    } catch {
      s = null;
    }
    if (s && s.isDirectory()) {
      fp = join(fp, 'index.html');
    } else if (!s) {
      fp = join(ROOT, p, 'index.html');
    } // extensionless page
    const buf = await readFile(fp);
    res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    await notFound(res, path);
  }
}).listen(PORT, () => console.log(`mirror serving on http://localhost:${PORT}`));
