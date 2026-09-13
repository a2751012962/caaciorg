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

test('admin events: lists and re-reads perk_deadline', async () => {
  const fetch = mockFetch(route());
  try {
    await onRequestGet({ request: authed(), env: fakeEnv() });
    await onRequestPost({ request: authed({ body: { id: 'e1', title: 'Gala' } }), env: fakeEnv() });
    const selects = fetch.calls.filter(
      (c) => c.url.includes('/rest/v1/events') && c.url.includes('select='),
    );
    assert.equal(selects.length, 2);
    for (const c of selects) assert.match(c.url, /select=[^&]*perk_deadline/);
  } finally {
    fetch.restore();
  }
});

test('admin events: perk_deadline is normalised to ISO, cleared to null, or refused', async () => {
  const fetch = mockFetch(route());
  const patchBody = () =>
    JSON.parse(fetch.calls.filter((c) => c.options.method === 'PATCH').at(-1).options.body);
  try {
    const set = await onRequestPost({
      request: authed({ body: { id: 'e1', perk_deadline: '2026-09-20T23:59:00-05:00' } }),
      env: fakeEnv(),
    });
    assert.equal(set.status, 200);
    assert.deepEqual(patchBody(), { perk_deadline: '2026-09-21T04:59:00.000Z' });

    for (const empty of ['', null]) {
      const cleared = await onRequestPost({
        request: authed({ body: { id: 'e1', perk_deadline: empty } }),
        env: fakeEnv(),
      });
      assert.equal(cleared.status, 200);
      assert.deepEqual(patchBody(), { perk_deadline: null });
    }

    const patches = fetch.calls.filter((c) => c.options.method === 'PATCH').length;
    const invalid = await onRequestPost({
      request: authed({ body: { id: 'e1', perk_deadline: 'next friday' } }),
      env: fakeEnv(),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'Invalid free-gift deadline.');
    assert.equal(fetch.calls.filter((c) => c.options.method === 'PATCH').length, patches);

    // Create accepts it too.
    const created = await onRequestPut({
      request: authed({
        body: {
          title: 'Mid-Autumn Festival',
          starts_at: '2026-09-27T19:00:00Z',
          perk_deadline: '2026-09-21T04:59:00Z',
        },
      }),
      env: fakeEnv(),
    });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).event.perk_deadline, '2026-09-21T04:59:00.000Z');
  } finally {
    fetch.restore();
  }
});

// ---------------------------------------------------- registration forms ----

const patchBodies = (fetch) =>
  fetch.calls.filter((c) => c.options.method === 'PATCH').map((c) => JSON.parse(c.options.body));
const postPatch = (body) =>
  onRequestPost({ request: authed({ body: { id: 'e1', ...body } }), env: fakeEnv() });

const QUESTION = {
  id: 'heard_from',
  type: 'single',
  label_en: 'How did you hear?',
  label_zh: '您是从哪里得知的？',
  required: false,
  options: [{ id: 'website', label_en: 'Website', label_zh: '网站' }],
  other: true,
};

test('admin events: lists and re-reads the Chinese title, questions and gift names', async () => {
  const fetch = mockFetch(route());
  try {
    await onRequestGet({ request: authed(), env: fakeEnv() });
    await postPatch({ title: 'Gala' });
    const selects = fetch.calls.filter(
      (c) => c.url.includes('/rest/v1/events') && c.url.includes('select='),
    );
    assert.equal(selects.length, 2);
    for (const c of selects) {
      const columns = new URL(c.url).searchParams.get('select').split(',');
      for (const col of ['title_zh', 'registration_questions', 'perk_item_zh', 'perk_item_en'])
        assert.ok(columns.includes(col), col);
    }
  } finally {
    fetch.restore();
  }
});

test('admin events: each listed event carries its registration_count', async () => {
  const fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_registrations')
      ? { body: [{ event_id: 'e1' }, { event_id: 'e1' }, { event_id: 'other' }] }
      : route()(u, o),
  );
  try {
    const r = await onRequestGet({ request: authed(), env: fakeEnv() });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(
      data.rows.map((x) => [x.id, x.registration_count]),
      [
        ['e1', 2],
        ['e2', 0],
      ],
    );
    assert.equal(data.total, 2);
    const reads = fetch.calls.filter((c) => c.url.includes('/rest/v1/event_registrations'));
    assert.equal(reads.length, 1, 'a short first page is the last');
    const params = new URL(reads[0].url).searchParams;
    assert.equal(params.get('select'), 'event_id');
    assert.equal(params.get('event_id'), 'in.(e1,e2)');
    assert.equal(params.get('order'), 'id');
    assert.equal(params.get('limit'), '1000');
    assert.equal(params.get('offset'), '0');
  } finally {
    fetch.restore();
  }
});

// PostgREST caps a response at max_rows (1000 by default) whatever limit is
// asked for, so a count from one read would stop at 1000.
test('admin events: registration_count pages through registrations 1000 at a time, in id order', async () => {
  const regsAt = (offset) =>
    offset === 0
      ? [
          ...Array.from({ length: 600 }, () => ({ event_id: 'e1' })),
          ...Array.from({ length: 400 }, () => ({ event_id: 'e2' })),
        ]
      : offset === 1000
        ? [{ event_id: 'e1' }, { event_id: 'e1' }, { event_id: 'e1' }, { event_id: 'gone' }]
        : [];
  const fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_registrations')
      ? { body: regsAt(Number(new URL(u).searchParams.get('offset'))) }
      : route()(u, o),
  );
  try {
    const data = await (await onRequestGet({ request: authed(), env: fakeEnv() })).json();
    assert.deepEqual(
      data.rows.map((x) => [x.id, x.registration_count]),
      [
        ['e1', 603],
        ['e2', 400],
      ],
    );
    const reads = fetch.calls
      .filter((c) => c.url.includes('/rest/v1/event_registrations'))
      .map((c) => new URL(c.url).searchParams);
    assert.deepEqual(
      reads.map((p) => [p.get('offset'), p.get('limit'), p.get('order')]),
      [
        ['0', '1000', 'id'],
        ['1000', '1000', 'id'],
      ],
    );
  } finally {
    fetch.restore();
  }
});

