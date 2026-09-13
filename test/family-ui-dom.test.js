// The Family card on /account/: boots the real account page and module in
// jsdom with Supabase stubbed and GET/POST /api/family answered per role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { mockFetch } from './helpers.js';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const PAGE = await readFile(new URL('../member-src/account.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 15));
const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];

// `confirms` records every confirm() text; `answer` is what confirm() returns.
function setup({ search = '', answer = true } = {}) {
  const dom = new JSDOM(PAGE, { url: 'https://caaci.example/account/' });
  const w = dom.window;
  globalThis.document = w.document;
  globalThis.Event = w.Event;
  globalThis.Image = w.Image;
  globalThis.localStorage = w.localStorage;
  globalThis.sessionStorage = w.sessionStorage;
  globalThis.location = {
    pathname: '/account/',
    origin: 'https://caaci.example',
    search,
    hash: '',
    href: '',
    reload: () => {},
  };
  w.__CAACI_TEST__ = true;
  const confirms = [];
  w.confirm = (text) => {
    confirms.push(text);
    return answer;
  };
  const scrolled = [];
  w.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this);
  };
  w.qrcode = () => ({ addData() {}, make() {}, createDataURL: () => 'data:image/gif;base64,R0lGOD' });
  globalThis.window = w;
  member.__setLang('en');
  return { confirms, scrolled };
}

const USER = { id: 'u1', email: 'mei@x.com' };

function supaStub({ user = USER, memberRow = null } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      getSession: async () =>
        user ? { data: { session: { access_token: 'tok', user } } } : { data: { session: null } },
    },
    from: (table) => ({
      select: () => ({
        eq: () => {
          if (table === 'membership_tiers') return Promise.resolve({ data: [] });
          return {
            maybeSingle: async () => ({ data: memberRow }),
            order: () => ({ limit: async () => ({ data: [] }) }),
          };
        },
      }),
    }),
  };
}

// GET /api/family answers `state.fam` (or `state.get`, a full response); POST
// answers `post(body, state)`, which may change `state.fam` for the reload.
function familyApi(fam, post = () => ({ body: { ok: true } })) {
  const state = { fam, get: null };
  const stub = mockFetch((url, opts) => {
    if (url.includes('/api/wallet-pass')) return { status: 503, body: {} };
    if (!url.includes('/api/family')) return { body: {} };
    if (opts.method === 'POST') return post(JSON.parse(opts.body), state);
    return state.get || { body: state.fam };
  });
  stub.state = state;
  stub.posts = () =>
    stub.calls
      .filter((c) => c.url.includes('/api/family') && c.options.method === 'POST')
      .map((c) => JSON.parse(c.options.body));
  stub.gets = () =>
    stub.calls.filter((c) => c.url.includes('/api/family') && c.options.method !== 'POST');
  return stub;
}

test('family: signed out with ?family_invite, Sign in comes back to the invitation', async () => {
  setup({ search: '?family_invite=inv-42' });
  member.__setSupa(supaStub({ user: null }));
  await member.wireAccountPage();
  const a = [...document.querySelectorAll('#caaci-account-host a')].find((x) =>
    /Sign in/.test(x.textContent),
  );
  assert.equal(
    a.getAttribute('href'),
    `/login-3/?next=${encodeURIComponent('/account/?family_invite=inv-42')}`,
  );

  // Hostile id text is encoded into the link, never markup.
  setup({ search: '?family_invite=%22%3E%3Cimg%20src%3Dx%3E' });
  member.__setSupa(supaStub({ user: null }));
  await member.wireAccountPage();
  assert.equal(q('#caaci-account-host img'), null);
  const b = [...document.querySelectorAll('#caaci-account-host a')].find((x) =>
    /Sign in/.test(x.textContent),
  );
  assert.equal(new URL(b.getAttribute('href'), 'https://caaci.example').pathname, '/login-3/');
  const next = new URL(b.getAttribute('href'), 'https://caaci.example').searchParams.get('next');
  assert.equal(new URL(next, 'https://caaci.example').searchParams.get('family_invite'), '"><img src=x>');
});

// Silence unused-helper lint until later slices use them.
void tick;
void qa;
void familyApi;
