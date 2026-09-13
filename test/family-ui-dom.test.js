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

// ---------- founder ----------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const P_FOUNDER = {
  id: 'p1',
  kind: 'account',
  member_id: 'u1',
  full_name: 'Mei Lin',
  relationship: 'head',
  is_founder: true,
  linked: true,
};
const P_SPOUSE = {
  id: 'p2',
  kind: 'account',
  member_id: 'u2',
  full_name: 'Wei Lin',
  relationship: 'spouse',
  is_founder: false,
  linked: true,
};
const P_CHILD = {
  id: 'p3',
  kind: 'name_only',
  member_id: null,
  full_name: 'Baby Lin',
  relationship: 'child',
  is_founder: false,
  linked: false,
};
const INV_DAD = {
  id: 'i1',
  email: 'dad@x.com',
  full_name: 'Lao Lin',
  relationship: 'parent',
  status: 'pending',
  created_at: '2026-09-01T12:00:00Z',
  expires_at: '2026-09-15T12:00:00Z',
};
const founderFam = (over = {}) => ({
  ...NONE,
  role: 'founder',
  household: { id: 'h1', name: 'Lin family', status: 'active' },
  plan: { tier_id: 'family', status: 'active', expires_at: '2027-03-01T00:00:00Z' },
  founder: { member_id: 'u1', email: 'mei@x.com' },
  seats: { used: 2, limit: 3 },
  people: [P_FOUNDER, P_CHILD],
  ...over,
});
const settle = async () => {
  await tick();
  await tick();
};

test('family founder: name, plan, seats, badges, activity, and the not-linked hint that prefills the invite', async () => {
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  const api = familyApi(
    founderFam({
      events: [
        {
          type: 'invite_sent',
          actor_email: 'mei@x.com',
          subject_email: 'dad@x.com',
          created_at: '2026-09-01T12:00:00Z',
        },
        {
          type: 'person_added',
          actor_email: 'mei@x.com',
          subject_email: null,
          created_at: '2026-09-02T12:00:00Z',
        },
      ],
    }),
  );
  try {
    await member.wireAccountPage();
    await tick();
    const fam = q('#caaci-family-host');
    assert.equal(fam.hidden, false);
    assert.equal(q('[data-fam-name]').textContent, 'Lin family');
    assert.match(q('[data-fam-plan-status]').textContent, /active/i);
    assert.match(
      fam.textContent,
      new RegExp(escRe(new Date('2027-03-01T00:00:00Z').toLocaleDateString())),
    );
    assert.match(q('[data-fam-seats]').textContent, /2\s*\/\s*3/);

    const [founder, child] = qa('[data-fam-person]');
    assert.ok(founder.querySelector('[data-fam-founder]'), 'founder badge');
    assert.match(founder.textContent, /Linked account/);
    assert.equal(founder.querySelector('[data-fam-remove]'), null, 'no Remove on the founder');
    assert.equal(child.querySelector('[data-fam-founder]'), null);
    assert.match(child.textContent, /Not linked to an account/);
    assert.match(child.textContent, /Once they have an email/);
    // The last non-founder person can't be removed — dissolving is the way out.
    assert.equal(child.querySelector('[data-fam-remove]').disabled, true);
    assert.match(child.textContent, /dissolve/i);

    child.querySelector('[data-fam-prefill]').click();
    const form = q('form[data-fam-invite]');
    assert.equal(form.querySelector('[name="full_name"]').value, 'Baby Lin');
    assert.equal(form.querySelector('[name="relationship"]').value, 'child');
    assert.equal(document.activeElement, form.querySelector('[name="email"]'));
    assert.equal(api.posts().length, 0, 'prefilling sends nothing');

    assert.equal(q('[data-fam-full]'), null);
    assert.equal(form.querySelector('button[type="submit"]').disabled, false);

    const events = qa('[data-fam-events] li');
    assert.equal(events.length, 2);
    assert.match(events[0].textContent, /mei@x\.com.*sent an invitation.*dad@x\.com/);
    assert.match(
      events[0].textContent,
      new RegExp(escRe(new Date('2026-09-01T12:00:00Z').toLocaleDateString())),
    );
    assert.match(events[1].textContent, /added a person/);
    assert.ok(q('[data-fam-dissolve]').classList.contains('btn-danger'));
  } finally {
    api.restore();
  }
});

