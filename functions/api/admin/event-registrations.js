// /api/admin/event-registrations?event_id=<uuid>  (admin only)
//   GET — the event's questions and every registration for it, oldest first,
//         each with its answers, matched to a website account and marked
//         eligible (or not) for the event's free gift; plus a summary with
//         per-option counts for the choice questions.
// An event with no gift (perk_item_zh / perk_item_en unset) has nobody eligible.
// Effective deadline = events.perk_deadline ?? events.starts_at, inclusive.
// Eligible = registered by the deadline AND a CONFIRMED account exists
// (members.id = member_id, else lower(members.email) = email) that was created
// by it too. The signup trigger (handle_new_user, 0001_init.sql) inserts the
// members row at signUp, before the email is confirmed, so a members row alone
// proves nothing; unconfirmed accounts are still returned (confirmed: false) so
// staff can see them.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { validateQuestions, perkOf } from '../_event-form.js';

const MAX_ROWS = 2000;
const MAX_MEMBERS = 5000;
const AUTH_PER_PAGE = 1000;
const AUTH_MAX_PAGES = 20;
const EVENT_COLUMNS =
  'id,slug,title,title_zh,starts_at,perk_deadline,perk_item_zh,perk_item_en,registration_questions';
const ROW_COLUMNS = 'id,email,answers,created_at,updated_at,member_id';
// events.id is a uuid: anything else can't match, and PostgREST would answer a
// malformed one with a cast error (500) rather than an empty result.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids of auth users who have confirmed their email (confirmed_at covers the
// older/phone shape). GoTrue's admin list is paged; a short page is the last.
// A failure throws: treating it as "nobody is confirmed" would silently mark
// every registrant ineligible.
async function confirmedUserIds(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const ids = new Set();
  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const r = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PER_PAGE}`,
      { headers },
    );
    if (!r.ok) throw new Error(`auth list users: ${r.status} ${await r.text()}`);
    const users = (await r.json())?.users || [];
    for (const u of users) if (u.email_confirmed_at || u.confirmed_at) ids.add(u.id);
    if (users.length < AUTH_PER_PAGE) break;
  }
  return ids;
}

// { [questionId]: { [optionId]: 0, …, other: 0 } } for the choice questions.
// Option ids are never 'other' (validateQuestions refuses it), so Other answers
// have a key of their own. An option id the question no longer has is not counted.
function emptyChoices(questions) {
  const choices = {};
  for (const q of questions) {
    if (q.type !== 'single' && q.type !== 'multi') continue;
    choices[q.id] = Object.fromEntries([...q.options.map((o) => [o.id, 0]), ['other', 0]]);
  }
  return choices;
}

function countChoices(choices, answers) {
  if (!answers || typeof answers !== 'object') return;
  for (const [questionId, counts] of Object.entries(choices)) {
    const a = Object.hasOwn(answers, questionId) ? answers[questionId] : null;
    if (!a || typeof a !== 'object') continue;
    const picked = new Set([
      ...(Array.isArray(a.options) ? a.options : []),
      ...(typeof a.option === 'string' ? [a.option] : []),
    ]);
    for (const id of picked) if (id !== 'other' && Object.hasOwn(counts, id)) counts[id]++;
    if (typeof a.other === 'string') counts.other++;
  }
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const eventId = (new URL(request.url).searchParams.get('event_id') || '').trim();
  if (!eventId) return bad('event_id required');
  if (!UUID.test(eventId)) return bad('Event not found.', 404);

  try {
    const DB = sb(env);
    const event = await DB.selectOne('events', { id: eventId }, EVENT_COLUMNS);
    if (!event) return bad('Event not found.', 404);
    const perk = perkOf(event);
    const cutoff = perk ? Date.parse(perk.deadline) : NaN;
    // A form that takes no registrations (null) still lists any it once took.
    // A hand-edited list that fails validation shows no question columns
    // rather than hiding the registrations.
    const questions = Array.isArray(event.registration_questions)
      ? validateQuestions(event.registration_questions).questions || []
      : [];

    const [{ rows: regs }, { rows: members }, confirmed] = await Promise.all([
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
      confirmedUserIds(env),
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
    // False for every timestamp when there is no gift (cutoff is NaN).
    const onTime = (ts) => !!ts && Date.parse(ts) <= cutoff;

    const summary = {
      total: 0,
      with_account: 0,
      perk_eligible: 0,
      choices: emptyChoices(questions),
    };
    const rows = regs.map((r) => {
      const m = (r.member_id && byId.get(r.member_id)) || byEmail.get(r.email) || null;
      const account = m
        ? {
            id: m.id,
            created_at: m.created_at,
            status: m.status,
            tier_id: m.tier_id,
            confirmed: confirmed.has(m.id),
          }
        : null;
      const perk_eligible =
        onTime(r.created_at) && !!account?.confirmed && onTime(account.created_at);
      const answers = r.answers && typeof r.answers === 'object' ? r.answers : {};

      summary.total++;
      if (account?.confirmed) summary.with_account++;
      if (perk_eligible) summary.perk_eligible++;
      countChoices(summary.choices, answers);

      return {
        id: r.id,
        email: r.email,
        answers,
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
        slug: event.slug,
        title: event.title,
        title_zh: event.title_zh ?? null,
        starts_at: event.starts_at,
        perk,
      },
      questions,
      rows,
      summary,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
