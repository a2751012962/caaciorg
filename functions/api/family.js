// /api/family — self-service family memberships for the signed-in member.
//   GET  — the caller's family (role, plan, seats, people), the founder's
//          invitations and history, and invitations addressed to the caller.
//   POST — { action, ... }: invite | cancel_invite | resend_invite |
//          accept_invite | decline_invite | add_person | remove_person |
//          leave | dissolve
//
// A family covers at most FAMILY_LIMIT people, founder included: linked login
// accounts, name-only people and pending unexpired invitations. The cap is
// enforced by the family_* SQL functions (0017), which lock the household row
// before counting; this file never counts and then inserts on its own.
//
// Invitations go out as Supabase Auth emails only: a GoTrue invite for a new
// address, a magic link for an existing confirmed login, and a re-sent invite
// for an existing unconfirmed one. The templates show "<founder login email>
// invited you" from user_metadata.family_invite_from, which is set just before
// the send and cleared right after it (GoTrue renders the email before it
// answers), and cleared again on accept, decline, cancel and expiry.
//
// Founder notifications (join, leave) and the removed member's email go through
// Resend and are skipped when it isn't configured (`notified: false`). They
// carry fixed bilingual copy plus login email addresses only — never a family
// name or a typed full name, which could carry phishing text.
import { json, bad, sb, authAdmin, requireUser, sendEmailBatch } from './_lib.js';

export const FAMILY_LIMIT = 3;
const RELATIONSHIPS = ['head', 'spouse', 'child', 'parent', 'other'];
const MEMBER_COLS = 'id,email,full_name,tier_id,status,expires_at,household_id';
const HOUSEHOLD_COLS = 'id,name,status,tier_id,expires_at,founder_member_id';
const INVITE_COLS =
  'id,household_id,email,full_name,relationship,status,created_at,expires_at,member_id';
const RATE_LIMIT_CODES = ['over_email_send_rate_limit', 'over_request_rate_limit'];
const ALREADY_REGISTERED_CODES = ['email_exists', 'user_already_exists'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]+$/;

const FOUNDER_ONLY = 'Only the member who holds the family plan can do this.';
const PLAN_INACTIVE = 'The family plan is not active, so invitations cannot be sent right now.';
const PLAN_INACTIVE_ACCEPT = "This family's plan is not active, so it cannot take new members.";
const RATE_LIMITED =
  'An email was sent to this address very recently. Please wait a minute and try again.';
const EMAIL_FAILED = 'The invitation email could not be sent right now. Please try again later.';
const EXPIRED = 'This invitation has expired. Ask the family plan holder for a new one.';
const NOT_OPEN = 'This invitation is no longer open.';
const LAST_PERSON =
  'This is the last person in your family besides you. Dissolve the family instead of removing them.';

const REFUSALS = {
  family_full: [
    `This family is full: a family membership covers at most ${FAMILY_LIMIT} people, including you and pending invitations.`,
    409,
  ],
  duplicate_invite: ['That email address already has a pending invitation to this family.', 409],
  already_in_household: ['That account is already in a family.', 409],
  not_pending: [NOT_OPEN, 409],
  expired: [EXPIRED, 409],
  wrong_email: ['Sign in with the email address this invitation was sent to.', 403],
  no_household: ['This family no longer exists.', 404],
  not_found: ['Invitation not found.', 404],
  no_member: ['Member not found.', 404],
};
const refusal = (reason) => {
  const [msg, status] = REFUSALS[reason] || ['That could not be done right now.', 502];
  return bad(msg, status);
};

const lower = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
const iso = () => new Date().toISOString();
const isExpired = (inv) =>
  inv.status === 'pending' && new Date(inv.expires_at).getTime() <= Date.now();