test('family founder: a full family disables both forms; Remove confirms, posts, and reloads', async () => {
  const { confirms } = setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  const api = familyApi(
    founderFam({ seats: { used: 3, limit: 3 }, people: [P_FOUNDER, P_SPOUSE, P_CHILD] }),
    (body, state) => {
      state.fam = founderFam({ people: [P_FOUNDER, P_SPOUSE] });
      return { body: { ok: true } };
    },
  );
  try {
    await member.wireAccountPage();
    await tick();
    assert.match(q('[data-fam-full]').textContent, /Family is full \(3 people\)/);
    for (const sel of ['form[data-fam-invite]', 'form[data-fam-add]'])
      for (const el of q(sel).querySelectorAll('input, select, button'))
        assert.equal(el.disabled, true, `${sel} ${el.name || el.tagName} disabled`);
    const add = q('form[data-fam-add]');
    add.querySelector('[name="full_name"]').value = 'Sneaky';
    submit(add);
    await tick();
    assert.equal(api.posts().length, 0, 'a full family posts nothing');

    const child = qa('[data-fam-person]')[2];
    assert.equal(child.querySelector('[data-fam-prefill]').disabled, true);
    const remove = child.querySelector('[data-fam-remove]');
    assert.equal(remove.disabled, false);
    remove.click();
    assert.equal(remove.disabled, true, 'busy while removing');
    remove.click();
    await settle();
    assert.equal(confirms.length, 1);
    assert.match(confirms[0], /Baby Lin/);
    assert.deepEqual(api.posts(), [{ action: 'remove_person', person_id: 'p3' }]);
    assert.match(q('[data-fam-notice]').textContent, /Baby Lin/);
    assert.equal(api.gets().length, 2);
    assert.equal(qa('[data-fam-person]').length, 2);
  } finally {
    api.restore();
  }
});

test('family founder: pending invites with Cancel; Dissolve spells out the consequences', async () => {
  const { confirms } = setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  const api = familyApi(
    founderFam({
      seats: { used: 3, limit: 3 },
      invites: [INV_DAD, { ...INV_DAD, id: 'i2', email: 'old@x.com', status: 'cancelled' }],
    }),
    (body, state) => {
      if (body.action === 'dissolve') state.fam = NONE;
      return { body: { ok: true } };
    },
  );
  try {
    await member.wireAccountPage();
    await tick();
    const pending = qa('[data-fam-pending]');
    assert.equal(pending.length, 1, 'only pending invitations are listed');
    assert.match(pending[0].textContent, /dad@x\.com/);
    assert.match(pending[0].textContent, /Lao Lin/);
    assert.match(pending[0].textContent, /Parent/);
    assert.doesNotMatch(q('#caaci-family-host').textContent, /old@x\.com/);

    pending[0].querySelector('[data-fam-cancel]').click();
    await settle();
    assert.match(confirms[0], /dad@x\.com/);
    assert.deepEqual(api.posts(), [{ action: 'cancel_invite', invite_id: 'i1' }]);
    assert.ok(q('[data-fam-notice]').classList.contains('alert-success'));

    q('[data-fam-dissolve]').click();
    await settle();
    assert.match(confirms[1], /membership card/);
    assert.match(confirms[1], /cannot be undone/);
    assert.deepEqual(api.posts()[1], { action: 'dissolve' });
    assert.match(q('[data-fam-notice]').textContent, /dissolved/);
    assert.match(q('#caaci-family-host').textContent, /Invite your family/, 'back to role none');
  } finally {
    api.restore();
  }
});

