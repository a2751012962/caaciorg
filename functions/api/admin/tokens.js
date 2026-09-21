// /api/admin/tokens  (admin only; changing the settings is root only)
//   GET ?view=overview            — settings + the treasurer's totals
//       ?view=member&id=<uuid>    — one member's balance and history
//       ?view=ledger[&kind=&merchant_id=&offset=] — the whole ledger, newest first
//       ?view=item&id=<uuid>[&offset=] — one menu item: what it sold, and the
//                                   charges behind that
//       ?view=disputes            — charges a member reported as not theirs
//       ?view=cash&date=YYYY-MM-DD — cash taken per admin that day (Central time)
//   POST { action }               — grant | mint | cash | debit | resolve | settings
// The caps on what an admin may mint live in the SQL functions (0024), so they
// hold for every caller; this file only routes and explains refusals.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import {
  tokensEnabled,
  tokensOff,
  requireRoot,
  ledgerError,
  maskName,
  confirmCode,
  UUID_RE,
} from '../_tokens.js';

const PAGE = 50;
const KINDS = [
  'grant',
  'purchase',
  'cash',
  'mint',
  'charge',
  'void',
  'reversal',
  'transfer_out',
  'transfer_in',
  'adjust',
];
const TX_COLS =
  'id,created_at,kind,amount,state,items,note,reason,cash_cents,member_id,actor_id,merchant_id,related_tx,' +
  'grant_period,disputed_at,dispute_note,resolution,receipt_sent_at,receipt_error,self_serve,' +
  'merchants(name,name_zh)';

