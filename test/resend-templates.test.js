import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch } from './helpers.js';
import {
  main,
  checkTemplates,
  templateBody,
  diffTemplate,
  RESERVED_KEYS,
} from '../resend-templates.mjs';
import { templateVariables } from '../functions/api/_event-emails.js';

const KEY = 're_SECRET_full_access_key_123';
const ALIASES = ['event-registration-confirmation', 'event-announcement'];
const noPause = { pause: async () => {} };

function capture(t) {
  const lines = [];
  for (const m of ['log', 'error', 'warn']) {
    t.mock.method(console, m, (...args) => lines.push(args.join(' ')));
  }
  return lines;
}

// A stand-in for Resend's template endpoints, keeping what was written:
// create, retrieve / update by id or alias, publish. `mangle` rewrites what a
// read returns, to model Resend storing something other than what was sent.
function resendServer({ templates = [], mangle = (t) => t, fail = {} } = {}) {
  const store = templates.map((t) => ({ ...t }));
  let next = 1;
  const find = (idOrAlias) => store.find((t) => t.id === idOrAlias || t.alias === idOrAlias);
  const handler = (url, options = {}) => {
    const { origin, pathname } = new URL(url);
    if (origin !== 'https://api.resend.com') return { status: 599, body: 'wrong host' };
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    const route = `${method} ${pathname.replace(/\/templates\/[^/]+/, '/templates/:id')}`;
    if (fail[route]) return fail[route];
    const stored = (vars) => vars.map((v) => ({ id: `var_${v.key}`, fallback_value: null, ...v }));
    if (route === 'POST /templates') {
      const t = {
        object: 'template',
        id: `tpl_${next++}`,
        status: 'draft',
        has_unpublished_versions: true,
        ...body,
        variables: stored(body.variables),
      };
      store.push(t);
      return { status: 201, body: { object: 'template', id: t.id } };
    }
    const id = decodeURIComponent(pathname.split('/')[2] || '');
    const t = find(id);
    if (!t) return { status: 404, body: { name: 'not_found', message: 'Template not found' } };
    if (route === 'GET /templates/:id') return { body: mangle({ ...t }) };
    if (route === 'PATCH /templates/:id') {
      Object.assign(t, body, { variables: stored(body.variables), has_unpublished_versions: true });
      return { body: { object: 'template', id: t.id } };
    }
    if (route === 'POST /templates/:id/publish') {
      Object.assign(t, { status: 'published', has_unpublished_versions: false });
      return { body: { object: 'template', id: t.id } };
    }
    return { status: 405, body: {} };
  };
  handler.store = store;
  return handler;
}

const liveCopy = (t, over = {}) => ({
  object: 'template',
  id: `live_${t.alias}`,
  status: 'published',
  has_unpublished_versions: false,
  ...templateBody(t),
  variables: t.variables.map((v) => ({ id: `v_${v.key}`, fallback_value: null, ...v })),
  ...over,
});
const LIVE = templateVariables.map((t) => liveCopy(t));

const calls = (stub) =>
  stub.calls.map((c) => `${c.options.method || 'GET'} ${new URL(c.url).pathname}`);

// ---------------------------------------------------------------- the checks ----

test('the repo templates pass the variable checks', () => {
  assert.doesNotThrow(() => checkTemplates(templateVariables));
  assert.deepEqual(
    templateVariables.map((t) => t.alias),
    ALIASES,
  );
});

test('checkTemplates refuses reserved, malformed, undeclared and unused variables', () => {
  const base = {
    alias: 'x',
    name: 'X',
    subject: '{{{TITLE}}}',
    html: '<p>{{{BODY_HTML}}}</p>',
    variables: [
      { key: 'TITLE', type: 'string' },
      { key: 'BODY_HTML', type: 'string' },
    ],
  };
  assert.doesNotThrow(() => checkTemplates([base]));
  for (const [label, t, error] of [
    ...['EMAIL', 'FIRST_NAME', 'UNSUBSCRIBE_URL'].map((key) => [
      `reserved ${key}`,
      {
        ...base,
        html: `${base.html}{{{${key}}}}`,
        variables: [...base.variables, { key, type: 'string' }],
      },
      /reserved variable name/,
    ]),
    [
      'lower case',
      {
        ...base,
        html: '{{{BODY_HTML}}}{{{title2}}}',
        variables: [...base.variables, { key: 'title2', type: 'string' }],
      },
      /invalid variable name title2/,
    ],
    [
      'over 50 characters',
      {
        ...base,
        html: `{{{BODY_HTML}}}{{{${'A'.repeat(51)}}}}`,
        variables: [...base.variables, { key: 'A'.repeat(51), type: 'string' }],
      },
      /invalid variable name/,
    ],
    [
      'undeclared',
      { ...base, html: '{{{BODY_HTML}}}{{{PERK_HTML}}}' },
      /PERK_HTML\}\}\} is not declared/,
    ],
    ['unused', { ...base, html: '<p></p>' }, /BODY_HTML is declared but never used/],
  ]) {
    assert.throws(() => checkTemplates([t]), error, label);
  }
  assert.ok(RESERVED_KEYS.includes('RESEND_UNSUBSCRIBE_URL'));
});

