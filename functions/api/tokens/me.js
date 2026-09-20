// GET /api/tokens/me — the signed-in member's wallet: balance, recent history,
// the packs on sale (priced through token_quote, so a running promotion shows),
// the family members tokens can be sent to, and which token roles the account
// holds (for showing the merchant and admin entrances). Answers
// { enabled: false } while the switch is off, so the account page can ask
// without knowing. Nothing expires since 0027.
import { json, bad, sb, requireUser, CARD_SURCHARGE, memberIsActive } from '../_lib.js';
import { tokensEnabled, callerRoles } from '../_tokens.js';

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return json({ enabled: false });
  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);
  const id = gate.user.id;

  try {
    const [settings, roles, balance, history] = await Promise.all([
      DB.selectOne('token_settings', { id: true }),
      callerRoles(DB, id),
      DB.rpc('token_balance', { p_member: id }),
      DB.select('token_tx', {
        columns: 'id,created_at,kind,amount,state,items,note,merchants(name,name_zh)',
        filters: [`member_id=eq.${id}`],
        order: 'created_at.desc',
        limit: 30,
      }),
    ]);

    // Nothing expires since 0027; the key stays so older pages keep working.
    const expiring = null;

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
    // Price each pack through token_quote rather than here, so the wallet can
    // never show a different number from the one the ledger will credit.
    const packCents = settings?.packs_cents || [];
    const quotes = await Promise.all(
      packCents.map((cents) => DB.rpc('token_quote', { p_member: id, p_cents: cents })),
    );
    const bonusPct = quotes.find((q) => q?.bonus_active)?.bonus_pct || 0;
    return json({
      enabled: true,
      balance: Number(balance) || 0,
      expiring,
      rate,
      bonus_pct: bonusPct,
      bonus_until: bonusPct ? quotes.find((q) => q?.bonus_active)?.bonus_to || null : null,
      // Active today, expiry included: a stored 'active' can be a year stale.
      can_buy: memberIsActive(roles.member),
      packs: packCents.map((cents, i) => {
        const base = (cents * rate) / 100;
        const tokens = Number.isInteger(quotes[i]?.total) ? quotes[i].total : base;
        return {
          cents,
          tokens,
          base,
          bonus: tokens - base,
          charge_cents: Math.round(cents * (1 + CARD_SURCHARGE)),
        };
      }),
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
