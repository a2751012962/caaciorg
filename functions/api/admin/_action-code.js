// Emailed verification codes for the admin actions that move money or change
// what a member is entitled to (refunds, a member's plan). The signed-in
// session alone is not enough for those: the admin asks for a code
// (POST /api/admin/action-code), it lands in their own mailbox, and the
// request then carries it in the `x-admin-code` header.
//
// Codes are stateless, TOTP-style: HMAC(service-role key, admin id + 10-minute
// slot), so no table has to exist and a code is good for the slot it was made
// in plus the next one (10–20 minutes) — several refunds in a row need one
// email, not one each. The trade-off of keeping no state is that a code cannot
// be revoked early and guesses are not counted here; the header check is
// constant-time and the code is six digits, which is the balance struck for a
// back office whose every request already needs an admin session.
import { json } from '../_lib.js';

export const CODE_HEADER = 'x-admin-code';
export const SLOT_MS = 10 * 60_000;
export const CODE_DIGITS = 6;

const encoder = new TextEncoder();

// The code for one admin in one slot: six digits from the HMAC's first bytes.
export async function codeFor(env, userId, slot) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SUPABASE_SERVICE_ROLE_KEY || ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`admin-action:${userId}:${slot}`)),
  );
  const n = ((mac[0] << 24) | (mac[1] << 16) | (mac[2] << 8) | mac[3]) >>> 0;
  return String(n % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
}

export const currentSlot = (now = Date.now()) => Math.floor(now / SLOT_MS);

// Two same-length strings compared without an early exit.
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True when `code` is the admin's code for this slot or the previous one.
export async function verifyActionCode(env, userId, code, now = Date.now()) {
  const given = String(code || '').trim();
  if (!/^\d{6}$/.test(given)) return false;
  const slot = currentSlot(now);
  let ok = false;
  for (const s of [slot, slot - 1]) ok = same(await codeFor(env, userId, s), given) || ok;
  return ok;
}

// Gate for a sensitive handler, after requireAdmin: `{ error }` is a 428
// (Precondition Required) carrying `code_required: true`, which the admin
// panel turns into the "enter the emailed code" step; otherwise `{}`.
export async function requireActionCode(request, env, userId) {
  const code = request.headers.get(CODE_HEADER) || '';
  if (await verifyActionCode(env, userId, code)) return {};
  return {
    error: json(
      {
        error: code
          ? 'That verification code is wrong or has expired.'
          : 'This action needs the verification code emailed to you.',
        code_required: true,
      },
      428,
    ),
  };
}
