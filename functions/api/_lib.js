// Shared helpers for Cloudflare Pages Functions.
// No npm deps — uses fetch so it runs on the Workers runtime.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const bad = (msg, status = 400) => json({ error: msg }, status);

// --- Supabase REST (PostgREST) using the service-role key (bypasses RLS) ---
export function sb(env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  return {
    async insert(table, row, { returning = true } = {}) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, prefer: returning ? 'return=representation' : 'return=minimal' },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`supabase insert ${table}: ${r.status} ${await r.text()}`);
      return returning ? r.json() : null;
    },
    async update(table, match, patch) {
      const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
      const r = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        method: 'PATCH',
        headers: { ...headers, prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`supabase update ${table}: ${r.status} ${await r.text()}`);
    },
    async selectOne(table, match, columns = '*') {
      const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
      const r = await fetch(`${base}/rest/v1/${table}?select=${columns}&${qs}&limit=1`, { headers });
      if (!r.ok) throw new Error(`supabase select ${table}: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      return rows[0] || null;
    },
  };
}

// --- Stripe via raw form-encoded API calls ---
export function stripe(env) {
  const key = env.STRIPE_SECRET_KEY;
  const call = async (path, params) => {
    const body = new URLSearchParams();
    const add = (k, v) => { if (v !== undefined && v !== null) body.append(k, String(v)); };
    // flatten nested params (Stripe's bracket syntax)
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else if (Array.isArray(v)) v.forEach((item, i) =>
          (item && typeof item === 'object') ? walk(item, `${key}[${i}]`) : add(`${key}[${i}]`, item));
        else add(key, v);
      }
    };
    walk(params, '');
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
  return { call };
}

// Send a notification email (Resend by default; falls back to no-op if unset).
export async function sendEmail(env, { subject, html, replyTo }) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !env.NOTIFY_TO) return; // not configured
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.NOTIFY_FROM, to: env.NOTIFY_TO, subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
}
