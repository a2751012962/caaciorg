// POST /api/invite — { code }: the signed-in member activates the membership
// an invitation code grants (Honorable Membership, 0011), the way a Stripe
// payment would activate a paid one. The rules — the code is live, has uses
// left, and the member is not on a paid plan — are all in invite_redeem()
// (0034), which runs under a lock on the code's row; this handler decides who
// is calling, turns the function's reason into a sentence in both languages,
// and hands out the tier's 华协币 afterwards, exactly as the webhook does.
//
// The link an admin sends is /account/?invite=<code>; the account page sends a
// signed-out visitor through /login-3/ (sign in or sign up) and comes back
// here with the code. Codes are made by the back office and are eight random
// characters unless an admin chose one, and every call needs a session, so
// guessing is a matter of the cap the admin set, not of this endpoint.
import { json, bad, sb, requireUser } from './_lib.js';
import { grantMembershipTokens } from './_tokens.js';

export const normalizeInviteCode = (code) =>
  String(code || '')
    .trim()
    .toUpperCase();

// invite_redeem()'s reason -> [English, 中文, HTTP status].
export const REFUSALS = {
  invalid: ['This invitation code is not valid.', '邀请码无效。', 400],
  expired: ['This invitation code has expired.', '邀请码已过期。', 400],
  used_up: [
    'This invitation code has been used by as many people as it allows.',
    '邀请码的使用次数已用完。',
    400,
  ],
  no_member: [
    'Your account has no membership record yet — please sign in again.',
    '账号没有会员记录，请重新登录。',
    409,
  ],
  paid_plan: [
    'You already hold a paid membership. Email CAACI and the Board will move you to Honorable Membership by hand.',
    '您已是付费会员。请发邮件联系华协，由理事会手动为您转为荣誉会员。',
    409,
  ],
  already_member: ['You already hold this membership.', '您已经是这一会员了。', 409],
  already_redeemed: [
    'You have already used this invitation code.',
    '您已经用过这个邀请码了。',
    409,
  ],
};

export function refusal(reason) {
  const [error, error_zh, status] = REFUSALS[reason] || [
    'The invitation could not be used.',
    '无法使用该邀请。',
    409,
  ];
  return json({ error, error_zh, code: REFUSALS[reason] ? reason : 'refused' }, status);
}

export async function onRequestPost({ request, env }) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const code = normalizeInviteCode(b.code);
  if (!code) return json({ error: 'Enter your invitation code.', error_zh: '请输入邀请码。' }, 400);

  const DB = sb(env);
  let r;
  try {
    r = await DB.rpc('invite_redeem', { p_code: code, p_member: gate.user.id });
  } catch (e) {
    return bad(e.message, 500);
  }
  if (!r || r.ok !== true) return refusal(r?.reason);

  // The membership is already active; the grant never throws (see _tokens.js)
  // and grants nothing while tokens are switched off.
  const grant = await grantMembershipTokens(env, DB, gate.user.id, null);
  return json({
    ok: true,
    tier_id: r.tier_id,
    tokens_granted: Number(grant?.granted) || 0,
  });
}
