// GET /api/tokens/merchant?merchant_id=<uuid>&offset=N — a merchant's own
// console: its charges, voids and reversals (newest first), what CAACI owes it
// right now, and its statements. Only that merchant's staff, or an admin, may
// read it. Customers appear by family name only — no email, no phone, and
// nothing about what they spent anywhere else.
import { json, bad } from '../_lib.js';
import { tokenGate, callerRoles, confirmCode, maskName, UUID_RE } from '../_tokens.js';

const PAGE = 50;

export async function onRequestGet({ request, env }) {
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  const url = new URL(request.url);
  const merchantId = url.searchParams.get('merchant_id') || '';
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const roles = await callerRoles(DB, user.id);
    // No id: the list of shops this account can open (the console's first screen).
    if (!merchantId) return json({ merchants: roles.merchants, admin: roles.isAdmin });
    if (!UUID_RE.test(merchantId)) return bad('Unknown merchant.');
    if (!roles.isAdmin && !roles.merchants.some((m) => m.id === merchantId))
      return bad('Your account is not on this merchant’s staff list.', 403);

    const merchant = await DB.selectOne(
      'merchants',
      { id: merchantId },
      'id,name,name_zh,kind,status,suspended_reason',
    );
    if (!merchant) return bad('Unknown merchant.', 404);

    const [tx, open, settlements, settings] = await Promise.all([
      DB.select('token_tx', {
        columns:
          'id,created_at,kind,amount,state,items,note,reason,member_id,actor_id,related_tx,settlement_id,self_serve',
        filters: [`merchant_id=eq.${merchantId}`],
        order: 'created_at.desc',
        limit: PAGE,
        offset,
        count: 'exact',
      }),
      DB.rpc('token_merchant_open', {
        p_merchant: merchantId,
        p_before: new Date(Date.now() + 1000).toISOString(),
      }),
      DB.select('merchant_settlements', {
        columns: 'id,period_end,tokens,amount_cents,status,reference,paid_at',
        filters: [`merchant_id=eq.${merchantId}`],
        order: 'period_end.desc',
        limit: 24,
      }),
      DB.selectOne('token_settings', { id: true }, 'tokens_per_dollar,void_hours'),
    ]);

    // token_tx points at auth.users, so names come from a second lookup.
    const ids = [...new Set(tx.rows.flatMap((t) => [t.member_id, t.actor_id]).filter(Boolean))];
    const names = new Map();
    if (ids.length) {
      const { rows } = await DB.select('members', {
        columns: 'id,full_name',
        filters: [`id=in.(${ids.join(',')})`],
        limit: ids.length,
      });
      for (const m of rows) names.set(m.id, m.full_name);
    }

    const rate = settings?.tokens_per_dollar || 10;
    const voidMs = (settings?.void_hours || 24) * 3600_000;
    const openTokens = Number(open) || 0;
    return json({
      merchant,
      rate,
      open: {
        tokens: openTokens,
        amount_cents: merchant.kind === 'internal' ? 0 : Math.round((openTokens * 100) / rate),
      },
      total: tx.total,
      offset,
      rows: tx.rows.map((t) => ({
        id: t.id,
        at: t.created_at,
        kind: t.kind,
        amount: t.amount,
        state: t.state,
        items: t.items || [],
        note: t.note || t.reason || '',
        customer: t.member_id ? maskName(names.get(t.member_id)) : '—',
        // staff see each other's full names; they work together. On a
        // self-serve charge the actor IS the customer, and staff get the same
        // masked name they already have, not the full one.
        by: t.actor_id && !t.self_serve ? names.get(t.actor_id) || '' : '',
        // What the customer's screen shows, for the counter to check against
        // (0030). Nobody can be served on a screenshot alone.
        self_serve: t.self_serve === true,
        confirm: t.kind === 'charge' && t.self_serve ? confirmCode(t.id) : '',
        related_tx: t.related_tx,
        settled: !!t.settlement_id,
        can_void:
          t.kind === 'charge' &&
          (t.state === 'ok' || t.state === 'disputed') &&
          (roles.isAdmin || Date.now() - new Date(t.created_at).getTime() < voidMs),
      })),
      settlements: settlements.rows,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