const planActive = (p) =>
  !!p && p.status === 'active' && (!p.expires_at || new Date(p.expires_at).getTime() > Date.now());
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Optional full_name / relationship from the body. Returns { full_name, relationship } or { error }.
function personFields(b, { nameRequired }) {
  const full_name = typeof b.full_name === 'string' ? b.full_name.trim() : '';
  if (nameRequired && !full_name) return { error: bad('full_name is required.') };
  if (full_name.length > 120) return { error: bad('full_name is too long.') };
  const relationship = b.relationship ? String(b.relationship) : null;
  if (relationship && !RELATIONSHIPS.includes(relationship))
    return { error: bad(`relationship must be one of ${RELATIONSHIPS.join(', ')}.`) };
  return { full_name: full_name || null, relationship };
}

async function load(env, user) {
  const DB = sb(env);
  const member = await DB.selectOne('members', { id: user.id }, MEMBER_COLS);
  const household = member?.household_id
    ? await DB.selectOne('households', { id: member.household_id }, HOUSEHOLD_COLS)
    : null;
  const role = !household
    ? 'none'
    : household.founder_member_id && household.founder_member_id === user.id
      ? 'founder'
      : 'member';
  return { DB, env, member, household, role, email: lower(user.email) };
}

// A member's LOGIN email (auth.users), never the editable profile email.
async function loginEmail(env, memberId) {
  if (!memberId) return null;
  try {
    const u = await authAdmin(env).getUser(memberId);
    return u?.email ? lower(u.email) : null;
  } catch {
    return null;
  }
}

// Best effort: the flag only decorates emails, so failing to clear it never fails an action.
async function clearInviteFlag(env, userId) {
  if (!userId) return;
  try {
    await authAdmin(env).updateUserMetadata(userId, { family_invite_from: null });
  } catch {
    // ignore
  }
}

// History is best effort too: the change it records has already happened.
async function logEvent(
  ctx,
  householdId,
  type,
  { subjectMember = null, subjectEmail = null } = {},
) {
  try {
    await ctx.DB.insert(
      'household_events',
      {
        household_id: householdId,
        type,
        actor_member_id: ctx.member?.id || null,
        subject_member_id: subjectMember,
        subject_email: subjectEmail,
      },
      { returning: false },
    );
  } catch {
    // ignore
  }
}

async function expireInvite(ctx, inv) {
  await ctx.DB.update(
    'household_invites',
    { id: inv.id, status: 'pending' },
    { status: 'expired' },
  );
  await clearInviteFlag(ctx.env, inv.member_id);
}

const NOTICES = {
  joined: {
    subject: '有人加入了你的 CAACI 家庭会员 / Someone joined your CAACI family membership',
    zh: (e) => `${e} 已接受邀请，加入了你的 CAACI 家庭会员。`,
    en: (e) => `${e} accepted your invitation and joined your CAACI family membership.`,
  },
  left: {
    subject: '有人退出了你的 CAACI 家庭会员 / Someone left your CAACI family membership',
    zh: (e) => `${e} 已退出你的 CAACI 家庭会员。`,
    en: (e) => `${e} left your CAACI family membership.`,
  },
  removed: {
    subject: '你已被移出 CAACI 家庭会员 / You were removed from a CAACI family membership',
    zh: (e) => `${e} 已将你移出其 CAACI 家庭会员。你的 CAACI 账号仍然保留。`,
    en: (e) =>
      `${e} removed you from their CAACI family membership. Your CAACI account is still there.`,
  },
};

// Returns whether the email was handed to Resend. `who` must be a login email.
async function notify(env, origin, to, kind, who) {
  if (!to || !who || !env.RESEND_API_KEY || !env.NOTIFY_FROM) return false;
  const n = NOTICES[kind];
  const account = `${origin}/account/`;
  const e = escapeHtml(who);
  const html =
    `<p>${n.zh(e)}</p><p>${n.en(e)}</p>` +
    `<p>管理家庭会员 / Manage your family membership: <a href="${escapeHtml(account)}">${escapeHtml(account)}</a></p>`;
  const text = `${n.zh(who)}\n${n.en(who)}\n\n管理家庭会员 / Manage your family membership: ${account}`;
  try {
    await sendEmailBatch(env, [{ to, subject: n.subject, html, text }]);
    return true;
  } catch {
    return false;
  }
}

