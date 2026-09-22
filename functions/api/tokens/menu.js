// A shop's own menu, kept by the shop.
//   GET  /api/tokens/menu?merchant_id=<uuid> — its items, what each has sold,
//        and whether a partner shop's QR codes are being honoured at all.
//   POST { action } — save_item | delete_item | issue_code | clear_code, the
//        same bodies the back office sends (functions/api/_menu.js), because
//        /merchant/ and /token-admin/ render the same component.
//
// Until now a stall that wanted one more item on the list had to ask an admin,
// who was not at the festival. The list is the shop's own business — a price,
// a name, a sticker to print — so its staff keep it, and CAACI keeps what a
// merchant IS: who is on the staff list, whether it is suspended, and what it
// is owed. Those stay in the back office.
//
// Who may write is checked here and nothing is taken from the body but the
// merchant it names: _menu.js filters every statement on that merchant_id, so
// an item id belonging to another shop is a 404, not an edit.
import { json, bad } from '../_lib.js';
import { tokenGate, callerRoles, ledgerError, UUID_RE } from '../_tokens.js';
import { menuAction } from '../_menu.js';

export async function onRequestGet({ request, env }) {
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  const merchantId = new URL(request.url).searchParams.get('merchant_id') || '';
  if (!UUID_RE.test(merchantId)) return bad('Which merchant?');

  try {
    const roles = await callerRoles(DB, user.id);
    if (!roles.isAdmin && !roles.merchants.some((m) => m.id === merchantId))
      return ledgerError({ error: 'not_staff' }, 403);

    const [merchant, items, settings] = await Promise.all([
      DB.selectOne('merchants', { id: merchantId }, 'id,name,name_zh,kind,status'),
      DB.select('merchant_items', {
        filters: [`merchant_id=eq.${merchantId}`],
        order: 'sort_order.asc,name.asc',
        limit: 500,
      }),
      DB.selectOne('token_settings', { id: true }, 'tokens_per_dollar,pay_allow_partners'),
    ]);
    if (!merchant) return bad('Unknown merchant.', 404);

    // What each line has sold (0033). One call answers for every merchant, so
    // this keeps the rows for this one. Until that migration is applied the
    // call fails, and the menu simply shows no figures rather than no menu.
    const sold = new Map();
    try {
      const rows = await DB.rpc('token_merchant_sales');
      for (const r of Array.isArray(rows) ? rows : [])
        if (r.merchant_id === merchantId && r.item_id)
          sold.set(r.item_id, { units: Number(r.units) || 0, tokens: Number(r.tokens) || 0 });
    } catch {
      // 0033 not applied yet: no figures, nothing else changes
    }

    return json({
      merchant,
      rate: settings?.tokens_per_dollar || 10,
      // A partner shop's printed codes are refused while this is off, so the
      // page can say that instead of handing out stickers that will not work.
      allow_partners: settings?.pay_allow_partners !== false,
      items: items.rows.map((i) => ({
        ...i,
        sold: sold.get(i.id)?.units ?? 0,
        sold_tokens: sold.get(i.id)?.tokens ?? 0,
      })),
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!UUID_RE.test(b.merchant_id || '')) return bad('Which merchant?');

  try {
    const roles = await callerRoles(DB, user.id);
    const mine = roles.merchants.find((m) => m.id === b.merchant_id);
    if (!roles.isAdmin && !mine) return ledgerError({ error: 'not_staff' }, 403);
    // A shop CAACI has stopped does not go on printing new QR codes or moving
    // its prices while it is stopped. An admin can still put it right from
    // here; the shop itself is told to ask.
    if (!roles.isAdmin && mine.status === 'suspended')
      return ledgerError({ error: 'merchant_suspended' });

    const result = await menuAction(DB, b);
    return result ?? bad('Unknown action.');
  } catch (e) {
    return bad(e.message, 500);
  }
}
