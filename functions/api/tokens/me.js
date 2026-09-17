// GET /api/tokens/me — the signed-in member's wallet: balance, what expires
// next, recent history, the packs on sale, the family members tokens can be
// sent to, and which token roles the account holds (for showing the merchant
// and admin entrances). Answers { enabled: false } while the switch is off, so
// the account page can ask without knowing.
import { json, bad, sb, requireUser, CARD_SURCHARGE } from '../_lib.js';
import { tokensEnabled, callerRoles } from '../_tokens.js';

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return json({ enabled: false });
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);
  const id = gate.user.id;

  try {
    const [settings, roles, balance, lots, history] = await Promise.all([
      DB.selectOne('token_settings', { id: true }),
      callerRoles(DB, id),
      DB.rpc('token_balance', { p_member: id }),
      DB.select('token_lots', {
        columns: 'remaining,expires_at',
        filters: [
          `member_id=eq.${id}`,
          'remaining=gt.0',
          `expires_at=gt.${new Date().toISOString()}`,
        ],
        order: 'expires_at.asc',
        limit: 50,
      }),
      DB.select('token_tx', {
        columns: 'id,created_at,kind,amount,state,items,note,merchants(name,name_zh)',
        filters: [`member_id=eq.${id}`],
        order: 'created_at.desc',
        limit: 30,
      }),
    ]);

    // Tokens that share the soonest expiry date, as one "N expire on …" line.
    let expiring = null;
    if (lots.rows.length) {
      const at = lots.rows[0].expires_at;
      const amount = lots.rows
        .filter((l) => l.expires_at === at)
        .reduce((sum, l) => sum + l.remaining, 0);
      expiring = { amount, at };
    }

    let family = [];
    if (roles.member?.household_id) {
      const { rows } = await DB.select('members', {
        columns: 'id,full_name',
        filters: [`household_id=eq.${roles.member.household_id}`, `id=neq.${id}`],
        limit: 10,
      });
      family = rows.map((m) => ({ id: m.id, name: m.full_name || 'Family member' }));
    }

    const rate = settings?.tokens_per_dollar || 10;
    return json({
      enabled: true,
      balance: Number(balance) || 0,
      expiring,
      rate,
      can_buy: roles.member?.status === 'active',
      packs: (settings?.packs_cents || []).map((cents) => ({
        cents,
        tokens: (cents * rate) / 100,
        charge_cents: Math.round(cents * (1 + CARD_SURCHARGE)),
      })),
      history: history.rows.map((t) => ({
        id: t.id,
        at: t.created_at,
        kind: t.kind,
        amount: t.amount,
        state: t.state,
        items: t.items || [],
        note: t.note || '',
        merchant: t.merchants ? { name: t.merchants.name, name_zh: t.merchants.name_zh } : null,
      })),
      family,
      roles: {
        admin: roles.isAdmin,
        root: roles.isRoot,
        merchants: roles.merchants.map((m) => ({ id: m.id, name: m.name, name_zh: m.name_zh })),
      },
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
