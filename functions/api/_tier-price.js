// Keeping a paid membership tier's Stripe Price in step with its price_cents.
//
// Checkout charges the active Price holding the tier's lookup_key
// (`caaci_<tier>_year`, see tierPrice in _lib.js), not the number in Supabase,
// so a price change has to move that lookup_key to a Price of the new amount.
// Shared by stripe-catalog.mjs (bulk, from a shell) and the admin Plans tab
// (/api/admin/tiers, one tier at a time).
//
// `S` is a Stripe client shaped { get(path), post(path, params) }.
//
// Reuse before create: a tier lives on the active Product tagged with its
// tier_id, or else the one with the same name (the live account's MemberPress
// products carry no tag), and takes over an existing yearly Price of the right
// amount under it. The old Price is archived only when this code made it;
// existing subscriptions keep billing on it either way, as Stripe intends.
import { CARD_SURCHARGE, tierLookupKey } from './_lib.js';

export const lookupKey = tierLookupKey;
export const chargeCents = (priceCents) => Math.round(priceCents * (1 + CARD_SURCHARGE));

// Every page of a Stripe list endpoint.
export async function listAll(S, path) {
  const out = [];
  for (let after = ''; ;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await S.get(`${path}${sep}limit=100${after ? `&starting_after=${after}` : ''}`);
    out.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) return out;
    after = page.data.at(-1).id;
  }
}

// A plain yearly USD Price charging exactly `want` cents.
export function isYearlyAt(price, want) {
  return (
    price.currency === 'usd' &&
    price.unit_amount === want &&
    price.recurring?.interval === 'year' &&
    (price.recurring.interval_count ?? 1) === 1 &&
    (price.recurring.usage_type ?? 'licensed') === 'licensed' &&
    (price.billing_scheme ?? 'per_unit') === 'per_unit'
  );
}

// Active Products a tier may live on: those tagged with its tier_id, else those
// with the same name (MemberPress products carry no tag).
export function candidateProducts(tier, products) {
  const active = products.filter((p) => p.active !== false);
  const tagged = active.filter((p) => p.metadata?.tier_id === tier.id);
  if (tagged.length) return tagged;
  const norm = (s) =>
    String(s || '')
      .trim()
      .toLowerCase();
  return active.filter((p) => norm(p.name) === norm(tier.name));
}

// Among candidates, prefer one that already has a matching Price, then the oldest.
export function pickProduct(candidates, pricesByProduct, want) {
  return (
    candidates.find((p) => (pricesByProduct[p.id] || []).some((x) => isYearlyAt(x, want))) ||
    [...candidates].sort((a, b) => (a.created ?? 0) - (b.created ?? 0))[0] ||
    null
  );
}

// A Price the catalogue script or the admin panel created (older runs tagged
// only base_cents). Anything else — e.g. a MemberPress plan — may be on legacy
// subscriptions or still sold by WordPress, so it is never archived or re-activated.
export const createdHere = (price) =>
  price?.metadata?.source === 'stripe-catalog.mjs' ||
  price?.metadata?.source === 'admin-tiers' ||
  price?.metadata?.base_cents != null;

// Decide what to do for one tier given what Stripe currently has.
//   existingPrice — the active Price holding this tier's lookup_key, if any
//   product/prices — the Product the tier should live on and all its Prices
export function planTier(tier, existingPrice, { product = null, prices = [] } = {}) {
  if (!(tier.price_cents > 0)) return { action: 'skip', want: 0 };
  const want = chargeCents(tier.price_cents);
  if (existingPrice && isYearlyAt(existingPrice, want)) return { action: 'ok', want };
  const from = existingPrice ? { from: existingPrice.unit_amount } : {};
  // Any active Price of the right amount can be taken over; an archived one only
  // if this code made it.
  const matches = prices.filter((p) => isYearlyAt(p, want));
  const reusable = matches.find((p) => p.active) || matches.find((p) => createdHere(p));
  if (reusable)
    return {
      action: 'reuse',
      want,
      price: reusable.id,
      reactivate: !reusable.active,
      product: product?.id ?? reusable.product ?? null,
      ...from,
    };
  return {
    action: existingPrice ? 'reprice' : 'create',
    want,
    product: product?.id ?? existingPrice?.product ?? null,
    ...from,
  };
}

// Carry out a plan from planTier (anything but 'ok'/'skip'). Returns
// { priceId, productId, note }. A refused lookup_key transfer on reuse throws
// with err.reuseFailed set: a duplicate Price is exactly what reuse avoids, so
// there is no silent fallback to creating one.
export async function applyTierPlan(S, tier, plan, existing, source) {
  const key = lookupKey(tier.id);
  let priceId = null;
  let note = '';
  if (plan.action === 'reuse') {
    try {
      await S.post(`prices/${plan.price}`, {
        lookup_key: key,
        transfer_lookup_key: true,
        ...(plan.reactivate ? { active: true } : {}),
      });
    } catch (err) {
      err.reuseFailed = true;
      throw err;
    }
    priceId = plan.price;
    note = plan.reactivate ? 'reused, re-activated' : 'reused';
  }
  let productId = plan.product;
  if (!priceId) {
    if (!productId) {
      productId = (
        await S.post('products', { name: tier.name, metadata: { tier_id: tier.id, source } })
      ).id;
      note = 'created product';
    } else {
      note = note || 'new price on existing product';
    }
    const price = await S.post('prices', {
      product: productId,
      currency: 'usd',
      unit_amount: plan.want,
      recurring: { interval: 'year' },
      lookup_key: key,
      transfer_lookup_key: true,
      nickname: `${tier.name} (incl. 3.5% card fee)`,
      metadata: { tier_id: tier.id, base_cents: tier.price_cents, source },
    });
    priceId = price.id;
  }
  if (existing && existing.id !== priceId) {
    if (createdHere(existing)) {
      await S.post(`prices/${existing.id}`, { active: false });
      note += `, archived ${existing.id}`;
    } else {
      note += `, left ${existing.id} active (not created by this script)`;
    }
  }
  return { priceId, productId, note };
}

// One tier, end to end: look up what Stripe has, then make the tier's
// lookup_key point at a yearly Price charging price_cents plus the card fee.
// Returns { action, want, priceId?, from? }; 'ok' and 'skip' write nothing.
export async function syncTierPrice(S, tier, source = 'admin-tiers') {
  const plan0 = planTier(tier, null);
  if (plan0.action === 'skip') return plan0;
  const found = await S.get(
    `prices?active=true&lookup_keys[]=${encodeURIComponent(lookupKey(tier.id))}`,
  );
  const existing = found?.data?.[0] || null;
  if (existing && isYearlyAt(existing, plan0.want))
    return { action: 'ok', want: plan0.want, priceId: existing.id };

  const candidates = candidateProducts(tier, await listAll(S, 'products?active=true'));
  const pricesByProduct = {};
  for (const p of candidates) pricesByProduct[p.id] = await listAll(S, `prices?product=${p.id}`);
  const product =
    pickProduct(candidates, pricesByProduct, plan0.want) ||
    (existing ? { id: existing.product } : null);
  const plan = planTier(tier, existing, {
    product,
    prices: product ? pricesByProduct[product.id] || [] : [],
  });
  const { priceId } = await applyTierPlan(S, tier, plan, existing, source);
  return {
    action: plan.action,
    want: plan.want,
    priceId,
    ...(plan.from ? { from: plan.from } : {}),
  };
}
