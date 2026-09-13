// /api/event-register — public registration for an event, no account needed
// (/events/<slug>/register/, and /mid_autumn_festival_form/ from the printed QR
// codes). Only published events whose registration_questions is not null take
// registrations (0018); any other slug is "not found".
//   GET  ?event=<slug> — the event's details, its free gift, its questions and
//        whether registration is still open. With a valid Authorization:
//        Bearer <supabase access token>, also the caller's email and their
//        registration, so the page can show "registered". Signed out, nothing
//        about any email.
//   POST — create or update the registration for (event, email) with answers
//        checked against the event's questions (_event-form.js). A resubmission
//        overwrites the answers but keeps created_at, the first submission time
//        that decides the free gift; only the first one gets a confirmation.
//        Signed in, the row is linked to the account (member_id, `linked: true`)
//        only when the form email is the account's own login email.
// A bad or expired token is treated as signed out, never as an error.
// event_registrations is server-only (0015): read and written here and by
// /api/admin/event-registrations, with the service-role key.
import { json, bad, sb, sendEmail, requireUser } from './_lib.js';
import { validateQuestions, validateAnswers, perkOf, registrationOpen } from './_event-form.js';
import { registrationConfirmation, emailLogo } from './_event-emails.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENT_COLUMNS =
  'id,slug,title,title_zh,description,starts_at,ends_at,location,perk_deadline,perk_item_zh,perk_item_en,registration_questions,published';

// The signed-in user behind the bearer token, or null.
async function optionalUser(request, env) {
  try {
    return (await requireUser(request, env)).user || null;
  } catch {
    return null; // auth unreachable: carry on signed out
  }
}

// The event and its questions → { event, questions }, or { error: Response }.
// An unpublished event, or one that takes no registrations, is not found.
async function loadForm(DB, slug) {
  const event = await DB.selectOne('events', { slug }, EVENT_COLUMNS);
  if (!event || event.published !== true || event.registration_questions == null)
    return { error: bad('Event not found.', 404) };
  // Saved through validateQuestions, so this only fails for a hand-edited row.
  const { questions, error } = validateQuestions(event.registration_questions);
  if (error) return { error: bad(`This event's registration form is invalid: ${error}`, 500) };
  return { event, questions };
}

export async function onRequestGet({ request, env }) {
  const slug = (new URL(request.url).searchParams.get('event') || '').trim();
  if (!slug) return bad('event required');

  try {
    const DB = sb(env);
    const form = await loadForm(DB, slug);
    if (form.error) return form.error;
    const { event, questions } = form;

    const out = {
      event: {
        slug: event.slug,
        title: event.title,
        title_zh: event.title_zh ?? null,
        description: event.description,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        location: event.location,
        perk: perkOf(event),
        questions,
        open: registrationOpen(event),
      },
      signed_in: false,
    };
    const user = await optionalUser(request, env);
    if (!user) return json(out);

    // By the login email first (it may have been sent signed out), else by the
    // account (signed in, but under another address). Two eq lookups: an email
    // can contain PostgREST syntax, so it never goes into an or=() filter.
    const cols = 'created_at,updated_at';
    const email = String(user.email || '').toLowerCase();
    const reg =
      (email && (await DB.selectOne('event_registrations', { event_id: event.id, email }, cols))) ||
      (await DB.selectOne('event_registrations', { event_id: event.id, member_id: user.id }, cols));
    return json({
      ...out,
      signed_in: true,
      email: user.email || null,
      registration: reg ? { registered_at: reg.created_at, updated_at: reg.updated_at } : null,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b || typeof b !== 'object') return bad('invalid JSON');
  if (b._hp) return json({ ok: true }); // honeypot: silently accept bots

  const slug = String(b.event ?? '').trim();
  if (!slug) return bad('event required');

  const email = String(b.email ?? '')
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return bad('Enter a valid email address.');

  try {
    const DB = sb(env);
    const form = await loadForm(DB, slug);
    if (form.error) return form.error;
    const { event, questions } = form;
    if (!registrationOpen(event)) return bad('Registration for this event has closed.', 409);

    const checked = validateAnswers(questions, b.answers);
    if (checked.error) return bad(checked.error);
    const { answers } = checked;

    // Link the registration to the account only when it is the account's own
    // address: otherwise a signed-in user could register someone else's email
    // and have that row (and its free gift) counted against their account.
    // Registering another address is stored exactly like a signed-out one.
    const user = await optionalUser(request, env);
    const linked = !!user?.id && String(user.email || '').toLowerCase() === email;
    const memberId = linked ? user.id : null;

    const existing = await DB.selectOne(
      'event_registrations',
      { event_id: event.id, email },
      'id,created_at',
    );
    // Never send created_at: the first submission time must survive a
    // resubmission. Never send member_id: null: a signed-out resubmission must
    // not unlink the account an earlier signed-in one recorded. The Mid-Autumn
    // form's legacy columns (attending, attendee_names, heard_from, wants_meal)
    // are gone once 0019 is applied; everything is in answers.
    const [row] = await DB.upsert(
      'event_registrations',
      {
        event_id: event.id,
        email,
        answers,
        updated_at: new Date().toISOString(),
        ...(memberId ? { member_id: memberId } : {}),
      },
      { onConflict: 'event_id,email' },
    );

    if (!existing) {
      try {
        const { subject, html } = registrationConfirmation({
          origin: new URL(request.url).origin,
          logo: emailLogo(env.SUPABASE_URL),
          event,
          questions,
          answers,
          linked,
          now: Date.now(),
        });
        await sendEmail(env, { to: email, replyTo: env.NOTIFY_TO, subject, html });
      } catch {
        // The registration is saved; a lost confirmation must not fail the form.
      }
    }

    return json({
      ok: true,
      already: !!existing,
      registered_at: existing?.created_at ?? row?.created_at ?? null,
      signed_in: !!user?.id,
      linked,
      perk: perkOf(event),
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
