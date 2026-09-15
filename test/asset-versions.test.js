// Cache busting for /assets/*. caaciorg.com serves those files with
// max-age=14400 while its HTML is max-age=0, so build.mjs gives every asset URL
// a ?v=<content hash>: a deploy that changes a file changes its URL on the very
// next page load, and a file that did not change keeps its URL and its browser
// cache. Covers the pure helpers and a real build into a temporary directory
// (not dist/, which another test file may be rebuilding at the same moment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentHash,
  planAssetVersions,
  versionAssetRefs,
  versionImports,
} from '../asset-versions.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const files = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));

test('contentHash: 12 hex characters of sha256, the same for the same bytes', () => {
  const h = contentHash('body{}');
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(contentHash(Buffer.from('body{}')), h);
  assert.notEqual(contentHash('body{ }'), h);
});

test('versionImports: static, multi-line, side-effect, re-export and dynamic imports of a sibling', () => {
  const v = (name) => ({ 'a.js': 'aaa', 'b.js': 'bbb' })[name];
  const js = [
    `import { x } from './a.js';`,
    `import {\n  y,\n  z,\n} from "./b.js";`,
    `import './a.js';`,
    `export * from './b.js';`,
    `const m = await import('./a.js');`,
  ].join('\n');
  assert.equal(
    versionImports(js, v),
    [
      `import { x } from './a.js?v=aaa';`,
      `import {\n  y,\n  z,\n} from "./b.js?v=bbb";`,
      `import './a.js?v=aaa';`,
      `export * from './b.js?v=bbb';`,
      `const m = await import('./a.js?v=aaa');`,
    ].join('\n'),
  );
});

test('versionImports: bare packages, unknown files, parent paths and versioned specifiers stay as they are', () => {
  const v = (name) => (name === 'a.js' ? 'aaa' : undefined);
  const js = [
    `import ws from "ws";`,
    `import q from './missing.js';`,
    `import r from './a.js?v=old';`,
    `import s from '../a.js';`,
  ].join('\n');
  assert.equal(versionImports(js, v), js);
});

test('planAssetVersions: an importer gets a new version when only its dependency changed', () => {
  const build = (shared) =>
    planAssetVersions(
      files({
        'app.js': `import { f } from './shared.js';`,
        'shared.js': shared,
        'ui.css': 'a{}',
      }),
    );
  const before = build('export const f = 1;');
  const after = build('export const f = 2;');
  const shared = after.versions.get('shared.js');
  assert.notEqual(shared, before.versions.get('shared.js'));
  assert.notEqual(
    after.versions.get('app.js'),
    before.versions.get('app.js'),
    'app.js now imports a different shared.js URL, so its own URL changes too',
  );
  assert.equal(
    after.versions.get('ui.css'),
    before.versions.get('ui.css'),
    'an unchanged file keeps its URL, and so its browser cache',
  );
  assert.equal(after.rewritten.get('app.js'), `import { f } from './shared.js?v=${shared}';`);
  assert.equal(
    after.versions.get('app.js'),
    contentHash(after.rewritten.get('app.js')),
    'the version is the hash of the file as served',
  );
  assert.equal(after.rewritten.has('shared.js'), false, 'files without imports are not rewritten');
  assert.equal(after.rewritten.has('ui.css'), false);
});

test('planAssetVersions: an import cycle is a build error, not a wrong hash', () => {
  assert.throws(
    () => planAssetVersions(files({ 'a.js': `import './b.js';`, 'b.js': `import './a.js';` })),
    /cycle/,
  );
});

test('versionAssetRefs: href and src into /assets/ get the version; other URLs do not', () => {
  const v = (name) => ({ 'caaci-ui.css': '111', 'caaci-app.js': '222' })[name];
  const others =
    `<link href="/wp-content/plugins/x/assets/y.css?ver=6.1">` +
    `<img src="https://cdn.example/assets/z.png">`;
  const html =
    `<link rel="stylesheet" href="/assets/caaci-ui.css">\n` +
    `<script type="module" src='/assets/caaci-app.js'></script>\n` +
    others;
  assert.equal(
    versionAssetRefs(html, v, 'index.html'),
    `<link rel="stylesheet" href="/assets/caaci-ui.css?v=111">\n` +
      `<script type="module" src='/assets/caaci-app.js?v=222'></script>\n` +
      others,
  );
});

