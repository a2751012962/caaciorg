// /api/admin/members  (admin only)
//   GET  — list/search members & subscriptions (paginated, hard-capped).
//   POST — patch a single member's status / tier / expiry.
// Every request is gated by requireAdmin (validates session + is_admin).
import { json, bad, sb, requireAdmin } from '../_lib.js';

const STATUSES = ['pending', 'active', 'expired', 'cancelled', 'past_due'];
const MAX_LIMIT = 50;
const COLUMNS =
  'id,full_name,email,phone,tier_id,status,member_since,expires_at,stripe_customer_id,stripe_subscription_id,created_at';

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
  if (Object.keys(patch).length === 0) return bad('Nothing to update.');

  try {
    await sb(env).update('members', { id: b.id }, patch);
    const row = await sb(env).selectOne('members', { id: b.id }, COLUMNS);
    return json({ ok: true, member: row });
  } catch (e) {
    return bad(e.message, 500);
  }
}
