// POST /api/tokens/collect — a stall ticks a scan-to-pay charge off its list
// (0031): { tx_id, collected }.
//
// The confirmation code tells the counter the payment is real; this is what
// keeps the same payment from being served twice. token_collect stamps the row
// only while nobody has stamped it, so of two volunteers tapping at once one
// gets ok and the other is told who took it and when — which is the point: a
// conflict at the counter instead of a quiet second juice.
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
  if (!UUID_RE.test(b.tx_id || '')) return bad('Which charge?');

  try {
    const result = await DB.rpc('token_collect', {
      p_tx: b.tx_id,
      p_actor: user.id,
      // Anything but an explicit false means "handed over".
      p_collected: b.collected !== false,
    });
    return result?.ok ? json(result) : ledgerError(result);
  } catch (e) {
    return bad(e.message, 500);
  }
}
