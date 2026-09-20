// The server half of "is this membership good today?" — functions/api/_lib.js.
// members.status is stored, not computed: the Stripe webhook writes it on a
// SUBSCRIPTION event and nothing else touches it, so a member who paid once
// keeps reading 'active' for ever. Every admin count and filter derives instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberIsActive, memberStatusFilter } from '../functions/api/_lib.js';

const NOW = '2026-09-20T21:02:11.539Z';

// The exact strings below were run against a real PostgREST before they were
// written down: on the same data 'active' lost a row and 'expired' gained it —
// a membership that had run out days earlier. Quoting the timestamp keeps its
// ':' and '.' out of the logic-tree grammar; a stray edit that drops the quotes
// or the parens comes back as a 400, so pin the shape.
test('memberStatusFilter: active means active AND not past its expiry', () => {
  assert.equal(
    memberStatusFilter('active', NOW),
    'and=(status.eq.active,or(expires_at.is.null,expires_at.gt."2026-09-20T21%3A02%3A11.539Z"))',
  );
});

test('memberStatusFilter: expired covers the stored ones and the lapsed ones', () => {
  assert.equal(
    memberStatusFilter('expired', NOW),
    'and=(or(status.eq.expired,and(status.eq.active,expires_at.lte."2026-09-20T21%3A02%3A11.539Z")))',
  );
});

// active + expired partition the rows they used to over/under-count, so the
// five head-counts still add up to the member total.
test('memberStatusFilter: every other status is stored truth', () => {
  for (const s of ['pending', 'past_due', 'cancelled'])
    assert.equal(memberStatusFilter(s, NOW), `status=eq.${s}`);
});

test('memberIsActive: one row, same rule', () => {
  const past = '2026-09-14T00:26:08Z';
  const future = '2027-09-14T00:26:08Z';
  assert.equal(memberIsActive({ status: 'active', expires_at: future }), true);
  assert.equal(memberIsActive({ status: 'active', expires_at: past }), false);
  // No expiry is a membership that does not lapse (the free tier).
  assert.equal(memberIsActive({ status: 'active', expires_at: null }), true);
  assert.equal(memberIsActive({ status: 'past_due', expires_at: future }), false);
  assert.equal(memberIsActive(null), false);
});
