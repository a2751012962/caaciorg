// /api/admin/households  (admin only)
//   GET    — list families, each with its linked login accounts + family members,
//            and (once migration 0017 is applied) its founder, pending
//            invitations, latest activity and seats in use. Also lists the
//            family-plan members who have no family yet (family_plan_members).
//   PUT    — create a family. With body.founder_member_id, create it for that
//            family-plan member instead, exactly as /api/family would.
//   POST   — update a family (body.id required).
//   DELETE — delete a family (its family members go too; linked accounts are kept).
// Every request is gated by requireAdmin (validates session + is_admin).
import { json, bad, sb, requireAdmin } from '../_lib.js';

const STATUSES = ['pending', 'active', 'expired', 'cancelled'];

// households <-> members has two foreign keys once 0017 adds
// households.founder_member_id, so every members embed names the one it means;
// an unhinted embed fails with PGRST201. The names are Postgres's defaults
// (<table>_<column>_fkey). members_household_id_fkey exists since 0004, so this
// query works whether or not 0017 has been applied.
const COLUMNS =
  '*,accounts:members!members_household_id_fkey(id,full_name,email,status,tier_id),people:household_members(*)';

// Founder, invitations and activity only exist after 0017. They are fetched
// separately, and a failure there leaves the families list intact.
const EXTRA_COLUMNS = [
  'id',
  'founder:members!households_founder_member_id_fkey(id,full_name,email)',
  'invites:household_invites(id,email,full_name,relationship,created_at,expires_at,person_id)',
  'events:household_events(type,subject_email,subject_name,created_at,actor:members!household_events_actor_member_id_fkey(email))',
].join(',');
const EXTRA_FILTERS = [
  'invites.status=eq.pending',
  'events.order=created_at.desc',
  'events.limit=20',
];

// Members on the family plan with no family. Imported MemberPress family plans
// start out like this; the family appears once the member invites someone from
// /account/ or an admin creates it here.
const PLAN_MEMBER_COLUMNS = 'id,full_name,email,status,member_since,expires_at';
const PLAN_MEMBER_FILTERS = ['tier_id=eq.family', 'household_id=is.null'];

// family_create_household refusals (0017).
const CREATE_REFUSAL = {
  already_in_household: ['That member is already in a family.', 409],
  no_member: ['Member not found.', 404],
};

// The self-service family cap enforced by 0017. Shown to admins for context
// only; admins are not capped.
const FAMILY_LIMIT = 3;

const isLive = (inv) => new Date(inv.expires_at).getTime() > Date.now();

// Display copy of family_seats_used (0017): linked accounts + name-only people +
// live invitations, except an invitation for a name-only person still in the
// family, which rides on that person's seat.
function seatsUsed(accounts, people, invites) {
  const nameOnly = new Set(people.filter((p) => !p.member_id).map((p) => p.id));
  const riding = (i) => !!i.person_id && nameOnly.has(i.person_id);
  return accounts.length + nameOnly.size + invites.filter((i) => !riding(i)).length;
}

function withExtras(h, x) {
  const invites = (x?.invites || []).filter(isLive);
  const events = (x?.events || []).map((e) => ({
    type: e.type,
    actor_email: e.actor?.email ?? null,
    subject_email: e.subject_email ?? null,
    subject_name: e.subject_name ?? null,
    created_at: e.created_at,
  }));
  return {
    ...h,
    founder: x?.founder ?? null,
    invites,
    events,
    seats_used: seatsUsed(h.accounts || [], h.people || [], invites),
    seats_limit: FAMILY_LIMIT,
  };
}

// Build a households patch from the request body. Returns { patch } or { error }.
async function buildPatch(b, env, { requireName }) {
  const patch = {};
  if (requireName || b.name !== undefined) {
    if (!b.name || !b.name.trim()) return { error: bad('Family name is required.') };
    patch.name = b.name.trim();
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return { error: bad('Invalid status.') };
    patch.status = b.status;
  } else if (requireName) {
    patch.status = 'active';
  }
  if (b.tier_id !== undefined) {
    if (!b.tier_id) {
      patch.tier_id = null;
    } else {
      const tier = await sb(env).selectOne('membership_tiers', { id: b.tier_id }, 'id');
      if (!tier) return { error: bad('Unknown membership tier.') };
      patch.tier_id = b.tier_id;
    }
  }
  for (const f of ['member_since', 'expires_at']) {
    if (b[f] === undefined) continue;
    if (b[f] === null || b[f] === '') {
      patch[f] = null;
    } else {
      const d = new Date(b[f]);
      if (isNaN(d.getTime())) return { error: bad(`Invalid ${f.replace('_', ' ')}.`) };
      patch[f] = d.toISOString();
    }
  }
  if (b.notes !== undefined) patch.notes = b.notes || null;
  return { patch };
}

// Start a family for a family-plan member with none, through the same
// family_create_household call /api/family uses: the member becomes its founder
// (linked account + 'head' person), so they can invite family from /account/.
async function createForMember(env, memberId) {
  if (!memberId || typeof memberId !== 'string') return bad('Member id is required.');
  const DB = sb(env);
  try {
    const m = await DB.selectOne(
      'members',
      { id: memberId },
      'id,full_name,email,tier_id,household_id',
    );
    if (!m) return bad(...CREATE_REFUSAL.no_member);
    if (m.household_id) return bad(...CREATE_REFUSAL.already_in_household);
    if (m.tier_id !== 'family') return bad('That member is not on the family plan.');
    const res = await DB.rpc('family_create_household', {
      p_founder: m.id,
      p_name: `${m.email || m.full_name}'s family`,
      p_full_name: m.full_name || m.email,
      p_email: m.email,
    });
    if (!res?.ok) {
      const [msg, status] = CREATE_REFUSAL[res?.reason] || ['Could not create the family.', 500];
      return bad(msg, status);
    }
    return json({ ok: true, household_id: res.household_id });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);
  const page = { order: 'created_at.desc', limit: 500 };
  // null = unavailable (0017 not applied yet, or the query failed).
  const extras = DB.select('households', {
    columns: EXTRA_COLUMNS,
    filters: EXTRA_FILTERS,
    ...page,
  }).then(
    ({ rows }) => rows,
    () => null,
  );
  // null = the list could not be read; the families list still loads.
  const planMembers = DB.select('members', {
    columns: PLAN_MEMBER_COLUMNS,
    filters: PLAN_MEMBER_FILTERS,
    order: 'email.asc',
    limit: 500,
  }).then(
    ({ rows }) => rows,
    () => null,
  );
  try {
    const { rows } = await DB.select('households', { columns: COLUMNS, ...page });
    const more = await extras;
    const byId = new Map((more || []).map((x) => [x.id, x]));
    return json({
      rows: rows.map((h) => withExtras(h, byId.get(h.id))),
      invites_available: more !== null,
      family_plan_members: await planMembers,
    });
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
  if (b.founder_member_id !== undefined) return createForMember(env, b.founder_member_id);
  const built = await buildPatch(b, env, { requireName: true });
  if (built.error) return built.error;

  try {
    const [row] = await sb(env).insert('households', built.patch);
    return json({ ok: true, household: row });
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
  if (!b.id) return bad('Family id is required.');
  const built = await buildPatch(b, env, { requireName: false });
  if (built.error) return built.error;
  if (Object.keys(built.patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('households', { id: b.id }, built.patch);
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) {
    try {
      id = (await request.json()).id || '';
    } catch {
      /* no body */
    }
  }
  if (!id) return bad('Family id is required.');

  try {
    await sb(env).del('households', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
