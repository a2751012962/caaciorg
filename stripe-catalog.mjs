// stripe-catalog.mjs — give every paid membership tier a real Stripe Product + Price.
//
// Checkout used to mint an inline price on every purchase, so the Dashboard
// filled up with one ad-hoc product per payment and MRR was unreadable. This
// gives each paid tier one Product and one yearly Price, tagged with a
// lookup_key (`caaci_<tier>_year`) that functions/api/_lib.js tierPrice()
// resolves at checkout time. No IDs are stored in the database, so the same
// code works in test and live mode — run this once per mode.
//
// Reuse before create: the live account already holds the WordPress
// (MemberPress) products that legacy subscribers are billed on. A tier lives on
// the active Product tagged with its tier_id, or else the one with the same
// name, and takes over an existing yearly Price of the right amount under it
// (re-activating it if archived). Only what is missing gets created, so old and
// new members share one Product. $0 tiers (free, honorary) never go through
// Stripe Checkout and get no Price.
//
// Usage (STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from the
// environment or .env):
//   node stripe-catalog.mjs            # report: what exists, what would change
//   node stripe-catalog.mjs --apply    # tag/create prices, re-price drift
//
// Idempotent: a tier whose Price already matches is left alone. If the tier's
// price changed in Supabase, the lookup_key moves to a matching Price
// (transfer_lookup_key) and the old one is archived — existing subscriptions
// stay on their old Price, exactly as Stripe intends.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  lookupKey,
  chargeCents,
  listAll,
  isYearlyAt,
  candidateProducts,
  pickProduct,
  createdHere,
  planTier,
  applyTierPlan,
} from './functions/api/_tier-price.js';
import { CARD_SURCHARGE } from './functions/api/_lib.js';

// The planning helpers live in functions/api/_tier-price.js (the admin Plans tab
// uses them too); re-exported for existing callers and tests.
export {
  CARD_SURCHARGE,
  lookupKey,
  chargeCents,
  isYearlyAt,
  candidateProducts,
  pickProduct,
  createdHere,
  planTier,
};

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

function describe(plan, product) {
  const on = product ? `${product.id} "${product.name}"` : 'a new Product';
  if (plan.action === 'reuse')
    return `reuse ${plan.price}${plan.reactivate ? ' (archived — re-activate)' : ''} on ${on}`;
  const what =
    plan.action === 'create'
      ? 'no catalogue price yet'
      : `price drifted from $${(plan.from / 100).toFixed(2)}`;
  return `${what} — create a Price on ${on}`;
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
  const keys = tiers.filter((t) => t.price_cents > 0).map((t) => lookupKey(t.id));
  const found = keys.length
    ? await S.get(
        `prices?active=true&limit=100&${keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&')}`,
      )
    : { data: [] };
  const byKey = new Map((found.data || []).map((p) => [p.lookup_key, p]));
  const products = await listAll(S, 'products?active=true');
  const pricesByProduct = {};

  console.log(`Stripe ${mode} — ${tiers.length} tiers in Supabase\n`);
  let changes = 0;
  let failures = 0;
  for (const tier of tiers) {
    const key = lookupKey(tier.id);
    if (!(tier.price_cents > 0)) {
      console.log(`  – ${tier.id.padEnd(11)} $0           no Stripe price needed`);
      continue;
    }
    const want = chargeCents(tier.price_cents);
    const candidates = candidateProducts(tier, products);
    for (const p of candidates)
      pricesByProduct[p.id] ??= await listAll(S, `prices?product=${p.id}`);
    const product = pickProduct(candidates, pricesByProduct, want);
    const existing = byKey.get(key);
    const plan = planTier(tier, existing, {
      product,
      prices: product ? pricesByProduct[product.id] : [],
    });
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
        `  ✗ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} ${describe(plan, product)} — rerun with --apply`,
      );
      continue;
    }

    let result;
    try {
      // No silent fallback: a refused lookup_key transfer on reuse stops this tier.
      result = await applyTierPlan(S, tier, plan, existing, 'stripe-catalog.mjs');
    } catch (err) {
      if (!err.reuseFailed) throw err;
      failures++;
      console.log(
        `  ✗ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} could not tag ${plan.price}: ${err.message} — nothing written for this tier`,
      );
      continue;
    }
    const { priceId, productId, note } = result;
    console.log(
      `  ✓ ${tier.id.padEnd(11)} ${dollars.padEnd(12)} ${priceId}  (${productId})  ${note}`,
    );
  }
  console.log(
    changes === 0
      ? '\nCatalogue matches Supabase — nothing to do.'
      : apply
        ? `\n${changes - failures} price(s) written. Checkout will pick them up on the next request.`
        : `\n${changes} change(s) pending.`,
  );
  if (failures) {
    console.error(`\n✗ ${failures} tier(s) not written — see above.`);
    return 1;
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
