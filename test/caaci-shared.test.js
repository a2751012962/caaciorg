// Helpers shared by both client layers (src/caaci-shared.js). These used to be
// pinned through caaci-app.js's re-exports; the member pages are their only
// remaining consumer for money math, so they are tested at the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, usd, withFee, mergeTiers, isFreeTier, TIERS_FALLBACK } from '../src/caaci-shared.js';

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