test('versionAssetRefs: a page linking an asset the build did not produce fails the build', () => {
  assert.throws(
    () =>
      versionAssetRefs(
        '<script src="/assets/gone.js"></script>',
        () => undefined,
        'admin/index.html',
      ),
    /admin\/index\.html.*\/assets\/gone\.js/,
  );
});

// ---------- the real build ----------
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

test('build: every /assets/ URL in the built site carries the hash of the file it serves', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'caaci-dist-'));
  t.after(() => rm(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await promisify(execFile)(process.execPath, ['build.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CAACI_DIST: out },
  });

  const assets = join(out, 'assets');
  const hashOf = new Map();
  for (const name of await readdir(assets))
    hashOf.set(name, contentHash(await readFile(join(assets, name))));
  const checkVersion = (where, name, v) => {
    assert.ok(hashOf.has(name), `${where}: /assets/${name} is not in the build`);
    assert.equal(v, hashOf.get(name), `${where}: /assets/${name}?v=${v} is not the served hash`);
  };

  // Pages: no fixed asset URL left, and every version matches the file.
  const pages = {};
  for (const f of (await walk(out)).filter((p) => p.endsWith('.html'))) {
    const where = relative(out, f).split(sep).join('/');
    const html = await readFile(f, 'utf8');
    pages[where] = html;
    const fixed = html.match(/\b(?:href|src)\s*=\s*["']\/assets\/[^"'?]*["']/g);
    assert.equal(fixed, null, `${where}: unversioned ${fixed}`);
    for (const m of html.matchAll(/["']\/assets\/([\w.-]+)\?v=([0-9a-f]+)["']/g))
      checkVersion(where, m[1], m[2]);
  }
  const v = (name) => `/assets/${name}?v=${hashOf.get(name)}`;
  // One page from each kind of page the build writes.
  const mirrored = 'hello-world/index.html';
  assert.ok(pages[mirrored].includes(`<link rel="stylesheet" href="${v('caaci-ui.css')}">`));
  assert.ok(pages[mirrored].includes(`<script type="module" src="${v('caaci-app.js')}">`));
  assert.ok(pages[`zh/${mirrored}`].includes(`src="${v('caaci-app.js')}"`));
  assert.ok(pages['admin/index.html'].includes(`src="${v('caaci-admin.js')}"`));
  assert.ok(pages['admin/index.html'].includes(`href="${v('tabler.min.css')}"`));
  assert.ok(pages['login-3/index.html'].includes(`src="${v('caaci-member.js')}"`));
  assert.ok(pages['login-3/index.html'].includes(`src="${v('caaci-config.js')}"`));
  // The React site (web/) loads the same runtime config; its own bundles are hashed by Vite.
  assert.ok(pages['index.html'].includes(`<script src="${v('caaci-config.js')}"></script>`));
  assert.ok(
    pages['zh/account/index.html'].includes(`<script src="${v('caaci-config.js')}"></script>`),
  );

  // Modules: a query string on the entry does not reach its imports, so each
  // relative import names the version of the file it loads.
  let imports = 0;
  for (const name of hashOf.keys()) {
    if (!name.endsWith('.js')) continue;
    const js = await readFile(join(assets, name), 'utf8');
    for (const m of js.matchAll(
      /\b(?:from|import)\s*\(?\s*["']\.\/([\w.-]+)(?:\?v=([0-9a-f]+))?["']/g,
    )) {
      assert.ok(m[2], `${name}: unversioned import of ./${m[1]}`);
      checkVersion(name, m[1], m[2]);
      imports++;
    }
  }
  for (const entry of ['caaci-app.js', 'caaci-member.js', 'caaci-admin.js'])
    assert.ok(
      (await readFile(join(assets, entry), 'utf8')).includes(
        `'./caaci-shared.js?v=${hashOf.get('caaci-shared.js')}'`,
      ),
      `${entry} imports the versioned caaci-shared.js`,
    );
  assert.ok(imports >= 3, `found ${imports} relative imports`);

  // Vendored bundles are served byte for byte.
  for (const [name, src] of [
    ['supabase.js', 'src/supabase.js'],
    ['tabler.min.js', 'src/vendor/tabler.min.js'],
    ['filepond.js', 'src/vendor/filepond.js'],
  ])
    assert.equal(hashOf.get(name), contentHash(await readFile(join(ROOT, src))), name);
});
