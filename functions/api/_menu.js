// One merchant's menu: the four writes that shape it, in one place because two
// endpoints now do them — the back office (functions/api/admin/merchants.js,
// for any shop) and the shop's own console (functions/api/tokens/menu.js, for
// the shops the caller works at). The two endpoints decide WHO may write; what
// a write means — and that it can only ever touch the merchant named in the
// request — is decided here, once.
//
// That scoping is the whole reason this file exists as a module rather than a
// copy. An admin passing an item id can be trusted with whatever it belongs to;
// a volunteer at one stall cannot. So every statement below filters on
// merchant_id as well as id, and an item that is not this merchant's is a 404
// rather than a silent edit of someone else's menu.
import { json, bad } from './_lib.js';
import { UUID_RE } from './_tokens.js';

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// A printed pay code (0030). No I, O or U, and no 0 or 1, so nothing on a
// sticker can be read back wrong; 31^8 ≈ 8.5e11, drawn from the CSPRNG, so a
// code cannot be guessed at from another one. Bytes at or above 248 are thrown
// away rather than folded, which would make the first few letters likelier.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
export function newPayCode() {
  let code = '';
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= 248) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/** The actions this module answers. Anything else is the caller's own. */
export const MENU_ACTIONS = ['save_item', 'delete_item', 'issue_code', 'clear_code'];

/**
 * Run a menu write for b.merchant_id, or answer null when `b.action` is not one
 * of MENU_ACTIONS — so an endpoint can offer this and then go on to its own.
 * The caller has already established that this account may write to this shop.
 */
export async function menuAction(DB, b) {
  if (!MENU_ACTIONS.includes(b.action)) return null;
  if (!UUID_RE.test(b.merchant_id || '')) return bad('Which merchant?');

  if (b.action === 'save_item') {
    const tokens = Number(b.tokens);
    if (!Number.isInteger(tokens) || tokens <= 0 || tokens > 100000)
      return bad('Tokens must be a whole number above zero.');
    const row = {
      merchant_id: b.merchant_id,
      name: text(b.name, 120),
      name_zh: text(b.name_zh, 120) || null,
      group_label: text(b.group_label, 80) || null,
      tokens,
      sort_order: Number.isInteger(Number(b.sort_order)) ? Number(b.sort_order) : 0,
      active: b.active !== false,
    };
    if (!row.name) return bad('The item needs a name.');
    if (b.id) {
      if (!UUID_RE.test(b.id)) return bad('Unknown item.');
      const before = await DB.selectOne(
        'merchant_items',
        { id: b.id, merchant_id: b.merchant_id },
        'id,tokens,pay_code',
      );
      if (!before) return bad('Unknown item.', 404);
      await DB.update('merchant_items', { id: b.id, merchant_id: b.merchant_id }, row);
      // The sticker carries the code, never the price, so a price change takes
      // effect on every cup already out there the moment it is saved.
      return json({ ok: true, reprint: !!before.pay_code && before.tokens !== tokens });
    }
    const [created] = await DB.insert('merchant_items', row);
    return json({ ok: true, item: created });
  }

  if (b.action === 'delete_item') {
    if (!UUID_RE.test(b.id || '')) return bad('Unknown item.');
    const item = await DB.selectOne(
      'merchant_items',
      { id: b.id, merchant_id: b.merchant_id },
      'id',
    );
    if (!item) return bad('Unknown item.', 404);
    // past charges keep their own copy of the line, so the ledger loses nothing
    await DB.del('merchant_items', { id: b.id, merchant_id: b.merchant_id });
    return json({ ok: true });
  }

  // Give an item the code printed in its QR sticker (0030), or give it a new
  // one. Re-issuing is how a sticker that was swapped, copied or photographed
  // is killed: every sheet printed from the old code stops working at once.
  if (b.action === 'issue_code') {
    if (!UUID_RE.test(b.id || '')) return bad('Unknown item.');
    const item = await DB.selectOne(
      'merchant_items',
      { id: b.id, merchant_id: b.merchant_id },
      'id',
    );
    if (!item) return bad('Unknown item.', 404);
    // Unique index, not a read-then-write: two people pressing at once each get
    // their own code instead of one silently overwriting the other.
    for (let attempt = 0; attempt < 5; attempt++) {
      const pay_code = newPayCode();
      try {
        await DB.update(
          'merchant_items',
          { id: b.id, merchant_id: b.merchant_id },
          { pay_code, pay_code_at: new Date().toISOString() },
        );
        return json({ ok: true, pay_code });
      } catch (err) {
        if (!/duplicate key|23505/i.test(err.message)) throw err;
      }
    }
    return bad('Could not make a unique code. Try again.', 503);
  }

  if (b.action === 'clear_code') {
    if (!UUID_RE.test(b.id || '')) return bad('Unknown item.');
    await DB.update(
      'merchant_items',
      { id: b.id, merchant_id: b.merchant_id },
      { pay_code: null, pay_code_at: null },
    );
    return json({ ok: true });
  }

  return null;
}