// Seat and people rows for one household (display only; the cap lives in SQL).
async function householdRows(ctx, H) {
  const [linked, hm, invites] = await Promise.all([
    ctx.DB.select('members', {
      columns: 'id,full_name,email',
      filters: [`household_id=eq.${H.id}`],
      limit: 50,
    }),
    ctx.DB.select('household_members', {
      columns: 'id,member_id,full_name,relationship,created_at',
      filters: [`household_id=eq.${H.id}`],
      order: 'created_at.asc',
      limit: 50,
    }),
    ctx.DB.select('household_invites', {
      columns: INVITE_COLS,
      filters: [`household_id=eq.${H.id}`],
      order: 'created_at.desc',
      limit: 50,
    }),
  ]);
  return { linked: linked.rows, hm: hm.rows, invites: invites.rows };
}

function buildPeople(H, linked, hm) {
  const linkedIds = new Set(linked.map((m) => m.id));
  const people = hm.map((p) => ({
    id: p.id,
    kind: p.member_id ? 'account' : 'name_only',
    member_id: p.member_id || null,
    full_name: p.full_name ?? null,
    relationship: p.relationship ?? null,
    is_founder: !!p.member_id && p.member_id === H.founder_member_id,
    linked: !!p.member_id && linkedIds.has(p.member_id),
  }));
  const covered = new Set(hm.map((p) => p.member_id).filter(Boolean));
  for (const m of linked) {
    if (covered.has(m.id)) continue;
    people.push({
      id: m.id,
      kind: 'account',
      member_id: m.id,
      full_name: m.full_name ?? null,
      relationship: null,
      is_founder: m.id === H.founder_member_id,
      linked: true,
    });
  }
  return people;
}

const publicInvite = (inv) => ({
  id: inv.id,
  email: inv.email,
  full_name: inv.full_name ?? null,
  relationship: inv.relationship ?? null,
  status: isExpired(inv) ? 'expired' : inv.status,
  created_at: inv.created_at,
  expires_at: inv.expires_at,
});

