// POST /api/tokens/refund-request { tx_id, note } — a signed-in member asks,
// from the history on their own account page, for one of their rows to be
// looked at: a charge they do not recognise, or a top-up they want back. The
// row goes to 'disputed' (token_refund_request, 0037), which is what the back
// office's Disputes tab lists; nothing is refunded here. Two emails go out
// after the answer: a confirmation to the member, and a notice to CAACI staff.
// The session is the proof of who is asking — the function only touches a row
// that belongs to that member — so, unlike the receipt link, no key is needed.
import { json, bad, sendEmail } from '../_lib.js';
import { tokenGate, ledgerError, afterResponse, UUID_RE } from '../_tokens.js';
import { SYSTEM_FONT_STACK } from '../_fonts.js';

const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

const central = (iso) =>
  new Date(iso || Date.now()).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const usd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

// What the row is, in a line both the member and the staff can read.
function describe(row, merchantName) {
  const at = `${central(row.created_at)} (Central)`;
  if (row.kind === 'charge')
    return `${-row.amount} tokens · 币 — ${merchantName || 'CAACI'} · ${at}`;
  const how = row.kind === 'cash' ? 'cash top-up · 现金充值' : 'online purchase · 线上购买';
  return `${row.amount} tokens · 币 — ${how}${row.cash_cents ? ` · ${usd(row.cash_cents)}` : ''} · ${at}`;
}

async function notify(env, DB, { memberId, txId, note }) {
  try {
    const [member, row] = await Promise.all([
      DB.selectOne('members', { id: memberId }, 'full_name,email'),
      DB.selectOne('token_tx', { id: txId }, 'id,kind,amount,created_at,cash_cents,merchant_id'),
    ]);
    if (!row) return;
    const merchant = row.merchant_id
      ? await DB.selectOne('merchants', { id: row.merchant_id }, 'name,name_zh')
      : null;
    const merchantName = [merchant?.name, merchant?.name_zh].filter(Boolean).join(' · ');
    const line = describe(row, merchantName);
    const isCharge = row.kind === 'charge';

    // To the member: we have it, and what happens next.
    if (member?.email)
      await sendEmail(env, {
        to: member.email,
        subject: isCharge
          ? 'We received your report · 已收到你的申诉 — CAACI Tokens'
          : 'We received your refund request · 已收到你的退款申请 — CAACI Tokens',
        html: `<div style="font-family:${SYSTEM_FONT_STACK};max-width:480px;color:#300200">
  <p style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8e2e11;font-weight:700">CAACI Tokens · 华协币</p>
  <p style="font-size:18px;font-weight:700;margin:0 0 8px">${isCharge ? 'Report received · 已收到申诉' : 'Refund request received · 已收到退款申请'}</p>
  <p style="margin:0 0 12px;color:#555">${esc(line)}</p>
  ${note ? `<p style="color:#555;border-left:2px solid #ccc;padding-left:10px">“${esc(note)}”</p>` : ''}
  <p style="color:#555">${
    isCharge
      ? 'An admin will check with the merchant and email you. If the charge was not yours, the tokens come back to your account.<br>管理员会向商家核实并邮件回复。若确认不是你的消费，币会退回你的账户。'
      : 'An admin will review it and email you. If it is approved, the tokens are taken out of your account and the money is returned the way it was paid.<br>管理员会核实并邮件回复。通过后，币将从你的账户扣除，款项按原付款方式退还。'
  }</p>
  <p style="color:#555">This record shows “under review” on your account page until then.<br>在此之前，这条记录在账户页显示为「核实中」。</p>
</div>`,
      });

    // To staff: who, what, and where to act on it.
    await sendEmail(env, {
      subject: `${isCharge ? 'Token charge disputed' : 'Token refund requested'} — ${member?.full_name || member?.email || 'a member'} (${Math.abs(row.amount)} tokens)`,
      replyTo: member?.email || undefined,
      html: `<p><b>${esc(member?.full_name || 'A member')}</b>${member?.email ? ` (${esc(member.email)})` : ''} ${
        isCharge ? 'says a charge was not theirs.' : 'asks for a top-up to be refunded.'
      }</p>
<p>${esc(line)}</p>
${note ? `<p>“${esc(note)}”</p>` : ''}
<p>Resolve it under Disputes in the token back office (/token-admin/). ${
        isCharge
          ? 'The charge is held out of the merchant’s statement until then.'
          : 'Refund it there so the money returned is on the record, or reject it.'
      }</p>`,
    });
  } catch (err) {
    console.warn('tokens: refund request emails failed —', err.message);
  }
}

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
  if (!UUID_RE.test(b.tx_id || '')) return bad('Which record?');
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';

  try {
    const result = await DB.rpc('token_refund_request', {
      p_tx: b.tx_id,
      p_member: user.id,
      p_note: note,
    });
    if (!result?.ok) return ledgerError(result);
    if (!result.already)
      await afterResponse(context, notify(env, DB, { memberId: user.id, txId: b.tx_id, note }));
    return json({ ok: true, already: result.already === true, kind: result.kind || null });
  } catch (e) {
    return bad(e.message, 500);
  }
}
