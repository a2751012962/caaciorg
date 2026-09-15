// Shared by the two public endpoints that write event_volunteers (0021):
// /api/volunteer (the /volunteer/ page) and /api/event-register (the "I'd also
// like to volunteer" box on an event's registration form). Kept here so both
// write the same row shape and agree on what counts as a signed-in caller and
// on which events are still open to sign up for.
import { requireUser } from './_lib.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Upsert one sign-up. Never sends created_at (the first sign-up time must
// survive a second submission) and never member_id: null (a signed-out
// resubmission must not unlink the account an earlier signed-in one recorded).
// `message` is left out the same way when there is none: the registration
// form has no message field at all, so sending null there would wipe the "how
// I can help" note the same person wrote on /volunteer/.
// The unique index is (event_id, email) `nulls not distinct`, so the event_id
// null "wherever needed" row merges like any other.
export function saveVolunteer(DB, { eventId, name, email, phone, message, source, memberId }) {
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
    },
    { onConflict: 'event_id,email' },
  );
}
