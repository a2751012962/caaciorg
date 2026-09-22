// A shop keeping its own menu (/api/tokens/menu). The back office could always
// do this; what is new is that the people at the stall can, which makes the
// question "whose item is this?" load-bearing: every write here names a
// merchant, and functions/api/_menu.js filters on it, so an item id belonging
// to another shop cannot be edited, deleted or re-coded by someone holding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';
import {
  onRequestGet as menuGet,
  onRequestPost as menuPost,
} from '../functions/api/tokens/menu.js';
import { onRequestPost as adminMerchants } from '../functions/api/admin/merchants.js';

const ON = { TOKENS_ENABLED: '1' };
const USER = '11111111-1111-4111-8111-111111111111';
const SHOP = '33333333-3333-4333-8333-333333333333';
const OTHER_SHOP = '77777777-7777-4777-8777-777777777777';
const ITEM = '44444444-4444-4444-8444-444444444444';
const auth = { authorization: 'Bearer token' };

// Supabase as seen through fetch, as in tokens-api.test.js.
function backend(db = {}) {
  return (url, options) => {
    if (url.includes('/auth/v1/user')) return { body: { id: USER } };
    const name = new URL(url).pathname.replace('/rest/v1/', '').replace('rpc/', '');
    const hit = db[name];
    const body = typeof hit === 'function' ? hit(url, options) : hit;
    return { body: body === undefined ? [] : body, headers: { 'content-range': '0-0/0' } };
  };
}

const staffOf = (status = 'active') => [
  { role: 'staff', merchants: { id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status } },
];
const shop = { members: [{ id: USER }], merchant_staff: staffOf() };
const stranger = { members: [{ id: USER }], merchant_staff: [] };

const get = (merchantId = SHOP) => ({
  request: fakeRequest({
    url: `https://x/api/tokens/menu?merchant_id=${merchantId}`,
    headers: auth,
  }),
  env: fakeEnv(ON),
});
const post = (body) => ({ request: fakeRequest({ body, headers: auth }), env: fakeEnv(ON) });

const wrote = (fetch, method) => fetch.calls.some((c) => c.options.method === method);

test('a shop’s staff read their own menu, with what each line has sold', async () => {
  const fetch = mockFetch(
    backend({
      ...shop,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      merchant_items: [{ id: ITEM, merchant_id: SHOP, name: 'Milk tea', tokens: 30 }],
      token_settings: [{ tokens_per_dollar: 10, pay_allow_partners: true }],
      token_merchant_sales: [
        { merchant_id: SHOP, item_id: ITEM, charges: 0, units: 7, tokens: 210 },
        // another shop's line, in the same answer: it is not this menu's
        { merchant_id: OTHER_SHOP, item_id: 'x', charges: 0, units: 99, tokens: 990 },
      ],
    }),
  );
  try {
    const r = await menuGet(get());
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.merchant.name, 'Kung Fu Tea');
    assert.equal(data.rate, 10);
    assert.equal(data.allow_partners, true);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].sold, 7);
    assert.equal(data.items[0].sold_tokens, 210);
    // only this merchant's items were asked for
    const list = fetch.calls.find((c) => c.url.includes('merchant_items?'));
    assert.match(list.url, new RegExp(`merchant_id=eq\\.${SHOP}`));
  } finally {
    fetch.restore();
  }
});

test('the menu still loads before 0033 is applied, just without the figures', async () => {
  const fetch = mockFetch((url, options) => {
    if (url.includes('rpc/token_merchant_sales')) return { status: 404, body: { message: 'no' } };
    return backend({
      ...shop,
      merchants: [{ id: SHOP, name: 'Kung Fu Tea', kind: 'partner', status: 'active' }],
      merchant_items: [{ id: ITEM, merchant_id: SHOP, name: 'Milk tea', tokens: 30 }],
      token_settings: [{ tokens_per_dollar: 10, pay_allow_partners: true }],
    })(url, options);
  });
  try {
    const r = await menuGet(get());
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.items[0].sold, 0);
  } finally {
    fetch.restore();
  }
});

test('an account that is not on the staff list is refused, in both languages', async () => {
  const fetch = mockFetch(backend({ ...stranger, merchants: [{ id: SHOP }] }));
  try {
    const r = await menuGet(get());
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.code, 'not_staff');
    assert.match(body.error_zh, /店员名单/);
  } finally {
    fetch.restore();
  }
});

test('a stranger cannot write to a menu either', async () => {
  const fetch = mockFetch(backend({ ...stranger, merchant_items: [{ id: ITEM }] }));
  try {
    const r = await menuPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Free tea', tokens: 1 }),
    );
    assert.equal(r.status, 403);
    assert.equal(wrote(fetch, 'PATCH'), false);
  } finally {
    fetch.restore();
  }
});

