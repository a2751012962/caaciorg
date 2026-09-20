// The token endpoints' own decisions: the kill switch, who gets in, that menu
// prices come from the database and never from the request, what a stranger
// sees, and that the webhook credits a paid pack. The ledger's rules themselves
// are pinned against a real Postgres in tokens-ledger.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';
import { maskName, tokensEnabled } from '../functions/api/_tokens.js';
import { onRequestGet as me } from '../functions/api/tokens/me.js';
import { onRequestGet as scan } from '../functions/api/tokens/scan.js';
import { onRequestPost as charge } from '../functions/api/tokens/charge.js';
import {
  onRequestGet as payGet,
  onRequestPost as payPost,
} from '../functions/api/tokens/pay.js';
import { onRequestPost as buy } from '../functions/api/tokens/buy.js';
import { onRequestGet as disputeGet } from '../functions/api/tokens/dispute.js';
import {
  onRequestPost as adminTokens,
  onRequestGet as adminTokensGet,
} from '../functions/api/admin/tokens.js';
import { onRequestPost as roles } from '../functions/api/admin/roles.js';
import { onRequestPost as adminMembers } from '../functions/api/admin/members.js';
import { onRequestGet as verify } from '../functions/api/verify.js';
import { onRequestPost as webhook } from '../functions/api/stripe-webhook.js';

const ON = { TOKENS_ENABLED: '1' };
const USER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const SHOP = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const TX = '55555555-5555-4555-8555-555555555555';
const auth = { authorization: 'Bearer token' };

// Supabase as seen through fetch. `db` maps a table or rpc name to its answer
// (a value, or a function of the URL / options).
function backend(db = {}) {
  return (url, options) => {
    if (url.includes('/auth/v1/user')) return { body: { id: USER, email: 'clerk@example.com' } };
    if (url.includes('api.resend.com')) return { body: { id: 'email_1' } };
    if (url.includes('api.stripe.com')) return { body: { id: 'cs_1', url: 'https://pay/cs_1' } };
    const name = new URL(url).pathname.replace('/rest/v1/', '').replace('rpc/', '');
    const hit = db[name];
    const body = typeof hit === 'function' ? hit(url, options) : hit;
    return { body: body === undefined ? [] : body, headers: { 'content-range': '0-0/0' } };
  };
}

const staffOf = (status = 'active') => [
  {
    role: 'staff',
    merchants: { id: SHOP, name: 'Kung Fu Tea', name_zh: '功夫茶', kind: 'partner', status },
  },
];

test('maskName keeps only the family name', () => {
  assert.equal(maskName('Wei Zhang'), 'W. Zhang');
  assert.equal(maskName('  mary   anne  o’brien '), 'M. o’brien');
  assert.equal(maskName('张伟'), '张＊');
  assert.equal(maskName('欧阳 娜娜'), '欧＊');
  assert.equal(maskName('Zhang'), 'Zhang');
  assert.equal(maskName(''), 'CAACI Member');
});

test('the switch: off by default, and every token endpoint is dark while it is off', async () => {
  assert.equal(tokensEnabled({}), false);
  assert.equal(tokensEnabled({ TOKENS_ENABLED: '0' }), false);
  assert.equal(tokensEnabled(ON), true);
  const fetch = mockFetch(backend());
  try {
    const env = fakeEnv();
    const r = await me({ request: fakeRequest({ headers: auth }), env });
    assert.deepEqual(await r.json(), { enabled: false });
    for (const call of [
      scan({
        request: fakeRequest({ url: `https://x/api/tokens/scan?m=${MEMBER}`, headers: auth }),
        env,
      }),
      charge({ request: fakeRequest({ body: {}, headers: auth }), env }),
      payGet({ request: fakeRequest({ url: 'https://x/api/tokens/pay?c=ABCD2345' }), env }),
      payPost({ request: fakeRequest({ body: { code: 'ABCD2345' }, headers: auth }), env }),
      buy({ request: fakeRequest({ body: {}, headers: auth }), env }),
      adminTokens({ request: fakeRequest({ body: {}, headers: auth }), env }),
      roles({ request: fakeRequest({ body: {}, headers: auth }), env }),
    ])
      assert.equal((await call).status, 404);
    assert.equal(fetch.calls.length, 0, 'nothing is even looked up while the switch is off');
  } finally {
    fetch.restore();
  }
});