// full names for the member/actor ids on a page of ledger rows
async function namesFor(DB, rows) {
  const ids = [...new Set(rows.flatMap((t) => [t.member_id, t.actor_id]).filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const { rows: members } = await DB.select('members', {
    columns: 'id,full_name,email',
    filters: [`id=in.(${ids.join(',')})`],
    limit: ids.length,
  });
  for (const m of members) names.set(m.id, m);
  return names;
}

const shape = (names) => (t) => ({
  ...t,
  merchant: t.merchants || null,
  merchants: undefined,
  // The four characters the member's screen showed and the shop's console
  // lists, so a query about one scan-to-pay charge can be matched from here
  // without opening the merchant console. Same rule as merchant.js: a charge a
  // clerk rang up has no code, because nobody had to check one.
  confirm: t.kind === 'charge' && t.self_serve ? confirmCode(t.id) : '',
  member_name: names.get(t.member_id)?.full_name || '',
  member_email: names.get(t.member_id)?.email || '',
  actor_name: names.get(t.actor_id)?.full_name || '',
});

// Midnight-to-midnight in Central time for a YYYY-MM-DD, as UTC instants.
function centralDay(date) {
  const at = (h) => {
    // find the UTC instant whose Central wall clock reads `date` 00:00
    const guess = new Date(`${date}T${String(h).padStart(2, '0')}:00:00Z`);
    const wall = guess.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T');
    return wall.startsWith(`${date}T00:00`) ? guess : null;
  };
  const start = at(5) || at(6); // CDT is UTC-5, CST is UTC-6
  if (!start) return null;
  return { from: start, to: new Date(start.getTime() + 24 * 3600_000) };
}

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);
  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'overview';
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    if (view === 'overview') {
      const [settings, totals, me] = await Promise.all([
        DB.selectOne('token_settings', { id: true }),
        DB.rpc('token_overview'),
        DB.selectOne('members', { id: gate.user.id }, 'is_root'),
      ]);
      return json({ settings, totals, root: me?.is_root === true });
    }

    if (view === 'member') {
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return bad('Member id is required.');
      const member = await DB.selectOne(
        'members',
        { id },
        'id,full_name,email,tier_id,status,expires_at',
      );
      if (!member) return bad('Member not found.', 404);
      const [balance, tx, settings] = await Promise.all([
        DB.rpc('token_balance', { p_member: id }),
        DB.select('token_tx', {
          columns: TX_COLS,
          filters: [`member_id=eq.${id}`],
          order: 'created_at.desc',
          limit: PAGE,
          offset,
          count: 'exact',
        }),
        DB.selectOne('token_settings', { id: true }, 'grants'),
      ]);
      const names = await namesFor(DB, tx.rows);
      return json({
        member,
        masked_name: maskName(member.full_name),
        balance: Number(balance) || 0,
        grant_target: Number(settings?.grants?.[member.tier_id]) || 0,
        total: tx.total,
        rows: tx.rows.map(shape(names)),
      });
    }

    if (view === 'ledger' || view === 'disputes') {
      const filters = [];
      if (view === 'disputes') filters.push('state=eq.disputed');
      const kind = url.searchParams.get('kind') || '';
      if (KINDS.includes(kind)) filters.push(`kind=eq.${kind}`);
      const merchantId = url.searchParams.get('merchant_id') || '';
      if (UUID_RE.test(merchantId)) filters.push(`merchant_id=eq.${merchantId}`);
      const tx = await DB.select('token_tx', {
        columns: TX_COLS,
        filters,
        order: 'created_at.desc',
        limit: PAGE,
        offset,
        count: 'exact',
      });
      const names = await namesFor(DB, tx.rows);
      return json({ total: tx.total, offset, rows: tx.rows.map(shape(names)) });
    }

    // One menu item on its own: what it is, what it has sold, and the charges
    // behind that. token_item_report (0032) adds up both shapes of charge and
    // hands back the ids; the rows themselves are read and shaped here exactly
    // as the ledger's are, so a charge looks the same wherever it is shown.
    if (view === 'item') {
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return bad('Item id is required.');
      const item = await DB.selectOne('merchant_items', { id });
      if (!item) return bad('Item not found.', 404);
      const [merchant, report] = await Promise.all([
        DB.selectOne('merchants', { id: item.merchant_id }, 'id,name,name_zh,kind,status'),
        DB.rpc('token_item_report', { p_item: id, p_limit: PAGE, p_offset: offset }),
      ]);
      const ids = Array.isArray(report?.ids) ? report.ids : [];
      let rows = [];
      if (ids.length) {
        const tx = await DB.select('token_tx', {
          columns: TX_COLS,
          filters: [`id=in.(${ids.join(',')})`],
          order: 'created_at.desc',
          limit: ids.length,
        });
        const names = await namesFor(DB, tx.rows);
        rows = tx.rows.map(shape(names));
      }
      return json({
        item,
        merchant,
        sold: Number(report?.sold) || 0,
        tokens: Number(report?.tokens) || 0,
        undone: Number(report?.undone) || 0,
        first_at: report?.first_at || null,
        last_at: report?.last_at || null,
        total: Number(report?.total) || 0,
        offset,
        rows,
      });
    }

    if (view === 'cash') {
      const date = url.searchParams.get('date') || '';
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? centralDay(date) : null;
      if (!day) return bad('Pass date=YYYY-MM-DD.');
      const rows = await DB.rpc('token_cash_report', {
        p_from: day.from.toISOString(),
        p_to: day.to.toISOString(),
      });
      return json({ date, rows: rows || [] });
    }

    return bad('Unknown view.');
  } catch (e) {
    return bad(e.message, 500);
  }
}

const SETTING_INTS = [
  'max_charge',
  'admin_mint_cap',
  'admin_daily_cap',
  'cash_min_cents',
  'void_hours',
  'dispute_days',
  'settle_min_cents',
  'suspend_after',
  'pay_repeat_seconds',
];
// Settings a zero is meaningful for: no statement minimum, and no second
// confirmation on a repeated scan-to-pay.
const ZERO_OK = new Set(['settle_min_cents', 'pay_repeat_seconds']);

