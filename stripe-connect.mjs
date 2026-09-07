// stripe-connect.mjs — wires this project to one specific Stripe account.
//
// Checkout uses inline `price_data`, so there is nothing to create in Stripe's
// product catalogue. "Connecting" is exactly three things:
//   1. a secret key belonging to the right account,
//   2. a webhook endpoint on /api/stripe-webhook subscribed to the four events
//      functions/api/stripe-webhook.js actually handles,
//   3. an active Billing Portal configuration, because /api/portal mints portal
//      sessions without naming one and Stripe then requires a default.
//
// Usage (reads the key from the environment; the key is never printed):
//   STRIPE_SECRET_KEY=sk_... node stripe-connect.mjs             # report only
//   STRIPE_SECRET_KEY=sk_... node stripe-connect.mjs --apply     # create/repair
//
// Options:
//   --site-url=<origin>   site the webhook should call (default https://caaci.pages.dev)
//   --account=<acct_...>  account the key must belong to; refuses to touch any other
//   --env-file=<path>     where to write STRIPE_WEBHOOK_SECRET on create (default .env)
//   --print-secret        also echo the new signing secret to stdout
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Exactly the events functions/api/stripe-webhook.js branches on. Subscribing to
// more just burns retries on events nobody reads.
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.deleted',
];

export const DEFAULT_SITE_URL = 'https://caaci.pages.dev';
export const DEFAULT_ACCOUNT = 'acct_1PfYMiJ3oYxWrRWD';

export const webhookUrl = (siteUrl) => `${siteUrl.replace(/\/+$/, '')}/api/stripe-webhook`;

