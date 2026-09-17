// POST /api/tokens/charge — a merchant's staff take tokens from a member.
//   { member_id, merchant_id, items: [{ id, qty }], custom_tokens, note, idem_key }
// Menu prices come from merchant_items on the server, never from the request;
// custom_tokens covers what is not on the menu. token_charge (0024) checks the
// caller is on that merchant's staff, the cap and the balance, and makes a
// retry with the same idem_key land once. The member then gets an email
// receipt with a "this wasn't me" link; its outcome is stamped on the row.
import { json, bad } from '../_lib.js';
import { tokenGate, ledgerError, sendReceipt, afterResponse, UUID_RE } from '../_tokens.js';

const MAX_QTY = 50;

export async function onRequestPost(context) {
  const { request, env } = context;
  const gate = await tokenGate(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  if (!UUID_RE.test(b.member_id || '')) return bad('That is not a CAACI member code.');
  if (!UUID_RE.test(b.merchant_id || '')) return bad('Choose the merchant you are charging for.');
  const idem = typeof b.idem_key === 'string' ? b.idem_key.slice(0, 80) : '';

  const wanted = Array.isArray(b.items) ? b.items : [];
  for (const w of wanted) {
    if (!UUID_RE.test(w?.id || '')) return bad('Unknown menu item.');
    if (!Number.isInteger(w.qty) || w.qty < 1 || w.qty > MAX_QTY) return bad('Invalid quantity.');
  }
  const custom =
    b.custom_tokens === undefined || b.custom_tokens === null ? 0 : Number(b.custom_tokens);
  if (!Number.isInteger(custom) || custom < 0) return bad('Enter a whole number of tokens.');

  try {
    let lines = [];
    if (wanted.length) {
      const { rows } = await DB.select('merchant_items', {
        columns: 'id,name,name_zh,tokens',
        filters: [
          `merchant_id=eq.${b.merchant_id}`,
          'active=eq.true',
          `id=in.(${wanted.map((w) => w.id).join(',')})`,
        ],
        limit: 200,
      });
      for (const w of wanted) {
        const item = rows.find((r) => r.id === w.id);
        if (!item) return bad('A menu item is no longer available. Reload and try again.', 409);
        lines.push({ name: item.name, name_zh: item.name_zh, tokens: item.tokens, qty: w.qty });
      }
    }
    if (custom > 0) lines.push({ name: 'Other', name_zh: '其他', tokens: custom, qty: 1 });
    const amount = lines.reduce((sum, l) => sum + l.tokens * l.qty, 0);
    if (amount <= 0) return bad('Nothing to charge.');

    const result = await DB.rpc('token_charge', {
      p_member: b.member_id,
      p_merchant: b.merchant_id,
      p_actor: user.id,
      p_amount: amount,
      p_items: lines,
      p_note: typeof b.note === 'string' ? b.note.slice(0, 200) : null,
      p_idem: idem || null,
    });
    if (!result?.ok) return ledgerError(result);

    if (!result.duplicate) {
      await afterResponse(
        context,
        (async () => {
          const [tx, member, merchant] = await Promise.all([
            DB.selectOne('token_tx', { id: result.tx_id }),
            DB.selectOne('members', { id: b.member_id }, 'id,email,full_name'),
            DB.selectOne('merchants', { id: b.merchant_id }, 'name,name_zh'),
          ]);
          await sendReceipt(env, DB, {
            origin: new URL(request.url).origin,
            tx,
            member,
            merchantName: [merchant?.name, merchant?.name_zh].filter(Boolean).join(' · '),
            balance: result.balance,
          });
        })().catch((err) => console.warn('tokens: receipt failed —', err.message)),
      );
    }
    return json({
      ok: true,
      tx_id: result.tx_id,
      amount,
      balance: result.balance,
      duplicate: !!result.duplicate,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