test('diffTemplate ignores line endings, trailing space and the fields Resend adds', () => {
  const [t] = templateVariables;
  const body = templateBody(t);
  const live = liveCopy(t, { html: `${body.html.replace(/\n/g, '\r\n')}  \r\n` });
  assert.deepEqual(diffTemplate(body, live), { changed: [], unpublished: false });

  assert.deepEqual(diffTemplate(body, { ...live, subject: 'old' }).changed, ['subject']);
  assert.deepEqual(diffTemplate(body, { ...live, html: '<p>old</p>' }).changed, ['html']);
  assert.deepEqual(diffTemplate(body, { ...live, name: 'Old' }).changed, ['name']);
  assert.deepEqual(diffTemplate(body, { ...live, variables: live.variables.slice(1) }).changed, [
    'variables',
  ]);
  assert.deepEqual(
    diffTemplate(body, { ...live, variables: [...live.variables].reverse() }).changed,
    [],
    'order does not matter',
  );
  assert.equal(diffTemplate(body, { ...live, status: 'draft' }).unpublished, true);
  assert.equal(diffTemplate(body, { ...live, has_unpublished_versions: true }).unpublished, true);
});

test('templateBody sends LF line endings and only key and type per variable', () => {
  const t = { ...templateVariables[0], html: '<p>\r\n{{{X}}}\r</p>' };
  const body = templateBody(t);
  assert.equal(body.html, '<p>\n{{{X}}}\n</p>');
  assert.deepEqual(Object.keys(body).sort(), ['alias', 'html', 'name', 'subject', 'variables']);
  for (const v of body.variables) assert.deepEqual(Object.keys(v).sort(), ['key', 'type']);
});

// --------------------------------------------------------------------- main ----

