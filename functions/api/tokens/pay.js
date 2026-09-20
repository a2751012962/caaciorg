// Scan-to-pay (0030): the customer scans the QR printed on the product.
//
//   GET  /api/tokens/pay?c=<code>  — what the sticker stands for: which shop,
//        which item, how many tokens. Answers a signed-out visitor too (they
//        have the code in their hand already), and adds their balance once they
//        have signed in, so the page can say "30 tokens · you have 450".
//   POST /api/tokens/pay { code, idem_key, allow_repeat }
//        — takes the tokens. The price is read from merchant_items inside
//        token_charge_code, never from this request: an edited URL cannot
//        change what an item costs. The member then gets the same email receipt
//        (with the "this wasn't me" link) a clerk's charge sends.
import { json, bad } from '../_lib.js';
import {
  confirmCode,
  ledgerError,
  sendReceipt,
  afterResponse,
  tokenGateOptional,
} from '../_tokens.js';

// What a printed code may contain: the alphabet issued in admin/merchants.js,
// minus the pairs a person misreads (I/1, O/0). Anything else is not a code.
const CODE_RE = /^[2-9A-HJ-NP-TV-Z]{6,16}$/;
const clean = (raw) => String(raw || '').trim().toUpperCase();

export async function onRequestGet({ request, env }) {
  const gate = await tokenGateOptional(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;

  const code = clean(new URL(request.url).searchParams.get('c'));
  if (!CODE_RE.test(code)) return bad('This QR code is not in use.', 404);

  try {
    const { rows } = await DB.select('merchant_items', {
      columns: 'id,merchant_id,name,name_zh,tokens,active,pay_code',
      filters: [`pay_code=eq.${code}`],
      limit: 1,
    });
    const item = rows[0];
    if (!item || !item.active) return bad('This QR code is not in use.', 404);

    const [merchant, settings] = await Promise.all([
      DB.selectOne('merchants', { id: item.merchant_id }, 'id,name,name_zh,kind,status'),
      DB.selectOne(
        'token_settings',
        { id: true },
        'tokens_per_dollar,max_charge,pay_allow_partners',
      ),
    ]);
    if (!merchant) return bad('This QR code is not in use.', 404);

    const balance = user ? Number(await DB.rpc('token_balance', { p_member: user.id })) || 0 : null;
    return json({
      code,
      merchant: { name: merchant.name, name_zh: merchant.name_zh },
      item: { name: item.name, name_zh: item.name_zh, tokens: item.tokens },
      // Why the page may have to refuse before the member even taps.
      open:
        merchant.status === 'active' &&
        (merchant.kind === 'internal' || settings?.pay_allow_partners === true) &&
        item.tokens <= (settings?.max_charge ?? 500),
      suspended: merchant.status !== 'active',
      rate: settings?.tokens_per_dollar ?? 10,
      signed_in: !!user,
      balance,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const gate = await tokenGateOptional(request, env);
  if (gate.error) return gate.error;
  const { user, DB } = gate;
  if (!user) return bad('Please sign in to pay with tokens.', 401);

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }
  const code = clean(b.code);
  if (!CODE_RE.test(code)) return bad('This QR code is not in use.', 404);
  const idem = typeof b.idem_key === 'string' ? b.idem_key.slice(0, 80) : '';

  try {
    const result = await DB.rpc('token_charge_code', {
      p_member: user.id,
      p_code: code,
      p_idem: idem || null,
      p_allow_repeat: b.allow_repeat === true,
    });
    if (!result?.ok) return ledgerError(result);

    if (!result.duplicate) {
      await afterResponse(
        context,
        (async () => {
          const [tx, member, merchant] = await Promise.all([
            DB.selectOne('token_tx', { id: result.tx_id }),
            DB.selectOne('members', { id: user.id }, 'id,email,full_name'),
            DB.selectOne('merchants', { id: result.merchant_id }, 'name,name_zh'),
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
      confirm: confirmCode(result.tx_id),
      amount: result.amount,
      balance: result.balance,
      duplicate: !!result.duplicate,
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}
