// POST /api/contact — stores a contact-form submission and emails a notification.
import { json, bad, sb, sendEmail } from './_lib.js';

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return bad('invalid JSON'); }
  if (!b.name || !b.email || !b.message) return bad('Name, email and message are required.');
  if (b._hp) return json({ ok: true }); // honeypot: silently accept bots

  try {
    await sb(env).insert('form_submissions', {
      kind: 'contact', name: b.name, email: b.email, phone: b.phone || null, message: b.message,
    }, { returning: false });
    await sendEmail(env, {
      subject: `CAACI contact form: ${b.name}`,
      replyTo: b.email,
      html: `<p><b>Name:</b> ${esc(b.name)}</p><p><b>Email:</b> ${esc(b.email)}</p>
             <p><b>Phone:</b> ${esc(b.phone || '-')}</p><p>${esc(b.message)}</p>`,
    });
    return json({ ok: true });
  } catch (e) { return bad(e.message, 500); }
}

const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