// A key's mode is readable from its prefix; the account object has no livemode flag.
export function keyMode(key) {
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

// What (if anything) is wrong with an existing endpoint: wrong event set, or
// disabled by Stripe after too many failures.
export function endpointDrift(endpoint) {
  const have = new Set(endpoint.enabled_events || []);
  const missing = WEBHOOK_EVENTS.filter((e) => !have.has(e) && !have.has('*'));
  const extra = [...have].filter((e) => e !== '*' && !WEBHOOK_EVENTS.includes(e));
  const disabled = Boolean(endpoint.status && endpoint.status !== 'enabled');
  return { missing, extra, disabled, ok: missing.length === 0 && !disabled };
}

export function parseArgs(argv) {
  const opts = {
    apply: false,
    siteUrl: DEFAULT_SITE_URL,
    account: DEFAULT_ACCOUNT,
    envFile: '.env',
    printSecret: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--print-secret') opts.printSecret = true;
    else if (arg.startsWith('--site-url=')) opts.siteUrl = arg.slice('--site-url='.length);
    else if (arg.startsWith('--account=')) opts.account = arg.slice('--account='.length);
    else if (arg.startsWith('--env-file=')) opts.envFile = arg.slice('--env-file='.length);
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

// Same form-encoding shape as functions/api/_lib.js stripe(), kept standalone so
// this script has no runtime dependency on the Workers code.
function api(key) {
  const encode = (obj, prefix = '', body = new URLSearchParams()) => {
    for (const [k, v] of Object.entries(obj)) {
      const name = prefix ? `${prefix}[${k}]` : k;
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((item, i) => body.append(`${name}[${i}]`, String(item)));
      else if (typeof v === 'object') encode(v, name, body);
      else body.append(name, String(v));
    }
    return body;
  };
  const send = async (method, path, params) => {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(params ? { body: encode(params) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
  return { get: (p) => send('GET', p), post: (p, params) => send('POST', p, params) };
}

// Persist the signing secret next to the other local secrets instead of leaving
// it only in scrollback. Replaces the line if present, appends it otherwise.
async function saveWebhookSecret(path, secret) {
  let text = await readFile(path, 'utf8').catch(() => '');
  text = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(text)
    ? text.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET=${secret}`)
    : `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}STRIPE_WEBHOOK_SECRET=${secret}\n`;
  await writeFile(path, text);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Missing STRIPE_SECRET_KEY. Run:');
    console.error('  STRIPE_SECRET_KEY=sk_... node stripe-connect.mjs [--apply]');
    return 1;
  }
  const S = api(key);
  const mode = keyMode(key);
  const url = webhookUrl(opts.siteUrl);

  // 1. Account — refuse to touch anything if the key is for a different account.
  const account = await S.get('account');
  console.log(`Account:  ${account.id}  ${account.business_profile?.name || account.email || ''}`);
  console.log(`Key mode: ${mode.toUpperCase()}`);
  console.log(
    `Charges:  ${account.charges_enabled ? 'enabled' : 'DISABLED'}   ` +
      `Payouts: ${account.payouts_enabled ? 'enabled' : 'DISABLED'}   ` +
      `Currency: ${(account.default_currency || '?').toUpperCase()}`,
  );
  if (opts.account && account.id !== opts.account) {
    console.error(`\n✗ This key belongs to ${account.id}, not ${opts.account}. Nothing changed.`);
    return 1;
  }
  if (mode === 'live' && !account.charges_enabled) {
    console.warn('\n! Live charges are not enabled on this account — finish Stripe onboarding.');
  }

  // 2. Webhook endpoint.
  console.log(`\nWebhook target: ${url}`);
  const endpoints = (await S.get('webhook_endpoints?limit=100')).data || [];
  const mine = endpoints.filter((e) => e.url === url);
  const others = endpoints.filter((e) => e.url !== url);
  if (others.length)
    console.log(
      `  (${others.length} other endpoint${others.length > 1 ? 's' : ''} in this mode, left alone)`,
    );

  let created = null;
  if (mine.length === 0) {
    if (!opts.apply) {
      console.log('  ✗ no endpoint for this URL — rerun with --apply to create it');
    } else {
      created = await S.post('webhook_endpoints', {
        url,
        enabled_events: WEBHOOK_EVENTS,
        description: 'CAACI site — membership + donation lifecycle',
      });
      console.log(`  ✓ created ${created.id} with ${WEBHOOK_EVENTS.length} events`);
      await saveWebhookSecret(opts.envFile, created.secret);
      console.log(`  ✓ signing secret written to ${opts.envFile} (STRIPE_WEBHOOK_SECRET)`);
      if (opts.printSecret) console.log(`  secret: ${created.secret}`);
    }
  } else {
    for (const ep of mine) {
      const drift = endpointDrift(ep);
      if (drift.ok) {
        console.log(`  ✓ ${ep.id} enabled, all ${WEBHOOK_EVENTS.length} events subscribed`);
        if (drift.extra.length) console.log(`    (also subscribed to: ${drift.extra.join(', ')})`);
        continue;
      }
      const problems = [
        drift.disabled ? `status=${ep.status}` : null,
        drift.missing.length ? `missing: ${drift.missing.join(', ')}` : null,
      ].filter(Boolean);
      console.log(`  ✗ ${ep.id} — ${problems.join('; ')}`);
      if (!opts.apply) {
        console.log('    rerun with --apply to repair');
        continue;
      }
      await S.post(`webhook_endpoints/${ep.id}`, {
        enabled_events: [...new Set([...(ep.enabled_events || []), ...WEBHOOK_EVENTS])].filter(
          (e) => e !== '*',
        ),
        disabled: false,
      });
      console.log('    ✓ repaired (signing secret unchanged — keep the one already deployed)');
    }
  }

  // 3. Billing Portal — /api/portal creates sessions without a `configuration`,
  //    so Stripe falls back to the account default and errors if there is none.
  const configs = (await S.get('billing_portal/configurations?limit=100')).data || [];
  const active = configs.find((c) => c.is_default && c.active) || configs.find((c) => c.active);
  console.log('\nBilling portal:');
  if (active) {
    console.log(`  ✓ ${active.id}${active.is_default ? ' (default)' : ' (active, not default)'}`);
    if (!active.is_default)
      console.log('    ! /api/portal uses the account default — make this one the default');
  } else if (!opts.apply) {
    console.log('  ✗ no active configuration — rerun with --apply to create one');
  } else {
    const cfg = await S.post('billing_portal/configurations', {
      business_profile: { headline: 'CAACI — manage your membership' },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
      },
    });
    console.log(`  ✓ created ${cfg.id}${cfg.is_default ? ' (default)' : ''}`);
  }

  // 4. What still has to happen outside Stripe.
  console.log('\nNext — put the same values on Cloudflare Pages (secrets bind on next deploy):');
  console.log('  npx wrangler pages secret put STRIPE_SECRET_KEY     --project-name=caaci');
  console.log('  npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=caaci');
  console.log('  npm run deploy');
  if (created) console.log(`  (the new signing secret is in ${opts.envFile})`);
  return 0;
}

// Set exitCode and let Node wind down on its own — process.exit() while fetch's
// sockets are still closing trips a libuv assertion on Windows (and would mask
// the real exit code).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    },
  );
}
