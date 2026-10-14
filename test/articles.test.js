// /api/articles — the public column directory and article pages. Only
// published articles whose date has come are ever answered: drafts and
// scheduled ones are 404 and never listed. Run against the in-memory tables of
// content-fake-db.js, which evaluates the published filter the way PostgREST does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/articles.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';
import { contentDb, seedContent, daysAgo, COL_A, ART_A, DRAFT_A } from './content-fake-db.js';

const get = (qs) =>
  onRequestGet({
    request: fakeRequest({ url: `https://caaci.example/api/articles${qs}` }),
    env: fakeEnv(),
  });

async function withDb(seed, fn) {
  const db = contentDb(seed);
  const fetch = mockFetch(db.route);
  try {
    return await fn(db, fetch);
  } finally {
    fetch.restore();
  }
}

// Three more in column A: an older one, a newer one, a scheduled one.
function richSeed() {
  const seed = seedContent();
  const base = seed.articles[0];
  seed.articles.push(
    {
      ...base,
      id: 'd0000000-0000-4000-8000-000000000001',
      slug: 'older',
      title_en: 'Older',
      published_at: daysAgo(9),
    },
    {
      ...base,
      id: 'd0000000-0000-4000-8000-000000000002',
      slug: 'newer',
      title_en: 'Newer',
      published_at: daysAgo(1),
    },
    {
      ...base,
      id: 'd0000000-0000-4000-8000-000000000003',
      slug: 'scheduled',
      title_en: 'Later',
      published_at: daysAgo(-3),
    },
    {
      ...base,
      id: 'd0000000-0000-4000-8000-000000000004',
      slug: 'pinned-old',
      title_en: 'Pinned',
      published_at: daysAgo(20),
      pinned: true,
    },
  );
  return seed;
}

test('list: published only, pinned first then newest, without bodies, cacheable', async () => {
  await withDb(richSeed(), async () => {
    const r = await get('?column=news');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    const data = await r.json();
    assert.deepEqual(
      data.rows.map((a) => a.slug),
      ['pinned-old', 'newer', 'spring-gala', 'older'],
    );
    assert.equal(data.total, 4);
    for (const row of data.rows) {
      assert.equal(row.body_en, undefined, 'list rows carry no body');
      assert.equal(row.status, undefined);
    }
    assert.deepEqual(
      data.columns.map((c) => c.slug),
      ['news', 'community'],
    );
  });
});

test('list: no column lists every column; an unknown column lists nothing', async () => {
  await withDb(richSeed(), async () => {
    const all = await (await get('')).json();
    assert.equal(all.total, 5);
    assert.ok(all.rows.some((a) => a.slug === 'river-walk'));
    assert.ok(!all.rows.some((a) => a.slug === 'unfinished' || a.slug === 'scheduled'));

    const none = await get('?column=nope');
    assert.equal(none.status, 200);
    const data = await none.json();
    assert.deepEqual(data.rows, []);
    assert.equal(data.total, 0);
    assert.equal(data.columns.length, 2);
  });
});

test('list: limit and offset page through', async () => {
  await withDb(richSeed(), async () => {
    const data = await (await get('?column=news&limit=2&offset=2')).json();
    assert.deepEqual(
      data.rows.map((a) => a.slug),
      ['spring-gala', 'older'],
    );
    assert.equal(data.total, 4);
  });
});

test('one article: the body, its column, and older/newer neighbours in the same column', async () => {
  await withDb(richSeed(), async () => {
    const r = await get('?slug=spring-gala');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    const data = await r.json();
    assert.equal(data.article.id, ART_A);
    assert.equal(data.article.body_en, '<p>Gala body</p>');
    assert.equal(data.article.created_by, undefined, 'who wrote it internally is not public');
    assert.equal(data.column.id, COL_A);
    assert.equal(data.prev.slug, 'older');
    assert.equal(data.next.slug, 'newer', 'the scheduled one is not "next" yet');
    assert.equal(data.next.body_en, undefined);
  });
});

test('one article: the newest has no next, the oldest no prev', async () => {
  await withDb(richSeed(), async () => {
    const newest = await (await get('?slug=newer')).json();
    assert.equal(newest.next, null);
    const oldest = await (await get('?slug=pinned-old')).json();
    assert.equal(oldest.prev, null);
  });
});

test('one article: a draft, a scheduled article, a bad slug or no such slug is 404', async () => {
  await withDb(richSeed(), async (db) => {
    assert.ok(db.tables.articles.some((a) => a.id === DRAFT_A));
    for (const slug of ['unfinished', 'scheduled', 'no-such-thing', 'Bad%20Slug', '']) {
      const r = await get(`?slug=${slug}`);
      assert.equal(r.status, 404, slug);
    }
  });
});

test('the published filter is sent as a quoted timestamp in a logic tree', async () => {
  await withDb(seedContent(), async (_db, fetch) => {
    await get('?slug=spring-gala');
    const call = fetch.calls.find((c) => c.url.includes('/rest/v1/articles'));
    assert.match(call.url, /and=\(status\.eq\.published,published_at\.lte\."[^"]+"\)/);
  });
});

test('a database failure is a 500, not an empty page', async () => {
  const fetch = mockFetch(() => ({ status: 500, body: { message: 'down' } }));
  try {
    const r = await get('?column=news');
    assert.equal(r.status, 500);
  } finally {
    fetch.restore();
  }
});
