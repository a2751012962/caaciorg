// stripe-catalog.mjs — give every membership tier a real Stripe Product + Price.
//
// Checkout used to mint an inline price on every purchase, so the Dashboard
// filled up with one ad-hoc product per payment and MRR was unreadable. This
// creates one Product per tier and one yearly Price per tier, tagged with a
// lookup_key (`caaci_<tier>_year`) that functions/api/_lib.js tierPrice()
// resolves at checkout time. No IDs are stored in the database, so the same
// code works in test and live mode — run this once per mode.
//
// Usage (STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from the
// environment or .env):
//   node stripe-catalog.mjs            # report: what exists, what would change
//   node stripe-catalog.mjs --apply    # create missing products/prices, re-price drift
//
// Idempotent: a tier whose Price already matches is left alone. If the tier's
// price changed in Supabase, a new Price is created, the lookup_key moves to it
// (transfer_lookup_key) and the old one is archived — existing subscriptions
// stay on their old Price, exactly as Stripe intends.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const CARD_SURCHARGE = 0.035; // must match functions/api/_lib.js
export const lookupKey = (tierId) => `caaci_${tierId}_year`;
export const chargeCents = (priceCents) => Math.round(priceCents * (1 + CARD_SURCHARGE));

// Minimal .env reader so this can run from a fresh shell; real env wins.
async function loadEnv(env) {
  let text;
  try {
    text = await readFile(new URL('./.env', import.meta.url), 'utf8');
  } catch {
    return env;
  }
  const out = { ...env };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*?)\s*(?:#.*)?$/);
    if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function stripeApi(key) {
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

async function loadTiers(env) {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/membership_tiers?select=id,name,price_cents,active&order=sort_order`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!r.ok) throw new Error(`supabase membership_tiers: ${r.status} ${await r.text()}`);
  return (await r.json()).filter((t) => t.active !== false);
}

// Decide what to do for one tier given what Stripe currently has.
export function planTier(tier, existingPrice) {
  const want = chargeCents(tier.price_cents);
  if (!existingPrice) return { action: 'create', want };
  const same =
    existingPrice.unit_amount === want &&
    existingPrice.currency === 'usd' &&
    existingPrice.recurring?.interval === 'year';
  return same
    ? { action: 'ok', want }
    : { action: 'reprice', want, from: existingPrice.unit_amount };
}

export async function main(argv = process.argv.slice(2), rawEnv = process.env) {
  const apply = argv.includes('--apply');
  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(' ')}`);
  const env = await loadEnv(rawEnv);
  for (const name of ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
    if (!env[name]) {
      console.error(`Missing ${name}.`);
      return 1;
    }
  const S = stripeApi(env.STRIPE_SECRET_KEY);
  const mode = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY) ? 'LIVE' : 'TEST';

  const tiers = await loadTiers(env);
  const keys = tiers.map((t) => lookupKey(t.id));
  const found = await S.get(
    `prices?active=true&limit=100&${keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&')}`,
  );
  const byKey = new Map((found.data || []).map((p) => [p.lookup_key, p]));

  console.log(`Stripe ${mode} — ${tiers.length} tiers in Supabase\n`);
  let changes = 0;
  for (const tier of tiers) {
    const key = lookupKey(tier.id);
    const existing = byKey.get(key);
    const plan = planTier(tier, existing);
    const dollars = `$${(plan.want / 100).toFixed(2)}/yr`;
    if (plan.action === 'ok') {
      console.log(
        `  ✓ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} ${existing.id}  (${existing.product})`,
      );
      continue;
    }
    changes++;
    if (!apply) {
      console.log(
        `  ✗ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} ${
          plan.action === 'create'
            ? 'no catalogue price yet'
            : `price drifted from $${(plan.from / 100).toFixed(2)}`
        } — rerun with --apply`,
      );
      continue;
    }
    // Reuse the tier's Product if the old Price had one, else create it.
    const productId =
      existing?.product ||
      (
        await S.post('products', {
          name: tier.name,
          metadata: { tier_id: tier.id, source: 'stripe-catalog.mjs' },
        })
      ).id;
    const price = await S.post('prices', {
      product: productId,
      currency: 'usd',
      unit_amount: plan.want,
      recurring: { interval: 'year' },
      lookup_key: key,
      transfer_lookup_key: true,
      nickname: `${tier.name} (incl. 3.5% card fee)`,
      metadata: { tier_id: tier.id, base_cents: tier.price_cents },
    });
    if (existing) await S.post(`prices/${existing.id}`, { active: false });
    console.log(
      `  ✓ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} ${price.id}  (${productId})${
        existing ? `  archived ${existing.id}` : '  created product'
      }`,
    );
  }
  console.log(
    changes === 0
      ? '\nCatalogue matches Supabase — nothing to do.'
      : apply
        ? `\n${changes} price(s) written. Checkout will pick them up on the next request.`
        : `\n${changes} change(s) pending.`,
  );
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
