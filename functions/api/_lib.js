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
      const qs = Object.entries(match)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join('&');
      const r = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        method: 'PATCH',
        headers: { ...headers, prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`supabase update ${table}: ${r.status} ${await r.text()}`);
    },
    async selectOne(table, match, columns = '*') {
      const qs = Object.entries(match)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join('&');
      const r = await fetch(`${base}/rest/v1/${table}?select=${columns}&${qs}&limit=1`, {
        headers,
      });
      if (!r.ok) throw new Error(`supabase select ${table}: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      return rows[0] || null;
    },
    // Multi-row select. `filters` is an array of raw PostgREST clauses, e.g.
    //   ['status=eq.active', 'or=(full_name.ilike.*ann*,email.ilike.*ann*)']
    // Returns { rows, total } — total comes from the Content-Range header when
    // `count` is set ('exact' | 'estimated' | 'planned').
    async select(
      table,
      { columns = '*', filters = [], order, limit = 25, offset = 0, count } = {},
    ) {
      const qs = [`select=${columns}`, ...filters, `limit=${limit}`, `offset=${offset}`];
      if (order) qs.push(`order=${order}`);
      const h = { ...headers };
      if (count) h.prefer = `count=${count}`;
      const r = await fetch(`${base}/rest/v1/${table}?${qs.join('&')}`, { headers: h });
      if (!r.ok) throw new Error(`supabase select ${table}: ${r.status} ${await r.text()}`);
      const rows = await r.json();
      // Content-Range looks like "0-24/137"; the part after the slash is the total.
      const range = r.headers.get('content-range') || '';
      const total = range.includes('/') ? Number(range.split('/')[1]) : rows.length;
      return { rows, total: Number.isFinite(total) ? total : rows.length };
    },
  };
}

// --- Admin gate: validate the caller's Supabase session, then confirm is_admin ---
// Returns { member, user } on success, or { error: Response } to return directly.
// The is_admin check uses the service-role select (authoritative) — never trust
// the JWT claims, since admin Functions use sb() which bypasses RLS.
export async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { error: bad('Missing bearer token.', 401) };

  // Validate the access token against Supabase Auth (reflects expiry/revocation).
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { error: bad('Invalid or expired session.', 401) };
  const user = await r.json();
  if (!user?.id) return { error: bad('Invalid session.', 401) };

  const member = await sb(env).selectOne('members', { id: user.id }, 'id,email,full_name,is_admin');
  if (!member || member.is_admin !== true) return { error: bad('Admin access required.', 403) };
  return { member, user };
}

// --- Stripe via raw form-encoded API calls ---
export function stripe(env) {
  const key = env.STRIPE_SECRET_KEY;
  const call = async (path, params) => {
    const body = new URLSearchParams();
    const add = (k, v) => {
      if (v !== undefined && v !== null) body.append(k, String(v));
    };
    // flatten nested params (Stripe's bracket syntax)
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}[${k}]` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else if (Array.isArray(v))
          v.forEach((item, i) =>
            item && typeof item === 'object'
              ? walk(item, `${key}[${i}]`)
              : add(`${key}[${i}]`, item),
          );
        else add(key, v);
      }
    };
    walk(params, '');
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
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
      from: env.NOTIFY_FROM,
      to: env.NOTIFY_TO,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
}

// Send many DISTINCT messages in one call (Resend batch; max 100 per call) so a
// large news blast uses few subrequests and stays within the Workers limit.
// `messages` is an array of { to, subject, html, text? }. Returns how many were
// accepted. Throws if Resend isn't configured or the call fails.
export async function sendEmailBatch(env, messages) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) throw new Error('Email is not configured.');
  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      messages.map((m) => ({
        from: env.NOTIFY_FROM,
        to: m.to,
        subject: m.subject,
        html: m.html,
        ...(m.text ? { text: m.text } : {}),
      })),
    ),
  });
  if (!r.ok) throw new Error(`resend batch: ${r.status} ${await r.text()}`);
  const data = await r.json();
  return Array.isArray(data?.data) ? data.data.length : messages.length;
}
