// stripe-reconcile.mjs — the comparison itself, with no Stripe and no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftCsv, maskEmail, reconcile } from '../stripe-reconcile.mjs';

const NOW = Date.parse('2026-09-20T21:00:00Z');
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString();
const unix = (isoDate) => Math.floor(Date.parse(isoDate) / 1000);

const sub = (id, status, customer, periodEnd, email = 'x@example.com') => ({
  id,
  status,
  customer: { id: customer, email },
  current_period_end: unix(periodEnd),
});

// The case that started this: GUANGYAO's row, imported the day before it ran
// out, no subscription behind it, still reading Active a week later.
test('reconcile: an active row past its expiry with no subscription is the top finding', () => {
  const { findings, counts } = reconcile(
    [
      {
        id: 'm1',
        email: 'lapsed@example.com',
        tier_id: 'individual',
        status: 'active',
        expires_at: inDays(-6),
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: null,
      },
    ],
    [],
    { now: NOW },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'lapsed');
  assert.equal(findings[0].days, 6);
  assert.equal(counts.active, 1);
  assert.equal(counts.with_subscription, 0);
});

test('reconcile: a live subscription keeps its member out of the findings', () => {
  const { findings, counts } = reconcile(
    [
      {
        id: 'm1',
        email: 'ok@example.com',
        tier_id: 'family',
        status: 'active',
        expires_at: inDays(29),
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
      },
    ],
    [sub('sub_1', 'active', 'cus_1', inDays(29))],
    { now: NOW },
  );
  assert.deepEqual(findings, []);
  assert.equal(counts.with_subscription, 1);
  assert.equal(counts.no_renewal, 0);
});

test('reconcile: a cancelled subscription behind an Active row is sub_gone', () => {
  const { findings } = reconcile(
    [
      {
        id: 'm1',
        email: 'gone@example.com',
        tier_id: 'individual',
        status: 'active',
        expires_at: inDays(200),
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
      },
    ],
    [sub('sub_1', 'canceled', 'cus_1', inDays(-30))],
    { now: NOW },
  );
  assert.equal(findings[0].kind, 'sub_gone');
});

// The expiry is still ahead, so 'lapsed' must not fire — the subscription is
// the problem, and the money is going out without the membership following.
test('reconcile: Stripe billing someone the site does not count is not_active', () => {
  const { findings } = reconcile(
    [
      {
        id: 'm1',
        email: 'paying@example.com',
        tier_id: 'individual',
        status: 'cancelled',
        expires_at: inDays(-3),
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
      },
    ],
    [sub('sub_1', 'active', 'cus_1', inDays(300))],
    { now: NOW },
  );
  assert.equal(findings[0].kind, 'not_active');
});

test('reconcile: dates more than two days apart are drift, a few hours are not', () => {
  const member = (expires) => ({
    id: 'm1',
    email: 'drift@example.com',
    tier_id: 'individual',
    status: 'active',
    expires_at: expires,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
  });
  const subs = [sub('sub_1', 'active', 'cus_1', inDays(100))];
  assert.equal(reconcile([member(inDays(100.1))], subs, { now: NOW }).findings.length, 0);
  assert.equal(reconcile([member(inDays(120))], subs, { now: NOW }).findings[0].kind, 'drift');
});

test('reconcile: a subscription with no members row at all is unknown_sub', () => {
  const { findings } = reconcile(
    [],
    [sub('sub_9', 'active', 'cus_9', inDays(10), 'who@example.com')],
    {
      now: NOW,
    },
  );
  assert.equal(findings[0].kind, 'unknown_sub');
  assert.equal(findings[0].email, 'who@example.com');
});

// Everyone who paid once is in this bucket; only the ones close to the edge are
// listed, so the report stays about what to do this month.
test('reconcile: no_renewal counts everyone, lists only those inside the window', () => {
  const m = (email, expires) => ({
    id: email,
    email,
    tier_id: 'individual',
    status: 'active',
    expires_at: expires,
    stripe_customer_id: 'cus_x',
    stripe_subscription_id: null,
  });
  const { findings, counts } = reconcile(
    [m('soon@x.com', inDays(20)), m('later@x.com', inDays(200))],
    [],
    {
      now: NOW,
      soonDays: 30,
    },
  );
  assert.equal(counts.no_renewal, 2);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'no_renewal');
  assert.equal(findings[0].email, 'soon@x.com');
  assert.equal(findings[0].days, 20);
});

// A membership with no expiry (the free tier) is not lapsed and not expiring.
test('reconcile: a membership with no expiry is left alone', () => {
  const { findings, counts } = reconcile(
    [
      {
        id: 'm1',
        email: 'free@example.com',
        tier_id: 'free',
        status: 'active',
        expires_at: null,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    ],
    [],
    { now: NOW },
  );
  assert.deepEqual(findings, []);
  assert.equal(counts.no_renewal, 1);
});

test('the console output masks addresses; only the CSV carries them', () => {
  assert.equal(maskEmail('guangyao@example.com'), 'gu******@example.com');
  assert.equal(maskEmail(''), '');
  const csv = driftCsv([{ kind: 'lapsed', email: 'real@example.com', days: 6 }]);
  assert.match(csv.split('\n')[0], /^kind,email,name,tier,db_status,db_expires/);
  assert.match(csv, /real@example\.com/);
});
