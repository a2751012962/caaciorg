// stripe-reconcile.mjs — READ-ONLY comparison of Stripe against the members table.
//
// The site learns about money only when Stripe pushes a webhook, and only for
// people who have a SUBSCRIPTION: checkout.session.completed, invoice.paid,
// invoice.payment_failed, customer.subscription.deleted. A member who paid once
// (most of the imported MemberPress roster) has no subscription object, so no
// event will ever arrive and their members row keeps whatever the import wrote.
// Nothing in the system ever notices that the two have drifted apart — this
// script is that missing check, run by hand.
//
// Every Stripe and Supabase request is a GET; there is no code path here that
// writes, so it is safe against live mode.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//     node stripe-reconcile.mjs [--csv=drift.csv] [--days=30] [--strict]
//
// The default output is aggregate plus one line per finding with the email
// masked, so it can be pasted into a chat. --csv writes the full rows (PII) to
// a local file instead. --strict exits 1 when anything needs attention, for a
// scheduled run that should fail loudly.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { keyMode, listAll } from './stripe-audit.mjs';

const DAY = 86_400_000;
// Stripe bills a few hours either side of the stored date (retries, clock
// skew, a plan change mid-cycle); only a real gap is worth a human's time.
const DRIFT_TOLERANCE_DAYS = 2;

const day = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '—');
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const norm = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();

export function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  const name = s.slice(0, at);
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${s.slice(at + 1)}`;
}

function stripeGet(key) {
  return async function get(path) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
}

// Every members row, paged past PostgREST's 1000-row ceiling.
export async function allMembers(url, serviceKey, fetchImpl = fetch) {
  const columns =
    'id,full_name,email,tier_id,status,member_since,expires_at,stripe_customer_id,stripe_subscription_id';
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const qs = `select=${columns}&order=id&limit=1000&offset=${page * 1000}`;
    const r = await fetchImpl(`${url}/rest/v1/members?${qs}`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    if (!r.ok) throw new Error(`supabase members: ${r.status} ${await r.text()}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

const periodEndOf = (sub) => sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
const customerIdOf = (sub) => (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id);
const customerEmailOf = (sub) => (typeof sub.customer === 'object' ? norm(sub.customer.email) : '');

/**
 * Compare one roster against one set of Stripe subscriptions.
 * Pure: takes data, returns findings, so it can be tested without either API.
 *
 * Findings, worst first:
 *   lapsed        — reads Active, but the paid year ran out. The panel now says
 *                   Expired; the stored column still says otherwise.
 *   sub_gone      — the row points at a subscription Stripe no longer bills,
 *                   while the row still says Active.
 *   not_active    — Stripe is billing them, the row says they are not a member.
 *   drift         — both live, but the dates disagree by more than two days.
 *   unknown_sub   — Stripe bills someone this site has never heard of.
 *   no_renewal    — Active, no subscription: nothing will ever renew them.
 *                   Informational, and the reason most of the roster needs the
 *                   reminder emails rather than Stripe.
 */
