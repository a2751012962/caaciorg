// Shared by the two public endpoints that write event_volunteers (0021):
// /api/volunteer (the volunteer dialog and each event's own volunteer page)
// and /api/event-register (the "I'd also like to volunteer" box on an event's
// registration form). Kept here so both write the same row shape and agree on
// what counts as a signed-in caller, on which events are still open to sign up
// for, and on which questions a volunteer form asks (0035).
import { requireUser } from './_lib.js';
import { validateQuestions } from './_event-form.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The signed-in user behind the bearer token, or null. A bad or expired token
// is signed out, never an error — these are public forms.
export async function optionalUser(request, env) {
  try {
    return (await requireUser(request, env)).user || null;
  } catch {
    return null; // auth unreachable: carry on signed out
  }
}

// PostgREST filters for the published events that have not happened yet —
// (ends_at ?? starts_at) >= now, the registrationOpen rule as a query. Used by
// GET /api/volunteer to list them and by POST to check the slugs it was sent,
// so the two can never disagree.
export function upcomingEventFilters(now = new Date()) {
  const iso = now.toISOString();
  return ['published=eq.true', `or=(ends_at.gte.${iso},and(ends_at.is.null,starts_at.gte.${iso}))`];
}

// Volunteer name/phone as the forms accept them: trimmed, with the same limits
// on both endpoints. Returns { name, phone } or { error }.
export function volunteerFields(value, { nameRequired = 'Enter your name.' } = {}) {
  const name = String(value?.name ?? '').trim();
  if (!name) return { error: nameRequired };
  if (name.length > 120) return { error: 'That name is too long.' };
  const phone = String(value?.phone ?? '').trim();
  if (phone.length > 40) return { error: 'That phone number is too long.' };
  return { name, phone: phone || null };
}

// The questions a stored column asks (events.volunteer_questions, or a
// template's questions): the validated list, or null when the column is null
// or holds something validateQuestions refuses (a hand-edited row), which the
// callers treat the same way — "no questions of its own".
export function questionsOf(raw) {
  if (!Array.isArray(raw)) return null;
  return validateQuestions(raw).questions ?? null;
}

// The site's default volunteer questions: the form_templates row of kind
// 'volunteer' marked is_default (0035). [] when there is none, so a form with
// no questions still asks for name, email and phone.
export async function defaultVolunteerQuestions(DB) {
  const { rows } = await DB.select('form_templates', {
    columns: 'questions',
    filters: ['kind=eq.volunteer', 'is_default=eq.true'],
    limit: 1,
  });
  return questionsOf(rows?.[0]?.questions) ?? [];
}

// The sign-up already stored for (event, email), or null. A null event is the
// "wherever needed" row, which needs `is.null` — an eq filter cannot say null.
export async function priorVolunteer(DB, eventId, email, columns) {
  const { rows } = await DB.select('event_volunteers', {
    columns,
    filters: [
      eventId ? `event_id=eq.${encodeURIComponent(eventId)}` : 'event_id=is.null',
      `email=eq.${encodeURIComponent(email)}`,
    ],
    limit: 1,
  });
  return (Array.isArray(rows) && rows[0]) || null;
}

// A second submission MERGES its answers into the stored ones, key by key: the
// general sign-up made from the dialog and the event's own form filled in later
// are one row, and neither wipes the other's answers. A question answered
// again is overwritten by the new answer.
export const mergedAnswers = (prior, answers) => ({
  ...(isObject(prior) ? prior : {}),
  ...(isObject(answers) ? answers : {}),
});

// Upsert one sign-up. Never sends created_at (the first sign-up time must
// survive a second submission) and never member_id: null (a signed-out
// resubmission must not unlink the account an earlier signed-in one recorded).
// `message` is left out the same way when there is none: the registration
// form has no message field at all, so sending null there would wipe the "how
// I can help" note the same person wrote on /volunteer/. `answers` likewise:
// a caller that asked no questions sends none, and the stored ones stay.
// The unique index is (event_id, email) `nulls not distinct`, so the event_id
// null "wherever needed" row merges like any other. Returns the stored row(s).
export function saveVolunteer(
  DB,
  { eventId, name, email, phone, message, source, memberId, answers },
) {
  return DB.upsert(
    'event_volunteers',
    {
      event_id: eventId ?? null,
      name,
      email,
      phone: phone ?? null,
      source,
      updated_at: new Date().toISOString(),
      ...(message == null || message === '' ? {} : { message }),
      ...(memberId ? { member_id: memberId } : {}),
      ...(isObject(answers) ? { answers } : {}),
    },
    { onConflict: 'event_id,email' },
  );
}