test('family founder: answering No to a confirm sends nothing', async () => {
  const { confirms } = setup({ answer: false });
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  const api = familyApi(founderFam({ people: [P_FOUNDER, P_SPOUSE, P_CHILD], invites: [INV_DAD] }));
  try {
    await member.wireAccountPage();
    await tick();
    qa('[data-fam-person]')[1].querySelector('[data-fam-remove]').click();
    q('[data-fam-cancel]').click();
    q('[data-fam-dissolve]').click();
    await settle();
    assert.equal(confirms.length, 3);
    assert.equal(api.posts().length, 0);
    assert.equal(q('[data-fam-dissolve]').disabled, false);
  } finally {
    api.restore();
  }
});

test('family founder: Resend counts down 60s after sending, and a 429 starts the countdown too', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  let status = 200;
  const api = familyApi(founderFam({ invites: [INV_DAD] }), () =>
    status === 429
      ? { status: 429, body: { error: 'Please wait before resending.' } }
      : { body: { ok: true } },
  );
  try {
    await member.wireAccountPage();
    await tick();
    let btn = q('[data-fam-resend]');
    assert.equal(btn.textContent, 'Resend');
    btn.click();
    await settle();
    assert.deepEqual(api.posts(), [{ action: 'resend_invite', invite_id: 'i1' }]);
    assert.match(q('[data-fam-notice]').textContent, /dad@x\.com/);
    assert.equal(api.gets().length, 2, 'reloaded');
    btn = q('[data-fam-resend]'); // the re-rendered button resumes the countdown
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Resend in 60s');
    t.mock.timers.tick(30_000);
    assert.equal(btn.textContent, 'Resend in 30s');
    btn.dispatchEvent(new window.Event('click'));
    await settle();
    assert.equal(api.posts().length, 1, 'nothing sent while cooling down');
    t.mock.timers.tick(30_000);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, 'Resend');

    status = 429;
    btn.click();
    await settle();
    assert.equal(api.posts().length, 2);
    const note = q('[data-fam-notice]');
    assert.equal(note.textContent, 'Please wait before resending.');
    assert.ok(note.classList.contains('alert-danger'));
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'Resend in 60s');
    assert.equal(api.gets().length, 2, 'no reload after a 429');
  } finally {
    api.restore();
  }
});

test('family: hostile family names, full names and emails render as text, never elements', async () => {
  setup();
  member.__setSupa(supaStub({ memberRow: FAMILY_ROW }));
  const evil = '<img src=x onerror="globalThis.pwned=1"><x-evil></x-evil>"\'';
  const api = familyApi(
    founderFam({
      household: { id: 'h1', name: evil, status: 'active' },
      founder: { member_id: 'u1', email: evil },
      people: [
        { ...P_FOUNDER, full_name: evil },
        { ...P_CHILD, full_name: evil },
      ],
      invites: [{ ...INV_DAD, email: evil, full_name: evil }],
      events: [
        { type: 'joined', actor_email: evil, subject_email: evil, created_at: '2026-09-01' },
        { type: evil, actor_email: 'a@x.com', subject_email: null, created_at: '2026-09-01' },
      ],
    }),
  );
  try {
    await member.wireAccountPage();
    await tick();
    const fam = q('#caaci-family-host');
    assert.equal(fam.hidden, false);
    assert.equal(fam.querySelector('img, x-evil'), null);
    assert.equal(q('[data-fam-name]').textContent, evil);
    assert.ok(fam.textContent.split(evil).length > 5, 'every hostile value shows as text');
    qa('[data-fam-person]')[1].querySelector('[data-fam-prefill]').click();
    assert.equal(q('form[data-fam-invite] [name="full_name"]').value, evil);
  } finally {
    api.restore();
  }
});
