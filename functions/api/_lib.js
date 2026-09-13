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
    // Insert, or merge into the row that already holds the same `onConflict`
    // key (e.g. 'event_id,email' — needs a unique constraint on exactly those
    // columns). Only the columns present in `row` are overwritten on a conflict,
    // so leaving one out (e.g. created_at) keeps its stored value. Returns rows.
    async upsert(table, row, { onConflict } = {}) {
      const r = await fetch(`${base}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: { ...headers, prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`supabase upsert ${table}: ${r.status} ${await r.text()}`);
      return r.json();
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
    async del(table, match) {
      const qs = Object.entries(match)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join('&');
      const r = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        method: 'DELETE',
        headers: { ...headers, prefer: 'return=minimal' },
      });
      if (!r.ok) throw new Error(`supabase delete ${table}: ${r.status} ${await r.text()}`);
    },
    // Call a Postgres function (PostgREST /rpc). Used where a plain UPDATE would
    // race, e.g. the atomic discount-redemption counter.
    async rpc(fn, args = {}) {
      const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error(`supabase rpc ${fn}: ${r.status} ${await r.text()}`);
      return r.json().catch(() => null);
    },
  };
}

// --- Supabase Auth Admin API (service-role) — create/delete login accounts ---
// Used by the admin back-office to add a member (which needs a real auth user so
// they can sign in) and to fully remove one (cascades to the members row).
export function authAdmin(env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
  // GoTrue's own email sends (/recover, /invite). They resolve to
  // { ok, status, code, message } instead of throwing, so a caller can turn a
  // rate limit or an already-registered refusal into a readable answer. GoTrue
  // reads redirect_to from the query string; `code` covers both error shapes
  // ({ error_code, msg } and the newer { code: '<string>', message }).
  // `extra` adds body fields (/invite's `data`, /otp's `create_user`); a successful
  // answer's JSON (the invited user, for /invite) comes back as `body`.
  const sendAuthEmail = async (path, email, redirectTo, extra = {}) => {
    const r = await fetch(`${base}/auth/v1/${path}?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, ...extra }),
    });
    if (r.ok) {
      const body = await r.json().catch(() => null);
      return { ok: true, status: r.status, code: '', message: '', body };
    }
    // `|| {}`: a JSON `null` body parses fine but has no properties to read.
    const data = (await r.json().catch(() => null)) || {};
    const code = data.error_code || (typeof data.code === 'string' ? data.code : '');
    return { ok: false, status: r.status, code, message: data.msg || data.message || '' };
  };
  return {
    // The auth user behind a member row, or null if there is none.
    async getUser(id) {
      const r = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`get user: ${r.status}`);
      return r.json();
    },
    sendRecovery: (email, redirectTo) => sendAuthEmail('recover', email, redirectTo),
    // GoTrue stores `data` as user_metadata only when it CREATES the user; for an
    // existing unconfirmed user it re-sends the invite without touching metadata.
    sendInvite: (email, redirectTo, data) =>
      sendAuthEmail('invite', email, redirectTo, data ? { data } : {}),
    // Magic Link email for an EXISTING confirmed user. create_user:false makes
    // GoTrue refuse (422 otp_disabled) rather than sign a stranger up; an
    // unconfirmed user would get the signup confirmation email instead.
    sendMagicLink: (email, redirectTo) =>
      sendAuthEmail('otp', email, redirectTo, { create_user: false }),
    // The auth user whose login email is exactly `email` (case-insensitive), or
    // null. GoTrue's `filter` is a substring LIKE on email, so match exactly here.
    async findUserByEmail(email) {
      const target = String(email || '')
        .trim()
        .toLowerCase();
      if (!target) return null;
      // Page through the substring hits (bounded) until the exact address turns up.
      const PER_PAGE = 50;
      for (let page = 1; page <= 20; page++) {
        const r = await fetch(
          `${base}/auth/v1/admin/users?filter=${encodeURIComponent(target)}&page=${page}&per_page=${PER_PAGE}`,
          { headers },
        );
        if (!r.ok) throw new Error(`find user: ${r.status}`);
        const data = await r.json();
        const users = Array.isArray(data?.users) ? data.users : [];
        const hit = users.find((u) => String(u.email || '').toLowerCase() === target);
        if (hit) return hit;
        if (users.length < PER_PAGE) return null;
      }
      return null;
    },
    // Merge keys into user_metadata. GoTrue merges (a null value deletes the
    // key) rather than replacing the whole object, so other keys survive.
    async updateUserMetadata(id, patch) {
      const r = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ user_metadata: patch }),
      });
      if (!r.ok) throw new Error(`update user: ${r.status}`);
    },
    async createUser(attrs) {
      const r = await fetch(`${base}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify(attrs),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          data.msg || data.error_description || data.error || `create user: ${r.status}`,
        );
      }
      return data;
    },
    async deleteUser(id) {
      const r = await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
      if (!r.ok) throw new Error(`delete user: ${r.status} ${await r.text()}`);
    },
  };
}

// --- Supabase Storage (service-role) — the admin media library bucket ---
// Public reads never come through here: a public bucket serves
// /storage/v1/object/public/<bucket>/<name> directly. Writes/lists/deletes are
// service-role only (storage.objects has RLS enabled with no policies).
export function storage(env) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  return {
    publicUrl(bucket, name) {
      return `${base}/storage/v1/object/public/${bucket}/${name}`;
    },
    async upload(bucket, name, body, contentType) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': contentType },
        body,
      });
      if (!r.ok) throw new Error(`storage upload ${name}: ${r.status} ${await r.text()}`);
      return r.json().catch(() => null);
    },
    async list(bucket, { limit = 100, offset = 0 } = {}) {
      const r = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          prefix: '',
          limit,
          offset,
          sortBy: { column: 'created_at', order: 'desc' },
        }),
      });
      if (!r.ok) throw new Error(`storage list: ${r.status} ${await r.text()}`);
      return r.json();
    },
    async remove(bucket, name) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${name}`, {
        method: 'DELETE',
        headers,
      });
      if (!r.ok) throw new Error(`storage delete ${name}: ${r.status} ${await r.text()}`);
    },
  };
}

