// The back office's merchant endpoint: editing a menu item, the one thing the
// ledger will not let an admin do to a merchant, and one item's own sales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';
import {
  onRequestGet as merchantsGet,
  onRequestPost as merchantsPost,
} from '../functions/api/admin/merchants.js';
import { onRequestGet as adminTokensGet } from '../functions/api/admin/tokens.js';

const ON = { TOKENS_ENABLED: '1' };
const USER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const SHOP = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const TX = '55555555-5555-4555-8555-555555555555';
const auth = { authorization: 'Bearer token' };

// Supabase as seen through fetch, as in tokens-api.test.js: `db` maps a table or
// rpc name to its answer (a value, or a function of the URL / options).
function backend(db = {}) {
  return (url, options) => {
    if (url.includes('/auth/v1/user')) return { body: { id: USER } };
    const name = new URL(url).pathname.replace('/rest/v1/', '').replace('rpc/', '');
    const hit = db[name];
    const body = typeof hit === 'function' ? hit(url, options) : hit;
    return { body: body === undefined ? [] : body, headers: { 'content-range': '0-0/0' } };
  };
}

const admin = { members: [{ id: USER, is_admin: true }] };
const post = (body) => ({ request: fakeRequest({ body, headers: auth }), env: fakeEnv(ON) });

test('the merchant list says which merchants could still be deleted', async () => {
  const fetch = mockFetch(
    backend({
      ...admin,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      token_settings: [{ tokens_per_dollar: 10, settle_min_cents: 2000 }],
      // one charge is enough: the ledger's foreign key would refuse the delete
      token_tx: [{ id: TX }],
    }),
  );
  try {
    const r = await merchantsGet({ request: fakeRequest({ headers: auth }), env: fakeEnv(ON) });
    assert.equal(r.status, 200);
    const { rows } = await r.json();
    assert.equal(rows[0].has_history, true);
  } finally {
    fetch.restore();
  }

  const clean = mockFetch(
    backend({
      ...admin,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      token_settings: [{ tokens_per_dollar: 10, settle_min_cents: 2000 }],
    }),
  );
  try {
    const r = await merchantsGet({ request: fakeRequest({ headers: auth }), env: fakeEnv(ON) });
    const { rows } = await r.json();
    assert.equal(rows[0].has_history, false);
  } finally {
    clean.restore();
  }
});

test('the merchant list carries what each shop and each menu line has sold', async () => {
  const OTHER = '66666666-6666-4666-8666-666666666666';
  const fetch = mockFetch(
    backend({
      ...admin,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      merchant_items: [
        { id: ITEM, merchant_id: SHOP, name: 'Milk tea', tokens: 30 },
        { id: OTHER, merchant_id: SHOP, name: 'Egg tart', tokens: 10 },
      ],
      token_settings: [{ tokens_per_dollar: 10, settle_min_cents: 2000 }],
      // the merchant's own row has no item; one item sold, the other never did
      token_merchant_sales: [
        { merchant_id: SHOP, item_id: null, charges: 9, units: 0, tokens: 260 },
        { merchant_id: SHOP, item_id: ITEM, charges: 0, units: 7, tokens: 210 },
      ],
    }),
  );
  try {
    const r = await merchantsGet({ request: fakeRequest({ headers: auth }), env: fakeEnv(ON) });
    const { rows } = await r.json();
    assert.equal(rows[0].sold_charges, 9);
    assert.equal(rows[0].sold_tokens, 260);
    const byName = Object.fromEntries(rows[0].items.map((i) => [i.name, i]));
    assert.equal(byName['Milk tea'].sold, 7);
    assert.equal(byName['Milk tea'].sold_tokens, 210);
    assert.equal(byName['Egg tart'].sold, 0);
  } finally {
    fetch.restore();
  }

  // before 0033 is applied the call fails; the list still loads, without figures
  const missing = mockFetch((url, options) => {
    if (url.includes('rpc/token_merchant_sales')) return { status: 404, body: { message: 'no' } };
    return backend({
      ...admin,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      token_settings: [{ tokens_per_dollar: 10, settle_min_cents: 2000 }],
    })(url, options);
  });
  try {
    const r = await merchantsGet({ request: fakeRequest({ headers: auth }), env: fakeEnv(ON) });
    assert.equal(r.status, 200);
    const { rows } = await r.json();
    assert.equal(rows[0].sold_tokens, 0);
  } finally {
    missing.restore();
  }
});

test('a merchant that has taken tokens is never deleted, in either language', async () => {
  const fetch = mockFetch(backend({ ...admin, token_tx: [{ id: TX }] }));
  try {
    const r = await merchantsPost(post({ action: 'delete_merchant', merchant_id: SHOP }));
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, 'merchant_has_history');
    assert.match(body.error, /cannot be deleted/i);
    assert.match(body.error_zh, /不能删除/);
    assert.equal(
      fetch.calls.some((c) => c.options.method === 'DELETE'),
      false,
      'nothing was deleted before the ledger was asked',
    );
  } finally {
    fetch.restore();
  }
});

