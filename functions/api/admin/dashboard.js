// GET /api/admin/dashboard  (admin only)
// Everything the admin panel's Dashboard tab shows, in one request: membership
// head-counts (per status, per tier, new this month, expiring within 30 days),
// revenue this year / this month with the latest payments, the next published
// events with their registration counts, the latest registrations, volunteer
// sign-ups, and the business-listing review queue. Read-only; every number is
// counted here from the same tables the other admin tabs page through.
// Every request is gated by requireAdmin.
import { json, bad, sb, requireAdmin } from '../_lib.js';

const STATUSES = ['active', 'pending', 'past_due', 'expired', 'cancelled'];
export const EXPIRING_DAYS = 30;
const LIST_LIMIT = 5; // recent payments / registrations, upcoming events
const EXPIRING_LIMIT = 10;
const MAX_TIERS = 50;
// PostgREST caps every response at max_rows (1000 by default), so sums and
// per-event counts read a page at a time; a short page is the last one.
const PAGE = 1000;
const MAX_PAGES = 20;

const MEMBER_COLUMNS = 'id,full_name,email,tier_id,status,expires_at';
const PAYMENT_COLUMNS = 'id,kind,amount_cents,tier_id,paid_at,members(full_name,email)';
const EVENT_COLUMNS =
  'id,title,title_zh,slug,starts_at,ends_at,location,published,registration_questions';
const REGISTRATION_COLUMNS = 'id,email,created_at,events(title,title_zh,slug,starts_at)';

// Every payment since `sinceIso` (amount + when), paged in a stable order.
async function paymentsSince(DB, sinceIso) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows } = await DB.select('payments', {
      columns: 'amount_cents,paid_at',
      filters: [`paid_at=gte.${sinceIso}`],
      order: 'id',
      limit: PAGE,
      offset: page * PAGE,
    });
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

// This year's payments bucketed by calendar month, January through the
// current month: [{ month: 'YYYY-MM', cents, payments }]. Feeds the revenue
// line chart; the last bucket is "this month".
function monthlyRevenue(payments, now) {
  const year = now.getFullYear();
  const months = [];
  for (let m = 0; m <= now.getMonth(); m++) {
    months.push({ month: `${year}-${String(m + 1).padStart(2, '0')}`, cents: 0, payments: 0 });
  }
  for (const p of payments) {
    const d = new Date(p.paid_at);
    if (isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const bucket = months[d.getMonth()];
    if (!bucket) continue;
    bucket.cents += p.amount_cents || 0;
    bucket.payments += 1;
  }
  return months;
}

// { [eventId]: registrations } for the given events (0 when none).
async function registrationCounts(DB, eventIds) {
  const counts = Object.fromEntries(eventIds.map((id) => [id, 0]));
  if (!eventIds.length) return counts;
  const filters = [`event_id=in.(${eventIds.map((id) => encodeURIComponent(id)).join(',')})`];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows } = await DB.select('event_registrations', {
      columns: 'event_id',
      filters,
      order: 'id',
      limit: PAGE,
      offset: page * PAGE,
    });
    for (const r of rows) if (r.event_id in counts) counts[r.event_id] += 1;
    if (rows.length < PAGE) break;
  }
  return counts;
}

export async function onRequestGet({ request, env }) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const DB = sb(env);
  // Cheap head-count: one row plus the exact total from Content-Range.
  const count = async (table, filters = []) =>
    (await DB.select(table, { columns: 'id', filters, limit: 1, count: 'exact' })).total;

  const now = new Date();
  const nowIso = now.toISOString();
  // Calendar boundaries in the runtime's zone (UTC on Workers) — the same
  // convention the Payments tab's "Revenue this year" already uses.
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const soon = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000).toISOString();

  try {
    // ---- members ----
    const status_counts = {};
    for (const s of STATUSES) status_counts[s] = await count('members', [`status=eq.${s}`]);
    const members_total = STATUSES.reduce((sum, s) => sum + status_counts[s], 0);
    const new_this_month = await count('members', [`created_at=gte.${monthStart}`]);

    const { rows: tiers } = await DB.select('membership_tiers', {
      columns: 'id,name',
      order: 'sort_order',
      limit: MAX_TIERS,
    });
    const by_tier = [];
    for (const tier of tiers) {
      const active = await count('members', [
        'status=eq.active',
        `tier_id=eq.${encodeURIComponent(tier.id)}`,
      ]);
      by_tier.push({ id: tier.id, name: tier.name, active });
    }

    // Active members whose membership runs out within EXPIRING_DAYS, soonest first.
    const expiring = await DB.select('members', {
      columns: MEMBER_COLUMNS,
      filters: ['status=eq.active', `expires_at=gte.${nowIso}`, `expires_at=lte.${soon}`],
      order: 'expires_at.asc',
      limit: EXPIRING_LIMIT,
      count: 'exact',
    });

    // ---- revenue ----
    // One read of the year's payments gives the year total, the month-by-month
    // series and this month's figures (its last bucket), all from one clock.
    const by_month = monthlyRevenue(await paymentsSince(DB, yearStart), now);
    const revenue_ytd_cents = by_month.reduce((sum, b) => sum + b.cents, 0);
    const thisMonth = by_month[by_month.length - 1];
    const revenue_month_cents = thisMonth.cents;
    const payments_this_month = thisMonth.payments;
    const { rows: recent_payments } = await DB.select('payments', {
      columns: PAYMENT_COLUMNS,
      order: 'paid_at.desc',
      limit: LIST_LIMIT,
    });

    // ---- events ----
    const upcoming = await DB.select('events', {
      columns: EVENT_COLUMNS,
      filters: ['published=eq.true', `starts_at=gte.${nowIso}`],
      order: 'starts_at.asc',
      limit: LIST_LIMIT,
      count: 'exact',
    });
    const regCounts = await registrationCounts(
      DB,
      upcoming.rows.map((e) => e.id),
    );
    const upcoming_events = upcoming.rows.map((e) => ({
      id: e.id,
      title: e.title,
      title_zh: e.title_zh ?? null,
      slug: e.slug,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      location: e.location,
      takes_registrations: Array.isArray(e.registration_questions),
      registration_count: regCounts[e.id] || 0,
    }));
    const drafts_total = await count('events', ['published=eq.false']);
    const { rows: recent_registrations } = await DB.select('event_registrations', {
      columns: REGISTRATION_COLUMNS,
      order: 'created_at.desc',
      limit: LIST_LIMIT,
    });

    // ---- volunteers + business directory ----
    const volunteers_total = await count('event_volunteers');
    const volunteers_this_month = await count('event_volunteers', [`created_at=gte.${monthStart}`]);
    const business_pending = await count('business_directory', ['approved=eq.false']);

    return json({
      generated_at: nowIso,
      members: {
        total: members_total,
        status_counts,
        new_this_month,
        by_tier,
        expiring_days: EXPIRING_DAYS,
        expiring_total: expiring.total,
        expiring: expiring.rows,
      },
      revenue: {
        ytd_cents: revenue_ytd_cents,
        month_cents: revenue_month_cents,
        payments_this_month,
        by_month,
        recent: recent_payments,
      },
      events: {
        upcoming_total: upcoming.total,
        upcoming: upcoming_events,
        drafts_total,
        recent_registrations,
      },
      volunteers: { total: volunteers_total, this_month: volunteers_this_month },
      business: { pending: business_pending },
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