export function reconcile(members, subs, { now = Date.now(), soonDays = 30 } = {}) {
  const subById = new Map(subs.map((s) => [s.id, s]));
  const liveByCustomer = new Map();
  for (const s of subs) {
    if (!['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) continue;
    const c = customerIdOf(s);
    if (c && !liveByCustomer.has(c)) liveByCustomer.set(c, s);
  }
  const findings = [];
  const seenSubs = new Set();
  const counts = { members: members.length, active: 0, with_subscription: 0, no_renewal: 0 };

  for (const m of members) {
    const until = m.expires_at ? Date.parse(m.expires_at) : null;
    const active = m.status === 'active';
    if (active) counts.active += 1;
    const sub =
      (m.stripe_subscription_id && subById.get(m.stripe_subscription_id)) ||
      (m.stripe_customer_id && liveByCustomer.get(m.stripe_customer_id)) ||
      null;
    if (sub) seenSubs.add(sub.id);
    const billing = sub && ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status);
    if (billing) counts.with_subscription += 1;
    const row = {
      email: m.email,
      name: m.full_name,
      tier: m.tier_id,
      db_status: m.status,
      db_expires: iso(m.expires_at),
      stripe_sub: sub?.id || m.stripe_subscription_id || '',
      stripe_status: sub?.status || '',
      stripe_period_end: sub ? day(periodEndOf(sub)) : '',
    };

    if (active && until !== null && until <= now && !billing) {
      findings.push({ kind: 'lapsed', ...row, days: Math.floor((now - until) / DAY) });
      continue;
    }
    if (active && m.stripe_subscription_id && !billing) {
      findings.push({ kind: 'sub_gone', ...row });
      continue;
    }
    if (billing && !active) {
      findings.push({ kind: 'not_active', ...row });
      continue;
    }
    if (billing && active) {
      const end = periodEndOf(sub);
      if (end && until !== null && Math.abs(end * 1000 - until) > DRIFT_TOLERANCE_DAYS * DAY)
        findings.push({ kind: 'drift', ...row });
      continue;
    }
    if (active && !billing) {
      counts.no_renewal += 1;
      // Only worth a line while it is close enough to act on.
      if (until !== null && until > now && until - now <= soonDays * DAY)
        findings.push({ kind: 'no_renewal', ...row, days: Math.ceil((until - now) / DAY) });
    }
  }

  for (const s of subs) {
    if (seenSubs.has(s.id)) continue;
    if (!['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) continue;
    findings.push({
      kind: 'unknown_sub',
      email: customerEmailOf(s),
      name: typeof s.customer === 'object' ? s.customer?.name : '',
      tier: '',
      db_status: '(no member row)',
      db_expires: '—',
      stripe_sub: s.id,
      stripe_status: s.status,
      stripe_period_end: day(periodEndOf(s)),
    });
  }

  const order = ['lapsed', 'sub_gone', 'not_active', 'drift', 'unknown_sub', 'no_renewal'];
  findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { findings, counts };
}

const HEADLINE = {
  lapsed: 'Reads Active, the paid year is over — nothing in Stripe will ever say so',
  sub_gone: 'Reads Active, but Stripe is not billing that subscription any more',
  not_active: 'Stripe is billing them; the site does not treat them as a member',
  drift: 'Both live, but the renewal date and the stored expiry disagree',
  unknown_sub: 'Stripe is billing someone with no members row',
  no_renewal: 'Active with no subscription — expiring soon, will not auto-renew',
};

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function driftCsv(findings) {
  const cols = [
    'kind',
    'email',
    'name',
    'tier',
    'db_status',
    'db_expires',
    'stripe_sub',
    'stripe_status',
    'stripe_period_end',
    'days',
  ];
  const head = cols.join(',');
  const rows = findings.map((f) => cols.map((c) => csvEscape(f[c] ?? '')).join(','));
  return [head, ...rows].join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let csvPath = null;
  let soonDays = 30;
  let strict = false;
  for (const arg of argv) {
    if (arg.startsWith('--csv=')) csvPath = arg.slice('--csv='.length);
    else if (arg.startsWith('--days=')) soonDays = parseInt(arg.slice('--days='.length), 10) || 30;
    else if (arg === '--strict') strict = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  const key = env.STRIPE_SECRET_KEY;
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !url || !serviceKey) {
    console.error('Missing credentials. Run:');
    console.error(
      '  STRIPE_SECRET_KEY=sk_… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node stripe-reconcile.mjs',
    );
    return 1;
  }

  const get = stripeGet(key);
  const [members, subs] = await Promise.all([
    allMembers(url, serviceKey),
    listAll(get, 'subscriptions?status=all&expand[]=data.customer'),
  ]);
  const { findings, counts } = await Promise.resolve(reconcile(members, subs, { soonDays }));

  console.log(`Stripe mode: ${keyMode(key).toUpperCase()}   subscriptions: ${subs.length}`);
  console.log(
    `Members: ${counts.members} rows, ${counts.active} stored Active, ` +
      `${counts.with_subscription} of those billed by Stripe, ${counts.no_renewal} with nothing to renew them.`,
  );

  if (!findings.length) {
    console.log('\n✓ Nothing to reconcile.');
    return 0;
  }

  const byKind = new Map();
  for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) || []), f]);
  for (const [kind, list] of byKind) {
    console.log(`\n${kind} (${list.length}) — ${HEADLINE[kind]}`);
    for (const f of list) {
      const when =
        f.kind === 'lapsed'
          ? `expired ${f.db_expires} (${f.days}d ago)`
          : f.kind === 'no_renewal'
            ? `expires ${f.db_expires} (in ${f.days}d)`
            : `db ${f.db_status}/${f.db_expires} · stripe ${f.stripe_status || '—'}/${f.stripe_period_end || '—'}`;
      console.log(`  ${maskEmail(f.email).padEnd(28)} ${f.tier || '—'.padEnd(10)}  ${when}`);
    }
  }

  if (csvPath) {
    await writeFile(csvPath, driftCsv(findings));
    console.log(`\n✓ Wrote ${findings.length} rows to ${csvPath} (not printed — has PII)`);
  } else {
    console.log('\nRerun with --csv=drift.csv for the full rows with addresses.');
  }

  const needsAction = findings.filter((f) => f.kind !== 'no_renewal').length;
  return strict && needsAction ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    },
  );
}
