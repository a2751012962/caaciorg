// Helpers shared by both client layers (src/caaci-shared.js). These used to be
// pinned through caaci-app.js's re-exports; the member pages are their only
// remaining consumer for money math, so they are tested at the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, usd, withFee } from '../src/caaci-shared.js';

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
