// Shared machinery for the browser suite. Exports only — registers no tests.
//
// Hermetic by construction. The pages are served from the real dist/ by the
// repo's own serve-mirror.mjs (which already emulates what Cloudflare Pages
// does: a directory serves its index.html, /events/<slug>/register/ rewrites to
// /event-register/, an unknown address gets 404.html). Every request that would
// leave the machine — /api/**, *.supabase.co, Stripe, Google Fonts — is
// answered from FIXTURES below, so a run does not depend on the live project
// being up, never reads production data, and gives the same answer today as it
// will in March.
//
// The page list is read from dist/ rather than written down here. A route added
// to the React app or a mirror page removed changes what gets checked without
// anybody remembering to edit a list, which is the only way a list like this
// stays true.
import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DIST = `${ROOT}dist`;

// --- what a page is -------------------------------------------------------
// Two layers, as UI_GUIDELINE.md draws them: the React app in web/ (ours, every
// line) and the Divi mirror (frozen — "the look is therefore fixed, we do not
// restyle it"). The difference is visible in the built HTML: React pages are a
// shell around <div id="root">.
const REACT_MARKER = '<div id="root"></div>';

// Addresses nothing should visit in a test run. wp-admin and friends are
// carried in the mirror only so the capture stays byte-for-byte.
const SKIP = [/^\/wp-(admin|content|includes)\//, /^\/hello-world\//];

export async function pages() {
  const found = [];
  async function walk(dir, url) {
    for (const name of await readdir(dir)) {
      const p = `${dir}/${name}`;
      if ((await stat(p)).isDirectory()) await walk(p, `${url}${name}/`);
      else if (name === 'index.html') {
        if (SKIP.some((re) => re.test(url))) continue;
        const html = await readFile(p, 'utf8');
        found.push({ url, react: html.includes(REACT_MARKER) });
      }
    }
  }
  await walk(DIST, '/');
  return found.sort((a, b) => a.url.localeCompare(b.url));
}

// --- the static server ----------------------------------------------------
export function serve(port) {
  const child = spawn(process.execPath, ['serve-mirror.mjs', 'dist', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    const bail = setTimeout(() => reject(new Error('serve-mirror did not start')), 15000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('serving on')) {
        clearTimeout(bail);
        resolve();
      }
    });
    child.on('error', reject);
  });
  return { child, ready, stop: () => child.kill() };
}

// --- the network, answered locally ----------------------------------------
// Only what a page actually asks for. Each body is the smallest shape the code
// reads; if a page starts needing a field that is not here it will show up as a
// console error, which this suite already fails on.
const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const TIERS = [
  { id: 'individual', name: 'Individual', price_cents: 3000, invite_only: false, sort: 1 },
  { id: 'family', name: 'Family', price_cents: 6000, invite_only: false, sort: 2 },
];

const FIXTURES = [
  // Supabase PostgREST reads the public pages make.
  [/\/rest\/v1\/membership_tiers/, json(TIERS)],
  [/\/rest\/v1\/events/, json([])],
  [/\/rest\/v1\/business_directory/, json([])],
  [/\/rest\/v1\//, json([])],
  // Signed out: GoTrue answers "no session" with a 401, and the client expects
  // that shape rather than an empty 200.
  [
    /\/auth\/v1\/user/,
    { status: 401, contentType: 'application/json', body: '{"msg":"no session"}' },
  ],
  [/\/auth\/v1\//, json({})],
  // The site's own API.
  [/\/api\/volunteer/, json({ events: [] })],
  [/\/api\/event-register/, json({ error: 'not found' })],
  [/\/api\/tokens\/me/, json({ balance: 0 })],
  [/\/api\//, json({})],
];

// Anything not matched and not same-origin is refused rather than allowed
// through, so a run can never quietly start depending on the internet.
export async function stubNetwork(page, origin) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    for (const [re, response] of FIXTURES) {
      if (re.test(url)) return route.fulfill(response);
    }
    // Fonts and other third-party assets: answer empty rather than fail, so a
    // blocked request is not reported as a console error the test then blames
    // on the page.
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
}

// --- loading a page, deterministically -------------------------------------
// Not `networkidle`: it waits for a quiet network, which a page with a poll, a
// video or a long-lived connection never reaches, and the wait is then bounded
// only by the timeout. Across 80-odd pages in a blocking job that is minutes of
// nothing. Instead wait for the thing that actually means "rendered": a React
// page has put children inside #root, a mirror page has finished `load`.
export async function gotoSettled(page, url, { react }) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
  if (react) {
    await page
      .waitForFunction(() => document.querySelector('#root')?.children.length > 0, null, {
        timeout: 15000,
      })
      // A React route that never mounts is a finding, not a crash: let the
      // render assertions report it as an empty page.
      .catch(() => {});
  }
  // One frame for layout to settle after mount, so measurements are of the
  // painted page rather than of React's first pass. A stub page (/admin-next/,
  // the printed-QR addresses) redirects as it loads, which destroys the
  // execution context mid-evaluate — that is the page doing its job, so follow
  // it and settle again rather than treating it as a failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      break;
    } catch (e) {
      if (!/Execution context was destroyed/.test(String(e))) throw e;
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    }
  }
  return response;
}

// Where a script came from, for deciding whether an error is ours. The mirror
// pages carry WordPress/Divi scripts — including inline ones — that expect
// third-party assets this hermetic run does not serve; those failures are the
// harness's doing, not the site's. Our own layer is exactly two paths, and
// "served from localhost" is not one of them: every inline Divi script is
// served from localhost too.
export const OUR_SCRIPT = /\/assets\/caaci-|\/app\//;

// --- axe ------------------------------------------------------------------
const AXE_SOURCE = `${ROOT}node_modules/axe-core/axe.min.js`;

export const axeAvailable = () => existsSync(AXE_SOURCE);

// `include` scopes the audit. On a mirror page that is the .caaci-* subtree we
// inject; Divi's own markup is not ours to fix and the repo forbids editing it.
export async function axeViolations(page, { include, serious = true } = {}) {
  await page.addScriptTag({ path: AXE_SOURCE });
  return page.evaluate(
    async ({ include, serious }) => {
      const context = include ? { include } : document;
      // eslint-disable-next-line no-undef
      const results = await axe.run(context, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      });
      return results.violations
        .filter((v) => !serious || v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
        }));
    },
    { include, serious },
  );
}
