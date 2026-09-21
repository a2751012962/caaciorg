// Shared pieces of the token (华协币) endpoints. The rules that move tokens live
// in the SQL functions of 0024_tokens.sql; this file decides WHO may call them,
// turns their error codes into sentences, and sends the receipt emails.
import { bad, sb, requireUser } from './_lib.js';
import { SYSTEM_FONT_STACK } from './_fonts.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The whole feature sits behind one switch, so production can stay dark until
// 0024 is applied and the board says go — and can go dark again in a second.
export const tokensEnabled = (env) =>
  ['1', 'true', 'on'].includes(String(env.TOKENS_ENABLED || ''));
export const tokensOff = () => bad('Tokens are not available.', 404);

// 'Wei Zhang' -> 'W. Zhang', '张伟' -> '张＊'. A clerk confirms the customer by
// family name; nobody who scans a card gets the full name. full_name is one
// free-text field, so this is a convention, not a parse: a name containing a
// Han character is read family-name-first, anything else family-name-last.
export function maskName(full) {
  const name = String(full || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return 'CAACI Member';
  if (/\p{Script=Han}/u.test(name)) return `${[...name.replace(/\s/g, '')][0]}＊`;
  const parts = name.split(' ');
  if (parts.length === 1) return parts[0];
  return `${[...parts[0]][0].toUpperCase()}. ${parts[parts.length - 1]}`;
}

// What the signed-in person may do: their members row and the shops they work
// for. An admin also acts for CAACI's own internal merchant(s) without being on
// the staff list, mirroring token_charge.
const MEMBER_COLS = 'id,full_name,email,tier_id,status,expires_at,household_id,is_admin,is_root';
export async function callerRoles(DB, userId) {
  const member = await DB.selectOne('members', { id: userId }, MEMBER_COLS);
  const { rows: staffRows } = await DB.select('merchant_staff', {
    columns: 'role,merchants(id,name,name_zh,kind,status)',
    filters: [`member_id=eq.${userId}`],
    limit: 50,
  });
  const merchants = staffRows
    .filter((r) => r.merchants)
    .map((r) => ({ ...r.merchants, role: r.role }));
  const isAdmin = member?.is_admin === true || member?.is_root === true;
  if (isAdmin) {
    const { rows } = await DB.select('merchants', {
      columns: 'id,name,name_zh,kind,status',
      filters: ['kind=eq.internal'],
      limit: 10,
    });
    for (const m of rows)
      if (!merchants.some((x) => x.id === m.id)) merchants.push({ ...m, role: 'admin' });
  }
  return { member, merchants, isAdmin, isRoot: member?.is_root === true };
}

// Gate for a token endpoint: switch on, signed in. Returns { user, DB } or { error }.
export async function tokenGate(request, env) {
  if (!tokensEnabled(env)) return { error: tokensOff() };
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  return { user: gate.user, DB: sb(env) };
}

// Gate for a page a signed-out visitor may still read: the switch must be on,
// and a session is validated only if the request carries one. Returns
// { user: null, DB } for a visitor who has not signed in yet — which is how
// someone who scanned a printed code gets to see what it is before logging in.
export async function tokenGateOptional(request, env) {
  if (!tokensEnabled(env)) return { error: tokensOff() };
  if (!(request.headers.get('authorization') || '').startsWith('Bearer '))
    return { user: null, DB: sb(env) };
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  return { user: gate.user, DB: sb(env) };
}

// The four characters a customer reads out at the counter, and the merchant
// console shows beside the charge. Short on purpose: it is checked against a
// list of the last few minutes, not searched for among every charge ever made.
export const confirmCode = (txId) =>
  String(txId || '')
    .replace(/-/g, '')
    .slice(0, 4)
    .toUpperCase();

// Root gate (after the switch): validates the session, then reads is_root with
// the service role — never from the JWT.
export async function requireRoot(request, env) {
  const gate = await requireUser(request, env);
  if (gate.error) return gate;
  const member = await sb(env).selectOne(
    'members',
    { id: gate.user.id },
    'id,email,full_name,is_admin,is_root',
  );
  if (!member || member.is_root !== true) return { error: bad('Root access required.', 403) };
  return { member, user: gate.user };
}

// SQL error code -> [English, 中文]. `d` is the function's jsonb answer.
const MESSAGES = {
  invalid_amount: () => ['Enter a whole number of tokens above zero.', '请输入大于零的整数币数。'],
  over_max_charge: (d) => [
    `One charge can take at most ${d.max} tokens. Split it into two.`,
    `单笔最多扣 ${d.max} 币，请分两笔。`,
  ],
  cannot_charge_self: () => ['You cannot charge your own account.', '不能给自己的账户扣币。'],
  merchant_not_found: () => ['That merchant does not exist.', '找不到该商家。'],
  merchant_suspended: () => [
    'This merchant is suspended. Please contact CAACI.',
    '该商家已被暂停，请联系华协。',
  ],
  not_staff: () => [
    'Your account is not on this merchant’s staff list.',
    '你的账号不在该商家的店员名单中。',
  ],
  not_admin: () => ['Admin access required.', '需要管理员权限。'],
  code_not_found: () => [
    'This QR code is not in use. Please pay at the counter.',
    '这个二维码已失效，请到柜台付款。',
  ],
  self_serve_not_allowed: () => [
    'This shop does not take scan-to-pay yet. Please pay at the counter.',
    '该商家暂不支持扫码付款，请到柜台付款。',
  ],
  already_collected: (d) => [
    `Already handed over${d.at ? ` at ${central(d.at)}` : ''}${d.by ? ` by ${d.by}` : ''}. Check with them before serving it again.`,
    `这笔已出货${d.at ? `（${central(d.at)}）` : ''}${d.by ? `，操作人：${d.by}` : ''}。再出货前请先核实。`,
  ],
  not_collected: () => ['That charge is not ticked off.', '这笔还没标记出货。'],
  not_self_serve: () => [
    'Only a charge the customer made by scanning a QR is ticked off here.',
    '只有顾客扫码自助支付的扣币才需要标记出货。',
  ],
  charge_not_ok: (d) => [
    `This charge is ${d.state === 'disputed' ? 'under dispute' : 'no longer valid'} — do not hand anything over.`,
    `这笔扣币${d.state === 'disputed' ? '正在申诉中' : '已失效'}，请不要出货。`,
  ],
  repeat_too_soon: (d) => [
    `You paid for this less than ${Math.round(d.seconds / 60) || 1} minute(s) ago.`,
    `你在 ${Math.round(d.seconds / 60) || 1} 分钟内刚为这件商品付过款。`,
  ],
  member_not_found: () => ['Member not found.', '找不到该会员。'],
  membership_not_active: () => [
    'This member has no active paid membership to grant tokens for.',
    '该会员没有有效的付费会员资格，无法发放年度额度。',
  ],
  insufficient_balance: (d) => [
    `Not enough tokens: the balance is ${d.balance}.`,
    `余额不足：当前余额 ${d.balance} 币。`,
  ],
  charge_not_found: () => ['That charge does not exist.', '找不到这笔扣币。'],
  already_undone: () => ['That charge was already voided or reversed.', '这笔扣币已被撤销或冲回。'],
  void_window_closed: (d) => [
    `A charge can only be voided within ${d.hours} hours. Ask a CAACI admin.`,
    `扣币只能在 ${d.hours} 小时内撤销，请联系华协管理员。`,
  ],
  not_disputed: () => ['That charge is not under dispute.', '这笔扣币不在争议中。'],
  dispute_window_closed: (d) => [
    `Charges can be disputed for ${d.days} days. Please email CAACI.`,
    `扣币申诉期为 ${d.days} 天，请直接联系华协。`,
  ],
  reason_required: () => ['A reason is required.', '必须填写原因。'],
  over_admin_cap: (d) => [
    `An admin can move at most ${d.cap} tokens at a time. Ask root.`,
    `管理员单次最多 ${d.cap} 币，超出请找 root。`,
  ],
  over_daily_cap: (d) => [
    `Daily mint limit reached (${d.used} of ${d.cap} used). Ask root.`,
    `已达每日发币上限（已用 ${d.used} / ${d.cap}），请找 root。`,
  ],
  cash_below_minimum: (d) => [
    `The minimum cash top-up is $${(d.min_cents / 100).toFixed(2)}.`,
    `现金充值最低 $${(d.min_cents / 100).toFixed(2)}。`,
  ],
  cash_amount_mismatch: () => ['Cash and tokens do not match the rate.', '现金与币数不符合汇率。'],
  invalid_kind: () => ['Unknown kind of credit.', '未知的入账类型。'],
  not_same_family: () => ['Tokens can only move within your family.', '只能转给同一家庭的成员。'],
  same_member: () => ['Pick someone else to send tokens to.', '请选择另一位家人。'],
  internal_not_settled: () => [
    'CAACI’s own merchant is never settled.',
    '华协内部商家不需要结算。',
  ],
  period_not_over: () => ['That statement date is in the future.', '对账截止时间不能在未来。'],
  // A merchant that has taken tokens is part of the ledger's record of where
  // the money went, so it is kept and closed, never removed.
  merchant_has_history: () => [
    'This merchant has charges in the ledger, so it cannot be deleted — every charge has to keep the shop it was made at. Suspend it instead: it disappears from the till and can take nothing more.',
    '该商家已有流水，不能删除——每笔扣币都必须保留它所属的商家。请改用「暂停」：暂停后收银台不再显示，也无法再扣币。',
  ],
};

// A ledger function's { error } as an HTTP response carrying both languages.
export function ledgerError(result, status = 409) {
  const [en, zh] = (
    MESSAGES[result?.error] || (() => ['The request was refused.', '请求被拒绝。'])
  )(result || {});
  return new Response(
    // the function's details first (balance, cap…), then the sentences over its `error` code
    JSON.stringify({ ...result, error: en, error_zh: zh, code: result?.error || 'refused' }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

// Grant the membership year's tokens after a payment. Never throws: the
// membership is already active, and a webhook that 500s makes Stripe retry.
export async function grantMembershipTokens(env, DB, memberId, actorId = null) {
  if (!tokensEnabled(env) || !memberId) return null;
  try {
    return await DB.rpc('token_membership_grant', { p_member: memberId, p_actor: actorId });
  } catch (err) {
    console.warn('tokens: membership grant failed —', err.message);
    return null;
  }
}

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

// The receipt is the ONLY way a member learns their card was charged while
// they were not there (the QR is static), so its outcome is written back on
// the ledger row: receipt_sent_at, or receipt_error for an admin to see.
export async function sendReceipt(
  env,
  DB,
  { origin, tx, member, merchantName, balance, kind = 'charge' },
) {
  const stamp = async (patch) => {
    try {
      await DB.update('token_tx', { id: tx.id }, patch);
    } catch (err) {
      console.warn('tokens: could not stamp receipt —', err.message);
    }
  };
  if (!member?.email) return stamp({ receipt_error: 'member has no email address' });
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM)
    return stamp({ receipt_error: 'email is not configured' });

  const amount = Math.abs(tx.amount);
  const items = Array.isArray(tx.items) ? tx.items : [];
  const lines = items
    .map(
      (i) =>
        `<li>${esc(i.name)}${i.name_zh ? ` · ${esc(i.name_zh)}` : ''} × ${i.qty} — ${i.tokens * i.qty}</li>`,
    )
    .join('');
  const disputeUrl = `${origin}/api/tokens/dispute?tx=${tx.id}&k=${tx.dispute_key}`;
  const isVoid = kind !== 'charge';
  const subject = isVoid
    ? `${amount} tokens returned · 已退回 ${amount} 币 — ${merchantName}`
    : `${amount} tokens spent · 已扣 ${amount} 币 — ${merchantName}`;
  const html = `<div style="font-family:${SYSTEM_FONT_STACK};max-width:480px;color:#300200">
  <p style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8e2e11;font-weight:700">CAACI Tokens · 华协币</p>
  <p style="font-size:22px;font-weight:700;margin:0 0 4px">${isVoid ? '+' : '−'}${amount} tokens · 币</p>
  <p style="margin:0 0 12px;color:#555">${esc(merchantName)} · ${esc(central(tx.created_at))} (Central)</p>
  ${lines ? `<ul style="color:#555;padding-left:18px">${lines}</ul>` : ''}
  ${tx.note ? `<p style="color:#555">${esc(tx.note)}</p>` : ''}
  <p style="margin:12px 0">Balance · 余额: <b>${balance}</b></p>
  ${
    isVoid
      ? '<p style="color:#555">A charge was cancelled and the tokens are back in your account.<br>一笔扣币已撤销，币已退回你的账户。</p>'
      : `<p style="color:#555">Wasn’t you? Tell us and an admin will look into it:<br>不是你本人消费？请点此申诉，管理员会核实：</p>
  <p><a href="${disputeUrl}" style="color:#8e2e11;font-weight:700">This wasn’t me · 这不是我</a></p>`
  }
</div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to: member.email, subject, html }),
    });
    if (!r.ok)
      return stamp({ receipt_error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` });
    return stamp({ receipt_sent_at: new Date().toISOString(), receipt_error: null });
  } catch (err) {
    return stamp({ receipt_error: String(err.message || err).slice(0, 200) });
  }
}

// Run work after the response when the platform allows it (Pages Functions
// pass waitUntil); otherwise — in tests — just wait for it.
export const afterResponse = (context, promise) =>
  typeof context.waitUntil === 'function' ? context.waitUntil(promise) : promise;
