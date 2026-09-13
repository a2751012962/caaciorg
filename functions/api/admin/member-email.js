// POST /api/admin/member-email  (admin only)
// Body: { member_id, action: 'reset' | 'invite' }
// Sends one member a Supabase Auth email through the project's SMTP: a password
// reset or an invitation. Both links land on /account/?recovery=1, where the
// member site shows its "Set a new password" card. The recipient is the
// member's LOGIN email, read server-side from Supabase Auth by member_id (never
// taken from the client or the editable profile), and the response carries no
// member data.
import { json, bad, sb, requireAdmin, authAdmin } from '../_lib.js';

const ACTIONS = ['reset', 'invite'];
const RATE_LIMIT_CODES = ['over_email_send_rate_limit', 'over_request_rate_limit'];
const ALREADY_REGISTERED_CODES = ['email_exists', 'user_already_exists'];
const USE_RESET =
  'This member already has a confirmed login. Use "Send password reset" instead of an invitation.';
const RATE_LIMITED =
  'An email was sent to this member very recently. Please wait a minute and try again.';
const UPSTREAM = 'The email could not be sent right now. Please try again later.';

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const action = b?.action;
  const memberId = typeof b?.member_id === 'string' ? b.member_id.trim() : '';
  if (!ACTIONS.includes(action)) return bad('action must be "reset" or "invite".');
  if (!memberId) return bad('member_id is required.');

  let member;
  try {
    member = await sb(env).selectOne('members', { id: memberId }, 'id');
  } catch {
    return bad('Could not look up that member.', 500);
  }
  if (!member) return bad('Member not found.', 404);

  // Send to the LOGIN's address, never members.email: the profile email is
  // member-editable, so trusting it would let a member aim a reset or invite
  // link at any inbox. members.id is the auth user's id.
  const A = authAdmin(env);
  let user;
  try {
    user = await A.getUser(member.id);
  } catch {
    return bad(UPSTREAM, 502);
  }
  if (!user) return bad('This member has no login account.', 404);

  // An invitation only makes sense for a login nobody has used yet. Admin-created
  // members are created already confirmed, and GoTrue refuses to invite a
  // confirmed user, so check first rather than depend on its error text.
  if (action === 'invite' && (user.email_confirmed_at || user.confirmed_at || user.last_sign_in_at))
    return bad(USE_RESET, 409);

  const email = (user.email || '').trim();
  if (!email) return bad('This login has no email address.', 422);
  const redirectTo = `${new URL(request.url).origin}/account/?recovery=1`;

  let res;
  try {
    res =
      action === 'reset'
        ? await A.sendRecovery(email, redirectTo)
        : await A.sendInvite(email, redirectTo);
  } catch {
    return bad(UPSTREAM, 502);
  }
  if (res.ok) return json({ ok: true, action });

  if (res.status === 429 || RATE_LIMIT_CODES.includes(res.code)) return bad(RATE_LIMITED, 429);
  if (
    action === 'invite' &&
    (ALREADY_REGISTERED_CODES.includes(res.code) || /already been registered/i.test(res.message))
  )
    return bad(USE_RESET, 409);
  // Surface GoTrue's machine code (e.g. email_address_not_authorized) for
  // debugging, but never its message or body.
  const code = /^[a-z_]{1,64}$/.test(res.code) ? res.code : undefined;
  return json({ error: UPSTREAM, ...(code ? { code } : {}) }, 502);
}
