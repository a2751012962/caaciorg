// Minimal static file server for ./mirror (verification only)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIR = process.argv[2] || 'mirror';
const ROOT = new URL(`./${DIR}/`, import.meta.url).pathname;
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

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
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
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`mirror serving on http://localhost:${PORT}`));
