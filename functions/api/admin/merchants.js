// /api/admin/merchants  (admin only)
//   GET  — every merchant with its staff, menu, what CAACI owes it now, and its
//          statements; plus `people`, the site's admins, for the add-staff
//          pick-list (anyone else is added by typing their email).
//   POST { action } — save_merchant | set_status | delete_merchant | add_staff |
//          remove_staff | save_item | delete_item | issue_code | clear_code |
//          close_statement | mark_paid
// Merchants and their staff are created here and nowhere else: an account that
// can take tokens is one CAACI has vetted. Staff are added by the email of an
// account that already exists — the person signs up on the site first.
//
// The menu actions are the four this endpoint shares with the shop's own
// console (functions/api/_menu.js): the same bodies, the same answers, whether
// an admin sends them from the back office or a stall sends them from
// /merchant/.
import { json, bad, sb, requireAdmin } from '../_lib.js';
import { tokensEnabled, tokensOff, ledgerError, UUID_RE } from '../_tokens.js';
import { menuAction } from '../_menu.js';

const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function onRequestGet({ request, env }) {
  if (!tokensEnabled(env)) return tokensOff();
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const DB = sb(env);

  try {
    const [merchants, staff, items, settlements, settings, admins] = await Promise.all([
      DB.select('merchants', { order: 'kind.asc,name.asc', limit: 200 }),
      DB.select('merchant_staff', {
        columns: 'merchant_id,member_id,role,created_at',
        limit: 1000,
      }),
      DB.select('merchant_items', { order: 'sort_order.asc,name.asc', limit: 2000 }),
      DB.select('merchant_settlements', { order: 'period_end.desc', limit: 500 }),
      DB.selectOne('token_settings', { id: true }, 'tokens_per_dollar,settle_min_cents'),
      // The add-staff pick-list: the site's admins (the same set the Roles
      // page lists), not every member, so the list is short enough to pick
      // from and never shows the whole membership on one screen. A volunteer
      // who is not an admin is still added by typing their email.
      DB.select('members', {
        columns: 'id,full_name,email',
        filters: ['or=(is_admin.eq.true,is_root.eq.true)', 'email=not.is.null'],
        order: 'full_name.asc.nullslast,email.asc',
        limit: 500,
      }),
    ]);

    // Name the staff already on a merchant. Admins are known already; anyone
    // else is looked up by id.
    const people = new Map(admins.rows.map((m) => [m.id, m]));
    const missing = [...new Set(staff.rows.map((s) => s.member_id))].filter(
      (id) => !people.has(id),
    );
    if (missing.length) {
      const { rows } = await DB.select('members', {
        columns: 'id,full_name,email',
        filters: [`id=in.(${missing.join(',')})`],
        limit: missing.length,
      });
      for (const m of rows) people.set(m.id, m);
    }

    const before = new Date(Date.now() + 1000).toISOString();
    const rate = settings?.tokens_per_dollar || 10;
    // What each merchant and each menu line has sold (0033), in one call for
    // all of them. Until that migration is applied the call fails, and the page
    // simply shows no sales figures rather than no page.
    const sales = new Map(); // merchant_id -> { charges, tokens, items: Map<item_id, {units, tokens}> }
    try {
      const rows = await DB.rpc('token_merchant_sales');
      for (const r of Array.isArray(rows) ? rows : []) {
        const s = sales.get(r.merchant_id) || { charges: 0, tokens: 0, items: new Map() };
        if (r.item_id) {
          s.items.set(r.item_id, { units: Number(r.units) || 0, tokens: Number(r.tokens) || 0 });
        } else {
          s.charges = Number(r.charges) || 0;
          s.tokens = Number(r.tokens) || 0;
        }
        sales.set(r.merchant_id, s);
      }
    } catch {
      // 0033 not applied yet: no figures, nothing else changes
    }
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
        const sold = sales.get(m.id);
        return {
          ...m,
          has_history: used.rows.length > 0 || settlements.rows.some((s) => s.merchant_id === m.id),
          open_tokens: openTokens,
          open_cents: m.kind === 'internal' ? 0 : Math.round((openTokens * 100) / rate),
          // standing charges so far: how many, and the tokens they took
          sold_charges: sold?.charges ?? 0,
          sold_tokens: sold?.tokens ?? 0,
          staff: staff.rows
            .filter((s) => s.merchant_id === m.id)
            .map((s) => ({
              member_id: s.member_id,
              role: s.role,
              name: people.get(s.member_id)?.full_name || '',
              email: people.get(s.member_id)?.email || '',
            })),
          items: items.rows
            .filter((i) => i.merchant_id === m.id)
            .map((i) => ({
              ...i,
              sold: sold?.items.get(i.id)?.units ?? 0,
              sold_tokens: sold?.items.get(i.id)?.tokens ?? 0,
            })),
          settlements: settlements.rows.filter((s) => s.merchant_id === m.id),
        };
      }),
    );
    return json({
      rows,
      rate,
      settle_min_cents: settings?.settle_min_cents ?? 2000,
      people: admins.rows,
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

    if (!UUID_RE.test(b.merchant_id || '') && b.action !== 'mark_paid')
      return bad('Which merchant?');

    // save_item | delete_item | issue_code | clear_code, scoped to this merchant
    const menu = await menuAction(DB, b);
    if (menu) return menu;

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
    //
    // CAACI's own merchant is never deleted, even on the day it has taken
    // nothing. It is the one every admin charges at, the only one cleared for
    // scan-to-pay while pay_allow_partners is off, and its printed codes hang
    // off it — deleting it would kill every sticker already on a cup to save
    // one row. There is no case where that is what was meant, so the button is
    // not offered and the endpoint refuses it.
    if (b.action === 'delete_merchant') {
      const merchant = await DB.selectOne('merchants', { id: b.merchant_id }, 'id,kind');
      if (!merchant) return bad('Merchant not found.', 404);
      if (merchant.kind === 'internal') return ledgerError({ error: 'internal_not_deleted' });
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
