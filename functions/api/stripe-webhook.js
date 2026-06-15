// POST /api/stripe-webhook
// Stripe calls this after checkout completes. Verifies the signature, then
// activates the membership / marks the donation paid in Supabase.
import { sb } from './_lib.js';

// Verify Stripe's signature (HMAC-SHA256) using Web Crypto (Workers-compatible).
// Exported so the signature logic can be unit-tested directly.
export async function verify(payload, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (hex.length !== v1.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  if (env.STRIPE_WEBHOOK_SECRET) {
    const ok = await verify(payload, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!ok) return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  const DB = sb(env);

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const md = s.metadata || {};
      if (md.kind === 'donation') {
        await DB.update('donations', { stripe_session_id: s.id }, { status: 'paid' });
      } else if (md.kind === 'membership' && md.member_id) {
        const now = new Date();
        const expires = new Date(now); expires.setFullYear(expires.getFullYear() + 1);
        await DB.update('members', { id: md.member_id }, {
          tier_id: md.tier_id || null,
          status: 'active',
          member_since: now.toISOString(),
          expires_at: expires.toISOString(),
          stripe_customer_id: s.customer || null,
          stripe_subscription_id: s.subscription || null,
        });
      }
    }
    return new Response('ok');
  } catch (e) {
    return new Response(`error: ${e.message}`, { status: 500 });
  }
}
