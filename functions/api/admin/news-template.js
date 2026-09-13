// /api/admin/news-template?event_id=<uuid>  (admin only)
//   GET — the "event announcement" email for one event, { subject, html },
//         for admin Compose News to fill in; the admin edits it and sends it
//         through /api/admin/news as usual. Nothing is sent from here.
// The email's button links to the event's registration page, which exists
// only for a published event that takes registrations, so any other event is
// refused (409) rather than announced with a link that answers "not found".
// Links use the origin the admin panel is served from.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { eventAnnouncement, emailLogo } from '../_event-emails.js';

const COLUMNS =
  'id,slug,title,title_zh,description,starts_at,ends_at,location,perk_deadline,perk_item_zh,perk_item_en,registration_questions,published';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const eventId = (url.searchParams.get('event_id') || '').trim();
  if (!eventId) return bad('event_id required');
  if (!UUID.test(eventId)) return bad('Event not found.', 404);

  try {
    const event = await sb(env).selectOne('events', { id: eventId }, COLUMNS);
    if (!event) return bad('Event not found.', 404);
    if (event.published !== true) return bad('Publish this event before announcing it.', 409);
    if (event.registration_questions == null)
      return bad('Turn on registrations for this event before announcing it.', 409);

    const { subject, html } = eventAnnouncement({
      origin: url.origin,
      logo: emailLogo(env.SUPABASE_URL),
      event,
      now: Date.now(),
    });
    return json({ subject, html });
  } catch (e) {
    return bad(e.message, 500);
  }
}
