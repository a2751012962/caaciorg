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
//        An optional `volunteer: { name, phone }` also signs the registrant up
//        to help at this event (event_volunteers, source 'registration'); the
//        signed-in GET reports that row so the page can pre-fill the box, and
//        an explicit `volunteer: false` (the pre-filled box un-ticked) removes
//        the sign-up again.
// A bad or expired token is treated as signed out, never as an error.
// event_registrations is server-only (0015): read and written here and by
// /api/admin/event-registrations, with the service-role key.
import { json, bad, sb, sendEmail } from './_lib.js';
import { validateQuestions, validateAnswers, perkOf, registrationOpen } from './_event-form.js';
import { registrationConfirmation, emailLogo } from './_event-emails.js';
import {
  EMAIL_RE,
  optionalUser,
  volunteerFields,
  saveVolunteer,
  questionsOf,
} from './_volunteers.js';
import { requireHuman, turnstileToken } from './_turnstile.js';

const EVENT_COLUMNS =
  'id,slug,title,title_zh,description,description_zh,starts_at,ends_at,location,perk_deadline,perk_item_zh,perk_item_en,registration_questions,volunteer_questions,published';

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
        description_zh: event.description_zh ?? null,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        location: event.location,
        perk: perkOf(event),
        questions,
        open: registrationOpen(event),
        // The event's own volunteer questions (0035), or null: with its own the
        // page points volunteers at /events/<slug>/volunteer/ instead of the
        // name-and-phone box, which cannot ask them.
        volunteer_questions: questionsOf(event.volunteer_questions),
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
    // The volunteer sign-up is keyed on (event_id, email) only — a row is
    // never looked up by account, so it follows the address the form uses.
    const vol = email
      ? await DB.selectOne(
          'event_volunteers',
          { event_id: event.id, email },
          'name,phone,created_at',
        )
      : null;
    return json({
      ...out,
      signed_in: true,
      email: user.email || null,
      registration: reg ? { registered_at: reg.created_at, updated_at: reg.updated_at } : null,
      volunteer: vol
        ? { name: vol.name, phone: vol.phone ?? null, created_at: vol.created_at }
        : null,
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

  // A registration mails the address it is given and writes the row for that
  // (event, email) pair — both worth proving a person asked for. After the
  // field checks above: a typo should not spend a single-use Turnstile token.
  const human = await requireHuman(request, env, 'event_register', turnstileToken(b));
  if (human.error) return human.error;

  try {
    const DB = sb(env);
    const form = await loadForm(DB, slug);
    if (form.error) return form.error;
    const { event, questions } = form;
    if (!registrationOpen(event)) return bad('Registration for this event has closed.', 409);

    const checked = validateAnswers(questions, b.answers);
    if (checked.error) return bad(checked.error);
    const { answers } = checked;

    // "I'd also like to volunteer at this event": an absent or null key leaves
    // the registration exactly as it was before this field existed. An explicit
    // `false` is the page saying the box was un-ticked after a pre-filled GET,
    // which has to remove the sign-up — otherwise the only way off the
    // volunteer list is to ask an admin.
    const unvolunteer = b.volunteer === false;
    let volunteer = null;
    if (b.volunteer != null && b.volunteer !== false) {
      const v = volunteerFields(b.volunteer, { nameRequired: 'Enter your name to volunteer.' });
      if (v.error) return bad(v.error);
      volunteer = v;
    }

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

    // Only after the registration is saved: the registration is what the
    // person came for, and the sign-up hangs off it.
    if (volunteer) {
      // An upsert has to send every column it wants to keep, so a box ticked
      // here would rewrite source to 'registration' on a row that /volunteer/
      // created — and the admin list would then credit the wrong form. Read
      // the existing row first and send back its own source; only a sign-up
      // this form actually creates is a 'registration' one.
      const prior = await DB.selectOne('event_volunteers', { event_id: event.id, email }, 'source');
      await saveVolunteer(DB, {
        eventId: event.id,
        name: volunteer.name,
        email,
        phone: volunteer.phone,
        message: null,
        source: prior?.source || 'registration',
        memberId,
      });
    } else if (unvolunteer) {
      // Same order for the same reason: the registration is saved first, and
      // dropping the sign-up cannot undo it. Deleting a row that is not there
      // is a no-op, so an un-ticked box on a first registration costs one
      // harmless request.
      await DB.del('event_volunteers', { event_id: event.id, email });
    }

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
      volunteer: !!volunteer,
      perk: perkOf(event),
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
