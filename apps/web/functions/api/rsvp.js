// POST /api/rsvp — authenticated member RSVPs to an event.
// Requires Authorization: Bearer <supabase access token>.
import { json, bad, sb } from './_lib.js';

async function userFromToken(env, token) {
  if (!token) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return bad('invalid JSON'); }
  if (!b.event_id) return bad('event_id required');

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(env, token);
  if (!user?.id) return bad('You must be logged in to RSVP.', 401);

  try {
    await sb(env).insert('rsvps', {
      event_id: b.event_id, member_id: user.id, guests: Math.max(0, Number(b.guests) || 0),
    }, { returning: false });
    return json({ ok: true });
  } catch (e) {
    if (/duplicate|unique/i.test(e.message)) return json({ ok: true, already: true });
    return bad(e.message, 500);
  }
}
