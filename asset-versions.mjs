// asset-versions.mjs — cache busting for dist/assets, used by build.mjs.
//
// On caaciorg.com /assets/* arrive with `Cache-Control: public, max-age=14400`,
// while the same files on caaci-8s2.pages.dev (same ETag) and the HTML on both
// hosts arrive with max-age=0 (checked 2026-09-13). At a fixed URL a returning
// visitor therefore keeps the old CSS/JS for up to 4 hours after a deploy, and a
// new page can run against an old stylesheet. So every /assets/ URL carries ?v=<content hash>:
// a changed file gets a new URL on the next page load, an unchanged file keeps
// its URL and stays cached.
//
// A query string on a module does not reach the modules it imports
// ('./caaci-shared.js' resolves without it), so relative imports between assets
// are versioned too — and an importer is hashed after that rewrite, so a change
// in caaci-shared.js also changes the URL of every module that imports it.
import { createHash } from 'node:crypto';

export const contentHash = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);

// A sibling module in a static import, re-export, side-effect or dynamic import:
//   from './x.js'   import './x.js'   import('./x.js')
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+)\2/g;

// Rewrites './name' to './name?v=<version>' wherever versionOf(name) knows the
// file. Anything else stays as written: bare packages, parent paths, specifiers
// that already carry a query, and names that are not assets (a vendor bundle
// may quote such a string without importing it).
export function versionImports(js, versionOf) {
  return js.replace(RELATIVE_IMPORT, (match, lead, quote, name) => {
    const v = versionOf(name);
    return v ? `${lead}${quote}./${name}?v=${v}${quote}` : match;
  });
}

// files: Map of asset file name -> Buffer, for the flat dist/assets directory.
// Returns the version of every file and the new text of each module whose
// imports were rewritten (all other files are served byte for byte).
export function planAssetVersions(files) {
  const versions = new Map();
  const rewritten = new Map();
  const visiting = new Set();
  const visit = (name) => {
    if (versions.has(name)) return versions.get(name);
    if (visiting.has(name))
      throw new Error(`asset import cycle through ${name}: cannot give it a content hash`);
    visiting.add(name);
    let data = files.get(name);
    if (name.endsWith('.js')) {
      const js = data.toString('utf8');
      const out = versionImports(js, (dep) => (files.has(dep) ? visit(dep) : undefined));
      if (out !== js) rewritten.set(name, (data = out));
    }
    versions.set(name, contentHash(data));
    visiting.delete(name);
    return versions.get(name);
  };
  for (const name of files.keys()) visit(name);
  return { versions, rewritten };
}

// href="/assets/x" and src="/assets/x" (either quote). A page that links an
// asset the build did not produce would 404 in production, so it fails here.
const ASSET_REF = /(\b(?:href|src)\s*=\s*)(['"])\/assets\/([\w.-]+)\2/g;

export function versionAssetRefs(html, versionOf, page) {
  return html.replace(ASSET_REF, (match, attr, quote, name) => {
    const v = versionOf(name);
    if (!v) throw new Error(`${page}: links /assets/${name}, which the build did not produce`);
    return `${attr}${quote}/assets/${name}?v=${v}${quote}`;
  });
}
