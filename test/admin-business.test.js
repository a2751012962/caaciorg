import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut, onRequestPost } from '../functions/api/admin/business.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const LISTINGS = [
  { id: 'b1', name: 'Golden Wok', category: 'restaurant', approved: true },
  { id: 'b2', name: 'New Bakery', category: 'bakery', approved: false },
];

function route() {
  return (u, options = {}) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: true }] };
    if (u.includes('/rest/v1/business_directory') && options.method === 'POST')
      return { body: [{ id: 'new-1', ...JSON.parse(options.body) }] };
    if (u.includes('/rest/v1/business_directory') && options.method === 'PATCH')
      return { body: [] };
    if (u.includes('/rest/v1/business_directory') && u.includes('id=eq.b2'))
      return { body: [{ ...LISTINGS[1], approved: true }] };
    if (u.includes('/rest/v1/business_directory') && u.includes('approved=eq.false'))
      return { body: [{ id: 'b2' }], headers: { 'content-range': '0-0/1' } };
    if (u.includes('/rest/v1/business_directory'))
      return { body: LISTINGS, headers: { 'content-range': '0-1/2' } };
    return { body: [] };
  };
}

const authed = (extra = {}) => fakeRequest({ headers: { authorization: 'Bearer tok' }, ...extra });

test('admin business: requires a bearer token', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({ request: fakeRequest({}), env: fakeEnv() });
    assert.equal(r.status, 401);
  } finally {
    fetch.restore();
  }
});

test('admin business: lists with pending count and approval filter', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestGet({
      request: authed({ url: 'https://caaci.example/api/admin/business?approved=false' }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.pending_total, 1);
    const listCall = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/business_directory') && c.url.includes('select='),
    );
    assert.ok(listCall.url.includes('approved=eq.false'));
  } finally {
    fetch.restore();
  }
});

test('admin business: approve toggle patches approved (make it official)', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await onRequestPost({
      request: authed({ body: { id: 'b2', approved: true } }),
      env: fakeEnv(),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.business.approved, true);
    const patch = fetch.calls.find(
      (c) => c.url.includes('/rest/v1/business_directory?id=eq.b2') && c.options.method === 'PATCH',
    );
    assert.ok(patch, 'issues the PATCH');
    assert.deepEqual(JSON.parse(patch.options.body), { approved: true });
  } finally {
    fetch.restore();
  }
});

test('admin business: create validates name and category', async () => {
  const fetch = mockFetch(route());
  try {
    const noName = await onRequestPut({
      request: authed({ body: { category: 'restaurant' } }),
      env: fakeEnv(),
    });
    assert.equal(noName.status, 400);

    const badCat = await onRequestPut({
      request: authed({ body: { name: 'X', category: 'nightclub' } }),
      env: fakeEnv(),
    });
    assert.equal(badCat.status, 400);

    const ok = await onRequestPut({
      request: authed({ body: { name: 'Golden Wok II', category: 'restaurant' } }),
      env: fakeEnv(),
    });
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.equal(data.business.approved, true); // admin-created = pre-approved
  } finally {
    fetch.restore();
  }
});
