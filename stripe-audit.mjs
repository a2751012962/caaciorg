// stripe-audit.mjs — READ-ONLY inventory of one Stripe mode.
//
// Answers "what is already in this account that the new site must not break?"
// before repointing webhooks at caaci.pages.dev. Every request is a GET; the
// script has no code path that writes, so it is safe to run against live mode.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_… node stripe-audit.mjs
//   STRIPE_SECRET_KEY=sk_live_… node stripe-audit.mjs --csv=subscribers.csv
//
// The default output is aggregate only — no emails, no ids of individuals — so
// it is safe to paste into a chat or a ticket. `--csv` writes the per-subscriber
// roster needed for the migration to a local file instead of printing it.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function keyMode(key) {
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

// GET-only client. There is deliberately no post()/delete() here: an audit that
// cannot write is one you can run against production without reading the code.
function api(key) {
  return async function get(path) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
}

// Walk a Stripe list endpoint to the end. `cap` bounds a runaway account.
export async function listAll(get, path, { cap = 5000 } = {}) {
  const out = [];
  let startingAfter = null;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await get(
      `${path}${sep}limit=100${startingAfter ? `&starting_after=${startingAfter}` : ''}`,
    );
    out.push(...(page.data || []));
    if (!page.has_more || out.length >= cap) return out;
    startingAfter = out[out.length - 1].id;
  }
}

export const money = (cents, currency = 'usd') =>
  cents === null || cents === undefined
    ? '—'
    : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

const day = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '—');

// One line per distinct price across the subscription set, so you can see which
// MemberPress plans still have people on them.
export function groupByPrice(subscriptions) {
  const groups = new Map();
  for (const sub of subscriptions) {
    for (const item of sub.items?.data || []) {
      const price = item.price || {};
      const key = price.id || '(no price)';
      const group = groups.get(key) || {
        priceId: key,
        productId: typeof price.product === 'string' ? price.product : price.product?.id,
        amount: price.unit_amount,
        currency: price.currency || 'usd',
        interval: price.recurring?.interval || 'one-off',
        statuses: {},
        total: 0,
      };
      group.statuses[sub.status] = (group.statuses[sub.status] || 0) + 1;
      group.total += 1;
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

// Subscriptions that are still generating money (or about to fail loudly).
export const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];
export const isLive = (sub) => LIVE_STATUSES.includes(sub.status);

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function subscribersCsv(subscriptions) {
  const header = [
    'stripe_customer_id',
    'stripe_subscription_id',
    'email',
    'name',
    'status',
    'price_id',
    'amount_cents',
    'currency',
    'interval',
    'current_period_end',
    'cancel_at_period_end',
    'created',
  ];
  const rows = subscriptions.map((sub) => {
    const customer = typeof sub.customer === 'object' ? sub.customer : {};
    const item = sub.items?.data?.[0] || {};
    const price = item.price || {};
    // The period moved onto the subscription item in newer API versions.
    const periodEnd = sub.current_period_end ?? item.current_period_end;
    return [
      typeof sub.customer === 'string' ? sub.customer : customer.id,
      sub.id,
      customer.email,
      customer.name,
      sub.status,
      price.id,
      price.unit_amount,
      price.currency,
      price.recurring?.interval,
      day(periodEnd),
      sub.cancel_at_period_end,
      day(sub.created),
    ].map(csvEscape);
  });
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let csvPath = null;
  for (const arg of argv) {
    if (arg.startsWith('--csv=')) csvPath = arg.slice('--csv='.length);
    else throw new Error(`unknown option: ${arg}`);
  }
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Missing STRIPE_SECRET_KEY. Run:');
    console.error('  STRIPE_SECRET_KEY=sk_… node stripe-audit.mjs [--csv=subscribers.csv]');
    return 1;
  }
  const get = api(key);

  const account = await get('account');
  console.log(`Account: ${account.id}  mode=${keyMode(key).toUpperCase()}`);
  console.log(
    `  charges=${account.charges_enabled ? 'on' : 'OFF'} payouts=${
      account.payouts_enabled ? 'on' : 'OFF'
    } currency=${(account.default_currency || '?').toUpperCase()}`,
  );

  // --- Webhooks: who is being told about payments today ---------------------
  const endpoints = await listAll(get, 'webhook_endpoints');
  console.log(`\nWebhook endpoints (${endpoints.length}) — anything live here is load-bearing:`);
  for (const e of endpoints) {
    console.log(`  ${e.status.padEnd(8)} ${e.url}`);
    console.log(`           ${e.enabled_events.length} events, created ${day(e.created)}`);
  }

  // --- Catalogue: MemberPress/WooCommerce created these; the new site does not
  //     use them (inline price_data), but existing subscriptions point at them.
  const prices = await listAll(get, 'prices?active=true');
  const products = await listAll(get, 'products?active=true');
  const productName = new Map(products.map((p) => [p.id, p.name]));
  console.log(`\nActive products: ${products.length}   active prices: ${prices.length}`);

  // --- Subscriptions: the thing that actually has to survive the cutover -----
  const subs = await listAll(get, 'subscriptions?status=all&expand[]=data.customer');
  const live = subs.filter(isLive);
  console.log(`\nSubscriptions: ${subs.length} total, ${live.length} still billing`);
  const byStatus = {};
  for (const s of subs) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${status}`);

  if (subs.length) {
    console.log('\nBy price (what people are actually paying):');
    for (const g of groupByPrice(subs)) {
      const name = productName.get(g.productId) || g.productId || '?';
      const breakdown = Object.entries(g.statuses)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ');
      console.log(
        `  ${money(g.amount, g.currency)}/${g.interval}  ${name}  —  ${breakdown}  [${g.priceId}]`,
      );
    }
    const renewals = live
      .map((s) => s.current_period_end ?? s.items?.data?.[0]?.current_period_end)
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (renewals.length)
      console.log(
        `\nNext renewal ${day(renewals[0])}, last ${day(renewals[renewals.length - 1])} — ` +
          'the webhook must be live before the earliest one.',
      );
  }

  const customers = await listAll(get, 'customers');
  console.log(`\nCustomers: ${customers.length}`);

  // --- Discounts and portal config: settings, not data, but easy to lose -----
  const coupons = await listAll(get, 'coupons');
  const promos = await listAll(get, 'promotion_codes');
  console.log(`Coupons: ${coupons.length}   promotion codes: ${promos.length}`);
  for (const p of promos.filter((p) => p.active))
    console.log(`  ${p.code} → ${p.coupon?.percent_off ?? p.coupon?.amount_off ?? '?'} off`);

  const portal = await listAll(get, 'billing_portal/configurations');
  const dflt = portal.find((c) => c.is_default && c.active);
  console.log(
    `Billing portal configurations: ${portal.length}` +
      (dflt ? ` (default ${dflt.id})` : ' — NO ACTIVE DEFAULT, /api/portal will fail'),
  );

  if (csvPath) {
    await writeFile(csvPath, subscribersCsv(subs));
    console.log(`\n✓ Wrote ${subs.length} subscriber rows to ${csvPath} (not printed — has PII)`);
  } else if (subs.length) {
    console.log('\nRerun with --csv=subscribers.csv to export the roster for the migration.');
  }
  return 0;
}

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
