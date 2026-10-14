// /api/admin/event-volunteers  (admin only)
//   GET ?event_id=<uuid> — everyone who offered to help with one event, oldest
//        first, with the event itself and a head-count summary.
//   GET ?scope=all (or no event_id) — every sign-up, newest first, each row
//        carrying its own event so the panel can list and filter them together.
//        The "no particular event" rows (event_id null) come back with event null.
//   DELETE body/query { id } — remove one sign-up (admin housekeeping; someone
//        who asked to be taken off the list, or an obvious duplicate).
// Sign-ups come from two places (event_volunteers.source): the /volunteer/ page
// and the "I'd also like to volunteer" box on an event's registration form.
// A row is matched to a website account the same way registrations are —
// member_id first, else lower(members.email) — but nothing here depends on the
// email being confirmed, so the (slow, paged) GoTrue user listing is not read.
// Every request is gated by requireAdmin.
// Answers (0035): each row carries its `answers`, and the response says which
// questions they answer — `questions` is the site's default volunteer form,
// and each event that has its own carries it as event.questions (null = the
// default). The panel counts the choices itself.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { questionsOf, defaultVolunteerQuestions } from '../_volunteers.js';

const MAX_ROWS = 2000;
const MAX_MEMBERS = 5000;
const EVENT_COLUMNS = 'id,slug,title,title_zh,starts_at,volunteer_questions';
const ROW_COLUMNS =
  'id,event_id,name,email,phone,message,source,member_id,answers,created_at,updated_at';
// The events FK (0021) makes this embed resolvable, so one request carries the
// event of every sign-up instead of one lookup per distinct event_id.
const ROW_COLUMNS_WITH_EVENT = `${ROW_COLUMNS},events(slug,title,title_zh,starts_at,volunteer_questions)`;
// events.id and event_volunteers.id are uuids: anything else can't match, and
// PostgREST would answer a malformed one with a cast error (500) rather than an
// empty result.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eventOf = (e) =>
  e
    ? {
        slug: e.slug,
        title: e.title,
        title_zh: e.title_zh ?? null,
        starts_at: e.starts_at,
        questions: questionsOf(e.volunteer_questions),
      }
    : null;

const answersOf = (r) => (r.answers && typeof r.answers === 'object' ? r.answers : {});

// members.email keeps whatever case the account was made with; volunteer rows
// are stored lower-cased, so match on the lower-cased address.
function accountIndex(members) {
  const byId = new Map();
  const byEmail = new Map();
  for (const m of members) {
    byId.set(m.id, m);
    const key = String(m.email || '')
      .trim()
      .toLowerCase();
    if (key && !byEmail.has(key)) byEmail.set(key, m);
  }
  return (row) => {
    const m = (row.member_id && byId.get(row.member_id)) || byEmail.get(row.email) || null;
    // expires_at comes too, so the panel can read the status as of today
    // (effectiveStatus) instead of trusting the stored column.
    return m ? { id: m.id, status: m.status, tier_id: m.tier_id, expires_at: m.expires_at } : null;
  };
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const params = new URL(request.url).searchParams;
  const eventId = (params.get('event_id') || '').trim();
  if (eventId && !UUID.test(eventId)) return bad('Event not found.', 404);

  try {
    const DB = sb(env);
    // Oldest first, so when two rows share an address the earliest account wins.
    const membersQuery = DB.select('members', {
      columns: 'id,email,created_at,status,tier_id,expires_at',
      order: 'created_at.asc',
      limit: MAX_MEMBERS,
    });

    if (!eventId) {
      const [{ rows: raw }, { rows: members }, questions] = await Promise.all([
        DB.select('event_volunteers', {
          columns: ROW_COLUMNS_WITH_EVENT,
          order: 'created_at.desc',
          limit: MAX_ROWS,
        }),
        membersQuery,
        defaultVolunteerQuestions(DB),
      ]);
      const accountOf = accountIndex(members);
      const rows = raw.map(({ events, ...r }) => ({
        ...r,
        answers: answersOf(r),
        event: eventOf(events),
        account: accountOf(r),
      }));
      return json({ rows, questions, summary: { total: rows.length } });
    }

    const event = await DB.selectOne('events', { id: eventId }, EVENT_COLUMNS);
    if (!event) return bad('Event not found.', 404);
    const own = questionsOf(event.volunteer_questions);
    const [{ rows: raw }, { rows: members }, questions] = await Promise.all([
      DB.select('event_volunteers', {
        columns: ROW_COLUMNS,
        filters: [`event_id=eq.${eventId}`],
        order: 'created_at.asc',
        limit: MAX_ROWS,
      }),
      membersQuery,
      // The default is only read when the event asks it.
      own ? Promise.resolve(own) : defaultVolunteerQuestions(DB),
    ]);
    const accountOf = accountIndex(members);
    const rows = raw.map((r) => ({
      ...r,
      answers: answersOf(r),
      event: eventOf(event),
      account: accountOf(r),
    }));
    return json({
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        title_zh: event.title_zh ?? null,
        starts_at: event.starts_at,
        questions: own,
      },
      questions,
      rows,
      summary: { total: rows.length, with_account: rows.filter((r) => r.account).length },
    });
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
  if (!id) return bad('Volunteer id is required.');
  // event_volunteers.id is a uuid too: PostgREST answers a malformed one with a
  // cast error (500) rather than deleting nothing, so check it here.
  if (!UUID.test(id)) return bad('Volunteer not found.', 404);
  try {
    await sb(env).del('event_volunteers', { id });
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