async function invitationsForMe(ctx) {
  if (!ctx.email) return [];
  const { rows } = await ctx.DB.select('household_invites', {
    columns:
      'id,household_id,invited_by,member_id,status,expires_at,households(name,status,founder_member_id)',
    filters: [`email=eq.${encodeURIComponent(ctx.email)}`, 'status=eq.pending'],
    order: 'created_at.desc',
    limit: 20,
  });
  const out = [];
  for (const inv of rows) {
    if (isExpired(inv)) {
      await expireInvite(ctx, inv);
      continue;
    }
    const h = inv.households || {};
    if (h.status === 'cancelled') continue;
    out.push({
      id: inv.id,
      household_name: h.name ?? null,
      founder_email: await loginEmail(ctx.env, h.founder_member_id || inv.invited_by),
      expires_at: inv.expires_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------- GET

export async function onRequestGet({ request, env }) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  try {
    const ctx = await load(env, gate.user);
    const out = {
      role: ctx.role,
      household: null,
      plan: null,
      founder: null,
      seats: { used: 0, limit: FAMILY_LIMIT },
      people: [],
      invites: [],
      events: [],
      invitations_for_me: await invitationsForMe(ctx),
    };
    const H = ctx.household;
    if (!H) return json(out);

    const founderRow = !H.founder_member_id
      ? null
      : H.founder_member_id === ctx.member.id
        ? ctx.member
        : await ctx.DB.selectOne('members', { id: H.founder_member_id }, MEMBER_COLS);
    const planSrc = H.founder_member_id ? founderRow : H;
    const { linked, hm, invites } = await householdRows(ctx, H);
    const pending = invites.filter((i) => i.status === 'pending' && !isExpired(i));

    out.household = { id: H.id, name: H.name, status: H.status };
    out.plan = planSrc
      ? {
          tier_id: planSrc.tier_id ?? null,
          status: planSrc.status ?? null,
          expires_at: planSrc.expires_at ?? null,
        }
      : null;
    out.founder = H.founder_member_id
      ? {
          member_id: H.founder_member_id,
          email: ctx.role === 'founder' ? ctx.email : await loginEmail(env, H.founder_member_id),
        }
      : null;
    out.people = buildPeople(H, linked, hm);
    out.seats.used = linked.length + hm.filter((p) => !p.member_id).length + pending.length;

    if (ctx.role === 'founder') {
      for (const inv of invites.filter(isExpired)) await expireInvite(ctx, inv);
      out.invites = invites.map(publicInvite);
      const { rows } = await ctx.DB.select('household_events', {
        columns:
          'type,subject_email,created_at,actor:members!household_events_actor_member_id_fkey(email)',
        filters: [`household_id=eq.${H.id}`],
        order: 'created_at.desc',
        limit: 50,
      });
      out.events = rows.map((e) => ({
        type: e.type,
        actor_email: e.actor?.email ?? null,
        subject_email: e.subject_email ?? null,
        created_at: e.created_at,
      }));
    }
    return json(out);
  } catch {
    return bad('Could not load your family right now. Please try again.', 502);
  }
}

// ---------------------------------------------------------------- POST

export async function onRequestPost({ request, env }) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const action = ACTIONS[b?.action];
  if (!action || !Object.hasOwn(ACTIONS, b.action)) return bad('Unknown action.');
  try {
    const ctx = await load(env, gate.user);
    if (!ctx.member) return bad('Member not found.', 404);
    ctx.origin = new URL(request.url).origin;
    return await action(ctx, b);
  } catch {
    return bad('Something went wrong. Please try again.', 502);
  }
}

const notFounder = (ctx) => (ctx.role === 'founder' ? null : bad(FOUNDER_ONLY, 403));

// The founder's household, creating it for a family-plan member who has none yet.
async function founderHousehold(ctx) {
  if (ctx.role === 'founder') return { id: ctx.household.id };
  if (ctx.role === 'member') return { error: bad(FOUNDER_ONLY, 403) };
  if (ctx.member.tier_id !== 'family')
    return { error: bad('Only a member on the family plan can start a family.', 403) };
  const res = await ctx.DB.rpc('family_create_household', {
    p_founder: ctx.member.id,
    p_name: `${ctx.email}'s family`,
    p_full_name: ctx.member.full_name || ctx.email,
    p_email: ctx.email,
  });
  if (!res?.ok) return { error: refusal(res?.reason) };
  return { id: res.household_id };
}

async function findHouseholdInvite(ctx, id) {
  if (!UUID.test(String(id || ''))) return { error: bad('invite_id is required.') };
  const inv = await ctx.DB.selectOne(
    'household_invites',
    { id, household_id: ctx.household.id },
    INVITE_COLS,
  );
  return inv ? { inv } : { error: bad('Invitation not found.', 404) };
}

// Send the Supabase Auth email for one invitation. Returns { delivered } or { error }.
async function deliver(ctx, inv, user) {
  const A = authAdmin(ctx.env);
  const redirectTo = `${ctx.origin}/account/?family_invite=${inv.id}`;
  const flag = { family_invite_from: ctx.email };
  let res;
  let delivered;
  let flagged = null;
  try {
    if (!user) {
      delivered = 'invite';
      res = await A.sendInvite(inv.email, redirectTo, flag);
      if (res.ok) flagged = res.body?.id || null;
      else if (
        ALREADY_REGISTERED_CODES.includes(res.code) ||
        /already been registered/i.test(res.message)
      ) {
        // The account appeared since the lookup; send a plain sign-in link.
        delivered = 'magic_link';
        res = await A.sendMagicLink(inv.email, redirectTo);
      }
    } else {
      const confirmed = !!(user.email_confirmed_at || user.confirmed_at);
      delivered = confirmed ? 'magic_link' : 'invite';
      flagged = user.id;
      await A.updateUserMetadata(user.id, flag);
      res = confirmed
        ? await A.sendMagicLink(inv.email, redirectTo)
        : await A.sendInvite(inv.email, redirectTo);
    }
  } catch {
    res = { ok: false, status: 502, code: '', message: '' };
  } finally {
    // GoTrue renders the email from user_metadata before it answers, so clear
    // the flag now: later ordinary sign-in emails must not carry the family line.
    await clearInviteFlag(ctx.env, flagged);
  }
  if (res.ok) return { delivered, userId: flagged };
  if (res.status === 429 || RATE_LIMIT_CODES.includes(res.code))
    return { error: bad(RATE_LIMITED, 429) };
  return { error: bad(EMAIL_FAILED, 502) };
}

const ACTIONS = {
  async invite(ctx, b) {
    const email = lower(b.email);
    if (!EMAIL.test(email) || email.length > 254) return bad('Enter a valid email address.');
    const fields = personFields(b, { nameRequired: false });
    if (fields.error) return fields.error;
    if (ctx.role === 'member') return bad(FOUNDER_ONLY, 403);
    if (ctx.role === 'none' && ctx.member.tier_id !== 'family')
      return bad('Only a member on the family plan can invite people.', 403);
    if (!planActive(ctx.member)) return bad(PLAN_INACTIVE, 403);
    if (email === ctx.email) return bad("You can't invite your own email address.");

    const user = await authAdmin(ctx.env).findUserByEmail(email);
    if (user) {
      const m = await ctx.DB.selectOne('members', { id: user.id }, 'id,household_id');
      if (m?.household_id) return bad('That person is already in a family.', 409);
    }
    const house = await founderHousehold(ctx);
    if (house.error) return house.error;

    const res = await ctx.DB.rpc('family_create_invite', {
      p_household: house.id,
      p_email: email,
      p_full_name: fields.full_name,
      p_relationship: fields.relationship,
      p_invited_by: ctx.member.id,
      p_member_id: user?.id || null,
    });
    if (!res?.ok) return refusal(res?.reason);
    const inv = res.invite;

    const sent = await deliver(ctx, inv, user);
    if (sent.error) {
      // Free the seat: nobody was told about this invitation.
      await ctx.DB.update(
        'household_invites',
        { id: inv.id, status: 'pending' },
        { status: 'cancelled', responded_at: iso() },
      );
      return sent.error;
    }
    if (sent.userId && !inv.member_id) {
      await ctx.DB.update('household_invites', { id: inv.id }, { member_id: sent.userId });
      inv.member_id = sent.userId;
    }
    await logEvent(ctx, house.id, 'invite_sent', {
      subjectMember: inv.member_id || null,
      subjectEmail: email,
    });
    return json({ ok: true, invite: publicInvite(inv), delivered: sent.delivered });
  },

  async cancel_invite(ctx, b) {
    const denied = notFounder(ctx);
    if (denied) return denied;
    const { inv, error } = await findHouseholdInvite(ctx, b.invite_id);
    if (error) return error;
    if (inv.status !== 'pending') return bad(NOT_OPEN, 409);
    await ctx.DB.update(
      'household_invites',
      { id: inv.id, status: 'pending' },
      { status: isExpired(inv) ? 'expired' : 'cancelled', responded_at: iso() },
    );
    await clearInviteFlag(ctx.env, inv.member_id);
    await logEvent(ctx, ctx.household.id, 'invite_cancelled', {
      subjectMember: inv.member_id || null,
      subjectEmail: inv.email,
    });
    return json({ ok: true });
  },

  async resend_invite(ctx, b) {
    const denied = notFounder(ctx);
    if (denied) return denied;
    const { inv, error } = await findHouseholdInvite(ctx, b.invite_id);
    if (error) return error;
    if (inv.status !== 'pending') return bad(NOT_OPEN, 409);
    if (isExpired(inv)) {
      await expireInvite(ctx, inv);
      return bad(EXPIRED, 409);
    }
    if (!planActive(ctx.member)) return bad(PLAN_INACTIVE, 403);
    const user = await authAdmin(ctx.env).findUserByEmail(inv.email);
    const sent = await deliver(ctx, inv, user);
    if (sent.error) return sent.error;
    const memberId = inv.member_id || user?.id || sent.userId || null;
    if (memberId && !inv.member_id)
      await ctx.DB.update('household_invites', { id: inv.id }, { member_id: memberId });
    await logEvent(ctx, ctx.household.id, 'invite_sent', {
      subjectMember: memberId,
      subjectEmail: inv.email,
    });
    return json({ ok: true, delivered: sent.delivered });
  },

  async accept_invite(ctx, b) {
    if (!UUID.test(String(b.invite_id || ''))) return bad('invite_id is required.');
    const inv = await ctx.DB.selectOne('household_invites', { id: b.invite_id }, INVITE_COLS);
    if (!inv) return bad('Invitation not found.', 404);
    if (lower(inv.email) !== ctx.email) return refusal('wrong_email');
    if (inv.status !== 'pending') return bad(NOT_OPEN, 409);
    if (isExpired(inv)) {
      await expireInvite(ctx, inv);
      return bad(EXPIRED, 409);
    }
    const H = await ctx.DB.selectOne('households', { id: inv.household_id }, HOUSEHOLD_COLS);
    if (!H || H.status === 'cancelled') return refusal('no_household');
    const founder = H.founder_member_id
      ? await ctx.DB.selectOne('members', { id: H.founder_member_id }, MEMBER_COLS)
      : null;
    if (!planActive(H.founder_member_id ? founder : H)) return bad(PLAN_INACTIVE_ACCEPT, 403);
    if (ctx.member.household_id)
      return bad('You are already in a family. Leave it before accepting another.', 409);

    const res = await ctx.DB.rpc('family_accept_invite', {
      p_invite: inv.id,
      p_member: ctx.member.id,
      p_email: ctx.email,
      p_full_name: ctx.member.full_name || ctx.email,
    });
    if (!res?.ok) return refusal(res?.reason);

    await clearInviteFlag(ctx.env, ctx.member.id);
    await logEvent(ctx, H.id, 'joined', { subjectMember: ctx.member.id, subjectEmail: ctx.email });
    const founderEmail = await loginEmail(ctx.env, H.founder_member_id);
    const notified = await notify(ctx.env, ctx.origin, founderEmail, 'joined', ctx.email);
    return json({ ok: true, household_id: H.id, notified });
  },

  async decline_invite(ctx, b) {
    if (!UUID.test(String(b.invite_id || ''))) return bad('invite_id is required.');
    const inv = await ctx.DB.selectOne('household_invites', { id: b.invite_id }, INVITE_COLS);
    if (!inv) return bad('Invitation not found.', 404);
    if (lower(inv.email) !== ctx.email) return refusal('wrong_email');
    if (inv.status !== 'pending') return bad(NOT_OPEN, 409);
    if (isExpired(inv)) {
      await expireInvite(ctx, inv);
      return bad(EXPIRED, 409);
    }
    await ctx.DB.update(
      'household_invites',
      { id: inv.id, status: 'pending' },
      { status: 'declined', responded_at: iso(), member_id: ctx.member.id },
    );
    await clearInviteFlag(ctx.env, ctx.member.id);
    await logEvent(ctx, inv.household_id, 'invite_declined', {
      subjectMember: ctx.member.id,
      subjectEmail: ctx.email,
    });
    return json({ ok: true });
  },

  async add_person(ctx, b) {
    const fields = personFields(b, { nameRequired: true });
    if (fields.error) return fields.error;
    const house = await founderHousehold(ctx);
    if (house.error) return house.error;
    const res = await ctx.DB.rpc('family_add_person', {
      p_household: house.id,
      p_full_name: fields.full_name,
      p_relationship: fields.relationship,
    });
    if (!res?.ok) return refusal(res?.reason);
    await logEvent(ctx, house.id, 'person_added');
    const p = res.person || {};
    return json({
      ok: true,
      person: {
        id: p.id,
        kind: 'name_only',
        member_id: null,
        full_name: p.full_name ?? fields.full_name,
        relationship: p.relationship ?? fields.relationship,
        is_founder: false,
        linked: false,
      },
    });
  },

  async remove_person(ctx, b) {
    const denied = notFounder(ctx);
    if (denied) return denied;
    const pid = String(b.person_id || '');
    if (!UUID.test(pid)) return bad('person_id is required.');
    const H = ctx.household;
    const { linked, hm } = await householdRows(ctx, H);
    const people = buildPeople(H, linked, hm);
    const target = people.find((p) => p.id === pid) || people.find((p) => p.member_id === pid);
    if (!target) return bad('Person not found in your family.', 404);
    if (target.is_founder)
      return bad("You can't remove yourself. Dissolve the family instead.", 409);
    const counts = (p) => !p.is_founder && (p.kind === 'name_only' || p.linked);
    if (counts(target) && people.filter(counts).length <= 1) return bad(LAST_PERSON, 409);

    if (target.kind === 'name_only') {
      await ctx.DB.del('household_members', { id: target.id, household_id: H.id });
      await logEvent(ctx, H.id, 'person_removed');
      return json({ ok: true });
    }
    const mid = target.member_id;
    if (target.linked)
      await ctx.DB.update('members', { id: mid, household_id: H.id }, { household_id: null });
    await ctx.DB.del('household_members', { member_id: mid, household_id: H.id });
    const removedEmail = await loginEmail(ctx.env, mid);
    await logEvent(ctx, H.id, 'member_removed', { subjectMember: mid, subjectEmail: removedEmail });
    const notified = target.linked
      ? await notify(ctx.env, ctx.origin, removedEmail, 'removed', ctx.email)
      : false;
    return json({ ok: true, notified });
  },

  async leave(ctx) {
    if (ctx.role === 'none') return bad('You are not in a family.', 409);
    if (ctx.role === 'founder')
      return bad('You hold the family plan. Dissolve the family instead of leaving it.', 403);
    const H = ctx.household;
    await ctx.DB.update(
      'members',
      { id: ctx.member.id, household_id: H.id },
      { household_id: null },
    );
    await ctx.DB.del('household_members', { member_id: ctx.member.id, household_id: H.id });
    await logEvent(ctx, H.id, 'left', { subjectMember: ctx.member.id, subjectEmail: ctx.email });
    const founderEmail = await loginEmail(ctx.env, H.founder_member_id);
    const notified = await notify(ctx.env, ctx.origin, founderEmail, 'left', ctx.email);
    return json({ ok: true, notified });
  },

  async dissolve(ctx) {
    const denied = notFounder(ctx);
    if (denied) return denied;
    const H = ctx.household;
    const { rows: pending } = await ctx.DB.select('household_invites', {
      columns: 'id,member_id',
      filters: [`household_id=eq.${H.id}`, 'status=eq.pending'],
      limit: 50,
    });
    await ctx.DB.update(
      'household_invites',
      { household_id: H.id, status: 'pending' },
      { status: 'cancelled', responded_at: iso() },
    );
    for (const inv of pending) await clearInviteFlag(ctx.env, inv.member_id);
    // Unlinks every account, the founder's included.
    await ctx.DB.update('members', { household_id: H.id }, { household_id: null });
    await ctx.DB.del('household_members', { household_id: H.id });
    await ctx.DB.update('households', { id: H.id }, { status: 'cancelled' });
    await logEvent(ctx, H.id, 'dissolved');
    return json({ ok: true });
  },
};
