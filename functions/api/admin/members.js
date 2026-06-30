// /api/admin/members  (admin only)
//   GET    — list/search members & subscriptions (paginated, hard-capped).
//   POST   — patch a single member's status / tier / expiry / family / details.
//   PUT    — create a member (also creates a login account so they can sign in).
//   DELETE — remove a member and their login account.
// Every request is gated by requireAdmin (validates session + is_admin).
import { json, bad, sb, requireAdmin, authAdmin } from '../_lib.js';

const STATUSES = ['pending', 'active', 'expired', 'cancelled', 'past_due'];
const MAX_LIMIT = 50;
const COLUMNS =
  'id,full_name,email,phone,tier_id,status,member_since,expires_at,household_id,stripe_customer_id,stripe_subscription_id,created_at';

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '';
  const tier = url.searchParams.get('tier_id') || '';
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const filters = [];
  if (status && STATUSES.includes(status)) filters.push(`status=eq.${status}`);
  if (tier) filters.push(`tier_id=eq.${encodeURIComponent(tier)}`);
  if (q) {
    const cleaned = q.replace(/[(),*]/g, ' ').trim(); // strip PostgREST meta chars
    if (cleaned) {
      const safe = cleaned.replace(/[\\%_]/g, (c) => `\\${c}`); // escape SQL LIKE wildcards
      filters.push(
        `or=(full_name.ilike.*${encodeURIComponent(safe)}*,email.ilike.*${encodeURIComponent(safe)}*)`,
      );
    }
  }

  try {
    const { rows, total } = await sb(env).select('members', {
      columns: COLUMNS,
      filters,
      order: 'created_at.desc',
      limit,
      offset,
      count: 'exact',
    });
    return json({ rows, total, limit, offset });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!b.id) return bad('Member id is required.');

  const patch = {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return bad('Invalid status.');
    patch.status = b.status;
  }
  if (b.tier_id !== undefined) {
    if (b.tier_id === null || b.tier_id === '') {
      patch.tier_id = null;
    } else {
      const tier = await sb(env).selectOne('membership_tiers', { id: b.tier_id }, 'id');
      if (!tier) return bad('Unknown membership tier.');
      patch.tier_id = b.tier_id;
    }
  }
  if (b.expires_at !== undefined) {
    if (b.expires_at === null || b.expires_at === '') {
      patch.expires_at = null;
    } else {
      const d = new Date(b.expires_at);
      if (isNaN(d.getTime())) return bad('Invalid expiry date.');
      patch.expires_at = d.toISOString();
    }
  }
  if (b.member_since !== undefined) {
    if (b.member_since === null || b.member_since === '') {
      patch.member_since = null;
    } else {
      const d = new Date(b.member_since);
      if (isNaN(d.getTime())) return bad('Invalid member-since date.');
      patch.member_since = d.toISOString();
    }
  }
  // Assign / clear the family this member belongs to.
  if (b.household_id !== undefined) {
    patch.household_id = b.household_id === '' || b.household_id === null ? null : b.household_id;
  }
  if (b.full_name !== undefined) patch.full_name = b.full_name || null;
  if (b.phone !== undefined) patch.phone = b.phone || null;
  if (b.notes !== undefined) patch.notes = b.notes || null;
  if (b.is_admin !== undefined) patch.is_admin = !!b.is_admin;
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('members', { id: b.id }, patch);
    const row = await sb(env).selectOne('members', { id: b.id }, COLUMNS);
    return json({ ok: true, member: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}

// PUT — create a member. Creates a Supabase Auth user (so the person can sign in)
// and then fills in the members row the signup trigger inserted.
export async function onRequestPut({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const email = (b.email || '').trim();
  if (!email) return bad('Email is required to create a member account.');
  if (b.status && !STATUSES.includes(b.status)) return bad('Invalid status.');
  if (b.tier_id) {
    const tier = await sb(env).selectOne('membership_tiers', { id: b.tier_id }, 'id');
    if (!tier) return bad('Unknown membership tier.');
  }

  try {
    const created = await authAdmin(env).createUser({
      email,
      password: b.password || undefined,
      email_confirm: true,
      user_metadata: { full_name: b.full_name || '' },
    });
    const patch = {
      full_name: b.full_name || null,
      phone: b.phone || null,
      tier_id: b.tier_id || null,
      status: b.status || 'active',
      household_id: b.household_id || null,
      notes: b.notes || null,
      is_admin: !!b.is_admin,
    };
    for (const f of ['member_since', 'expires_at']) {
      if (b[f]) {
        const d = new Date(b[f]);
        if (!isNaN(d.getTime())) patch[f] = d.toISOString();
      }
    }
    await sb(env).update('members', { id: created.id }, patch);
    const row = await sb(env).selectOne('members', { id: created.id }, COLUMNS);
    return json({ ok: true, member: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}

// DELETE — remove a member and their login account (cascades to the members row).
export async function onRequestDelete({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let id = new URL(request.url).searchParams.get('id') || '';
  if (!id) {
    try {
      id = (await request.json()).id || '';
    } catch {
      /* no body */
    }
  }
  if (!id) return bad('Member id is required.');
  if (id === gate.member.id) return bad('You cannot delete your own account.');

  try {
    await authAdmin(env).deleteUser(id);
    return json({ ok: true });
  } catch (e) {
    return bad(e.message, 500);
  }
}