test('without a key, or with a bad option or a key a header cannot carry, it exits 1 with no request', async (t) => {
  const out = capture(t);
  const stub = mockFetch(() => ({}));
  try {
    assert.equal(await main([], {}, noPause), 1);
    assert.equal(await main(['--aply'], { RESEND_API_KEY: KEY }, noPause), 1);
    assert.equal(await main([], { RESEND_API_KEY: `${KEY}\n` }, noPause), 1);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
  assert.match(out.join('\n'), /Missing RESEND_API_KEY/);
  assert.match(out.join('\n'), /unknown option: --aply/);
  assert.equal(out.join('\n').includes(KEY), false);
});

test('the dry run only reads, and says both would be created', async (t) => {
  const out = capture(t);
  const server = resendServer();
  const stub = mockFetch(server);
  try {
    assert.equal(await main([], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(
    calls(stub),
    ALIASES.map((a) => `GET /templates/${a}`),
  );
  for (const c of stub.calls) assert.equal(c.options.headers.authorization, `Bearer ${KEY}`);
  assert.equal(server.store.length, 0);
  const text = out.join('\n');
  for (const a of ALIASES) assert.match(text, new RegExp(`${a}: not in Resend — would be created`));
  assert.match(text, /Dry run — nothing was changed/);
  assert.equal(text.includes(KEY), false, 'the key is never printed');
});

test('the dry run names the fields that differ and what is already up to date', async (t) => {
  const out = capture(t);
  const stub = mockFetch(
    resendServer({ templates: [LIVE[0], { ...LIVE[1], subject: 'old subject', status: 'draft' }] }),
  );
  try {
    assert.equal(await main([], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(
    calls(stub),
    ALIASES.map((a) => `GET /templates/${a}`),
  );
  const text = out.join('\n');
  assert.match(text, /event-registration-confirmation: up to date and published/);
  assert.match(text, /event-announcement: differs \(subject\) — would be updated and published/);
  assert.match(text, /--apply would write 1 template\(s\): event-announcement/);
});

test('--apply creates, publishes and reads back each missing template', async (t) => {
  const out = capture(t);
  const server = resendServer();
  const stub = mockFetch(server);
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(calls(stub), [
    'GET /templates/event-registration-confirmation',
    'GET /templates/event-announcement',
    'POST /templates',
    'POST /templates/tpl_1/publish',
    'GET /templates/event-registration-confirmation',
    'POST /templates',
    'POST /templates/tpl_2/publish',
    'GET /templates/event-announcement',
  ]);
  const creates = stub.calls.filter(
    (c) => c.options.method === 'POST' && c.url.endsWith('/templates'),
  );
  assert.deepEqual(
    creates.map((c) => JSON.parse(c.options.body)),
    templateVariables.map(templateBody),
  );
  assert.equal(creates[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(
    server.store.map((s) => [s.alias, s.status]),
    ALIASES.map((a) => [a, 'published']),
  );
  assert.match(out.join('\n'), /✓ event-announcement: created and published/);
});

test('--apply updates a drifted template by id, publishes it, and leaves an up-to-date one alone', async (t) => {
  capture(t);
  const server = resendServer({ templates: [LIVE[0], { ...LIVE[1], html: '<p>old</p>' }] });
  const stub = mockFetch(server);
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(calls(stub), [
    'GET /templates/event-registration-confirmation',
    'GET /templates/event-announcement',
    'PATCH /templates/live_event-announcement',
    'POST /templates/live_event-announcement/publish',
    'GET /templates/event-announcement',
  ]);
  assert.equal(server.store[1].html, templateBody(templateVariables[1]).html);
});

test('--apply only publishes a template whose content already matches', async (t) => {
  capture(t);
  const stub = mockFetch(
    resendServer({ templates: [LIVE[0], { ...LIVE[1], has_unpublished_versions: true }] }),
  );
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(calls(stub).slice(2), [
    'POST /templates/live_event-announcement/publish',
    'GET /templates/event-announcement',
  ]);
});

test('--apply with nothing to do writes nothing', async (t) => {
  const out = capture(t);
  const stub = mockFetch(resendServer({ templates: LIVE }));
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 0);
  } finally {
    stub.restore();
  }
  assert.deepEqual(
    calls(stub),
    ALIASES.map((a) => `GET /templates/${a}`),
  );
  assert.match(out.join('\n'), /Nothing to do/);
});

test('--apply exits 1 when a template reads back different from what was sent', async (t) => {
  const out = capture(t);
  const stub = mockFetch(
    resendServer({ mangle: (tpl) => ({ ...tpl, html: tpl.html.replace('报名', '') }) }),
  );
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 1);
  } finally {
    stub.restore();
  }
  assert.match(
    out.join('\n'),
    /✗ event-registration-confirmation: written, but reads back with different html/,
  );
});

test('--apply exits 1 on a refused write, with the key scrubbed from the printed error', async (t) => {
  const out = capture(t);
  const stub = mockFetch(
    resendServer({
      fail: {
        'POST /templates': {
          status: 422,
          body: { message: `key ${KEY} may not create templates` },
        },
      },
    }),
  );
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 1);
  } finally {
    stub.restore();
  }
  const text = out.join('\n');
  assert.match(text, /✗ POST \/templates \(event-registration-confirmation\): HTTP 422/);
  assert.match(text, /key \[key\] may not create templates/);
  assert.equal(text.includes(KEY), false);
  assert.equal(
    calls(stub).some((c) => c.endsWith('/publish')),
    false,
    'nothing refused is published',
  );
});

test('a failed read stops the run before any write', async (t) => {
  const out = capture(t);
  const stub = mockFetch(
    resendServer({ fail: { 'GET /templates/:id': { status: 401, body: 'restricted key' } } }),
  );
  try {
    assert.equal(await main(['--apply'], { RESEND_API_KEY: KEY }, noPause), 1);
  } finally {
    stub.restore();
  }
  assert.deepEqual(calls(stub), ['GET /templates/event-registration-confirmation']);
  assert.match(out.join('\n'), /HTTP 401 restricted key/);
});

test('waits between requests, never before the first', async (t) => {
  capture(t);
  let pauses = 0;
  const stub = mockFetch(resendServer());
  try {
    await main([], { RESEND_API_KEY: KEY }, { pause: async () => pauses++ });
  } finally {
    stub.restore();
  }
  assert.equal(pauses, stub.calls.length - 1);
});
