import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  onRequestGet,
  onRequestPut,
  onRequestPost,
  onRequestDelete,
} from '../functions/api/admin/events.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const EVENTS = [
  {
    id: 'e1',
    title: 'Lunar New Year Gala',
    slug: 'lunar-new-year-gala',
    starts_at: '2026-02-17T00:00:00Z',
    location: 'Springfield',
    published: true,
  },
  {
    id: 'e2',
    title: 'Draft picnic',
    slug: 'draft-picnic',
    starts_at: '2026-08-01T00:00:00Z',
    location: null,
    published: false,
  },
];

function route({ slugTaken = false } = {}) {
  return (u, options = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/events') && u.includes('slug=eq.'))
      return { body: slugTaken ? [{ id: 'existing' }] : [] };
    if (u.includes('/rest/v1/events') && options.method === 'POST')
      return { body: [{ id: 'new-1', ...JSON.parse(options.body) }] };
    if (u.includes('/rest/v1/events') && options.method === 'PATCH') return { body: [] };
    if (u.includes('/rest/v1/events') && options.method === 'DELETE') return { body: [] };
    if (u.includes('/rest/v1/events') && u.includes('id=eq.e1')) return { body: [EVENTS[0]] };
    if (u.includes('/rest/v1/events'))
      return { body: EVENTS, headers: { 'content-range': '0-1/2' } };
    return { body: [] };
  };
}

const authed = (extra = {}) => fakeRequest({ headers: { authorization: 'Bearer tok' }, ...extra });

test('admin events: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin events: lists with published filter and search', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({
      request: authed({
        url: 'https://caaci.example/api/admin/events?published=false&q=picnic',
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.total, 2);
    const listCall = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/events') && c.url.includes('select='),
    );
    assert.ok(listCall.url.includes('published=eq.false'));
    assert.ok(listCall.url.includes('title.ilike.*picnic*'));
  } finally {
    fetch.restore();
  }
});

test('admin events: create requires title and a valid start', async () => {
  const fetch = mockFetch(route());
  try {
    const noTitle = await onRequestPut({
      request: authed({ body: { starts_at: '2026-09-01T18:00' } }),
      env: fakeEnv(),
    });
    assert.equal(noTitle.status, 400);

    const badDate = await onRequestPut({
      request: authed({ body: { title: 'Picnic', starts_at: 'not-a-date' } }),
      env: fakeEnv(),
    });
    assert.equal(badDate.status, 400);
  } finally {
    fetch.restore();
  }
});

test('admin events: create derives a slug and defuses collisions', async () => {
  const fetch = mockFetch(route({ slugTaken: true }));
  try {
    const r = await onRequestPut({
      request: authed({
        body: { title: 'Mid-Autumn Festival!', starts_at: '2026-09-25T18:00' },
      }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    // slugified title plus a uniquifying suffix because the slug was taken
    assert.match(data.event.slug, /^mid-autumn-festival-[a-z0-9]+$/);
    assert.equal(data.event.published, true); // default
  } finally {
    fetch.restore();
  }
});

test('admin events: publish toggle patches published', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: authed({ body: { id: 'e1', published: false } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const patch = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/events?id=eq.e1') && c.options.method === 'PATCH',
    );
    assert.ok(patch, 'issues the PATCH');
    assert.deepEqual(JSON.parse(patch.options.body), { published: false });
  } finally {
    fetch.restore();
  }
});

test('admin events: delete needs an id', async () => {
  const fetch = mockFetch(route());
  try {
    const noId = await onRequestDelete({ request: authed({}), env: fakeEnv() });
    assert.equal(noId.status, 400);

    const ok = await onRequestDelete({
      request: authed({ url: 'https://caaci.example/api/admin/events?id=e2' }),
      env: fakeEnv(),
    });
    assert.equal(ok.status, 200);
  } finally {
    fetch.restore();
  }
});