// --- User gate: validate the caller's Supabase session (any signed-in user) ---
// Returns { user } on success, or { error: Response } to return directly.
export async function requireUser(request, env) {
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
  return { user };
}

// --- Admin gate: validate the caller's Supabase session, then confirm is_admin ---
// Returns { member, user } on success, or { error: Response } to return directly.
// The is_admin check uses the service-role select (authoritative) — never trust
// the JWT claims, since admin Functions use sb() which bypasses RLS.
export async function requireAdmin(request, env) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  const { user } = gate;

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
  const get = async (path) => {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
  return { call, get };
}

// The plan a member's card stands for: their own membership when it is active,
// otherwise — for a member who joined a family — the family plan. That is the
// founder's members row (family tier, active, unexpired), or the households row
// for a legacy admin-made family with no founder. Separate lookups, not a
// members<->households embed, which is ambiguous once 0017 adds
// households.founder_member_id; households is read with `*` so this also works
// before 0017 is applied (legacy families only). Returns
// { member, tier_id, expires_at }, or null when there is no valid plan.
const MEMBERSHIP_COLS = 'id,full_name,email,tier_id,status,expires_at,household_id';
const liveUntil = (row) => !row.expires_at || new Date(row.expires_at) > new Date();
export async function effectiveMembership(DB, memberId) {
  const m = await DB.selectOne('members', { id: memberId }, MEMBERSHIP_COLS);
  if (!m) return null;
  if (m.tier_id && m.status === 'active' && liveUntil(m))
    return { member: m, tier_id: m.tier_id, expires_at: m.expires_at };
  if (!m.household_id) return null;
  // Before 0017 is applied a family lookup can fail (a PostgREST error on a
  // column or table it adds). The member's own plan, not valid above, decides:
  // a failed lookup is never a valid card.
  try {
    return await familyPlan(DB, m);
  } catch {
    return null;
  }
}

async function familyPlan(DB, m) {
  const h = await DB.selectOne('households', { id: m.household_id }, '*');
  if (!h || h.status === 'cancelled') return null;
  if (h.founder_member_id) {
    const f = await DB.selectOne(
      'members',
      { id: h.founder_member_id },
      'id,tier_id,status,expires_at',
    );
    if (!f || f.tier_id !== 'family' || f.status !== 'active' || !liveUntil(f)) return null;
    return { member: m, tier_id: 'family', expires_at: f.expires_at };
  }
  if (!h.tier_id || h.status !== 'active' || !liveUntil(h)) return null;
  return { member: m, tier_id: h.tier_id, expires_at: h.expires_at };
}

// ~3.5% card fee on top of the tier's base price, matching the live site.
export const CARD_SURCHARGE = 0.035;
export const tierLookupKey = (tierId) => `caaci_${tierId}_year`;

// Line-item pricing for a membership tier. Prefer the catalogue Price that
// stripe-catalog.mjs created (resolved by lookup_key, so the same code works in
// test and live mode and the Dashboard shows one product per tier). Fall back
// to an inline price_data when the catalogue hasn't been created in this mode,
// so checkout keeps working either way. Returns a partial line item.
export async function tierPrice(S, tier) {
  try {
    const found = await S.get(
      `prices?active=true&lookup_keys[]=${encodeURIComponent(tierLookupKey(tier.id))}`,
    );
    const id = found?.data?.[0]?.id;
    if (id) return { price: id };
  } catch {
    // lookup failed — fall through to inline pricing
  }
  return {
    price_data: {
      currency: 'usd',
      unit_amount: Math.round(tier.price_cents * (1 + CARD_SURCHARGE)),
      product_data: { name: tier.name },
      recurring: { interval: 'year' },
    },
  };
}

// The self-serve $0 tier — mirrors isFreeTier in src/caaci-shared.js. Honorable
// is also $0 but invite_only, and is refused by checkout/change-plan before this.
export const isFreeTier = (tier) => !!tier && !tier.invite_only && !(tier.price_cents > 0);

// Put a member on the free tier without Stripe: active, no expiry, no
// subscription. Refused while a paid subscription is still live — Stripe would
// keep billing someone the site shows as free — so those cancel in the billing
// portal first (the webhook then marks them cancelled and they can join free).
// `member` may be passed in when the caller already has the row.
export async function activateFreeTier(DB, memberId, tier, member = null) {
  const m = member || (await DB.selectOne('members', { id: memberId }));
  if (m?.stripe_subscription_id && ['active', 'past_due'].includes(m.status))
    return { error: 'You already have a paid membership — cancel it from Manage billing first.' };
  await DB.update(
    'members',
    { id: memberId },
    {
      tier_id: tier.id,
      status: 'active',
      member_since: m?.member_since || new Date().toISOString(),
      expires_at: null,
      stripe_subscription_id: null,
    },
  );
  return { ok: true };
}

// Send an email (Resend by default; falls back to no-op if unset). Without `to`
// it is a staff notification to NOTIFY_TO; with `to` (e.g. a registrant's
// confirmation) only RESEND_API_KEY and NOTIFY_FROM are needed.
export async function sendEmail(env, { subject, html, replyTo, to }) {
  const recipient = to || env.NOTIFY_TO;
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM || !recipient) return; // not configured
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.NOTIFY_FROM,
      to: recipient,
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
