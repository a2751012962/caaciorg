// migrate-members.mjs — import everyone who paid the old MemberPress site into Supabase.
//
// The WordPress site (MemberPress) and this site bill through the same Stripe
// account, so Stripe already holds the membership history: every MemberPress
// charge, PaymentIntent and subscription carries metadata.memberpress_product.
// This reads that history (GET only), works out each person's tier and expiry,
// and creates or updates their Supabase login and members row.
//
// It never sends an email. Accounts are created already confirmed through the
// Auth admin API (no invite, recovery, OTP or magic link); members set a
// password or use a one-time code on their next sign-in.
//
// Usage (dry run first — nothing is written without --apply):
//   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env
//   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env --only=a@x.com --apply
//   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env --apply
//
// Options:
//   --apply                  write the plan (default: dry run)
//   --only=a@x.com,b@y.com   restrict the plan and the writes to these emails
//   --report=<path>          write the full plan (emails, names) as JSON — has PII
//   --stripe-env=<file>      read the Stripe key from this file, over STRIPE_SECRET_KEY
//   --fix-email=<from>=<to>  import a mistyped payer email as the corrected one (repeatable)
//
// Stdout carries masked emails and no names, so it is safe to paste into a
// chat. Re-running is safe: entries that were already written plan as unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isLive, keyMode, listAll, money } from './stripe-audit.mjs';

const USAGE =
  'node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env ' +
  '[--only=<email>,…] [--fix-email=<from>=<to>] [--report=migrate-report.json] [--apply]';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPO_DOMAINS = new Set([
  'gmai.com',
  'gmial.com',
  'gamil.com',
  'hotmial.com',
  'yahooo.com',
  'outlok.com',
]);
// GoTrue endpoints that email the user. applyPlan refuses them outright.
const SENDS_MAIL = /\/(invite|recover|otp|magiclink)\b/;

// Everything a create writes to the members row; updates write a subset.
const MEMBER_FIELDS = [
  'full_name',
  'email',
  'tier_id',
  'status',
  'member_since',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
];
const COMPARED = [
  'tier_id',
  'status',
  'member_since',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
];
const VERIFIED = [
  'tier_id',
  'status',
  'expires_at',
  'stripe_customer_id',
  'stripe_subscription_id',
];
const MEMBER_COLUMNS = `id,${COMPARED.join(',')}`;
const DATE_FIELDS = new Set(['member_since', 'expires_at']);
const UNPAID_TIERS = new Set(['free', 'honorary']);

const normEmail = (s) => (typeof s === 'string' && s.trim() ? s.trim().toLowerCase() : null);
const idOf = (x) => (typeof x === 'string' ? x : (x?.id ?? null));
const toIso = (unix) =>
  unix === null || unix === undefined ? null : new Date(unix * 1000).toISOString();
const dayOf = (unix) => toIso(unix).slice(0, 10);
const epoch = (v) => (v === null || v === undefined ? null : Date.parse(v));
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
const same = (field, a, b) =>
  DATE_FIELDS.has(field) ? epoch(a) === epoch(b) : (a ?? null) === (b ?? null);

export function maskEmail(email) {
  if (!email) return '(no email)';
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}

// Mask any address inside free text (error messages from Supabase, say).
const maskEmails = (text) => String(text).replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, maskEmail);

export function stripeKeyFrom(text) {
  const m = /\b(?:sk|rk)_live_[A-Za-z0-9]+|\b(?:sk|rk)_test_[A-Za-z0-9]+/.exec(text || '');
  return m ? m[0] : null;
}

export function tierFromProduct(name) {
  if (!name) return null;
  if (/family/i.test(name)) return 'family';
  if (/individual/i.test(name)) return 'individual';
  if (/student/i.test(name)) return 'student';
  if (/business/i.test(name)) return 'business';
  return null;
}