test('admin events: registration_count stops after 20 full pages', async () => {
  const full = Array.from({ length: 1000 }, () => ({ event_id: 'e1' }));
  const fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_registrations') ? { body: full } : route()(u, o),
  );
  try {
    const r = await onRequestGet({ request: authed(), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rows[0].registration_count, 20000);
    const reads = fetch.calls.filter((c) => c.url.includes('/rest/v1/event_registrations'));
    assert.equal(reads.length, 20);
    assert.equal(new URL(reads.at(-1).url).searchParams.get('offset'), '19000');
  } finally {
    fetch.restore();
  }
});

test('admin events: an empty page reads no registrations; a failed count read is a 500', async () => {
  let fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/events') && !o.method ? { body: [] } : route()(u, o),
  );
  try {
    const r = await onRequestGet({ request: authed(), env: fakeEnv() });
    assert.deepEqual((await r.json()).rows, []);
    assert.equal(
      fetch.calls.some((c) => c.url.includes('/rest/v1/event_registrations')),
      false,
    );
  } finally {
    fetch.restore();
  }
  fetch = mockFetch((u, o) =>
    u.includes('/rest/v1/event_registrations') ? { status: 503, body: 'down' } : route()(u, o),
  );
  try {
    const r = await onRequestGet({ request: authed(), env: fakeEnv() });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /event_registrations: 503/);
  } finally {
    fetch.restore();
  }
});

test('admin events: registration_questions are validated and stored normalized, or cleared with null', async () => {
  const fetch = mockFetch(route());
  try {
    const set = await postPatch({
      registration_questions: [{ ...QUESTION, label_en: '  How did you hear?  ', color: 'red' }],
    });
    assert.equal(set.status, 200);
    assert.deepEqual(patchBodies(fetch).at(-1), { registration_questions: [QUESTION] });

    const open = await postPatch({ registration_questions: [] });
    assert.equal(open.status, 200);
    assert.deepEqual(patchBodies(fetch).at(-1), { registration_questions: [] });

    const off = await postPatch({ registration_questions: null });
    assert.equal(off.status, 200);
    assert.deepEqual(patchBodies(fetch).at(-1), { registration_questions: null });

    const patches = patchBodies(fetch).length;
    for (const [bad, error] of [
      [[{ ...QUESTION, id: 'Heard From' }], /^Question 1 has an invalid id/],
      [[QUESTION, QUESTION], /^Question 2 repeats the id "heard_from"\.$/],
      [{ heard_from: QUESTION }, /^Registration questions must be a list\.$/],
      ['', /^Registration questions must be a list\.$/],
    ]) {
      const r = await postPatch({ registration_questions: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match((await r.json()).error, error);
    }
    assert.equal(patchBodies(fetch).length, patches, 'nothing written for an invalid form');

    // Create accepts a form too.
    const created = await onRequestPut({
      request: authed({
        body: {
          title: 'Picnic',
          starts_at: '2026-10-01T18:00:00Z',
          registration_questions: [QUESTION],
        },
      }),
      env: fakeEnv(),
    });
    assert.equal(created.status, 200);
    assert.deepEqual((await created.json()).event.registration_questions, [QUESTION]);
  } finally {
    fetch.restore();
  }
});

test('admin events: title_zh is trimmed, and blank clears it', async () => {
  const fetch = mockFetch(route());
  try {
    await postPatch({ title_zh: '  中秋节 ' });
    assert.deepEqual(patchBodies(fetch).at(-1), { title_zh: '中秋节' });
    for (const empty of ['', '   ', null]) {
      await postPatch({ title_zh: empty });
      assert.deepEqual(patchBodies(fetch).at(-1), { title_zh: null });
    }
  } finally {
    fetch.restore();
  }
});

test('admin events: the gift name is set in both languages or neither', async () => {
  const fetch = mockFetch(route());
  try {
    const both = await postPatch({ perk_item_zh: ' 月饼 ', perk_item_en: ' mooncake ' });
    assert.equal(both.status, 200);
    assert.deepEqual(patchBodies(fetch).at(-1), { perk_item_zh: '月饼', perk_item_en: 'mooncake' });

    for (const neither of [
      { perk_item_zh: '', perk_item_en: '' },
      { perk_item_zh: null, perk_item_en: ' ' },
    ]) {
      const r = await postPatch(neither);
      assert.equal(r.status, 200);
      assert.deepEqual(patchBodies(fetch).at(-1), { perk_item_zh: null, perk_item_en: null });
    }

    const patches = patchBodies(fetch).length;
    for (const one of [
      { perk_item_zh: '月饼', perk_item_en: '' },
      { perk_item_zh: '  ', perk_item_en: 'mooncake' },
      { perk_item_zh: '月饼' },
      { perk_item_en: 'mooncake' },
    ]) {
      const r = await postPatch(one);
      assert.equal(r.status, 400, JSON.stringify(one));
      assert.deepEqual(await r.json(), {
        error: 'Enter the gift name in both languages, or neither.',
      });
    }
    assert.equal(patchBodies(fetch).length, patches);
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
