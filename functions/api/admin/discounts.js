// /api/admin/discounts  (admin only)
//   GET    — list all discount codes (newest first).
//   PUT    — create a code (uppercased; percent 1–100, optional expiry / cap).
//   POST   — patch a code (activate/deactivate, description, expiry, cap).
//   DELETE — remove a code.
// Every request is gated by requireAdmin. The public side only ever sees a code
// through /api/discount (exact-match validation) and the checkout metadata.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { normalizeCode } from '../discount.js';

const COLUMNS =
  'code,percent_off,description,active,expires_at,max_redemptions,times_redeemed,created_at';

// Codes end up in URLs (/membership/?code=…) and QR payloads — keep them simple.
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function parseLimits(b) {
  const patch = {};
  if (b.description !== undefined) patch.description = String(b.description || '').trim() || null;
  if (b.expires_at !== undefined) {
    if (b.expires_at === null || b.expires_at === '') {
      patch.expires_at = null;
    } else {
      const d = new Date(b.expires_at);
      if (isNaN(d.getTime())) return { error: 'Invalid expiry date.' };
      patch.expires_at = d.toISOString();
    }
  }
  if (b.max_redemptions !== undefined) {
    if (b.max_redemptions === null || b.max_redemptions === '') {
      patch.max_redemptions = null;
    } else {
      const n = parseInt(b.max_redemptions, 10);
      if (!Number.isFinite(n) || n < 1) return { error: 'Max redemptions must be at least 1.' };
      patch.max_redemptions = n;
    }
  }
  if (b.active !== undefined) patch.active = !!b.active;
  return { patch };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const { rows } = await sb(env).select('discount_codes', {
      columns: COLUMNS,
      order: 'created_at.desc',
      limit: 200,
    });
    return json({ rows });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const code = normalizeCode(b.code);
  if (!CODE_RE.test(code)) return bad('Code must be 2–32 letters, digits, dashes or underscores.');
  const percent = parseInt(b.percent_off, 10);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100)
    return bad('Percent off must be between 1 and 100.');
  const { patch, error } = parseLimits(b);
  if (error) return bad(error);

  try {
    const existing = await sb(env).selectOne('discount_codes', { code }, 'code');
    if (existing) return bad('That code already exists.');
    const rows = await sb(env).insert('discount_codes', {
      code,
      percent_off: percent,
      active: patch.active ?? true,
      description: patch.description ?? null,
      expires_at: patch.expires_at ?? null,
      max_redemptions: patch.max_redemptions ?? null,
    });
    return json({ ok: true, discount: rows[0] });
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
  const code = normalizeCode(b.code);
  if (!code) return bad('Code is required.');
  const { patch, error } = parseLimits(b);
  if (error) return bad(error);
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('discount_codes', { code }, patch);
    const row = await sb(env).selectOne('discount_codes', { code }, COLUMNS);
    if (!row) return bad('Unknown code.', 404);
    return json({ ok: true, discount: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let code = normalizeCode(new URL(request.url).searchParams.get('code') || '');
  if (!code) {
    try {
      code = normalizeCode((await request.json()).code || '');
    } catch {
      /* no body */
    }
  }
  if (!code) return bad('Code is required.');
  try {
    await sb(env).del('discount_codes', { code });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