function yearAfter(unix) {
  const d = new Date(unix * 1000);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

// The latest non-empty name, whitespace collapsed. Later pushes win ties, so a
// customer name recorded alongside a billing name at the same moment wins.
function latestName(candidates) {
  let best = null;
  for (const c of candidates) {
    const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim() : '';
    if (name && (!best || (c.at ?? 0) >= best.at)) best = { name, at: c.at ?? 0 };
  }
  return best?.name ?? null;
}

const blank = (over) => ({
  email: null,
  full_name: null,
  tier_id: null,
  status: null,
  member_since: null,
  expires_at: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  source: null,
  action: 'skip',
  reason: '',
  warnings: [],
  user_id: null,
  changes: [],
  ...over,
});

// Pure: Stripe history + Supabase state in, one entry per person out.
export function planImport({
  subscriptions = [],
  charges = [],
  customers = [],
  users = [],
  members = [],
  tierIds = [],
  now = Date.now(),
  productNames = {},
  emailFixes = {},
}) {
  const nowMs =
    now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const tiers = new Set(tierIds);
  const names = productNames instanceof Map ? productNames : new Map(Object.entries(productNames));
  const fixes = new Map(
    [...(emailFixes instanceof Map ? emailFixes : Object.entries(emailFixes))].map(([f, t]) => [
      normEmail(f),
      normEmail(t),
    ]),
  );

  const customerById = new Map();
  for (const c of customers) if (c?.id) customerById.set(c.id, c);
  for (const s of subscriptions)
    if (s.customer?.id && !customerById.has(s.customer.id))
      customerById.set(s.customer.id, s.customer);

  const resolve = (...raw) => {
    const email = raw.map(normEmail).find(Boolean) ?? null;
    const fixed = email && fixes.get(email);
    return fixed ? { email: fixed, from: email } : { email, from: null };
  };

  const people = new Map();
  const person = (email) => {
    if (!people.has(email))
      people.set(email, {
        email,
        correctedFrom: new Set(),
        charges: [],
        liveSubs: [],
        customerIds: new Set(),
        names: [],
      });
    return people.get(email);
  };
  // Payments with no email anywhere, one skip entry per Stripe customer.
  const orphans = new Map();

  for (const ch of charges) {
    if (ch.status !== 'succeeded' || ch.refunded === true) continue;
    const customerId = idOf(ch.customer);
    const cust =
      (typeof ch.customer === 'object' && ch.customer) || customerById.get(customerId) || {};
    const pi = typeof ch.payment_intent === 'object' && ch.payment_intent ? ch.payment_intent : {};
    const { email, from } = resolve(
      cust.email,
      ch.billing_details?.email,
      ch.receipt_email,
      ch.metadata?.invoice_email,
      pi.metadata?.invoice_email,
    );
    if (!email) {
      orphans.set(customerId || ch.id, customerId);
      continue;
    }
    const p = person(email);
    if (from) p.correctedFrom.add(from);
    if (customerId) p.customerIds.add(customerId);
    p.charges.push({
      created: ch.created,
      amount: ch.amount,
      currency: ch.currency,
      product: ch.metadata?.memberpress_product || pi.metadata?.memberpress_product || null,
      invoice: idOf(ch.invoice),
      customerId,
    });
    p.names.push(
      { at: ch.created, name: ch.billing_details?.name },
      { at: ch.created, name: cust.name },
    );
  }

  for (const s of subscriptions) {
    if (!isLive(s)) continue;
    const item = s.items?.data?.[0] || {};
    const catalogName = names.get(idOf(item.price?.product ?? item.plan?.product));
    // Only MemberPress memberships count; a recurring donation is not one.
    const productName =
      s.metadata?.memberpress_product || (tierFromProduct(catalogName) ? catalogName : null);
    if (!productName) continue;
    const customerId = idOf(s.customer);
    const cust =
      (typeof s.customer === 'object' && s.customer) || customerById.get(customerId) || {};
    const { email, from } = resolve(cust.email, s.metadata?.invoice_email);
    if (!email) {
      orphans.set(customerId || s.id, customerId);
      continue;
    }
    const p = person(email);
    if (from) p.correctedFrom.add(from);
    if (customerId) p.customerIds.add(customerId);
    p.liveSubs.push({ sub: s, productName });
    p.names.push({ at: s.created, name: cust.name });
  }

  const tierProblem = (productName, tier) => {
    if (!tier) return `unknown product "${productName}"`;
    if (!tiers.has(tier)) return `tier ${tier} is not in membership_tiers`;
    return null;
  };

  function decide(p) {
    const base = blank({ email: p.email, full_name: latestName(p.names) });
    for (const from of p.correctedFrom)
      base.warnings.push(`email corrected from ${maskEmail(from)} to ${maskEmail(p.email)}`);
    if (!EMAIL_RE.test(p.email)) return { ...base, reason: 'malformed email' };
    const domain = p.email.slice(p.email.lastIndexOf('@') + 1);
    if (!p.correctedFrom.size && TYPO_DOMAINS.has(domain))
      base.warnings.push(`email domain ${domain} looks like a typo — correct it with --fix-email`);
    if (p.customerIds.size > 1)
      base.warnings.push(`${p.customerIds.size} Stripe customers use this email`);

    const membership = p.charges.filter((c) => c.product).sort((a, b) => a.created - b.created);
    if (p.liveSubs.length > 1)
      return { ...base, reason: 'multiple live subscriptions — handle by hand' };
    if (!p.liveSubs.length && !membership.length)
      return { ...base, reason: 'no MemberPress membership payment' };

    if (p.liveSubs.length === 1) {
      const { sub, productName } = p.liveSubs[0];
      const tier = tierFromProduct(productName);
      const problem = tierProblem(productName, tier);
      if (problem) return { ...base, reason: problem };
      const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
      if (periodEnd === null) base.warnings.push('subscription has no current_period_end');
      // Invoice charges belong to a subscription; only invoice-less ones are one-time.
      for (const c of membership.filter((c) => !c.invoice))
        base.warnings.push(
          `also paid one-time ${dayOf(c.created)} ${money(c.amount, c.currency)} ${c.product}`,
        );
      const starts = [sub.start_date ?? sub.created, membership[0]?.created].filter(
        (v) => v !== null && v !== undefined,
      );
      return {
        ...base,
        tier_id: tier,
        status: ['active', 'trialing'].includes(sub.status) ? 'active' : 'past_due',
        member_since: starts.length ? toIso(Math.min(...starts)) : null,
        expires_at: toIso(periodEnd),
        stripe_customer_id: idOf(sub.customer),
        stripe_subscription_id: sub.id,
        source: 'subscription',
        action: 'create',
        reason: 'new account',
      };
    }

    const last = membership[membership.length - 1];
    const tier = tierFromProduct(last.product);
    const problem = tierProblem(last.product, tier);
    if (problem) return { ...base, reason: problem };
    if (new Set(membership.map((c) => c.product)).size > 1) {
      const steps = membership
        .filter((c, i) => i === 0 || c.product !== membership[i - 1].product)
        .map((c) => `${c.product} (${dayOf(c.created)})`);
      base.warnings.push(`product changed over time: ${steps.join(' → ')} — using the latest`);
    }
    const expires = yearAfter(last.created);
    return {
      ...base,
      tier_id: tier,
      status: expires.getTime() > nowMs ? 'active' : 'expired',
      member_since: toIso(membership[0].created),
      expires_at: expires.toISOString(),
      stripe_customer_id: last.customerId,
      stripe_subscription_id: null,
      source: last.invoice ? 'ended-subscription' : 'one-time',
      action: 'create',
      reason: 'new account',
    };
  }

  const usersByEmail = new Map();
  for (const u of users) {
    const email = normEmail(u.email);
    if (email) usersByEmail.set(email, u);
  }
  const membersById = new Map(members.map((m) => [m.id, m]));
  const subscriptionOwner = new Map(
    members.filter((m) => m.stripe_subscription_id).map((m) => [m.stripe_subscription_id, m.id]),
  );

  function match(entry) {
    if (entry.action !== 'create') return entry;
    const skip = (e, reason) => ({ ...e, action: 'skip', reason });
    const user = usersByEmail.get(entry.email);
    const owner =
      entry.stripe_subscription_id && subscriptionOwner.get(entry.stripe_subscription_id);
    if (owner && owner !== user?.id)
      return skip(entry, 'subscription is already linked to another member');
    if (!user) return entry;
    const e = { ...entry, user_id: user.id };
    const m = membersById.get(user.id);
    if (!m) return { ...e, reason: 'auth user has no members row' };
    if (m.tier_id === 'honorary') return skip(e, 'honorary member');
    if (m.stripe_subscription_id && entry.stripe_subscription_id !== m.stripe_subscription_id)
      return skip(
        e,
        entry.stripe_subscription_id
          ? 'member is linked to a different subscription — handle by hand'
          : 'member is linked to a subscription the import did not find live — handle by hand',
      );
    const planned = epoch(entry.expires_at);
    const current = epoch(m.expires_at);
    if (
      m.tier_id &&
      !UNPAID_TIERS.has(m.tier_id) &&
      m.status === 'active' &&
      planned !== null &&
      (current === null || current > planned)
    )
      return skip(e, 'already has a longer membership');
    if (entry.status === 'expired' && m.status === 'active')
      return skip(e, 'already active on this site; the MemberPress membership has expired');

    const since = [epoch(m.member_since), epoch(entry.member_since)].filter((v) => v !== null);
    const desired = {
      tier_id: entry.tier_id,
      status: entry.status,
      member_since: since.length ? new Date(Math.min(...since)).toISOString() : null,
      expires_at: entry.expires_at,
      stripe_customer_id: entry.stripe_customer_id ?? m.stripe_customer_id ?? null,
      stripe_subscription_id: entry.stripe_subscription_id,
    };
    const changes = COMPARED.filter((k) => !same(k, m[k], desired[k]));
    const merged = { ...e, ...desired, changes };
    if (!changes.length) return { ...merged, action: 'unchanged', reason: 'already up to date' };
    return {
      ...merged,
      action: 'update',
      reason:
        m.tier_id === 'free' ? `upgrade free → ${entry.tier_id}` : `update ${changes.join(', ')}`,
    };
  }

  const entries = [...people.values()].map((p) => match(decide(p)));
  for (const customerId of orphans.values())
    entries.push(
      blank({
        stripe_customer_id: customerId,
        reason: 'no email on the Stripe customer or payment',
      }),
    );
  return entries.sort((a, b) =>
    a.email === b.email
      ? 0
      : a.email === null
        ? 1
        : b.email === null
          ? -1
          : a.email < b.email
            ? -1
            : 1,
  );
}

// Service-role Supabase client. Every URL is checked against SENDS_MAIL first.
function supabase({ fetch, supabaseUrl, serviceKey }) {
  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  };
  return async function call(method, path, body, extra = {}) {
    const url = `${base}${path}`;
    if (SENDS_MAIL.test(url)) throw new Error(`refusing ${path.split('?')[0]}: it sends email`);
    const r = await fetch(url, {
      method,
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!r.ok) {
      const detail = data?.msg || data?.message || data?.error_description || data?.error || '';
      throw new Error(`supabase ${method} ${path.split('?')[0]}: ${r.status} ${detail}`.trim());
    }
    return data;
  };
}

const RETURN_ROWS = { prefer: 'return=representation' };

// Write the plan, one entry at a time, stopping at the first error.
export async function applyPlan(
  plan,
  { fetch = globalThis.fetch, supabaseUrl, serviceKey, log = () => {} },
) {
  const call = supabase({ fetch, supabaseUrl, serviceKey });
  const patchMember = async (id, patch) => {
    const rows = await call(
      'PATCH',
      `/rest/v1/members?id=eq.${encodeURIComponent(id)}`,
      patch,
      RETURN_ROWS,
    );
    return Array.isArray(rows) ? rows : [];
  };
  const done = [];
  for (const e of plan) {
    if (e.action !== 'create' && e.action !== 'update') continue;
    let id = e.user_id;
    try {
      if (e.action === 'create') {
        if (!id) {
          const user = await call('POST', '/auth/v1/admin/users', {
            email: e.email,
            email_confirm: true,
            user_metadata: { full_name: e.full_name, imported_from: 'memberpress' },
          });
          id = user?.id ?? user?.user?.id;
          if (!id) throw new Error('auth user created but no id came back');
        }
        const row = pick(e, MEMBER_FIELDS);
        const rows = await patchMember(id, row);
        // No row means the handle_new_user trigger is missing: insert it instead.
        if (rows.length === 0) await call('POST', '/rest/v1/members', { id, ...row }, RETURN_ROWS);
        else if (rows.length !== 1) throw new Error(`expected 1 members row, got ${rows.length}`);
      } else {
        if (!id || !e.changes?.length) throw new Error('update entry without user_id or changes');
        const rows = await patchMember(id, pick(e, e.changes));
        if (rows.length !== 1) throw new Error(`expected 1 members row, got ${rows.length}`);
      }
    } catch (err) {
      return {
        done,
        failed: { email: e.email, action: e.action, user_id: id ?? null, message: err.message },
      };
    }
    done.push({ email: e.email, action: e.action, user_id: id });
    log(`  ✓ ${e.action.padEnd(6)} ${maskEmail(e.email)}`);
  }
  return { done, failed: null };
}

export function parseArgs(argv) {
  const opts = { apply: false, only: null, report: null, stripeEnv: null, fixes: new Map() };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg.startsWith('--only=')) {
      opts.only = new Set(arg.slice('--only='.length).split(',').map(normEmail).filter(Boolean));
      if (!opts.only.size) throw new Error('--only needs at least one email');
    } else if (arg.startsWith('--report=')) opts.report = arg.slice('--report='.length);
    else if (arg.startsWith('--stripe-env=')) opts.stripeEnv = arg.slice('--stripe-env='.length);
    else if (arg.startsWith('--fix-email=')) {
      const m = /^([^=]+)=([^=]+)$/.exec(arg.slice('--fix-email='.length));
      const from = normEmail(m?.[1]);
      const to = normEmail(m?.[2]);
      if (!from || !to || !EMAIL_RE.test(from) || !EMAIL_RE.test(to))
        throw new Error('--fix-email needs <from>=<to>, both email addresses');
      opts.fixes.set(from, to);
    } else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

const count = (items, keyOf) => {
  const out = {};
  for (const item of items) out[keyOf(item)] = (out[keyOf(item)] || 0) + 1;
  return Object.entries(out)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
};

function printPlan(entries) {
  const rows = entries.map((e) => [
    maskEmail(e.email),
    e.action,
    e.tier_id || '—',
    e.status || '—',
    e.expires_at ? e.expires_at.slice(0, 10) : '—',
    e.source || '—',
    e.reason,
  ]);
  const head = ['email', 'action', 'tier', 'status', 'expires', 'source', 'reason'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) =>
    '  ' +
    r
      .map((c, i) => (i === r.length - 1 ? c : String(c).padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  console.log(`\nPlan (${entries.length}):`);
  console.log(line(head));
  for (const r of rows) console.log(line(r));

  console.log(`\nBy action: ${count(entries, (e) => e.action) || 'none'}`);
  const kept = entries.filter((e) => e.action !== 'skip');
  console.log(`By tier/status: ${count(kept, (e) => `${e.tier_id}/${e.status}`) || 'none'}`);

  const warned = entries.filter((e) => e.warnings.length);
  if (warned.length) {
    console.log('\nWarnings:');
    for (const e of warned)
      for (const w of e.warnings) console.log(`  ${maskEmail(e.email)}: ${w}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    console.error(`Usage: ${USAGE}`);
    return 1;
  }

  let key = env.STRIPE_SECRET_KEY;
  if (opts.stripeEnv) {
    key = stripeKeyFrom(await readFile(opts.stripeEnv, 'utf8'));
    if (!key) {
      console.error(`✗ No sk_/rk_ live or test key found in ${opts.stripeEnv}`);
      return 1;
    }
  }
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !supabaseUrl || !serviceKey) {
    console.error('Missing STRIPE_SECRET_KEY (or --stripe-env), SUPABASE_URL or');
    console.error('SUPABASE_SERVICE_ROLE_KEY. Run:');
    console.error(`  ${USAGE}`);
    return 1;
  }

  // --- Read Stripe: GET only -----------------------------------------------
  const stripe = async (path) => {
    const r = await globalThis.fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path}: ${data.error?.message || r.status}`);
    return data;
  };
  const account = await stripe('account');
  console.log(`Stripe account: ${account.id}  mode=${keyMode(key).toUpperCase()}`);
  const subscriptions = await listAll(stripe, 'subscriptions?status=all&expand[]=data.customer');
  const charges = await listAll(stripe, 'charges?expand[]=data.payment_intent');
  const customers = await listAll(stripe, 'customers');
  const products = await listAll(stripe, 'products');
  console.log(
    `  ${subscriptions.length} subscriptions, ${charges.length} charges, ${customers.length} customers`,
  );

  // --- Read Supabase: GET only ---------------------------------------------
  const call = supabase({ fetch: (...a) => globalThis.fetch(...a), supabaseUrl, serviceKey });
  // Page until a page is empty or adds nobody new: the server may cap a page
  // below what was asked for, and a short page must not end the listing — a
  // missed user would plan as a duplicate 'create'.
  const collect = async (fetchPage) => {
    const byId = new Map();
    for (let page = 0; page < 1000; page += 1) {
      const batch = (await fetchPage(page, byId.size)) || [];
      const before = byId.size;
      for (const row of batch) byId.set(row.id, row);
      if (!batch.length || byId.size === before) break;
    }
    return [...byId.values()];
  };
  const users = await collect(
    async (page) =>
      (await call('GET', `/auth/v1/admin/users?page=${page + 1}&per_page=1000`))?.users,
  );
  const members = await collect((page, seen) =>
    call('GET', `/rest/v1/members?select=${MEMBER_COLUMNS}&order=id&limit=1000&offset=${seen}`),
  );
  const tiers = await call('GET', '/rest/v1/membership_tiers?select=id');
  console.log(`Supabase: ${users.length} auth users, ${members.length} members rows`);

  const plan = planImport({
    subscriptions,
    charges,
    customers,
    users,
    members,
    tierIds: tiers.map((t) => t.id),
    now: Date.now(),
    productNames: Object.fromEntries(products.map((p) => [p.id, p.name])),
    emailFixes: opts.fixes,
  });

  let entries = plan;
  if (opts.only) {
    // Accept either side of a --fix-email pair.
    const wanted = new Set([...opts.only].map((e) => opts.fixes.get(e) || e));
    entries = plan.filter((e) => e.email && wanted.has(e.email));
    const missing = [...wanted].filter((w) => !entries.some((e) => e.email === w)).length;
    if (missing) console.log(`⚠ ${missing} --only address(es) matched nobody who paid in Stripe`);
  }

  printPlan(entries);

  if (opts.report) {
    await writeFile(opts.report, JSON.stringify(entries, null, 2) + '\n');
    console.log(`\n✓ Wrote ${entries.length} entries to ${opts.report} (not printed — has PII)`);
  }

  if (!opts.apply) {
    console.log('\ndry run — nothing written. Re-run with --apply');
    return 0;
  }

  console.log('\nApplying…');
  const result = await applyPlan(entries, {
    fetch: (...a) => globalThis.fetch(...a),
    supabaseUrl,
    serviceKey,
    log: (l) => console.log(l),
  });
  console.log(`${result.done.length} written.`);
  if (result.failed) {
    const f = result.failed;
    console.error(`✗ stopped at ${maskEmail(f.email)} (${f.action}): ${maskEmails(f.message)}`);
    console.error('  Fix the cause and re-run: finished entries will plan as unchanged.');
  }

  // --- Verify: read back the rows that were written ------------------------
  let verified = 0;
  const byEmail = new Map(entries.map((e) => [e.email, e]));
  for (let i = 0; i < result.done.length; i += 100) {
    const chunk = result.done.slice(i, i + 100);
    const rows = await call(
      'GET',
      `/rest/v1/members?select=${MEMBER_COLUMNS}&id=in.(${chunk.map((d) => d.user_id).join(',')})`,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const d of chunk) {
      const row = byId.get(d.user_id);
      const want = byEmail.get(d.email);
      if (row && VERIFIED.every((k) => same(k, row[k], want[k]))) verified += 1;
    }
  }
  console.log(`Verified ${verified}/${result.done.length} members rows match the plan`);
  return result.failed || verified !== result.done.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`✗ ${maskEmails(err.message)}`);
      process.exitCode = 1;
    },
  );
}
