// POST /api/tokens/void { tx_id, reason } — cancel a charge and put the tokens
// back. token_void (0024) decides who may: the shop's own staff within
// void_hours, or an admin at any time. The member is emailed that the tokens
// came back. A void is a new ledger row; the charge stays in the history.
import { json, bad } from '../_lib.js';
import { tokenGate, ledgerError, sendReceipt, afterResponse, UUID_RE } from '../_tokens.js';

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
  if (!UUID_RE.test(b.tx_id || '')) return bad('Which charge?');

  try {
    const result = await DB.rpc('token_void', {
      p_tx: b.tx_id,
      p_actor: user.id,
      p_reason: typeof b.reason === 'string' ? b.reason.slice(0, 200) : null,
    });
    if (!result?.ok) return ledgerError(result, result?.error === 'not_staff' ? 403 : 409);

    await afterResponse(
      context,
      (async () => {
        const tx = await DB.selectOne('token_tx', { id: result.tx_id });
        if (!tx?.member_id) return;
        const [member, merchant] = await Promise.all([
          DB.selectOne('members', { id: tx.member_id }, 'id,email,full_name'),
          tx.merchant_id ? DB.selectOne('merchants', { id: tx.merchant_id }, 'name,name_zh') : null,
        ]);
        await sendReceipt(env, DB, {
          origin: new URL(request.url).origin,
          tx,
          member,
          merchantName: [merchant?.name, merchant?.name_zh].filter(Boolean).join(' · '),
          balance: result.balance,
          kind: 'void',
        });
      })().catch((err) => console.warn('tokens: void notice failed —', err.message)),
    );
    return json({ ok: true, tx_id: result.tx_id, amount: result.amount, balance: result.balance });
  } catch (e) {
    return bad(e.message, 500);
  }
}