test('a merchant created by mistake is deleted with its menu and staff', async () => {
  const fetch = mockFetch(backend(admin));
  try {
    const r = await merchantsPost(post({ action: 'delete_merchant', merchant_id: SHOP }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const deleted = fetch.calls
      .filter((c) => c.options.method === 'DELETE')
      .map((c) => new URL(c.url).pathname.replace('/rest/v1/', ''));
    assert.deepEqual(deleted, ['merchant_items', 'merchant_staff', 'merchants']);
  } finally {
    fetch.restore();
  }
});

test('editing an item saves it, and says so when the printed price has moved', async () => {
  // same price: nothing printed is wrong, so no warning
  let fetch = mockFetch(
    backend({ ...admin, merchant_items: [{ id: ITEM, tokens: 30, pay_code: 'ABCD2345' }] }),
  );
  try {
    const r = await merchantsPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 30 }),
    );
    assert.deepEqual(await r.json(), { ok: true, reprint: false });
    const patch = fetch.calls.find((c) => c.options.method === 'PATCH');
    assert.match(patch.url, /merchant_items\?id=eq\./);
    assert.equal(JSON.parse(patch.options.body).name, 'Milk tea');
  } finally {
    fetch.restore();
  }

  // a new price under a sticker that is already on the cups
  fetch = mockFetch(
    backend({ ...admin, merchant_items: [{ id: ITEM, tokens: 30, pay_code: 'ABCD2345' }] }),
  );
  try {
    const r = await merchantsPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 40 }),
    );
    assert.deepEqual(await r.json(), { ok: true, reprint: true });
  } finally {
    fetch.restore();
  }

  // no sticker yet: nothing to reprint
  fetch = mockFetch(
    backend({ ...admin, merchant_items: [{ id: ITEM, tokens: 30, pay_code: null }] }),
  );
  try {
    const r = await merchantsPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 40 }),
    );
    assert.deepEqual(await r.json(), { ok: true, reprint: false });
  } finally {
    fetch.restore();
  }
});

test('an item that is not this merchant’s is not edited', async () => {
  const fetch = mockFetch(backend({ ...admin, merchant_items: [] }));
  try {
    const r = await merchantsPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 40 }),
    );
    assert.equal(r.status, 404);
    assert.equal(
      fetch.calls.some((c) => c.options.method === 'PATCH'),
      false,
    );
  } finally {
    fetch.restore();
  }
});

test('one item’s page: the totals come from the ledger, and the rows are shaped like any other', async () => {
  const fetch = mockFetch(
    backend({
      ...admin,
      merchant_items: [{ id: ITEM, merchant_id: SHOP, name: 'Milk tea', tokens: 30 }],
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', name_zh: '功夫茶' }],
      token_item_report: {
        sold: 7,
        tokens: 210,
        undone: 1,
        first_at: '2026-09-01T18:00:00Z',
        last_at: '2026-09-20T18:00:00Z',
        total: 8,
        ids: [TX],
      },
      token_tx: [
        {
          id: TX,
          created_at: '2026-09-20T18:00:00Z',
          kind: 'charge',
          amount: -30,
          state: 'ok',
          member_id: MEMBER,
          actor_id: MEMBER,
          merchants: { name: 'Kung Fu Tea', name_zh: '功夫茶' },
        },
      ],
      members: (url) =>
        url.includes(MEMBER)
          ? [{ id: MEMBER, full_name: 'Wei Zhang', email: 'wei@example.com' }]
          : [{ id: USER, is_admin: true }],
    }),
  );
  try {
    const r = await adminTokensGet({
      request: fakeRequest({
        url: `https://x/api/admin/tokens?view=item&id=${ITEM}`,
        headers: auth,
      }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.sold, 7);
    assert.equal(data.tokens, 210);
    assert.equal(data.undone, 1);
    assert.equal(data.total, 8);
    assert.equal(data.item.name, 'Milk tea');
    assert.equal(data.merchant.name_zh, '功夫茶');
    assert.equal(data.rows[0].member_name, 'Wei Zhang');
    assert.equal(data.rows[0].merchant.name, 'Kung Fu Tea');
    // the report decides which transactions belong to the item; the select only
    // fetches the ids it named
    assert.ok(
      fetch.calls.some(
        (c) => c.url.includes(`token_tx?select=`) && c.url.includes(`id=in.(${TX})`),
      ),
    );
  } finally {
    fetch.restore();
  }
});

test('one item’s page refuses an id that is not one', async () => {
  const fetch = mockFetch(backend(admin));
  try {
    const r = await adminTokensGet({
      request: fakeRequest({ url: 'https://x/api/admin/tokens?view=item&id=nope', headers: auth }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 400);
  } finally {
    fetch.restore();
  }
});
