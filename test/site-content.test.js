// Page-copy overrides: the public /api/site-content the site loads at boot,
// and /api/admin/site-content behind the Page content tab (administrators and
// editors with can_edit_pages). null clears a language; a key with neither
// language left is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as publicGet } from '../functions/api/site-content.js';
import { onRequestGet, onRequestPut } from '../functions/api/admin/site-content.js';
import { fakeRequest, mockFetch, fakeEnv, asUser } from './helpers.js';
import {
  contentDb,
  seedContent,
  ADMIN,
  EDITOR_A,
  EDITOR_ALL,
  PAGES,
  STRANGER,
} from './content-fake-db.js';

const call = (handler, who, body) =>
  handler({
    request: fakeRequest({
      url: 'https://caaci.example/api/admin/site-content',
      headers: who ? asUser(who) : {},
      body,
    }),
    env: fakeEnv(),
  });

function seeded() {
  const seed = seedContent();
  seed.site_content = [
    {
      key: 'about.missionText',
      value_en: 'Our mission',
      value_zh: '我们的使命',
      updated_by: PAGES,
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      key: 'about.team',
      value_en: [{ name: 'Ann' }],
      value_zh: null,
      updated_by: null,
      updated_at: '2026-10-02T00:00:00.000Z',
    },
  ];
  return seed;
}

async function withDb(fn, seed = seeded()) {
  const db = contentDb(seed);
  const fetch = mockFetch(db.route);
  try {
    return await fn(db, fetch);
  } finally {
    fetch.restore();
  }
}
const stored = (db, key) => db.tables.site_content.find((r) => r.key === key);

test('public: only the languages that are set, cacheable', async () => {
  await withDb(async () => {
    const r = await publicGet({ request: fakeRequest(), env: fakeEnv() });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    assert.deepEqual(await r.json(), {
      overrides: {
        'about.missionText': { en: 'Our mission', zh: '我们的使命' },
        'about.team': { en: [{ name: 'Ann' }] },
      },
    });
  });
});

test('admin: no token 401; a member, or an editor without page access, 403', async () => {
  await withDb(async () => {
    assert.equal((await call(onRequestGet, null)).status, 401);
    for (const who of [STRANGER, EDITOR_A, EDITOR_ALL]) {
      const r = await call(onRequestGet, who);
      assert.equal(r.status, 403, who);
      assert.equal(
        (await call(onRequestPut, who, { changes: [{ key: 'a.b', en: 'x' }] })).status,
        403,
      );
    }
  });
});

test('admin: rows with the name of whoever saved them last', async () => {
  await withDb(async () => {
    const r = await call(onRequestGet, PAGES);
    assert.equal(r.status, 200);
    const { rows } = await r.json();
    assert.deepEqual(
      rows.map((x) => [x.key, x.updated_by_name]),
      [
        ['about.missionText', 'Paige Pages'],
        ['about.team', ''],
      ],
    );
    assert.deepEqual(rows[1].value_en, [{ name: 'Ann' }]);
    assert.equal(rows[1].value_zh, null);
  });
});

test('save: adds, changes one language, leaves the other, and stamps the editor', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPut, PAGES, {
      changes: [
        { key: 'common.hero.title', en: 'Welcome' },
        { key: 'about.missionText', zh: '新的使命' },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, saved: 2, deleted: 0 });
    const hero = stored(db, 'common.hero.title');
    assert.deepEqual([hero.value_en, hero.value_zh, hero.updated_by], ['Welcome', null, PAGES]);
    const mission = stored(db, 'about.missionText');
    assert.deepEqual([mission.value_en, mission.value_zh], ['Our mission', '新的使命']);
  });
});

test('save: null clears a language, and a key left with neither is deleted', async () => {
  await withDb(async (db) => {
    const r = await call(onRequestPut, ADMIN, {
      changes: [
        { key: 'about.missionText', en: null },
        { key: 'about.team', en: null },
        { key: 'never.existed', en: null, zh: null },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, saved: 1, deleted: 1 });
    const mission = stored(db, 'about.missionText');
    assert.deepEqual([mission.value_en, mission.value_zh], [null, '我们的使命']);
    assert.equal(stored(db, 'about.team'), undefined, 'both languages null → row deleted');
    assert.equal(stored(db, 'never.existed'), undefined);
  });
});

test('save: repeats of one key merge in order', async () => {
  await withDb(async (db) => {
    await call(onRequestPut, PAGES, {
      changes: [
        { key: 'x.y', en: 'first', zh: '一' },
        { key: 'x.y', en: 'second' },
      ],
    });
    const row = stored(db, 'x.y');
    assert.deepEqual([row.value_en, row.value_zh], ['second', '一']);
  });
});

test('save: refuses bad keys, too many changes, oversized values — and writes nothing', async () => {
  await withDb(async (db) => {
    const before = structuredClone(db.tables.site_content);
    const refused = async (body, pattern) => {
      const r = await call(onRequestPut, ADMIN, body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      if (pattern) assert.match((await r.json()).error, pattern);
    };
    await refused(
      {
        changes: [
          { key: 'ok.key', en: 'x' },
          { key: 'bad key!', en: 'x' },
        ],
      },
      /valid content key/,
    );
    await refused({ changes: [{ key: '', en: 'x' }] });
    await refused({ changes: [{ key: 'a/b', en: 'x' }] });
    await refused({ changes: [{ key: 'k'.repeat(201), en: 'x' }] });
    await refused({ changes: [] });
    await refused({ changes: 'nope' });
    await refused('not json');
    await refused(
      { changes: Array.from({ length: 501 }, (_, i) => ({ key: `k.${i}`, en: 'x' })) },
      /500/,
    );
    await refused({ changes: [{ key: 'big', en: 'x'.repeat(100 * 1024) }] }, /100 KB/);
    assert.deepEqual(db.tables.site_content, before);
  });
});

test('save: 500 changes at once are fine, and lookups are split into short URLs', async () => {
  await withDb(async (db, fetch) => {
    const changes = Array.from({ length: 500 }, (_, i) => ({ key: `bulk.item${i}`, en: `v${i}` }));
    const r = await call(onRequestPut, PAGES, { changes });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).saved, 500);
    assert.equal(db.tables.site_content.length, 502);
    const lookups = fetch.calls.filter(
      (c) => c.url.includes('/rest/v1/site_content') && (c.options.method || 'GET') === 'GET',
    );
    assert.equal(lookups.length, 5);
    assert.ok(fetch.calls.length < 50, 'stays inside the Workers subrequest limit');
  });
});
