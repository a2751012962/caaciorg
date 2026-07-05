// GET /api/admin/payments  (admin only)
// The membership-tracking view: recent payments (who, when, how much, first
// year vs renewal, discount used) plus fleet stats — members per status and
// revenue collected this calendar year. Rows are written by the Stripe webhook.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const MAX_LIMIT = 100;
const STATUSES = ['active', 'pending', 'past_due', 'expired', 'cancelled'];

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const DB = sb(env);
  try {
    // Ledger page — member name/email come along via the FK embed.
    const { rows, total } = await DB.select('payments', {
      columns:
        'id,kind,amount_cents,currency,tier_id,discount_code,paid_at,members(full_name,email)',
      order: 'paid_at.desc',
      limit,
      offset,
      count: 'exact',
    });

    // Members per status (five cheap head-counts).
    const status_counts = {};
    for (const s of STATUSES) {
      const r = await DB.select('members', {
        columns: 'id',
        filters: [`status=eq.${s}`],
        limit: 1,
        count: 'exact',
      });
      status_counts[s] = r.total;
    }

    // Revenue collected since Jan 1 (summed here — fine at community-org scale).
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const ytd = await DB.select('payments', {
      columns: 'amount_cents',
      filters: [`paid_at=gte.${yearStart}`],
      limit: 1000,
    });
    const revenue_ytd_cents = ytd.rows.reduce((sum, p) => sum + (p.amount_cents || 0), 0);

    return json({ rows, total, limit, offset, status_counts, revenue_ytd_cents });
  } catch (e) {
    return bad(e.message, 500);
  }
}
