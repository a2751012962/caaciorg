// /api/admin/event-registrations?event_id=<uuid>  (admin only)
//   GET — every registration for one event, oldest first, each matched to a
//         website account and marked eligible (or not) for the free gift.
// Effective deadline = events.perk_deadline ?? events.starts_at, inclusive.
// Eligible = registered by the deadline AND an account exists (members.id =
// member_id, else lower(members.email) = email) that was created by it too.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const MAX_ROWS = 2000;
const MAX_MEMBERS = 5000;
const ROW_COLUMNS =
  'id,email,attending,attendee_names,heard_from,wants_meal,created_at,updated_at,member_id';
// events.id is a uuid: anything else can't match, and PostgREST would answer a
// malformed one with a cast error (500) rather than an empty result.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const eventId = (new URL(request.url).searchParams.get('event_id') || '').trim();
  if (!eventId) return bad('event_id required');
  if (!UUID.test(eventId)) return bad('Event not found.', 404);

  try {
    const DB = sb(env);
    const event = await DB.selectOne('events', { id: eventId }, 'id,title,starts_at,perk_deadline');
    if (!event) return bad('Event not found.', 404);
    const deadline = event.perk_deadline ?? event.starts_at;
    const cutoff = Date.parse(deadline);

    const [{ rows: regs }, { rows: members }] = await Promise.all([
      DB.select('event_registrations', {
        columns: ROW_COLUMNS,
        filters: [`event_id=eq.${eventId}`],
        order: 'created_at.asc',
        limit: MAX_ROWS,
      }),
      // Oldest first, so when two rows share an address the earliest account wins.
      DB.select('members', {
        columns: 'id,email,created_at,status,tier_id',
        order: 'created_at.asc',
        limit: MAX_MEMBERS,
      }),
    ]);

    // members.email keeps whatever case the account was made with; registrations
    // are stored lower-cased, so match on the lower-cased address.
    const byId = new Map();
    const byEmail = new Map();
    for (const m of members) {
      byId.set(m.id, m);
      const key = String(m.email || '')
        .trim()
        .toLowerCase();
      if (key && !byEmail.has(key)) byEmail.set(key, m);
    }
    const onTime = (ts) => !!ts && Date.parse(ts) <= cutoff;

    const summary = {
      total: 0,
      attending: 0,
      not_attending: 0,
      meal: 0,
      with_account: 0,
      perk_eligible: 0,
    };
    const rows = regs.map((r) => {
      const m = (r.member_id && byId.get(r.member_id)) || byEmail.get(r.email) || null;
      const account = m
        ? { id: m.id, created_at: m.created_at, status: m.status, tier_id: m.tier_id }
        : null;
      const perk_eligible = onTime(r.created_at) && !!account && onTime(account.created_at);

      summary.total++;
      if (r.attending === true) summary.attending++;
      if (r.attending === false) summary.not_attending++;
      if (r.wants_meal === true) summary.meal++;
      if (account) summary.with_account++;
      if (perk_eligible) summary.perk_eligible++;

      return {
        id: r.id,
        email: r.email,
        attending: r.attending,
        attendee_names: r.attendee_names,
        heard_from: r.heard_from,
        wants_meal: r.wants_meal,
        created_at: r.created_at,
        updated_at: r.updated_at,
        member_id: r.member_id,
        account,
        perk_eligible,
      };
    });

    return json({
      event: {
        id: event.id,
        title: event.title,
        starts_at: event.starts_at,
        perk_deadline: event.perk_deadline,
        deadline,
      },
      rows,
      summary,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
