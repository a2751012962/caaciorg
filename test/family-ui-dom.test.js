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
  w.qrcode = () => ({
    addData() {},
    make() {},
    createDataURL: () => 'data:image/gif;base64,R0lGOD',
  });
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
  assert.equal(
    new URL(next, 'https://caaci.example').searchParams.get('family_invite'),
    '"><img src=x>',
  );
});

const NONE = {
  role: 'none',
  household: null,
  plan: null,
  founder: null,
  seats: { used: 0, limit: 3 },
  people: [],
  invites: [],
  events: [],
  invitations_for_me: [],
};
const FAMILY_ROW = { id: 'u1', full_name: 'Mei Lin', tier_id: 'family', status: 'active' };
const submit = (form) => form.dispatchEvent(new Event('submit', { cancelable: true }));

for (const [label, get] of [
  ['404', { status: 404, body: { error: 'not found' } }],
  ['500', { status: 500, body: {} }],
  ['a network error', null],
]) {
  test(`family: GET failing with ${label} hides the card and leaves the page working`, async () => {
    setup();
    member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
    const api = familyApi(NONE);
    if (get) api.state.get = get;
    else
      api.state.get = {
        get status() {
          throw new TypeError('fetch failed');
        },
      };
    try {
      await member.wireAccountPage();
      await tick();
      assert.equal(api.gets().length, 1, 'GET /api/family once');
      assert.equal(api.gets()[0].options.headers.authorization, 'Bearer tok');
      const fam = q('#caaci-family-host');
      assert.ok(fam, 'family host exists');
      assert.equal(fam.hidden, true);
      assert.match(
        q('#caaci-account-host').textContent,
        /Family Membership/,
        'subscription still renders',
      );
      assert.ok(q('#caaci-security-host').children.length, 'security card still renders');
    } finally {
      api.restore();
    }
  });
}

test('family: role none with an active family tier offers invites; without one, nothing shows', async () => {
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  let api = familyApi(NONE);
  try {
    await member.wireAccountPage();
    await tick();
    const fam = q('#caaci-family-host');
    assert.equal(fam.hidden, false);
    assert.match(fam.textContent, /Family/);
    assert.match(fam.textContent, /Invite your family/);
    assert.match(q('[data-fam-seats]').textContent, /1\s*\/\s*3/);
    assert.ok(q('form[data-fam-invite] input[type="email"][required]'));
    assert.ok(q('form[data-fam-add] input[name="full_name"][required]'));
    assert.equal(qa('form[data-fam-add] select[name="relationship"] option').length, 6);
  } finally {
    api.restore();
  }

  for (const row of [
    { ...FAMILY_ROW, tier_id: 'individual' },
    { ...FAMILY_ROW, status: 'expired' },
  ]) {
    setup();
    member.__setSupa(supaStub({ memberRow: row }));
    api = familyApi(NONE);
    try {
      await member.wireAccountPage();
      await tick();
      assert.equal(q('#caaci-family-host').hidden, true, `${row.tier_id}/${row.status}: hidden`);
      assert.equal(q('form[data-fam-invite]'), null);
    } finally {
      api.restore();
    }
  }
});

test('family: invite posts the form, says which email went out, and reloads', async () => {
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  let delivered = 'invite';
  const api = familyApi(NONE, () => ({ body: { ok: true, invite: { id: 'i1' }, delivered } }));
  try {
    await member.wireAccountPage();
    await tick();
    let form = q('form[data-fam-invite]');
    form.querySelector('[name="email"]').value = ' dad@x.com ';
    form.querySelector('[name="full_name"]').value = 'Wei Lin';
    form.querySelector('[name="relationship"]').value = 'spouse';
    const btn = form.querySelector('button[type="submit"]');
    submit(form);
    assert.equal(btn.disabled, true, 'busy while sending');
    submit(form); // double submit sends nothing more
    await tick();
    await tick();
    assert.deepEqual(api.posts(), [
      { action: 'invite', email: 'dad@x.com', full_name: 'Wei Lin', relationship: 'spouse' },
    ]);
    const note = q('[data-fam-notice]');
    assert.match(note.textContent, /Invitation email sent to dad@x\.com/);
    assert.ok(note.classList.contains('alert-success'));
    assert.equal(api.gets().length, 2, 'reloaded after the invite');
    assert.equal(q('form[data-fam-invite] [name="email"]').value, '', 'fresh form after reload');

    // A new address gets a sign-in link instead; optional fields stay out.
    delivered = 'magic_link';
    form = q('form[data-fam-invite]');
    form.querySelector('[name="email"]').value = 'kid@x.com';
    submit(form);
    await tick();
    await tick();
    assert.deepEqual(api.posts()[1], { action: 'invite', email: 'kid@x.com' });
    assert.match(q('[data-fam-notice]').textContent, /sign-in link/i);
    assert.match(q('[data-fam-notice]').textContent, /kid@x\.com/);
  } finally {
    api.restore();
  }
});

test('family: add a name-only person; a server error shows and nothing reloads', async () => {
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  let fail = false;
  const api = familyApi(NONE, () =>
    fail ? { status: 409, body: { error: 'Family is full.' } } : { body: { ok: true } },
  );
  try {
    await member.wireAccountPage();
    await tick();
    let form = q('form[data-fam-add]');
    form.querySelector('[name="full_name"]').value = 'Baby Lin';
    form.querySelector('[name="relationship"]').value = 'child';
    submit(form);
    await tick();
    await tick();
    assert.deepEqual(api.posts(), [
      { action: 'add_person', full_name: 'Baby Lin', relationship: 'child' },
    ]);
    assert.match(q('[data-fam-notice]').textContent, /Baby Lin/);
    assert.equal(api.gets().length, 2);

    fail = true;
    form = q('form[data-fam-add]');
    form.querySelector('[name="full_name"]').value = 'Another';
    submit(form);
    await tick();
    await tick();
    const note = q('[data-fam-notice]');
    assert.equal(note.textContent, 'Family is full.');
    assert.ok(note.classList.contains('alert-danger'));
    assert.equal(api.gets().length, 2, 'no reload after an error');
    assert.equal(
      form.querySelector('button[type="submit"]').disabled,
      false,
      'button usable again',
    );

    // An empty name never posts.
    form.querySelector('[name="full_name"]').value = '  ';
    submit(form);
    await tick();
    assert.equal(api.posts().length, 2);
  } finally {
    api.restore();
  }
});
