// /api/admin/merchants  (admin only)
//   GET  — every merchant with its staff, menu, what CAACI owes it now, and its
//          statements; plus `people`, every account on the site, for the
//          add-staff pick-list.
//   POST { action } — save_merchant | set_status | delete_merchant | add_staff |
//          remove_staff | save_item | delete_item | issue_code | clear_code |
//          close_statement | mark_paid
// Merchants and their staff are created here and nowhere else: an account that
// can take tokens is one CAACI has vetted. Staff are added by the email of an
// account that already exists — the person signs up on the site first.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { tokensEnabled, tokensOff, ledgerError, UUID_RE } from '../_tokens.js';

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// A printed pay code (0030). No I, O or U, and no 0 or 1, so nothing on a
// sticker can be read back wrong; 31^8 ≈ 8.5e11, drawn from the CSPRNG, so a
// code cannot be guessed at from another one. Bytes at or above 248 are thrown
// away rather than folded, which would make the first few letters likelier.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
function newPayCode() {
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

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);

  try {
    const [merchants, staff, items, settlements, settings] = await Promise.all([
      DB.select('merchants', { order: 'kind.asc,name.asc', limit: 200 }),
      DB.select('merchant_staff', {
        columns: 'merchant_id,member_id,role,created_at',
        limit: 1000,
      }),
      DB.select('merchant_items', { order: 'sort_order.asc,name.asc', limit: 2000 }),
      DB.select('merchant_settlements', { order: 'period_end.desc', limit: 500 }),
      DB.selectOne('token_settings', { id: true }, 'tokens_per_dollar,settle_min_cents'),
    ]);

    // Every account on the site, once: it names the staff already on a
    // merchant, and it fills the page's pick-list for adding one, so an admin
    // can choose a volunteer instead of typing an address from memory.
    const accounts = await DB.select('members', {
      columns: 'id,full_name,email',
      order: 'full_name.asc.nullslast,email.asc',
      limit: 2000,
    });
    const people = new Map(accounts.rows.map((m) => [m.id, m]));

    const before = new Date(Date.now() + 1000).toISOString();
    const rate = settings?.tokens_per_dollar || 10;
    const rows = await Promise.all(
      merchants.rows.map(async (m) => {
        const [open, used] = await Promise.all([
          DB.rpc('token_merchant_open', { p_merchant: m.id, p_before: before }),
          // One row is enough: a merchant with any charge at all can never be
          // deleted (the ledger's foreign key is ON DELETE RESTRICT), so the
          // page offers Suspend instead of a button that would only refuse.
          DB.select('token_tx', {
            columns: 'id',
            filters: [`merchant_id=eq.${m.id}`],
            limit: 1,
          }),
        ]);
        const openTokens = Number(open) || 0;
        return {
          ...m,
          has_history: used.rows.length > 0 || settlements.rows.some((s) => s.merchant_id === m.id),
          open_tokens: openTokens,
          open_cents: m.kind === 'internal' ? 0 : Math.round((openTokens * 100) / rate),
          staff: staff.rows
            .filter((s) => s.merchant_id === m.id)
            .map((s) => ({
              member_id: s.member_id,
              role: s.role,
              name: people.get(s.member_id)?.full_name || '',
              email: people.get(s.member_id)?.email || '',
            })),
          items: items.rows.filter((i) => i.merchant_id === m.id),
          settlements: settlements.rows.filter((s) => s.merchant_id === m.id),
        };
      }),
    );
    return json({
      rows,
      rate,
      settle_min_cents: settings?.settle_min_cents ?? 2000,
      people: accounts.rows.filter((m) => m.email),
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);

  let b;
  try {
    b = await request.json();
  } catch {
    return bad('invalid JSON');
  }

  try {
    if (b.action === 'save_merchant') {
      const row = {
        name: text(b.name, 120),
        name_zh: text(b.name_zh, 120) || null,
        contact_name: text(b.contact_name, 120) || null,
        contact_email: text(b.contact_email, 200) || null,
        payout_note: text(b.payout_note, 500) || null,
        directory_id: UUID_RE.test(b.directory_id || '') ? b.directory_id : null,
      };
      if (!row.name) return bad('The merchant needs a name.');
      if (b.id) {
        if (!UUID_RE.test(b.id)) return bad('Unknown merchant.');
        await DB.update('merchants', { id: b.id }, row); // kind never changes after creation
        return json({ ok: true, merchant: await DB.selectOne('merchants', { id: b.id }) });
      }
      const kind = b.kind === 'internal' ? 'internal' : 'partner';
      const [created] = await DB.insert('merchants', { ...row, kind, created_by: gate.user.id });
      return json({ ok: true, merchant: created });
    }

    if (!UUID_RE.test(b.merchant_id || '') && !['mark_paid', 'delete_item'].includes(b.action))
      return bad('Which merchant?');

    if (b.action === 'set_status') {
      if (!['active', 'suspended'].includes(b.status)) return bad('Invalid status.');
      await DB.update(
        'merchants',
        { id: b.merchant_id },
        {
          status: b.status,
          suspended_reason:
            b.status === 'suspended' ? text(b.reason, 200) || 'Suspended by an admin' : null,
        },
      );
      return json({ ok: true });
    }

    // Remove a merchant that was created by mistake. Only ever one that has
    // taken nothing: token_tx.merchant_id and merchant_settlements.merchant_id
    // are ON DELETE RESTRICT, so Postgres would refuse anyway — this asks first
    // so the answer is a sentence instead of a foreign-key error. Its menu and
    // staff go with it (both cascade); a merchant with history is suspended.
    if (b.action === 'delete_merchant') {
      const [charges, statements] = await Promise.all([
        DB.select('token_tx', {
          columns: 'id',
          filters: [`merchant_id=eq.${b.merchant_id}`],
          limit: 1,
        }),
        DB.select('merchant_settlements', {
          columns: 'id',
          filters: [`merchant_id=eq.${b.merchant_id}`],
          limit: 1,
        }),
      ]);
      if (charges.rows.length || statements.rows.length)
        return ledgerError({ error: 'merchant_has_history' });
      await DB.del('merchant_items', { merchant_id: b.merchant_id });
      await DB.del('merchant_staff', { merchant_id: b.merchant_id });
      await DB.del('merchants', { id: b.merchant_id });
      return json({ ok: true });
    }

    if (b.action === 'add_staff') {
      const email = text(b.email, 200).toLowerCase();
      // No PostgREST pattern characters: the address is matched whole, any case.
      if (!/^[^\s@*%(),\\]+@[^\s@*%(),\\]+\.[^\s@*%(),\\]+$/.test(email))
        return bad('Enter the email of their CAACI account.');
      const { rows } = await DB.select('members', {
        columns: 'id,full_name,email',
        filters: [`email=ilike.${encodeURIComponent(email.replace(/_/g, '\\_'))}`],
        limit: 2,
      });
      if (rows.length !== 1)
        return bad(
          'No CAACI account uses that email. They need to sign up on the site first.',
          404,
        );
      await DB.upsert(
        'merchant_staff',
        {
          merchant_id: b.merchant_id,
          member_id: rows[0].id,
          role: b.role === 'owner' ? 'owner' : 'staff',
          created_by: gate.user.id,
        },
        { onConflict: 'merchant_id,member_id' },
      );
      return json({ ok: true, member: rows[0] });
    }

    if (b.action === 'remove_staff') {
      if (!UUID_RE.test(b.member_id || '')) return bad('Which person?');
      await DB.del('merchant_staff', { merchant_id: b.merchant_id, member_id: b.member_id });
      return json({ ok: true });
    }

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
      await DB.del('merchant_items', { id: b.id }); // past charges keep their own copy of the line
      return json({ ok: true });
    }

    // Give an item the code printed in its QR sticker (0030), or give it a new
    // one. Re-issuing is how a sticker that was swapped, copied or photographed
    // is killed: every sheet printed from the old code stops working at once.
    if (b.action === 'issue_code') {
      if (!UUID_RE.test(b.id || '')) return bad('Unknown item.');
      const item = await DB.selectOne('merchant_items', { id: b.id }, 'id,merchant_id');
      if (!item || item.merchant_id !== b.merchant_id) return bad('Unknown item.', 404);
      // Unique index, not a read-then-write: two admins pressing at once each
      // get their own code instead of one silently overwriting the other.
      for (let attempt = 0; attempt < 5; attempt++) {
        const pay_code = newPayCode();
        try {
          await DB.update(
            'merchant_items',
            { id: b.id },
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

    if (b.action === 'close_statement') {
      const before = new Date(b.before || '');
      if (isNaN(before.getTime())) return bad('Pass the statement cut-off time.');
      const result = await DB.rpc('token_settlement_close', {
        p_merchant: b.merchant_id,
        p_before: before.toISOString(),
        p_actor: gate.user.id,
      });
      return result?.ok ? json(result) : ledgerError(result);
    }

    if (b.action === 'mark_paid') {
      if (!UUID_RE.test(b.settlement_id || '')) return bad('Which statement?');
      const reference = text(b.reference, 200);
      if (!reference) return bad('Enter the cheque number or transfer reference.');
      const row = await DB.selectOne('merchant_settlements', { id: b.settlement_id });
      if (!row) return bad('Statement not found.', 404);
      if (row.status === 'paid') return bad('That statement is already marked paid.', 409);
      await DB.update(
        'merchant_settlements',
        { id: b.settlement_id, status: 'due' },
        {
          status: 'paid',
          reference,
          paid_at: new Date().toISOString(),
          paid_by: gate.user.id,
        },
      );
      return json({ ok: true });
    }

    return bad('Unknown action.');
  } catch (e) {
    return bad(e.message, 500);
  }
}
