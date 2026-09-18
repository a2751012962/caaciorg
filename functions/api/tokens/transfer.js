// POST /api/tokens/transfer { to, amount } — send tokens to someone in the same
// family. A family plan's yearly tokens land on the founder; this is how they
// reach the others. token_transfer (0024) checks both people share a household
// and keeps each piece's expiry date.
import { json, bad } from '../_lib.js';
import { tokenGate, ledgerError, UUID_RE } from '../_tokens.js';

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
  if (!UUID_RE.test(b.to || '')) return bad('Choose a family member.');
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount <= 0) return bad('Enter a whole number of tokens.');

  try {
    const result = await DB.rpc('token_transfer', {
      p_from: user.id,
      p_to: b.to,
      p_amount: amount,
    });
    if (!result?.ok) return ledgerError(result);
    return json({ ok: true, balance: result.balance });
  } catch (e) {
    return bad(e.message, 500);
  }
}
