import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEBHOOK_EVENTS,
  DEFAULT_ACCOUNT,
  endpointDrift,
  keyMode,
  parseArgs,
  webhookUrl,
  main,
} from '../stripe-connect.mjs';
import { mockFetch } from './helpers.js';

// Silence the script's progress output; keep the last run's lines for asserts.
function quiet(fn) {
  const lines = [];
  const { log, warn, error } = console;
  const capture =
    (kind) =>
    (...args) =>
      lines.push(`${kind}: ${args.join(' ')}`);
  console.log = capture('log');
  console.warn = capture('warn');
  console.error = capture('err');
  return Promise.resolve()
    .then(fn)
    .then(
      (value) => ({ value, lines }),
      (err) => {
        throw err;
      },
    )
    .finally(() => {
      Object.assign(console, { log, warn, error });
    });
}

// Stripe stand-in. `endpoints` seeds the list; POSTs are recorded on `.posted`.
function stripeRoute({ account = DEFAULT_ACCOUNT, endpoints = [], configs = [] } = {}) {
  const posted = [];
  const handler = (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.endsWith('/v1/account'))
      return { body: { id: account, charges_enabled: true, payouts_enabled: true } };
    if (url.includes('webhook_endpoints')) {
      if (method === 'POST') {
        posted.push(url);
        return { body: { id: 'we_new', secret: 'whsec_generated' } };
      }
      return { body: { data: endpoints } };
    }
    if (url.includes('billing_portal/configurations')) {
      if (method === 'POST') {
        posted.push(url);
        return { body: { id: 'bpc_new', is_default: true } };
      }
      return { body: { data: configs } };
    }
    return {};
  };
  handler.posted = posted;
  return handler;
}

const healthy = { id: 'we_1', status: 'enabled', enabled_events: WEBHOOK_EVENTS };

test('webhookUrl trims trailing slashes off the site origin', () => {
  assert.equal(
    webhookUrl('https://caaci.pages.dev/'),
    'https://caaci.pages.dev/api/stripe-webhook',
  );
});

test('keyMode reads live/test off the key prefix', () => {
  assert.equal(keyMode('sk_live_abc'), 'live');
  assert.equal(keyMode('rk_test_abc'), 'test');
  assert.equal(keyMode('nonsense'), 'unknown');
});

test('endpointDrift: a fully subscribed enabled endpoint is ok', () => {
  const drift = endpointDrift(healthy);
  assert.deepEqual(drift, { missing: [], extra: [], disabled: false, ok: true });
});

test('endpointDrift: missing events and a disabled endpoint are both flagged', () => {
  const drift = endpointDrift({
    status: 'disabled',
    enabled_events: ['checkout.session.completed', 'charge.refunded'],
  });
  assert.deepEqual(drift.missing, [
    'invoice.paid',
    'invoice.payment_failed',
    'customer.subscription.deleted',
  ]);
  assert.deepEqual(drift.extra, ['charge.refunded']);
  assert.equal(drift.disabled, true);
  assert.equal(drift.ok, false);
});

test('endpointDrift: a wildcard subscription covers every event we need', () => {
  assert.equal(endpointDrift({ status: 'enabled', enabled_events: ['*'] }).ok, true);
});

test('parseArgs rejects an unknown flag rather than silently ignoring it', () => {
  assert.throws(() => parseArgs(['--aply']), /unknown option: --aply/);
});

test('main: a key for the wrong account changes nothing', async () => {
  const route = stripeRoute({ account: 'acct_someoneelse' });
  const fetch = mockFetch(route);
  try {
    const { value, lines } = await quiet(() =>
      main(['--apply'], { STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    assert.equal(value, 1);
    assert.deepEqual(route.posted, []);
    assert.ok(lines.some((l) => l.includes('acct_someoneelse')));
  } finally {
    fetch.restore();
  }
});

test('main: without --apply it reports gaps but writes nothing', async () => {
  const route = stripeRoute();
  const fetch = mockFetch(route);
  try {
    const { value, lines } = await quiet(() => main([], { STRIPE_SECRET_KEY: 'sk_test_x' }));
    assert.equal(value, 0);
    assert.deepEqual(route.posted, []);
    assert.ok(lines.some((l) => l.includes('rerun with --apply to create it')));
  } finally {
    fetch.restore();
  }
});

test('main --apply: creates the endpoint and saves the signing secret', async () => {
  const envFile = join(await mkdtemp(join(tmpdir(), 'caaci-')), '.env');
  const route = stripeRoute();
  const fetch = mockFetch(route);
  try {
    const { value } = await quiet(() =>
      main([`--env-file=${envFile}`, '--apply'], { STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    assert.equal(value, 0);
    assert.equal(route.posted.length, 2); // webhook endpoint + portal configuration
    assert.match(await readFile(envFile, 'utf8'), /^STRIPE_WEBHOOK_SECRET=whsec_generated$/m);
  } finally {
    fetch.restore();
  }
});

test('main --apply: an already-healthy account is left untouched', async () => {
  const route = stripeRoute({
    endpoints: [{ ...healthy, url: 'https://caaci.pages.dev/api/stripe-webhook' }],
    configs: [{ id: 'bpc_1', active: true, is_default: true }],
  });
  const fetch = mockFetch(route);
  try {
    const { value, lines } = await quiet(() =>
      main(['--apply'], { STRIPE_SECRET_KEY: 'sk_live_x' }),
    );
    assert.equal(value, 0);
    assert.deepEqual(route.posted, []);
    assert.ok(lines.some((l) => l.includes('we_1') && l.includes('✓')));
  } finally {
    fetch.restore();
  }
});

test('main --apply: repairs an endpoint that is missing events', async () => {
  const route = stripeRoute({
    endpoints: [
      {
        id: 'we_2',
        url: 'https://caaci.pages.dev/api/stripe-webhook',
        status: 'enabled',
        enabled_events: ['checkout.session.completed'],
      },
    ],
    configs: [{ id: 'bpc_1', active: true, is_default: true }],
  });
  const fetch = mockFetch(route);
  try {
    const { value } = await quiet(() => main(['--apply'], { STRIPE_SECRET_KEY: 'sk_live_x' }));
    assert.equal(value, 0);
    assert.deepEqual(route.posted, ['https://api.stripe.com/v1/webhook_endpoints/we_2']);
    const repair = fetch.calls.find((c) => c.options.method === 'POST');
    const body = repair.options.body.toString();
    for (const event of WEBHOOK_EVENTS) assert.ok(body.includes(encodeURIComponent(event)));
  } finally {
    fetch.restore();
  }
});

test('main: a missing key is an error, not a crash', async () => {
  const { value } = await quiet(() => main([], {}));
  assert.equal(value, 1);
});
