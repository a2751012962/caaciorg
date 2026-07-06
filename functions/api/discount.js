// POST /api/discount — validate a discount code for the checkout UI.
// Returns { code, percent_off } when the code is usable, or a 400 with why not.
// Codes live in discount_codes (RLS: service-role only), so this endpoint is the
// single public window onto them — and it only answers for an exact code.
import { json, bad, sb } from './_lib.js';

export const normalizeCode = (code) =>
  String(code || '')
    .trim()
    .toUpperCase();

// Why a code can't be used right now, or null if it can. Split from the lookup
// so the admin panel data and tests can reason about a row directly.
export function discountProblem(row, now = new Date()) {
  if (!row || row.active !== true) return 'Invalid discount code.';
  if (row.expires_at && new Date(row.expires_at) <= now) return 'This discount code has expired.';
  if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions)
    return 'This discount code has been fully redeemed.';
  return null;
}

// Look a code up and vet it. Returns { row } when usable, { error } otherwise.
// Shared with /api/checkout so a code can't be validated in the UI but stale by
// charge time without the server noticing.
export async function lookupDiscount(env, code) {
  const clean = normalizeCode(code);
  if (!clean) return { error: 'Enter a discount code.' };
  const row = await sb(env).selectOne('discount_codes', { code: clean });
  const problem = discountProblem(row);
  if (problem) return { error: problem };
  return { row };
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  try {
    const { row, error } = await lookupDiscount(env, body.code);
    if (error) return bad(error);
    return json({ code: row.code, percent_off: row.percent_off });
  } catch (e) {
    return bad(e.message, 500);
  }
}