export async function onRequestPost({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }

  // ---- root only: the global parameters ----
  if (b.action === 'settings') {
    const gate = await requireRoot(request, env);
    if (gate.error) return gate.error;
    const patch = {};
    for (const k of SETTING_INTS) {
      if (b[k] === undefined) continue;
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < (ZERO_OK.has(k) ? 0 : 1)) return bad(`Invalid ${k}.`);
      patch[k] = n;
    }
    // Whether shops CAACI does not run may take scan-to-pay. This is the
    // compliance decision behind 0027/0030, so it is root's and explicit.
    if (b.pay_allow_partners !== undefined) {
      if (typeof b.pay_allow_partners !== 'boolean') return bad('Invalid pay_allow_partners.');
      patch.pay_allow_partners = b.pay_allow_partners;
    }
    if (b.grants !== undefined) {
      if (!b.grants || typeof b.grants !== 'object' || Array.isArray(b.grants))
        return bad('Invalid grants.');
      const grants = {};
      for (const [tier, n] of Object.entries(b.grants)) {
        if (!/^[a-z0-9_-]{1,40}$/.test(tier) || !Number.isInteger(n) || n < 0 || n > 100000)
          return bad('Invalid grants.');
        if (n > 0) grants[tier] = n;
      }
      patch.grants = grants;
    }
    if (b.packs_cents !== undefined) {
      const packs = Array.isArray(b.packs_cents) ? b.packs_cents.map(Number) : null;
      // $10 is the floor the board set: below it Stripe's fixed fee eats the sale
      if (
        !packs ||
        !packs.length ||
        packs.some((c) => !Number.isInteger(c) || c < 1000 || c > 100000)
      )
        return bad('Packs must be whole cents, from $10 to $1000.');
      patch.packs_cents = [...new Set(packs)].sort((x, y) => x - y);
    }
    if (!Object.keys(patch).length) return bad('Nothing to update.');
    try {
      const DB = sb(env);
      await DB.update(
        'token_settings',
        { id: true },
        {
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: gate.user.id,
        },
      );
      return json({ ok: true, settings: await DB.selectOne('token_settings', { id: true }) });
    } catch (e) {
      return bad(e.message, 500);
    }
  }

  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);
  const actor = gate.user.id;

  try {
    if (b.action === 'resolve') {
      if (!UUID_RE.test(b.tx_id || '')) return bad('Which charge?');
      const result = await DB.rpc('token_dispute_resolve', {
        p_tx: b.tx_id,
        p_actor: actor,
        p_uphold: b.uphold === true,
        p_note: typeof b.note === 'string' ? b.note.slice(0, 500) : null,
      });
      return result?.ok ? json(result) : ledgerError(result);
    }

    if (!UUID_RE.test(b.member_id || '')) return bad('Member id is required.');
    if (
      ['mint', 'debit'].includes(b.action) &&
      !(Number.isInteger(Number(b.amount)) && Number(b.amount) > 0)
    )
      return bad('Enter a whole number of tokens above zero.');
    let result;
    if (b.action === 'grant') {
      result = await DB.rpc('token_membership_grant', { p_member: b.member_id, p_actor: actor });
    } else if (b.action === 'mint') {
      result = await DB.rpc('token_admin_credit', {
        p_member: b.member_id,
        p_kind: 'mint',
        p_amount: Number(b.amount),
        p_cash_cents: null,
        p_actor: actor,
        p_reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : '',
      });
    } else if (b.action === 'cash') {
      const cents = Number(b.cash_cents);
      if (!Number.isInteger(cents) || cents <= 0) return bad('Enter the cash received.');
      // token_quote is the one place the rate lives, promotion included, so the
      // desk cannot send a number token_admin_credit will turn down. It re-quotes
      // under the member lock, and a mismatch comes back with `expected`.
      const quote = await DB.rpc('token_quote', { p_member: b.member_id, p_cents: cents });
      if (!quote || quote.error) return bad(quote?.error || 'Could not price that amount.');
      const tokens = quote.total;
      if (!Number.isInteger(tokens)) return bad('That amount does not convert to whole tokens.');
      result = await DB.rpc('token_admin_credit', {
        p_member: b.member_id,
        p_kind: 'cash',
        p_amount: tokens,
        p_cash_cents: cents,
        p_actor: actor,
        p_reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : null,
      });
    } else if (b.action === 'debit') {
      result = await DB.rpc('token_admin_debit', {
        p_member: b.member_id,
        p_amount: Number(b.amount),
        p_actor: actor,
        p_reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : '',
      });
    } else {
      return bad('Unknown action.');
    }
    return result?.ok ? json(result) : ledgerError(result);
  } catch (e) {
    return bad(e.message, 500);
  }
}
