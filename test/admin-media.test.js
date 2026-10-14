import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut, onRequestDelete } from '../functions/api/admin/media.js';
import { fakeRequest, fakeFile, mockFetch, fakeEnv } from './helpers.js';

const LISTING = [
  {
    id: 'obj-1',
    name: '1750000000000-lantern-festival.jpg',
    created_at: '2026-06-01T00:00:00Z',
    metadata: { size: 34567, mimetype: 'image/jpeg' },
  },
  { id: null, name: '.emptyFolderPlaceholder' }, // folder placeholder — must be skipped
];

// `who` plays the caller: 'admin' (members.is_admin), 'editor' (a content
// editor: not an admin, but with a content_editors row) or 'member' (neither).
function route(who = 'admin') {
  return (u, options = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'user-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'user-1', is_admin: who === 'admin' }] };
    if (u.includes('/rest/v1/content_editors'))
      return {
        body:
          who === 'editor'
            ? [{ member_id: 'user-1', all_columns: false, column_ids: [], can_edit_pages: true }]
            : [],
      };
    if (u.includes('/storage/v1/object/list/media')) return { body: LISTING };
    if (u.includes('/storage/v1/object/media/') && options.method === 'POST')
      return { body: { Key: 'media/x' } };
    if (u.includes('/storage/v1/object/media/') && options.method === 'DELETE') return { body: {} };
    return { body: [] };
  };
}

const authed = (extra = {}) => fakeRequest({ headers: { authorization: 'Bearer tok' }, ...extra });

test('admin media: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin media: lists the bucket with public URLs, skipping placeholders', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({
      request: authed({ url: 'https://caaci.example/api/admin/media' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.rows.length, 1); // placeholder filtered out
    assert.equal(data.rows[0].name, '1750000000000-lantern-festival.jpg');
    assert.equal(data.rows[0].size, 34567);
    assert.equal(
      data.rows[0].url,
      'https://db.example/storage/v1/object/public/media/1750000000000-lantern-festival.jpg',
    );
  } finally {
    fetch.restore();
  }
});

test('admin media: upload stores the image and returns its public URL', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPut({
      request: authed({ formData: { file: fakeFile({ name: 'Spring Gala!.JPG' }) } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    // sanitized: lowercased, punctuation collapsed, whitelisted extension
    assert.match(data.file.name, /^\d+-spring-gala\.jpg$/);
    assert.match(data.file.url, /^https:\/\/db\.example\/storage\/v1\/object\/public\/media\//);
    const upload = fetch.calls.find((c) => c.url.includes('/storage/v1/object/media/'));
    assert.ok(upload, 'uploads to the media bucket');
    assert.equal(upload.options.method, 'POST');
    assert.equal(upload.options.headers['content-type'], 'image/jpeg');
  } finally {
    fetch.restore();
  }
});

test('admin media: upload rejects non-image types and oversized files', async () => {
  const fetch = mockFetch(route());
  try {
    const bad1 = await onRequestPut({
      request: authed({
        formData: { file: fakeFile({ name: 'evil.svg', type: 'image/svg+xml' }) },
      }),
      env: fakeEnv(),
    });
    assert.equal(bad1.status, 400);

    const bad2 = await onRequestPut({
      request: authed({ formData: { file: fakeFile({ size: 6 * 1024 * 1024 }) } }),
      env: fakeEnv(),
    });
    assert.equal(bad2.status, 400);
    assert.match((await bad2.json()).error, /too large/i);

    const bad3 = await onRequestPut({ request: authed({ formData: {} }), env: fakeEnv() });
    assert.equal(bad3.status, 400);
  } finally {
    fetch.restore();
  }
});

test('admin media: delete validates the name against traversal', async () => {
  const fetch = mockFetch(route());
  try {
    const bad1 = await onRequestDelete({
      request: authed({ url: 'https://caaci.example/api/admin/media?name=..%2Fsecret' }),
      env: fakeEnv(),
    });
    assert.equal(bad1.status, 400);

    const ok = await onRequestDelete({
      request: authed({ url: 'https://caaci.example/api/admin/media?name=123-pic.jpg' }),
      env: fakeEnv(),
    });
    assert.equal(ok.status, 200);
    const del = fetch.calls.find(
      (c) =>
        c.url.endsWith('/storage/v1/object/media/123-pic.jpg') && c.options.method === 'DELETE',
    );
    assert.ok(del, 'issues the storage delete');
  } finally {
    fetch.restore();
  }
});

test('admin media: a content editor may list and upload, but not delete', async () => {
  const fetch = mockFetch(route('editor'));
  try {
    const list = await onRequestGet({
      request: authed({ url: 'https://caaci.example/api/admin/media' }),
      env: fakeEnv(),
    });
    assert.equal(list.status, 200);
    const put = await onRequestPut({
      request: authed({ formData: { file: fakeFile({ name: 'cover.png', type: 'image/png' }) } }),
      env: fakeEnv(),
    });
    assert.equal(put.status, 200);
    assert.match((await put.json()).file.name, /^\d+-cover\.png$/);

    const del = await onRequestDelete({
      request: authed({ url: 'https://caaci.example/api/admin/media?name=123-pic.jpg' }),
      env: fakeEnv(),
    });
    assert.equal(del.status, 403);
    assert.ok(
      !fetch.calls.some((c) => c.options.method === 'DELETE'),
      'no storage delete was attempted',
    );
  } finally {
    fetch.restore();
  }
});

test('admin media: a member who is neither admin nor editor is refused everything', async () => {
  const fetch = mockFetch(route('member'));
  try {
    const list = await onRequestGet({
      request: authed({ url: 'https://caaci.example/api/admin/media' }),
      env: fakeEnv(),
    });
    assert.equal(list.status, 403);
    const put = await onRequestPut({
      request: authed({ formData: { file: fakeFile() } }),
      env: fakeEnv(),
    });
    assert.equal(put.status, 403);
    const del = await onRequestDelete({
      request: authed({ url: 'https://caaci.example/api/admin/media?name=123-pic.jpg' }),
      env: fakeEnv(),
    });
    assert.equal(del.status, 403);
    assert.ok(!fetch.calls.some((c) => c.url.includes('/storage/v1/')), 'storage never touched');
  } finally {
    fetch.restore();
  }
});
