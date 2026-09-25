// /api/admin/invites  (admin only) — invitation codes for Honorable Membership.
//   GET    — every code (newest first) and who has used them.
//   PUT    — create a code. Needs the emailed verification code: a code hands
//            out a membership (and its 华协币) to whoever holds the link, which
//            is the same entitlement a plan change moves, and the same control
//            guards that (POST /api/admin/members).
//   POST   — patch a code. Switching one off, or editing its note, is free;
//            switching one back on, or changing its cap or expiry, opens seats
//            again and needs the verification code like creating one.
//   DELETE — remove a code nobody has used. A used code is the record of who
//            got the tier through it, so it is switched off instead.
// The member side is POST /api/invite; the rules live in invite_redeem() (0034).
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { requireActionCode } from './_action-code.js';
import { normalizeInviteCode } from '../invite.js';

const COLUMNS =
  'code,tier_id,note,active,expires_at,max_redemptions,times_redeemed,created_by,created_at';
const REDEMPTION_COLUMNS = 'code,member_id,redeemed_at,members(full_name,email)';

// Codes end up in URLs (/account/?invite=…) and QR payloads — keep them simple.
export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

// Eight characters from an alphabet without 0/O/1/I, so a code read out over
// the phone or typed from a printout is not misheard: HM-7K3Q9XAB.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateCode(random = crypto.getRandomValues.bind(crypto)) {
  const bytes = random(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `HM-${out}`;
}

function parseFields(b) {
  const patch = {};
  if (b.note !== undefined) patch.note = String(b.note || '').trim() || null;
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
      if (!Number.isFinite(n) || n < 1) return { error: 'Max uses must be at least 1.' };
      patch.max_redemptions = n;
    }
  }
  if (b.active !== undefined) patch.active = !!b.active;
  return { patch };
}

// A patch that lets more people use the code than before it was applied.
export const opensSeats = (patch) =>
  patch.active === true || patch.max_redemptions !== undefined || patch.expires_at !== undefined;

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  try {
    const [{ rows }, { rows: redemptions }] = await Promise.all([
      sb(env).select('invite_codes', { columns: COLUMNS, order: 'created_at.desc', limit: 200 }),
      sb(env).select('invite_redemptions', {
        columns: REDEMPTION_COLUMNS,
        order: 'redeemed_at.desc',
        limit: 500,
      }),
    ]);
    return json({ rows, redemptions });
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
  const code = b.code ? normalizeInviteCode(b.code) : generateCode();
  if (!CODE_RE.test(code)) return bad('Code must be 2–32 letters, digits, dashes or underscores.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);

  const check = await requireActionCode(request, env, gate.user.id);
  if (check.error) return check.error;

  try {
    const existing = await sb(env).selectOne('invite_codes', { code }, 'code');
    if (existing) return bad('That code already exists.');
    const rows = await sb(env).insert('invite_codes', {
      code,
      tier_id: 'honorary',
      note: patch.note ?? null,
      active: patch.active ?? true,
      expires_at: patch.expires_at ?? null,
      max_redemptions: patch.max_redemptions ?? null,
      created_by: gate.member.id,
    });
    return json({ ok: true, invite: rows[0] });
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
  const code = normalizeInviteCode(b.code);
  if (!code) return bad('Code is required.');
  const { patch, error } = parseFields(b);
  if (error) return bad(error);
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  if (opensSeats(patch)) {
    const check = await requireActionCode(request, env, gate.user.id);
    if (check.error) return check.error;
  }

  try {
    await sb(env).update('invite_codes', { code }, patch);
    const row = await sb(env).selectOne('invite_codes', { code }, COLUMNS);
    if (!row) return bad('Unknown code.', 404);
    return json({ ok: true, invite: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let code = normalizeInviteCode(new URL(request.url).searchParams.get('code') || '');
  if (!code) {
    try {
      code = normalizeInviteCode((await request.json()).code || '');
    } catch {
      /* no body */
    }
  }
  if (!code) return bad('Code is required.');
  try {
    const row = await sb(env).selectOne('invite_codes', { code }, 'code,times_redeemed');
    if (!row) return bad('Unknown code.', 404);
    if (row.times_redeemed > 0)
      return bad(
        'This code has been used, so it stays as the record of who joined through it. Switch it off instead.',
        409,
      );
    await sb(env).del('invite_codes', { code });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
