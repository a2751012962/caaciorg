// /api/tokens/dispute?tx=<uuid>&k=<dispute_key> — the "this wasn't me" link in
// a charge receipt. No sign-in: the key in the link is the proof, and it only
// ever went to the member's own mailbox.
//   GET  — shows the charge and a confirm button. It changes nothing, because
//          mail scanners and link previews open every link in an email.
//   POST — files the dispute (token_dispute_open) and tells CAACI staff. The
//          charge stays out of the merchant's statement until an admin decides.
import { sb, sendEmail } from '../_lib.js';
import { tokensEnabled, UUID_RE } from '../_tokens.js';
import { SYSTEM_FONT_STACK } from '../_fonts.js';

const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

const shell = (inner, status = 200) =>
  new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>CAACI Tokens · 华协币</title>
<style>
  body{margin:0;font-family:${SYSTEM_FONT_STACK};background:#f3f3f3;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:8px;box-shadow:0 15px 80px -6px rgba(0,0,0,.2);padding:36px 32px;max-width:420px;width:90%;color:#300200}
  .org{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8e2e11;font-weight:700;margin:0 0 18px}
  h1{font-size:22px;margin:0 0 10px} p{color:#555;line-height:1.5}
  textarea{width:100%;box-sizing:border-box;min-height:80px;border:1px solid #ccc;border-radius:6px;padding:10px;font:inherit}
  button{margin-top:14px;width:100%;min-height:48px;border:0;border-radius:6px;background:#8e2e11;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
</style></head><body><div class="card"><p class="org">CAACI Tokens · 华协币</p>${inner}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

const notFound = () =>
  shell(
    '<h1>Link not valid · 链接无效</h1><p>This link is wrong or too old. Please email CAACI and we will look into it.<br>链接有误或已过期，请直接邮件联系华协。</p>',
    404,
  );

async function load(request, env) {
  if (!tokensEnabled(env)) return {};
  const url = new URL(request.url);
  const tx = url.searchParams.get('tx') || '';
  const key = url.searchParams.get('k') || '';
  if (!UUID_RE.test(tx) || !UUID_RE.test(key)) return {};
  const DB = sb(env);
  const row = await DB.selectOne('token_tx', { id: tx, dispute_key: key, kind: 'charge' });
  if (!row) return {};
  const merchant = row.merchant_id
    ? await DB.selectOne('merchants', { id: row.merchant_id }, 'name,name_zh')
    : null;
  return {
    DB,
    row,
    key,
    merchantName: [merchant?.name, merchant?.name_zh].filter(Boolean).join(' · '),
  };
}

const when = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export async function onRequestGet({ request, env }) {
  try {
    const { row, merchantName } = await load(request, env);
    if (!row) return notFound();
    if (row.state === 'disputed')
      return shell(
        '<h1>Already reported · 已收到申诉</h1><p>An admin is looking into it and will email you.<br>管理员正在核实，会邮件回复你。</p>',
      );
    if (row.state !== 'ok')
      return shell(
        '<h1>Already returned · 已退回</h1><p>This charge was cancelled and the tokens are back in your account.<br>这笔扣币已撤销，币已退回你的账户。</p>',
      );
    return shell(`<h1>${-row.amount} tokens · 币</h1>
<p>${esc(merchantName)}<br>${esc(when(row.created_at))} (Central)</p>
<p>If you did not make this purchase, tell us. An admin will check with the merchant and email you.<br>如果这不是你本人的消费，请提交申诉，管理员会向商家核实并邮件回复。</p>
<form method="post"><textarea name="note" maxlength="500" placeholder="Anything that helps (optional) · 补充说明（可选）"></textarea>
<button type="submit">This wasn’t me · 这不是我</button></form>`);
  } catch {
    return notFound();
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const { DB, row, key, merchantName } = await load(request, env);
    if (!row) return notFound();
    const note = (new URLSearchParams(await request.text()).get('note') || '').slice(0, 500);
    const result = await DB.rpc('token_dispute_open', { p_tx: row.id, p_key: key, p_note: note });
    if (!result?.ok) {
      if (result?.error === 'already_undone')
        return shell(
          '<h1>Already returned · 已退回</h1><p>The tokens are back in your account.<br>币已退回你的账户。</p>',
        );
      return notFound();
    }
    if (!result.already) {
      const member = row.member_id
        ? await DB.selectOne('members', { id: row.member_id }, 'full_name,email')
        : null;
      await sendEmail(env, {
        subject: `Token charge disputed — ${merchantName} (${-row.amount} tokens)`,
        replyTo: member?.email || undefined,
        html: `<p><b>${esc(member?.full_name || 'A member')}</b> says a charge was not theirs.</p>
<p>${esc(merchantName)} · ${-row.amount} tokens · ${esc(when(row.created_at))} (Central)</p>
${note ? `<p>“${esc(note)}”</p>` : ''}
<p>Resolve it under Tokens → Disputes in the admin panel. The charge is held out of the merchant’s statement until then.</p>`,
      }).catch(() => {});
    }
    return shell(
      '<h1>Thank you · 已收到</h1><p>An admin will check with the merchant and email you. If the charge was not yours, the tokens come back to your account.<br>管理员会向商家核实并邮件回复。若确认不是你的消费，币会退回你的账户。</p>',
    );
  } catch {
    return notFound();
  }
}
