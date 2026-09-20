// Helpers shared by both client layers (src/caaci-shared.js). These used to be
// pinned through caaci-app.js's re-exports; the member pages are their only
// remaining consumer for money math, so they are tested at the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  usd,
  withFee,
  mergeTiers,
  isFreeTier,
  statusLabel,
  effectiveStatus,
  TIERS_FALLBACK,
  COOLDOWN_PREFIX,
  cooldownKey,
  clearCooldowns,
} from '../src/caaci-shared.js';

// A localStorage stand-in with the parts clearCooldowns uses.
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

// The keys outlive the visit, so a shared machine must not be able to read a
// member's mobile number, email address or account id back out of one.
test('cooldownKey: the recipient is digested, never written into the key', () => {
  for (const recipient of [
    '+12175550123',
    'mei@example.com',
    '8f14e45f-ceea-467a-9575-2b4c0e9b1b7f',
  ]) {
    const key = cooldownKey('sms', recipient);
    assert.ok(key.startsWith(COOLDOWN_PREFIX + 'sms:'), key);
    assert.doesNotMatch(key, /@|\+|2175550123|8f14e45f/, key);
    // Still usable as a key: same recipient, same key; different, different.
    assert.equal(key, cooldownKey('sms', recipient));
    assert.notEqual(key, cooldownKey('sms', recipient + '4'));
    assert.notEqual(key, cooldownKey('email_change', recipient));
  }
  // Spelling of the same address does not start a second countdown.
  assert.equal(
    cooldownKey('reauth', ' Mei@Example.com '),
    cooldownKey('reauth', 'mei@example.com'),
  );
  assert.equal(cooldownKey('sms', null), cooldownKey('sms', ''));
});

test('clearCooldowns: drops every countdown, including the old plaintext keys, and nothing else', () => {
  const store = fakeStorage({
    [cooldownKey('sms', '+12175550123')]: '1',
    [cooldownKey('reauth', 'mei@example.com')]: '2',
    'caaci-cooldown:sms:+12175550123': '3', // written before the digest
    'caaci-lang': 'zh',
    'caaci-login-method': 'phone',
    'sb-wslzeq-auth-token': '{}',
  });
  clearCooldowns(store);
  assert.deepEqual(store.keys(), ['caaci-lang', 'caaci-login-method', 'sb-wslzeq-auth-token']);
});

test('clearCooldowns: storage that is missing or blocked is not an error', () => {
  assert.doesNotThrow(() => clearCooldowns(null));
  assert.doesNotThrow(() =>
    clearCooldowns({
      get length() {
        throw new Error('blocked');
      },
    }),
  );
});

test('isFreeTier: the self-serve $0 tier, but not the invitation-only Honorable tier', () => {
  assert.equal(isFreeTier({ id: 'free', price_cents: 0 }), true);
  assert.equal(isFreeTier({ id: 'honorary', price_cents: 0, invite_only: true }), false);
  assert.equal(isFreeTier({ id: 'student', price_cents: 1000 }), false);
  assert.equal(isFreeTier(undefined), false);
});

test('mergeTiers: free leads, paid tiers by price, Honorable last', () => {
  const ids = mergeTiers(null).map((t) => t.id);
  assert.deepEqual(ids, ['free', 'student', 'individual', 'family', 'business', 'honorary']);
  // live rows override the fallback in place; the free tier stays free
  const live = mergeTiers([{ id: 'free', name: 'Free', price_cents: 0, invite_only: false }]);
  assert.equal(live[0].name, 'Free');
  assert.equal(isFreeTier(live[0]), true);
  assert.equal(TIERS_FALLBACK.filter(isFreeTier).length, 1);
});

test('tiers carry Chinese text that survives a live (English-only) row override', () => {
  for (const tier of TIERS_FALLBACK)
    for (const key of ['name', 'description', 'highlight'])
      assert.ok(tier[`${key}_zh`], `${tier.id}.${key}_zh`);
  const [student] = mergeTiers([
    { id: 'student', name: 'Student', price_cents: 1000, description: '$10 per year.' },
  ]).filter((t) => t.id === 'student');
  assert.equal(student.description, '$10 per year.');
  assert.equal(student.description_zh, TIERS_FALLBACK[1].description_zh);
  assert.deepEqual(student.features, []); // no lines saved → the page keeps its built-in copy
});

test('mergeTiers: copy saved in the admin Plans tab comes through', () => {
  const [family] = mergeTiers([
    {
      id: 'family',
      name: 'Family',
      price_cents: 8000,
      description_zh: '全家共享。',
      features: ['Up to 3 people'],
      features_zh: ['最多 3 人'],
    },
  ]).filter((t) => t.id === 'family');
  assert.equal(family.price_cents, 8000);
  assert.equal(family.description_zh, '全家共享。');
  assert.deepEqual(family.features, ['Up to 3 people']);
  assert.deepEqual(family.features_zh, ['最多 3 人']);
});

test('statusLabel: one language at a time, raw status when unknown', () => {
  assert.equal(statusLabel('active', 'en'), 'Active');
  assert.equal(statusLabel('active', 'zh'), '有效');
  assert.equal(statusLabel('weird', 'zh'), 'weird');
  assert.equal(statusLabel(undefined, 'zh'), undefined);
});

// The defect this rule exists for: a member imported from MemberPress with a
// one-time payment has no Stripe subscription, so no webhook event ever moves
// their row off 'active' — it read Active for a week after the year ran out.
test('effectiveStatus: an active row past its expiry reads as expired', () => {
  const now = Date.parse('2026-09-20T20:00:00Z');
  assert.equal(effectiveStatus('active', '2026-09-14T00:26:08Z', now), 'expired');
  assert.equal(effectiveStatus('active', '2027-09-14T00:26:08Z', now), 'active');
  // The boundary belongs to the past: at the expiry instant the year is over.
  assert.equal(effectiveStatus('active', '2026-09-20T20:00:00Z', now), 'expired');
});

test('effectiveStatus: leaves everything it cannot improve alone', () => {
  const now = Date.parse('2026-09-20T20:00:00Z');
  // No expiry (the free tier) never lapses.
  assert.equal(effectiveStatus('active', null, now), 'active');
  // Other statuses are stored truth — they already read as "not good".
  for (const s of ['pending', 'past_due', 'expired', 'cancelled'])
    assert.equal(effectiveStatus(s, '2020-01-01T00:00:00Z', now), s);
  // An unparseable date must not silently expire a paid-up member.
  assert.equal(effectiveStatus('active', 'not a date', now), 'active');
  assert.equal(effectiveStatus(null, '2020-01-01T00:00:00Z', now), null);
});

test('usd / withFee format prices and apply the 3.5% card surcharge', () => {
  assert.equal(usd(3000), '$30.00');
  assert.equal(withFee(3000), 3105); // $31.05 — matches the live site
  assert.equal(usd(withFee(10000)), '$103.50');
});

test('esc() neutralises HTML in user-supplied strings', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('a & "b"'), 'a &amp; &quot;b&quot;');
  assert.equal(esc(null), '');
});
