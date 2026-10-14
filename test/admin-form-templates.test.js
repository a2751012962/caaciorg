import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPut,
  onRequestPost,
  onRequestDelete,
} from '../functions/api/admin/form-templates.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const QUESTION = {
  id: 'shifts',
  type: 'multi',
  label_en: 'When can you help?',
  label_zh: '您可以帮忙的时间段？',
  required: true,
  options: [{ id: 'setup', label_en: 'Setup', label_zh: '布置' }],
  other: false,
};
const ROWS = {
  [ID]: { id: ID, kind: 'volunteer', name: 'General', questions: [], is_default: true },
  [OTHER]: {
    id: OTHER,
    kind: 'volunteer',
    name: 'Festival',
    questions: [QUESTION],
    is_default: false,
  },
};

function route({ admin = true, rows = ROWS } = {}) {
  return (u, options = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members')) return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/form_templates')) {
      if (options.method === 'POST')
        return { body: [{ id: 'new-1', ...JSON.parse(options.body) }] };
      if (options.method === 'PATCH' || options.method === 'DELETE') return { body: [] };
      const id = decodeURIComponent(u.match(/[?&]id=eq\.([^&]+)/)?.[1] || '');
      if (id) return { body: rows[id] ? [rows[id]] : [] };
      return { body: Object.values(rows) };
    }
    return { body: [] };
  };
}

const call = (
  handler,
  { body, url = 'https://caaci.example/api/admin/form-templates', auth = true } = {},
) =>
  handler({
    request: fakeRequest({ url, body, headers: auth ? { authorization: 'Bearer tok' } : {} }),
    env: fakeEnv(),
  });
const patches = (fetch) =>
  fetch.calls
    .filter((c) => c.options.method === 'PATCH')
    .map((c) => [decodeURIComponent(c.url.split('?')[1]), JSON.parse(c.options.body)]);

test('admin form templates: every handler is gated (401 without a token, 403 for a non-admin)', async () => {
  let fetch = mockFetch(route());
  try {
    for (const h of [onRequestGet, onRequestPut, onRequestPost, onRequestDelete])
      assert.equal((await call(h, { auth: false, body: {} })).status, 401);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ admin: false }));
  try {
    for (const h of [onRequestGet, onRequestPut, onRequestPost, onRequestDelete])
      assert.equal((await call(h, { body: {} })).status, 403);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/form_templates')),
      false,
    );
  } finally {
    fetch.restore();
  }
});

test('admin form templates: GET lists by kind, by name; an unknown kind is refused', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await call(onRequestGet, {
      url: 'https://caaci.example/api/admin/form-templates?kind=volunteer',
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).rows, Object.values(ROWS));
    const q = fetch.calls.find((c) => c.url.includes('/rest/v1/form_templates')).url;
    assert.ok(q.includes('kind=eq.volunteer') && q.includes('order=name.asc'), q);

    const bad = await call(onRequestGet, {
      url: 'https://caaci.example/api/admin/form-templates?kind=menu',
    });
    assert.equal(bad.status, 400);
  } finally {
    fetch.restore();
  }
});

test('admin form templates: PUT creates one with validated questions; a default clears the old default first', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await call(onRequestPut, {
      body: { kind: 'volunteer', name: '  Festival 2027 ', questions: [{ ...QUESTION, extra: 1 }] },
    });
    assert.equal(r.status, 200);
    const insert = fetch.calls.find((c) => c.options.method === 'POST');
    assert.deepEqual(JSON.parse(insert.options.body), {
      kind: 'volunteer',
      name: 'Festival 2027',
      questions: [QUESTION],
      is_default: false,
    });
    assert.equal(patches(fetch).length, 0);

    const d = await call(onRequestPut, {
      body: { kind: 'registration', name: 'Gala', questions: [], is_default: true },
    });
    assert.equal(d.status, 200);
    assert.deepEqual(patches(fetch), [
      ['kind=eq.registration&is_default=eq.true', { is_default: false }],
    ]);

    for (const [body, error] of [
      [{ kind: 'menu', name: 'x' }, 'Unknown template kind.'],
      [{ kind: 'volunteer', name: '  ' }, 'Give the template a name.'],
      [{ kind: 'volunteer' }, 'Give the template a name.'],
      [{ kind: 'volunteer', name: 'n'.repeat(81) }, 'A template name is at most 80 characters.'],
      [
        { kind: 'volunteer', name: 'x', questions: 'shifts' },
        'Registration questions must be a list.',
      ],
    ]) {
      const bad = await call(onRequestPut, { body });
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal((await bad.json()).error, error);
    }
  } finally {
    fetch.restore();
  }
});

test('admin form templates: POST patches name and questions, and can only ever SET the default', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await call(onRequestPost, {
      body: { id: OTHER, name: ' Festival 2026 ', questions: [QUESTION] },
    });
    assert.equal(r.status, 200);
    const [[where, body]] = patches(fetch);
    assert.equal(where, `id=eq.${OTHER}`);
    assert.deepEqual(
      { ...body, updated_at: undefined },
      { name: 'Festival 2026', questions: [QUESTION], updated_at: undefined },
    );
    assert.ok(body.updated_at);

    const d = await call(onRequestPost, { body: { id: OTHER, is_default: true } });
    assert.equal(d.status, 200);
    const later = patches(fetch).slice(1);
    assert.deepEqual(later[0], ['kind=eq.volunteer&is_default=eq.true', { is_default: false }]);
    assert.equal(later[1][0], `id=eq.${OTHER}`);
    assert.equal(later[1][1].is_default, true);

    // Already the default: nothing to clear, nothing to write.
    const before = patches(fetch).length;
    assert.equal((await call(onRequestPost, { body: { id: ID, is_default: true } })).status, 200);
    assert.equal(patches(fetch).length, before);

    for (const [body, status, error] of [
      [{ name: 'x' }, 400, 'Template id is required.'],
      [{ id: 'nope', name: 'x' }, 404, 'Template not found.'],
      [{ id: ID }, 400, 'Nothing to update.'],
      [{ id: ID, is_default: false }, 400, 'Make another template the default instead.'],
      [{ id: '33333333-3333-4333-8333-333333333333', name: 'x' }, 404, 'Template not found.'],
    ]) {
      const bad = await call(onRequestPost, { body });
      assert.equal(bad.status, status, JSON.stringify(body));
      assert.equal((await bad.json()).error, error);
    }
  } finally {
    fetch.restore();
  }
});

test('admin form templates: DELETE removes one, never the default', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await call(onRequestDelete, { body: { id: OTHER } });
    assert.equal(r.status, 200);
    const del = fetch.calls.find((c) => c.options.method === 'DELETE');
    assert.equal(del.url, `https://db.example/rest/v1/form_templates?id=eq.${OTHER}`);

    const kept = await call(onRequestDelete, { body: { id: ID } });
    assert.equal(kept.status, 400);
    assert.equal(
      (await kept.json()).error,
      'This is the default template. Make another one the default first.',
    );
    assert.equal(fetch.calls.filter((c) => c.options.method === 'DELETE').length, 1);

    assert.equal((await call(onRequestDelete, { body: { id: 'nope' } })).status, 404);
    assert.equal((await call(onRequestDelete, { body: {} })).status, 400);
  } finally {
    fetch.restore();
  }
});
