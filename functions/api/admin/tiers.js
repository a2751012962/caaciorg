// /api/admin/tiers  (admin only)
//   GET  — every membership tier (inactive ones too), in page order.
//   POST — edit one tier's copy and/or price:
//          { id, description?, description_zh?, features?, features_zh?, price_cents? }
//
// Copy is the card text on /membership/: the short description and the benefit
// lines, in English and Chinese (migration 0023). An empty list of lines makes
// the page fall back to its built-in copy.
//
// Price is the annual base dues in cents; card checkout adds 3.5%. Checkout
// charges the Stripe Price holding the tier's lookup_key, not this number, so a
// price change first moves that lookup_key to a Price of the new amount
// (syncTierPrice) and only then writes the row, so a Stripe error saves nothing. New sign-ups and plan switches pay the new price; existing
// subscriptions renew on the Price they were bought on.
// $0 tiers (free, honorary) never go through Stripe, and a paid tier can't be
// made $0 (or the reverse): checkout treats a $0 self-serve tier as the free
// plan, which would leave paying subscribers on a "free" tier.
import { json, bad, sb, stripe, requireAdmin } from '../_lib.js';
import { syncTierPrice } from '../_tier-price.js';
import { requireActionCode } from './_action-code.js';

export const MAX_FEATURES = 12;
export const MAX_FEATURE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MIN_PRICE_CENTS = 100; // $1
export const MAX_PRICE_CENTS = 1000000; // $10,000

function parseLines(raw, label) {
  if (raw === null) return { lines: [] };
  if (!Array.isArray(raw)) return { error: `${label} must be a list.` };
  const lines = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (lines.length > MAX_FEATURES) return { error: `${label}: at most ${MAX_FEATURES} lines.` };
  if (lines.some((x) => x.length > MAX_FEATURE_LENGTH))
    return { error: `${label}: each line at most ${MAX_FEATURE_LENGTH} characters.` };
  return { lines };
}

// Validate the copy fields; returns { patch } or { error }.
export function parseCopy(b) {
  const patch = {};
  for (const f of ['description', 'description_zh']) {
    if (b[f] === undefined) continue;
    const text = String(b[f] ?? '').trim();
    if (text.length > MAX_DESCRIPTION_LENGTH)
      return { error: `Description at most ${MAX_DESCRIPTION_LENGTH} characters.` };
    patch[f] = text || null;
  }
  for (const [f, label] of [
    ['features', 'Benefits (English)'],
    ['features_zh', 'Benefits (Chinese)'],
  ]) {
    if (b[f] === undefined) continue;
    const { lines, error } = parseLines(b[f], label);
    if (error) return { error };
    patch[f] = lines;
  }
  return { patch };
}

// The new price for `tier`, or { error }. undefined = no price change.
export function parsePrice(tier, raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  const cents = Number(raw);
  if (!Number.isInteger(cents)) return { error: 'Price must be a whole number of cents.' };
  if (cents === tier.price_cents) return {};
  if (!(tier.price_cents > 0)) return { error: 'Free and invitation-only plans stay at $0.' };
  if (cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS)
    return { error: 'A paid plan must cost between $1 and $10,000 a year.' };
  return { price_cents: cents };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const { rows } = await sb(env).select('membership_tiers', {
      columns: '*',
      order: 'sort_order.asc,price_cents.asc',
      limit: 50,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b.id) return bad('Plan id is required.');
  const { patch, error } = parseCopy(b);
  if (error) return bad(error);

  const DB = sb(env);
  try {
    const tier = await DB.selectOne('membership_tiers', { id: b.id });
    if (!tier) return bad('Unknown plan.', 404);
    const price = parsePrice(tier, b.price_cents);
    if (price.error) return bad(price.error);
    if (price.price_cents === undefined && Object.keys(patch).length === 0)
      return bad('Nothing to update.');

    let stripeResult = null;
    if (price.price_cents !== undefined) {
      if (!env.STRIPE_SECRET_KEY)
        return bad('Stripe is not configured, so prices are locked.', 503);
      // What every new member pays: needs the emailed verification code, like
      // refunds and plan changes (see _action-code.js). Copy edits do not.
      const check = await requireActionCode(request, env, gate.user.id);
      if (check.error) return check.error;
      const S = stripe(env);
      try {
        stripeResult = await syncTierPrice(
          { get: S.get, post: S.call },
          { ...tier, price_cents: price.price_cents },
        );
      } catch (e) {
        return bad(`Stripe error — the new price was not saved. Try again. (${e.message})`, 502);
      }
      patch.price_cents = price.price_cents;
    }

    try {
      await DB.update('membership_tiers', { id: tier.id }, patch);
    } catch (e) {
      // Stripe already charges the new price; saving again finishes the change
      // (the Stripe step finds its Price in place and writes nothing).
      if (stripeResult)
        return bad(`Stripe was updated but saving failed — press Save again. (${e.message})`, 500);
      throw e;
    }
    const row = await DB.selectOne('membership_tiers', { id: tier.id });
    return json({ ok: true, tier: row, stripe: stripeResult });
  } catch (e) {
    return bad(e.message, 500);
  }
}
