import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/admin/news-template.js';
import { eventAnnouncement } from '../functions/api/_event-emails.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

const EV = '11111111-1111-4111-8111-111111111111';
const EVENT = {
  id: EV,
  slug: 'mid-autumn-festival',
  title: 'Mid-Autumn Festival 中秋节',
  title_zh: '中秋节',
  description: 'Mooncakes & lanterns',
  starts_at: '2099-09-27T19:00:00+00:00',
  ends_at: '2099-09-27T23:00:00+00:00',
  location: 'Siebel Center for Design',
  perk_deadline: null,
  perk_item_zh: '月饼',
  perk_item_en: 'mooncake',
  registration_questions: [],
  published: true,
};

function route({ admin = true, event = EVENT, eventsError } = {}) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: 'admin-1' } };
    if (u.includes('/rest/v1/members') && u.includes('is_admin'))
      return { body: [{ id: 'admin-1', is_admin: admin }] };
    if (u.includes('/rest/v1/events')) {
      if (eventsError) return eventsError;
      return { body: event && u.includes(`id=eq.${event.id}`) ? [event] : [] };
    }
    return { body: [] };
  };
}

const get = (
  query,
  { headers = { authorization: 'Bearer tok' }, origin = 'https://caaciorg.com' } = {},
) =>
  onRequestGet({
    request: fakeRequest({ url: `${origin}/api/admin/news-template${query}`, headers }),
    env: fakeEnv(),
  });
const eventReads = (fetch) => fetch.calls.filter((c) => c.url.includes('/rest/v1/events'));

test('news template: 401 without a token, 403 for a non-admin, with no event read', async () => {
  let fetch = mockFetch(route());
  try {
    assert.equal((await get(`?event_id=${EV}`, { headers: {} })).status, 401);
    assert.equal(eventReads(fetch).length, 0);
  } finally {
    fetch.restore();
  }
  fetch = mockFetch(route({ admin: false }));
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'Admin access required.' });
    assert.equal(eventReads(fetch).length, 0);
  } finally {
    fetch.restore();
  }
});

test('news template: event_id required; malformed or unknown event is 404', async () => {
  const fetch = mockFetch(route());
  try {
    const missing = await get('');
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: 'event_id required' });

    const malformed = await get('?event_id=not-a-uuid');
    assert.equal(malformed.status, 404);
    assert.equal(eventReads(fetch).length, 0, 'a malformed id never reaches PostgREST');

    const unknown = await get('?event_id=33333333-3333-4333-8333-333333333333');
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'Event not found.' });
  } finally {
    fetch.restore();
  }
});

test('news template: an event with no registration page to link to is refused with 409', async () => {
  for (const [event, error] of [
    [{ ...EVENT, published: false }, 'Publish this event before announcing it.'],
    [
      { ...EVENT, registration_questions: null },
      'Turn on registrations for this event before announcing it.',
    ],
  ]) {
    const fetch = mockFetch(route({ event }));
    try {
      const r = await get(`?event_id=${EV}`);
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { error });
    } finally {
      fetch.restore();
    }
  }
});

test('news template: 200 with the announcement subject and HTML, links from the request origin', async () => {
  const fetch = mockFetch(route());
  try {
    const r = await get(`?event_id=${EV}`, { origin: 'https://beta.caaciorg.com' });
    assert.equal(r.status, 200);
    const out = await r.json();
    assert.deepEqual(Object.keys(out).sort(), ['html', 'subject']);
    assert.deepEqual(
      out,
      eventAnnouncement({
        origin: 'https://beta.caaciorg.com',
        logo: 'https://db.example/storage/v1/object/public/media/email/caaci-logo.png',
        event: EVENT,
      }),
    );
    assert.equal(out.subject, '中秋节 · Mid-Autumn Festival 中秋节 报名开始 / Registration open');
    assert.match(
      out.html,
      /href="https:\/\/beta\.caaciorg\.com\/events\/mid-autumn-festival\/register\/"/,
    );
    assert.match(out.html, /Mooncakes &amp; lanterns/);
    assert.match(out.html, /免费领月饼/);

    const [read] = eventReads(fetch);
    assert.match(read.url, new RegExp(`id=eq\\.${EV}&limit=1$`));
    const columns = new URL(read.url).searchParams.get('select').split(',');
    for (const col of [
      'slug',
      'title_zh',
      'description',
      'perk_item_zh',
      'perk_item_en',
      'registration_questions',
      'published',
    ])
      assert.ok(columns.includes(col), col);
  } finally {
    fetch.restore();
  }
});

test('news template: a database error is a 500', async () => {
  const fetch = mockFetch(route({ eventsError: { status: 503, body: 'down' } }));
  try {
    const r = await get(`?event_id=${EV}`);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'supabase select events: 503 down' });
  } finally {
    fetch.restore();
  }
});
