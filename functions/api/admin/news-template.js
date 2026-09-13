// /api/admin/news-template?template=<name>&event_id=<uuid>  (admin only)
//   GET — one Compose News template filled in, { subject, html }, for the
//         admin to edit and send through /api/admin/news as usual. Nothing is
//         sent from here. `template` defaults to announcement:
//     announcement — registration is open. Its button links to the event's
//       registration page, which exists only for a published event that takes
//       registrations, so any other event is refused (409) rather than
//       announced with a link that answers "not found".
//     reminder — the event is coming up. Refused (409) for an unpublished
//       event; it links to the registration page only when the event takes
//       registrations, and to /events/ otherwise.
//     thanks — thank you for coming, for any event.
//     general, renewal — a general announcement and a membership renewal
//       reminder. They need no event: event_id is ignored and nothing is read.
// Links use the origin the admin panel is served from.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import {
  newsTemplate,
  emailLogo,
  EVENT_NEWS_TEMPLATES,
  SITE_NEWS_TEMPLATES,
} from '../_event-emails.js';

const COLUMNS =
  'id,slug,title,title_zh,description,starts_at,ends_at,location,perk_deadline,perk_item_zh,perk_item_en,registration_questions,published';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const name = (url.searchParams.get('template') || 'announcement').trim();
  const forEvent = EVENT_NEWS_TEMPLATES.includes(name);
  if (!forEvent && !SITE_NEWS_TEMPLATES.includes(name)) return bad('Unknown template.');
  const base = { origin: url.origin, logo: emailLogo(env.SUPABASE_URL), now: Date.now() };
  if (!forEvent) {
    const { subject, html } = newsTemplate(name, base);
    return json({ subject, html });
  }

  const eventId = (url.searchParams.get('event_id') || '').trim();
  if (!eventId) return bad('event_id required');
  if (!UUID.test(eventId)) return bad('Event not found.', 404);

  try {
    const event = await sb(env).selectOne('events', { id: eventId }, COLUMNS);
    if (!event) return bad('Event not found.', 404);
    if (name === 'announcement') {
      if (event.published !== true) return bad('Publish this event before announcing it.', 409);
      if (event.registration_questions == null)
        return bad('Turn on registrations for this event before announcing it.', 409);
    }
    if (name === 'reminder' && event.published !== true)
      return bad('Publish this event before sending a reminder.', 409);

    const { subject, html } = newsTemplate(name, { ...base, event });
    return json({ subject, html });
  } catch (e) {
    return bad(e.message, 500);
  }
}
