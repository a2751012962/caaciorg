// POST /api/business-listing — submits a business for the directory (pending approval).
import { json, bad, sb, sendEmail } from './_lib.js';

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return bad('invalid JSON'); }
  if (!b.name || !b.email) return bad('Business name and contact email are required.');
  if (b._hp) return json({ ok: true });

  try {
    await sb(env).insert('business_directory', {
      name: b.name, category: b.category || 'other', description: b.description || null,
      address: b.address || null, phone: b.phone || null, website: b.website || null,
      approved: false,
    }, { returning: false });
    await sendEmail(env, {
      subject: `CAACI business listing: ${b.name}`,
      replyTo: b.email,
      html: `<p>New business directory submission (pending approval):</p>
             <p><b>${esc(b.name)}</b> — ${esc(b.category || 'other')}</p>
             <p>${esc(b.description || '')}</p>`,
    });
    return json({ ok: true });
  } catch (e) { return bad(e.message, 500); }
}

const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
