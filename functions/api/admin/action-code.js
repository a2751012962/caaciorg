// POST /api/admin/action-code  (admin only)
// Emails the signed-in admin the verification code that refunds and plan
// changes must carry (see _action-code.js). The code goes to the admin's own
// address only — the one on their account — and the answer never contains it.
// Every request is gated by requireAdmin.
import { json, bad, requireAdmin, sendEmail } from '../_lib.js';
import { codeFor, currentSlot, SLOT_MS } from './_action-code.js';

const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { user, member } = gate;
  const to = user.email || member.email;
  if (!to) return bad('Your account has no email address to send the code to.', 409);
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) return bad('Email is not configured.', 503);

  const code = await codeFor(env, user.id, currentSlot());
  const minutes = SLOT_MS / 60_000;
  try {
    await sendEmail(env, {
      to,
      subject: `CAACI admin verification code: ${code} / 管理后台验证码`,
      html: `<p>Your CAACI admin verification code is:</p>
<p style="font-size:28px;letter-spacing:6px"><strong>${esc(code)}</strong></p>
<p>Enter it in the admin panel to confirm the refund or plan change. It is valid for about ${minutes} minutes. If you did not ask for it, someone is using your admin session — sign out everywhere and change your password.</p>
<hr>
<p>您的 CAACI 管理后台验证码是：</p>
<p style="font-size:28px;letter-spacing:6px"><strong>${esc(code)}</strong></p>
<p>请在管理后台输入以确认退款或会员方案变更，约 ${minutes} 分钟内有效。如果不是您本人操作，说明有人正在使用您的管理员会话，请立即退出所有设备并修改密码。</p>`,
    });
  } catch (e) {
    return bad(`The code could not be emailed: ${e.message}`, 502);
  }
  return json({ ok: true, sent_to: to, valid_minutes: minutes });
}
