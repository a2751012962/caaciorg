// GET /api/tokens/scan?m=<member uuid> — what a clerk (or an admin at an event
// desk) sees after scanning a member card and signing in: the family name only,
// whether the membership is valid, the balance, and the shops — with their
// menus — this account may charge for. Strangers get a 403: a balance is
// nobody else's business.
import { json, bad, effectiveMembership } from '../_lib.js';
import { tokenGate, callerRoles, maskName, UUID_RE } from '../_tokens.js';

export async function onRequestGet({ request, env }) {
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  const memberId = new URL(request.url).searchParams.get('m') || '';
  if (!UUID_RE.test(memberId)) return bad('That is not a CAACI member code.');

  try {
    const roles = await callerRoles(DB, user.id);
    if (!roles.isAdmin && roles.merchants.length === 0)
      return bad(
        'This account is not set up to take tokens. Ask CAACI to add you to a merchant.',
        403,
      );

    const target = await DB.selectOne(
      'members',
      { id: memberId },
      'id,full_name,tier_id,status,expires_at',
    );
    if (!target) return bad('Member not found.', 404);

    const [plan, balance, settings] = await Promise.all([
      effectiveMembership(DB, memberId),
      DB.rpc('token_balance', { p_member: memberId }),
      DB.selectOne('token_settings', { id: true }),
    ]);
    const tier = plan ? await DB.selectOne('membership_tiers', { id: plan.tier_id }, 'name') : null;

    const active = roles.merchants.filter((m) => m.status === 'active');
    let items = [];
    if (active.length) {
      const { rows } = await DB.select('merchant_items', {
        columns: 'id,merchant_id,group_label,name,name_zh,tokens,sort_order',
        filters: [`merchant_id=in.(${active.map((m) => m.id).join(',')})`, 'active=eq.true'],
        order: 'sort_order.asc,name.asc',
        limit: 500,
      });
      items = rows;
    }

    return json({
      member: {
        id: target.id,
        name: maskName(target.full_name),
        valid: !!plan,
        tier_name: tier?.name || null,
        until: plan?.expires_at || null,
        is_self: target.id === user.id,
      },
      balance: Number(balance) || 0,
      merchants: roles.merchants.map((m) => ({
        id: m.id,
        name: m.name,
        name_zh: m.name_zh,
        kind: m.kind,
        status: m.status,
        items: items.filter((i) => i.merchant_id === m.id),
      })),
      admin: roles.isAdmin,
      root: roles.isRoot,
      // what an admin's "grant this year's tokens" would aim for (0 = plan has none)
      grant_target: roles.isAdmin ? Number(settings?.grants?.[target.tier_id]) || 0 : 0,
      limits: {
        max_charge: settings?.max_charge ?? 500,
        rate: settings?.tokens_per_dollar ?? 10,
        cash_min_cents: settings?.cash_min_cents ?? 500,
        admin_mint_cap: settings?.admin_mint_cap ?? 500,
      },
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