test('the shop adds an item, and is told when a printed price has moved', async () => {
  let fetch = mockFetch(backend({ ...shop, merchant_items: [] }));
  try {
    const r = await menuPost(
      post({ action: 'save_item', merchant_id: SHOP, name: 'Egg tart', tokens: 10 }),
    );
    assert.equal(r.status, 200);
    const posted = fetch.calls.find(
      (c) => c.options.method === 'POST' && c.url.includes('merchant_items'),
    );
    assert.equal(JSON.parse(posted.options.body).merchant_id, SHOP);
  } finally {
    fetch.restore();
  }

  // the price moved under a sticker that is already on the cups
  fetch = mockFetch(
    backend({
      ...shop,
      merchant_items: [{ id: ITEM, merchant_id: SHOP, tokens: 30, pay_code: 'ABCD2345' }],
    }),
  );
  try {
    const r = await menuPost(
      post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 40 }),
    );
    assert.deepEqual(await r.json(), { ok: true, reprint: true });
  } finally {
    fetch.restore();
  }
});

test('a price cannot be set to nothing, or to something that is not a number', async () => {
  const fetch = mockFetch(backend({ ...shop, merchant_items: [{ id: ITEM, merchant_id: SHOP }] }));
  try {
    for (const tokens of [0, -5, 2.5, 'free']) {
      const r = await menuPost(
        post({ action: 'save_item', merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens }),
      );
      assert.equal(r.status, 400, `tokens=${tokens}`);
    }
    assert.equal(wrote(fetch, 'PATCH'), false);
  } finally {
    fetch.restore();
  }
});

test('an item belonging to another shop is not edited, deleted or re-coded', async () => {
  // the row exists, but not under this merchant: the scoped read finds nothing
  for (const action of ['save_item', 'delete_item', 'issue_code']) {
    const fetch = mockFetch(backend({ ...shop, merchant_items: [] }));
    try {
      const r = await menuPost(
        post({ action, merchant_id: SHOP, id: ITEM, name: 'Milk tea', tokens: 40 }),
      );
      assert.equal(r.status, 404, action);
      assert.equal(wrote(fetch, 'PATCH'), false, action);
      assert.equal(wrote(fetch, 'DELETE'), false, action);
    } finally {
      fetch.restore();
    }
  }
});

test('a delete names the merchant as well as the item', async () => {
  const fetch = mockFetch(backend({ ...shop, merchant_items: [{ id: ITEM, merchant_id: SHOP }] }));
  try {
    const r = await menuPost(post({ action: 'delete_item', merchant_id: SHOP, id: ITEM }));
    assert.equal(r.status, 200);
    const del = fetch.calls.find((c) => c.options.method === 'DELETE');
    assert.match(del.url, new RegExp(`id=eq\\.${ITEM}`));
    assert.match(del.url, new RegExp(`merchant_id=eq\\.${SHOP}`));
  } finally {
    fetch.restore();
  }
});

test('the shop issues its own QR code, and it is eight readable characters', async () => {
  const fetch = mockFetch(backend({ ...shop, merchant_items: [{ id: ITEM, merchant_id: SHOP }] }));
  try {
    const r = await menuPost(post({ action: 'issue_code', merchant_id: SHOP, id: ITEM }));
    assert.equal(r.status, 200);
    const { pay_code } = await r.json();
    // no I, O, U, 0 or 1 — nothing on a sticker can be read back wrong
    assert.match(pay_code, /^[23456789ABCDEFGHJKLMNPQRSTVWXYZ]{8}$/);
    const patch = fetch.calls.find((c) => c.options.method === 'PATCH');
    assert.match(patch.url, new RegExp(`merchant_id=eq\\.${SHOP}`));
  } finally {
    fetch.restore();
  }
});

test('a suspended shop is told to ask CAACI; an admin can still put it right', async () => {
  const fetch = mockFetch(
    backend({
      members: [{ id: USER }],
      merchant_staff: staffOf('suspended'),
      merchant_items: [{ id: ITEM, merchant_id: SHOP }],
    }),
  );
  try {
    const r = await menuPost(post({ action: 'issue_code', merchant_id: SHOP, id: ITEM }));
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, 'merchant_suspended');
    assert.equal(wrote(fetch, 'PATCH'), false);
  } finally {
    fetch.restore();
  }

  const asAdmin = mockFetch(
    backend({
      members: [{ id: USER, is_admin: true }],
      merchant_staff: staffOf('suspended'),
      merchant_items: [{ id: ITEM, merchant_id: SHOP }],
    }),
  );
  try {
    const r = await menuPost(post({ action: 'issue_code', merchant_id: SHOP, id: ITEM }));
    assert.equal(r.status, 200);
  } finally {
    asAdmin.restore();
  }
});

test('the menu endpoint answers nothing but menu actions', async () => {
  const fetch = mockFetch(backend(shop));
  try {
    const r = await menuPost(post({ action: 'remove_staff', merchant_id: SHOP, member_id: USER }));
    assert.equal(r.status, 400);
    assert.equal(wrote(fetch, 'DELETE'), false);
  } finally {
    fetch.restore();
  }
});

test('the back office deletes an item through the same scoped path', async () => {
  const fetch = mockFetch(
    backend({
      members: [{ id: USER, is_admin: true }],
      merchant_items: [{ id: ITEM, merchant_id: SHOP }],
    }),
  );
  try {
    const r = await adminMerchants(post({ action: 'delete_item', merchant_id: SHOP, id: ITEM }));
    assert.equal(r.status, 200);
    const del = fetch.calls.find((c) => c.options.method === 'DELETE');
    assert.match(del.url, new RegExp(`merchant_id=eq\\.${SHOP}`));
  } finally {
    fetch.restore();
  }
});
