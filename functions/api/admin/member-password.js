// POST /api/admin/member-password  (admin only)
// Body: { member_id, password }
// Sets a member's login password directly — no reset link — so the member can
// sign in with it at once. The login email is marked confirmed at the same
// time, the way an admin-created member is, because GoTrue refuses a password
// sign-in to an unconfirmed address and the new password would not work.
//
// Two kinds of account are refused:
//   - the caller's own: the My account tab changes it through Supabase's own
//     flow, which checks the current password (or emails a code), so a stolen
//     admin session cannot quietly re-key its own login;
//   - any other administrator: one admin must not be able to take over
//     another admin's login.
// After the change the member gets a short notice at their LOGIN email (read
// from Supabase Auth, never from the client), without the password. The
// response carries no member data and never echoes the password.
import { json, bad, sb, requireAdmin, authAdmin, sendEmail } from '../_lib.js';

export const MIN_PASSWORD_LENGTH = 8; // same floor as the member account page
export const MAX_PASSWORD_BYTES = 72; // bcrypt's limit; GoTrue refuses longer

const UPSTREAM = 'The password could not be changed right now. Please try again later.';

const escapeHtml = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

// Best effort: the password has already changed, so a mail failure must not
// turn the admin's success into an error.
async function notifyMember(env, email) {
  if (!email) return;
  const who = escapeHtml(email);
  try {
    await sendEmail(env, {
      to: email,
      replyTo: env.NOTIFY_TO,
      subject: 'Your CAACI password was changed / 您的 CAACI 密码已被修改',
      html:
        `<p>A CAACI administrator changed the password for your account (${who}). ` +
        'Sign in with the new password they gave you. If you did not ask for this, reply to this email.</p>' +
        `<p>CAACI 管理员修改了您账户（${who}）的密码，请使用管理员告知的新密码登录。` +
        '如果这不是您本人的请求，请直接回复此邮件。</p>',
    });
  } catch {
    /* already changed — nothing to undo */
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
  const memberId = typeof b?.member_id === 'string' ? b.member_id.trim() : '';
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!memberId) return bad('member_id is required.');
  if (memberId === gate.user.id) return bad('Change your own password in the My account tab.', 403);
  if (password.length < MIN_PASSWORD_LENGTH)
    return bad(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES)
    return bad(`Password is too long (at most ${MAX_PASSWORD_BYTES} bytes).`);

  let target;
  try {
    target = await sb(env).selectOne('members', { id: memberId }, 'id,is_admin');
  } catch {
    return bad(UPSTREAM, 502);
  }
  if (target?.is_admin === true)
    return bad(
      "An administrator's password can only be changed by that administrator, in the My account tab.",
      403,
    );

  const admin = authAdmin(env);
  let user;
  try {
    user = await admin.getUser(memberId);
  } catch {
    return bad(UPSTREAM, 502);
  }
  if (!user) return bad('This member has no login account yet. Send an invitation instead.', 404);

  const res = await admin.updateUser(memberId, { password, email_confirm: true });
  if (!res.ok) {
    if (res.code === 'weak_password' || res.status === 422)
      return bad(res.message || 'That password is too weak.', 422);
    return bad(UPSTREAM, 502);
  }
  await notifyMember(env, user.email);
  return json({ ok: true });
}