test('scan: a stranger learns nothing; staff see the family name, balance and their menu', async () => {
  let fetch = mockFetch(backend({ members: [{ id: USER, is_admin: false, is_root: false }] }));
  try {
    const r = await scan({
      request: fakeRequest({ url: `https://x/api/tokens/scan?m=${MEMBER}`, headers: auth }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 403);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('token_balance')),
      false,
    );
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(
    backend({
      members: (url) =>
        url.includes(MEMBER)
          ? [
              {
                id: MEMBER,
                full_name: 'Wei Zhang',
                tier_id: 'student',
                status: 'active',
                expires_at: null,
              },
            ]
          : [{ id: USER, is_admin: false, is_root: false }],
      merchant_staff: staffOf(),
      merchant_items: [
        { id: ITEM, merchant_id: SHOP, name: 'Milk tea', name_zh: '奶茶', tokens: 40 },
      ],
      membership_tiers: [{ name: 'Student' }],
      token_settings: [{ max_charge: 500, tokens_per_dollar: 10, grants: { student: 150 } }],
      token_balance: 150,
    }),
  );
  try {
    const r = await scan({
      request: fakeRequest({ url: `https://x/api/tokens/scan?m=${MEMBER}`, headers: auth }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.member.name, 'W. Zhang');
    assert.equal(
      JSON.stringify(data).includes('Wei'),
      false,
      'the given name never leaves the server',
    );
    assert.equal(data.balance, 150);
    assert.equal(data.merchants[0].items[0].tokens, 40);
    assert.equal(data.grant_target, 0, 'only an admin is told what a grant would be');
  } finally {
    fetch.restore();
  }
});

test('charge: the price is the menu’s, not the request’s, and a receipt goes out', async () => {
  const fetch = mockFetch(
    backend({
      merchant_items: [{ id: ITEM, name: 'Milk tea', name_zh: '奶茶', tokens: 40 }],
      token_charge: { ok: true, tx_id: TX, balance: 70 },
      token_tx: [
        { id: TX, amount: -80, created_at: '2026-09-27T20:00:00Z', dispute_key: TX, items: [] },
      ],
      members: [{ id: MEMBER, email: 'wei@example.com', full_name: 'Wei Zhang' }],
      merchants: [{ name: 'Kung Fu Tea', name_zh: '功夫茶' }],
    }),
  );
  try {
    const r = await charge({
      request: fakeRequest({
        headers: auth,
        body: {
          member_id: MEMBER,
          merchant_id: SHOP,
          items: [{ id: ITEM, qty: 2, tokens: 1 }], // a forged price is ignored
          idem_key: 'abc',
        },
      }),
      env: fakeEnv({ ...ON, RESEND_API_KEY: 're_1', NOTIFY_FROM: 'CAACI <no-reply@caaciorg.com>' }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      tx_id: TX,
      amount: 80,
      balance: 70,
      duplicate: false,
    });

    const rpc = fetch.calls.find((c) => c.url.includes('rpc/token_charge'));
    const args = JSON.parse(rpc.options.body);
    assert.equal(args.p_amount, 80);
    assert.equal(args.p_actor, USER, 'the actor is the session, not the body');
    assert.equal(args.p_idem, 'abc');

    const mail = fetch.calls.find((c) => c.url.includes('api.resend.com'));
    const sent = JSON.parse(mail.options.body);
    assert.equal(sent.to, 'wei@example.com');
    assert.match(sent.html, /api\/tokens\/dispute\?tx=/);
    const stamp = fetch.calls.find(
      (c) => c.options.method === 'PATCH' && c.url.includes('token_tx'),
    );
    assert.ok(
      JSON.parse(stamp.options.body).receipt_sent_at,
      'the receipt outcome is stamped on the row',
    );
  } finally {
    fetch.restore();
  }
});

// ---- scan-to-pay: the QR printed on the product (0030) ----

const CODE = 'K7M2PQ34';
const stall = (over = {}) => ({
  merchant_items: [
    {
      id: ITEM,
      merchant_id: SHOP,
      name: 'Orange juice',
      name_zh: '橙汁',
      tokens: 30,
      active: true,
      pay_code: CODE,
    },
  ],
  merchants: [
    { id: SHOP, name: 'CAACI Events', name_zh: '华协活动', kind: 'internal', status: 'active' },
  ],
  token_settings: [{ tokens_per_dollar: 10, max_charge: 500, pay_allow_partners: false }],
  ...over,
});

test('pay: a printed code says which shop and what for before anyone signs in', async () => {
  const fetch = mockFetch(backend(stall()));
  try {
    const r = await payGet({
      request: fakeRequest({ url: `https://x/api/tokens/pay?c=${CODE}` }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.item.tokens, 30);
    assert.equal(data.merchant.name, 'CAACI Events');
    assert.equal(data.open, true);
    assert.equal(data.signed_in, false);
    assert.equal(data.balance, null, 'a signed-out visitor has no balance to show');
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/auth/v1/user')),
      false,
      'no session was offered, so none is validated',
    );
  } finally {
    fetch.restore();
  }
});

test('pay: a code that is not in the printed alphabet never reaches the database', async () => {
  const fetch = mockFetch(backend(stall()));
  try {
    for (const c of ['hello!', 'ABC', 'I0OU1234', `${CODE}'--`]) {
      const r = await payGet({
        request: fakeRequest({ url: `https://x/api/tokens/pay?c=${encodeURIComponent(c)}` }),
        env: fakeEnv(ON),
      });
      assert.equal(r.status, 404, c);
    }
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('pay: a partner shop cannot take scan-to-pay until root turns it on', async () => {
  const fetch = mockFetch(
    backend(
      stall({
        merchants: [
          { id: SHOP, name: 'Kung Fu Tea', name_zh: '功夫茶', kind: 'partner', status: 'active' },
        ],
      }),
    ),
  );
  try {
    const r = await payGet({
      request: fakeRequest({ url: `https://x/api/tokens/pay?c=${CODE}` }),
      env: fakeEnv(ON),
    });
    assert.equal((await r.json()).open, false);
  } finally {
    fetch.restore();
  }
});

test('pay: the amount is the item’s, the payer is the session, and a receipt goes out', async () => {
  const fetch = mockFetch(
    backend(
      stall({
        token_charge_code: { ok: true, tx_id: TX, amount: 30, merchant_id: SHOP, balance: 120 },
        token_tx: [
          { id: TX, amount: -30, created_at: '2026-09-27T20:00:00Z', dispute_key: TX, items: [] },
        ],
        members: [{ id: USER, email: 'wei@example.com', full_name: 'Wei Zhang' }],
      }),
    ),
  );
  try {
    const r = await payPost({
      request: fakeRequest({
        headers: auth,
        // a forged amount has nowhere to go: the endpoint sends the code alone
        body: { code: CODE.toLowerCase(), idem_key: 'abc', amount: 1, tokens: 1 },
      }),
      env: fakeEnv({ ...ON, RESEND_API_KEY: 're_1', NOTIFY_FROM: 'CAACI <no-reply@caaciorg.com>' }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      ok: true,
      tx_id: TX,
      confirm: '5555',
      amount: 30,
      balance: 120,
      duplicate: false,
    });

    const rpc = fetch.calls.find((c) => c.url.includes('rpc/token_charge_code'));
    const args = JSON.parse(rpc.options.body);
    assert.deepEqual(Object.keys(args).sort(), [
      'p_allow_repeat',
      'p_code',
      'p_idem',
      'p_member',
    ]);
    assert.equal(args.p_code, CODE, 'the code is read back in the printed case');
    assert.equal(args.p_member, USER, 'the payer is the session, not the body');
    assert.equal(args.p_allow_repeat, false);

    const mail = fetch.calls.find((c) => c.url.includes('api.resend.com'));
    assert.match(JSON.parse(mail.options.body).html, /api\/tokens\/dispute\?tx=/);
  } finally {
    fetch.restore();
  }
});

test('pay: signed out takes nothing; a repeat comes back in both languages', async () => {
  let fetch = mockFetch(backend(stall()));
  try {
    const r = await payPost({
      request: fakeRequest({ body: { code: CODE, idem_key: 'abc' } }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 401);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('token_charge_code')),
      false,
    );
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(
    backend(stall({ token_charge_code: { error: 'repeat_too_soon', seconds: 120 } })),
  );
  try {
    const r = await payPost({
      request: fakeRequest({ headers: auth, body: { code: CODE, idem_key: 'abc' } }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 409);
    const data = await r.json();
    assert.equal(data.code, 'repeat_too_soon');
    assert.match(data.error, /2 minute/);
    assert.match(data.error_zh, /2 分钟/);
  } finally {
    fetch.restore();
  }
});

test('charge: a ledger refusal comes back in both languages; a failed receipt is recorded', async () => {
  let fetch = mockFetch(backend({ token_charge: { error: 'insufficient_balance', balance: 10 } }));
  try {
    const r = await charge({
      request: fakeRequest({
        headers: auth,
        body: { member_id: MEMBER, merchant_id: SHOP, custom_tokens: 30 },
      }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 409);
    const data = await r.json();
    assert.equal(data.code, 'insufficient_balance');
    assert.match(data.error, /balance is 10/);
    assert.match(data.error_zh, /余额不足/);
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(
    backend({
      token_charge: { ok: true, tx_id: TX, balance: 0 },
      token_tx: [{ id: TX, amount: -30, created_at: '2026-09-27T20:00:00Z', dispute_key: TX }],
      members: [{ id: MEMBER, email: '', full_name: 'No Email' }],
      merchants: [{ name: 'CAACI Events' }],
    }),
  );
  try {
    await charge({
      request: fakeRequest({
        headers: auth,
        body: { member_id: MEMBER, merchant_id: SHOP, custom_tokens: 30 },
      }),
      env: fakeEnv(ON),
    });
    const stamp = fetch.calls.find(
      (c) => c.options.method === 'PATCH' && c.url.includes('token_tx'),
    );
    assert.match(JSON.parse(stamp.options.body).receipt_error, /no email/);
  } finally {
    fetch.restore();
  }
});

test('buy: only a listed pack, for the signed-in account, with the card fee on top', async () => {
  const db = {
    token_settings: [{ packs_cents: [1000, 2000, 5000, 10000], tokens_per_dollar: 10 }],
    members: [{ id: USER, email: 'me@example.com', status: 'active', stripe_customer_id: null }],
  };
  let fetch = mockFetch(backend(db));
  try {
    const r = await buy({
      request: fakeRequest({ headers: auth, body: { pack_cents: 100 } }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 400, '$1 is not a pack: the floor is $10');
    assert.equal(
      fetch.calls.some((c) => c.url.includes('api.stripe.com')),
      false,
    );
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(backend(db));
  try {
    const r = await buy({
      request: fakeRequest({ headers: auth, body: { pack_cents: 1000, member_id: MEMBER } }),
      env: fakeEnv(ON),
    });
    assert.deepEqual(await r.json(), { url: 'https://pay/cs_1' });
    const form = new URLSearchParams(
      fetch.calls.find((c) => c.url.includes('api.stripe.com')).options.body,
    );
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1035');
    assert.equal(form.get('metadata[member_id]'), USER, 'never the member_id from the body');
    assert.equal(form.get('metadata[tokens]'), '100');
    assert.equal(form.get('metadata[kind]'), 'tokens');
  } finally {
    fetch.restore();
  }
});

test('webhook: a paid token pack is credited by session id; an unpaid one is not', async () => {
  const event = (payment_status) => ({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_pack',
        payment_status,
        metadata: { kind: 'tokens', member_id: MEMBER, pack_cents: '2000', tokens: '99999' },
      },
    },
  });
  for (const [status, credited] of [
    ['paid', true],
    ['unpaid', false],
  ]) {
    const fetch = mockFetch(
      backend({ token_settings: [{ tokens_per_dollar: 10 }], token_purchase_credit: { ok: true } }),
    );
    try {
      const r = await webhook({ request: fakeRequest({ body: event(status) }), env: fakeEnv(ON) });
      assert.equal(r.status, 200);
      const rpc = fetch.calls.find((c) => c.url.includes('rpc/token_purchase_credit'));
      assert.equal(!!rpc, credited, status);
      if (rpc)
        assert.deepEqual(JSON.parse(rpc.options.body), {
          p_member: MEMBER,
          p_amount: 200, // from the money paid, not from metadata.tokens
          p_cents: 2000,
          p_session: 'cs_pack',
        });
    } finally {
      fetch.restore();
    }
  }
});

test('webhook: a pack that cannot be credited answers 500 so Stripe retries', async () => {
  const fetch = mockFetch(
    backend({
      token_settings: [{ tokens_per_dollar: 10 }],
      token_purchase_credit: { error: 'member_not_found' },
    }),
  );
  try {
    const r = await webhook({
      request: fakeRequest({
        body: {
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_x',
              payment_status: 'paid',
              metadata: { kind: 'tokens', member_id: MEMBER, pack_cents: '1000' },
            },
          },
        },
      }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 500);
  } finally {
    fetch.restore();
  }
});

test('only root changes the settings or appoints an admin', async () => {
  const admin = { members: [{ id: USER, is_admin: true, is_root: false }] };
  let fetch = mockFetch(backend(admin));
  try {
    const s = await adminTokens({
      request: fakeRequest({ headers: auth, body: { action: 'settings', admin_mint_cap: 99999 } }),
      env: fakeEnv(ON),
    });
    assert.equal(s.status, 403);
    const a = await roles({
      request: fakeRequest({ headers: auth, body: { member_id: MEMBER, is_admin: true } }),
      env: fakeEnv(ON),
    });
    assert.equal(a.status, 403);
    const viaMembers = await adminMembers({
      request: fakeRequest({ headers: auth, body: { id: MEMBER, is_admin: true } }),
      env: fakeEnv(ON),
    });
    assert.equal(
      viaMembers.status,
      403,
      'the members endpoint no longer sets is_admin once tokens are on',
    );
    assert.equal(
      fetch.calls.some((c) => c.options.method === 'PATCH'),
      false,
      'nothing was written',
    );
  } finally {
    fetch.restore();
  }

  fetch = mockFetch(backend({ members: [{ id: USER, is_admin: true, is_root: true }] }));
  try {
    const r = await roles({
      request: fakeRequest({ headers: auth, body: { member_id: MEMBER, is_admin: true } }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const patch = fetch.calls.find((c) => c.options.method === 'PATCH');
    assert.deepEqual(
      JSON.parse(patch.options.body),
      { is_admin: true },
      'is_root is never written by the API',
    );
  } finally {
    fetch.restore();
  }
});

test('admin cash top-up: tokens come from token_quote, not the amount in the body', async () => {
  const fetch = mockFetch(
    backend({
      members: [{ id: USER, is_admin: true }],
      token_settings: [{ tokens_per_dollar: 10 }],
      token_quote: { cents: 1000, rate: 10, base: 100, bonus: 0, total: 100, bonus_active: false },
      token_admin_credit: { ok: true, tx_id: TX, balance: 100 },
    }),
  );
  try {
    const r = await adminTokens({
      request: fakeRequest({
        headers: auth,
        body: { action: 'cash', member_id: MEMBER, cash_cents: 1000, amount: 5000 },
      }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const args = JSON.parse(
      fetch.calls.find((c) => c.url.includes('rpc/token_admin_credit')).options.body,
    );
    assert.equal(args.p_amount, 100, 'not the amount in the body');
    assert.equal(args.p_cash_cents, 1000);
    assert.equal(args.p_kind, 'cash');
    assert.equal(args.p_actor, USER);
  } finally {
    fetch.restore();
  }
});

test('admin cash top-up: a running promotion is handed over at the desk', async () => {
  const fetch = mockFetch(
    backend({
      members: [{ id: USER, is_admin: true }],
      token_settings: [{ tokens_per_dollar: 10 }],
      token_quote: { cents: 1000, rate: 10, base: 100, bonus: 50, total: 150, bonus_active: true },
      token_admin_credit: { ok: true, tx_id: TX, balance: 150 },
    }),
  );
  try {
    const r = await adminTokens({
      request: fakeRequest({
        headers: auth,
        body: { action: 'cash', member_id: MEMBER, cash_cents: 1000 },
      }),
      env: fakeEnv(ON),
    });
    assert.equal(r.status, 200);
    const args = JSON.parse(
      fetch.calls.find((c) => c.url.includes('rpc/token_admin_credit')).options.body,
    );
    assert.equal(args.p_amount, 150, '$10 buys 150 while the promotion is on');
    assert.equal(args.p_cash_cents, 1000, 'the cash taken is still $10');
  } finally {
    fetch.restore();
  }
});

test('the dispute link only shows the charge on GET; it needs the key', async () => {
  const fetch = mockFetch(
    backend({
      token_tx: (url) =>
        url.includes(`dispute_key=eq.${TX}`)
          ? [
              {
                id: TX,
                kind: 'charge',
                state: 'ok',
                amount: -40,
                created_at: '2026-09-27T20:00:00Z',
                merchant_id: SHOP,
              },
            ]
          : [],
      merchants: [{ name: 'Kung Fu Tea' }],
    }),
  );
  try {
    const ok = await disputeGet({
      request: fakeRequest({ url: `https://x/api/tokens/dispute?tx=${TX}&k=${TX}` }),
      env: fakeEnv(ON),
    });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /40 tokens/);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rpc/')),
      false,
      'opening the email link files nothing',
    );

    const wrong = await disputeGet({
      request: fakeRequest({ url: `https://x/api/tokens/dispute?tx=${TX}&k=${MEMBER}` }),
      env: fakeEnv(ON),
    });
    assert.equal(wrong.status, 404);
  } finally {
    fetch.restore();
  }
});

test('verify page: full name while tokens are off; family name and a merchant button once on', async () => {
  const db = {
    members: [
      {
        id: MEMBER,
        full_name: 'Wei Zhang',
        tier_id: 'student',
        status: 'active',
        expires_at: null,
      },
    ],
    membership_tiers: [{ name: 'Student' }],
  };
  for (const [env, shows, hides] of [
    [fakeEnv(), /Wei Zhang/, /\/charge\//],
    [fakeEnv(ON), /W\. Zhang/, /Wei Zhang/],
  ]) {
    const fetch = mockFetch(backend(db));
    try {
      const r = await verify({
        request: fakeRequest({ url: `https://x/api/verify?m=${MEMBER}` }),
        env,
      });
      const html = await r.text();
      assert.match(html, shows);
      assert.doesNotMatch(html, hides);
      if (env.TOKENS_ENABLED) assert.match(html, new RegExp(`/charge/\\?m=${MEMBER}`));
    } finally {
      fetch.restore();
    }
  }
});

test('admin ledger: filters by merchant and kind, and ignores a malformed merchant id', async () => {
  const fetch = mockFetch(
    backend({ members: [{ id: USER, is_admin: true, is_root: false }], token_tx: [] }),
  );
  try {
    const ledgerCall = async (qs) => {
      const r = await adminTokensGet({
        request: fakeRequest({
          url: `https://x/api/admin/tokens?view=ledger&${qs}`,
          headers: auth,
        }),
        env: fakeEnv(ON),
      });
      assert.equal(r.status, 200);
      const call = fetch.calls.filter((c) => c.url.includes('/rest/v1/token_tx')).pop();
      return decodeURIComponent(call.url);
    };
    const one = await ledgerCall(`merchant_id=${SHOP}&kind=void`);
    assert.ok(one.includes(`merchant_id=eq.${SHOP}`), one);
    assert.ok(one.includes('kind=eq.void'), one);

    const all = await ledgerCall('');
    assert.doesNotMatch(all, /merchant_id=eq/, 'all merchants: no merchant filter');

    const bad = await ledgerCall('merchant_id=not-a-uuid');
    assert.doesNotMatch(bad, /merchant_id=eq/, 'a malformed id is not passed to the database');
  } finally {
    fetch.restore();
  }
});
