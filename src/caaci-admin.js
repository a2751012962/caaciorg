// caaci-admin.js — back-office panel logic. Loaded ONLY by /admin/index.html.
// Gates on a live Supabase session + members.is_admin (real enforcement is
// server-side in /api/admin/*; this is UX). All privileged data comes from
// authenticated API calls, never baked into the page.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js,
// a classic <script> the build injects before this deferred module), which sets
// window.supabase.createClient. Serving it from our own origin drops the runtime
// dependency on esm.sh — blocked/slow on some networks (e.g. China), which
// otherwise leaves this panel stuck on "Checking access…".
import { LANG_KEY, preferredLang } from './caaci-shared.js';

const cfg = window.CAACI_CONFIG || {};
const sb = window.supabase;
const supa =
  sb && sb.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
    ? sb.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- i18n (EN / 中文) ----------
// The panel keeps its own choice; until one is made it follows the language
// chosen on the public site, then the browser's.
let lang = preferredLang(
  localStorage.getItem('caaci-admin-lang') || localStorage.getItem(LANG_KEY),
  window.navigator?.languages,
);
function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh' : 'en';
  for (const el of $$('[data-en]')) {
    const v = el.getAttribute(`data-${lang}`);
    if (v != null) el.textContent = v;
  }
  for (const el of $$('[data-ph-en]')) {
    const v = el.getAttribute(`data-ph-${lang}`);
    if (v != null) el.placeholder = v;
  }
  const t = $('#caaci-lang');
  if (t) t.textContent = lang === 'en' ? '中文' : 'EN';
}
const t = (en, zh) => (lang === 'zh' ? zh : en);

// ---------- session + admin gate ----------
let token = null;
let gateState = null; // null = checking | 'misconfig' | 'anon' | 'forbidden'

// Render the gate's heading + message for the current state and language. Once a
// state is set we own the heading, so drop its data-* (which applyLang would
// otherwise reset to "Checking access…" on a language toggle).
function renderGate() {
  if (!gateState) return; // still checking — leave the HTML default
  const h2 = $('#caaci-admin-gate h2');
  const msg = $('#caaci-gate-msg');
  // Nothing to sign out of when there's no session (or no backend at all) —
  // offering the button there just looks broken. 'forbidden' keeps it: that
  // visitor IS signed in, just not as an admin, and needs a way out.
  const signout = $('#caaci-admin-signout');
  if (signout) signout.hidden = gateState === 'anon' || gateState === 'misconfig';
  h2.removeAttribute('data-en');
  h2.removeAttribute('data-zh');
  if (gateState === 'misconfig') {
    h2.textContent = t('Unavailable', '不可用');
    msg.textContent = 'Supabase is not configured.';
  } else if (gateState === 'anon') {
    h2.textContent = t('Please sign in', '请先登录');
    msg.innerHTML = `<a href="/login/">${t('Go to login', '前往登录')}</a>`;
  } else if (gateState === 'forbidden') {
    h2.textContent = t('Not authorized', '无权访问');
    msg.textContent = t('This account is not an administrator.', '该账户不是管理员。');
  }
}

async function gate() {
  if (!supa) {
    gateState = 'misconfig';
    renderGate();
    return false;
  }
  const {
    data: { session },
  } = await supa.auth.getSession();
  if (!session) {
    gateState = 'anon';
    renderGate();
    return false;
  }
  token = session.access_token;
  // Read our own member row (RLS lets a user read their own row, incl. is_admin).
  const { data: me } = await supa
    .from('members')
    .select('is_admin')
    .eq('id', session.user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    gateState = 'forbidden';
    renderGate();
    return false;
  }
  return true;
}

// authenticated API helper
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Feedback line — a Tabler alert, green for success, red for errors.
function notice(el, msg, good = true) {
  el.hidden = false;
  el.textContent = msg;
  el.classList.remove('alert-success', 'alert-danger');
  el.classList.add('alert', good ? 'alert-success' : 'alert-danger');
}

// ---------- tabs ----------
function wireTabs() {
  for (const tab of $$('[data-tab]')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      for (const tt of $$('[data-tab]')) {
        tt.classList.toggle('active', tt === tab);
        tt.setAttribute('aria-selected', String(tt === tab));
      }
      for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
    });
  }
}

// ---------- tiers (filter + label lookup) ----------
let tierName = {};
async function loadTiers() {
  const { data } = await supa.from('membership_tiers').select('id,name').order('sort_order');
  const sel = $('#caaci-tier');
  for (const tr of data || []) {
    tierName[tr.id] = tr.name;
    const o = document.createElement('option');
    o.value = tr.id;
    o.textContent = tr.name;
    sel.appendChild(o);
  }
}

// ---------- members table ----------
const LIMIT = 25;
let offset = 0,
  total = 0;

const STATUS_LABEL = {
  active: () => t('Active', '有效'),
  pending: () => t('Pending', '待处理'),
  past_due: () => t('Past due', '逾期'),
  expired: () => t('Expired', '已过期'),
  cancelled: () => t('Cancelled', '已取消'),
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

// Status chips — Tabler soft badges (bg-*-lt sets tinted bg + readable fg).
const BADGE_BG = {
  active: 'bg-success-lt',
  pending: 'bg-warning-lt',
  past_due: 'bg-orange-lt',
  expired: 'bg-secondary-lt',
  cancelled: 'bg-danger-lt',
};
const badgeHtml = (state, label) =>
  `<span class="badge ${BADGE_BG[state] || 'bg-secondary-lt'}">${esc(label)}</span>`;

async function loadMembers() {
  const q = $('#caaci-q').value.trim();
  const status = $('#caaci-status').value;
  const tier = $('#caaci-tier').value;
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (tier) params.set('tier_id', tier);

  const { ok, data } = await api(`/api/admin/members?${params}`);
  const notb = $('#caaci-members-notice');
  if (!ok) {
    notice(notb, data.error || t('Could not load members.', '无法加载会员。'), false);
    return;
  }
  notb.hidden = true;
  total = data.total || 0;
  renderRows(data.rows || []);
  $('#caaci-page-info').textContent = total
    ? t(
        `${offset + 1}–${Math.min(offset + LIMIT, total)} of ${total}`,
        `${offset + 1}–${Math.min(offset + LIMIT, total)} / 共 ${total}`,
      )
    : t('No members', '暂无会员');
  $('#caaci-prev').disabled = offset === 0;
  $('#caaci-next').disabled = offset + LIMIT >= total;
}

function renderRows(rows) {
  const tb = $('#caaci-members-body');
  clearEditorTimers(); // the open editor row is about to be wiped with the table
  tb.innerHTML = '';
  for (const m of rows) {
    const tr = document.createElement('tr');
    const statusTxt = STATUS_LABEL[m.status]?.() || m.status || '—';
    tr.innerHTML = `
      <td>${esc(m.full_name) || '—'}</td>
      <td>${esc(m.email)}</td>
      <td>${esc(tierName[m.tier_id] || m.tier_id || '—')}</td>
      <td>${badgeHtml(m.status, statusTxt)}</td>
      <td>${fmtDate(m.expires_at)}</td>
      <td><button type="button" class="btn btn-sm">${t('Edit', '编辑')}</button></td>`;
    tr.querySelector('button').addEventListener('click', () => toggleEditor(tr, m));
    tb.appendChild(tr);
  }
}

// ---------- auth emails (password reset / invitation) ----------
// Supabase allows one auth email per user per 60s, so a button counts that down
// after a send (or a 429). The expiry lives in a module-level map keyed by
// member + action, so closing and reopening the editor, or the table
// re-rendering after Save, resumes the countdown instead of resetting it. Only
// one editor is open at a time; its intervals are cleared when it goes away.
const AUTH_EMAIL_COOLDOWN_MS = 60_000;
const authEmailCooldownUntil = new Map(); // `${member.id}:${action}` → epoch ms
const editorTimers = new Set();
const ticking = new WeakSet(); // buttons that already have a countdown interval
function clearEditorTimers() {
  for (const id of editorTimers) clearInterval(id);
  editorTimers.clear();
}
// Paint a button from its stored expiry and keep ticking while it is cooling.
function showCooldown(btn, label, key) {
  const paint = () => {
    const left = Math.ceil(((authEmailCooldownUntil.get(key) || 0) - Date.now()) / 1000);
    if (left > 0) {
      btn.disabled = true;
      btn.textContent = `${label} (${left}s)`;
      return true;
    }
    authEmailCooldownUntil.delete(key);
    btn.disabled = false;
    btn.textContent = label;
    return false;
  };
  // One interval per button, even if two sends for the same key resolve.
  if (!paint() || ticking.has(btn)) return;
  ticking.add(btn);
  const timer = setInterval(() => {
    if (paint()) return;
    clearInterval(timer);
    editorTimers.delete(timer);
    ticking.delete(btn);
  }, 1000);
  editorTimers.add(timer);
}

// The send button and notice line for a member's action in whichever member
// editor is open NOW. The editor that was clicked may have been closed (or
// closed and reopened) while its request was in flight; null when none is open.
function openEditorTarget(memberId, action) {
  const row = [...$$('#caaci-members-body tr[data-edit-row]')].find(
    (r) => r.dataset.memberId === memberId,
  );
  if (!row) return null;
  return {
    btn: row.querySelector(`[data-act="send-${action}"]`),
    msg: row.querySelector('[data-msg]'),
  };
}

function wireAuthEmails(row, m) {
  row.dataset.memberId = m.id; // lets a late response find this member's open editor
  const who = m.full_name || m.email;
  const kinds = {
    reset: {
      label: t('Send password reset', '发送重置密码邮件'),
      ask: t(`Email ${who} a link to set a new password?`, `向 ${who} 发送设置新密码的链接？`),
      done: t(`Password reset email sent to ${who}.`, `已向 ${who} 发送重置密码邮件。`),
    },
    invite: {
      label: t('Send invitation', '发送邀请邮件'),
      ask: t(
        `Email ${who} a link to set up their login? Members without a login get an invitation; existing accounts get a password-setup link.`,
        `向 ${who} 发送登录设置链接？尚未启用登录的会员会收到邀请邮件；已有账户的会员会收到设置密码的链接。`,
      ),
      done: t(`Invitation sent to ${who}.`, `已向 ${who} 发送邀请邮件。`),
      // The server sends an existing account the password-setup email instead.
      password_setup: t(
        `${who} already has an account, so they were emailed a link to set their password. The email's subject reads "Set or reset your CAACI password".`,
        `${who} 已有账户，已向其发送设置密码的链接。邮件主题为“设置或重置你的 CAACI 账号密码”。`,
      ),
    },
  };
  for (const [action, k] of Object.entries(kinds)) {
    const btn = row.querySelector(`[data-act="send-${action}"]`);
    const key = `${m.id}:${action}`;
    showCooldown(btn, k.label, key); // resume a countdown from an earlier editor
    btn.addEventListener('click', async () => {
      if (!window.confirm(k.ask)) return;
      btn.disabled = true;
      let res = null;
      try {
        res = await api('/api/admin/member-email', {
          method: 'POST',
          body: { member_id: m.id, action },
        });
      } catch {
        // Network failure: reported below as an unsent email, button re-enabled.
      }
      // Report into the member's editor that is open now (maybe none, maybe a
      // rebuilt one), never into a detached button that would tick unseen.
      const target = openEditorTarget(m.id, action);
      const say = (text, good) => {
        if (target) notice(target.msg, text, good);
      };
      if (res?.ok || res?.status === 429) {
        authEmailCooldownUntil.set(key, Date.now() + AUTH_EMAIL_COOLDOWN_MS);
        if (target) showCooldown(target.btn, k.label, key);
        say(
          res.ok
            ? (res.data?.delivered === 'password_setup' && k.password_setup) || k.done
            : t(
                'An email was sent to this member very recently. Please wait a minute and try again.',
                '刚刚已向该会员发送过邮件，请等一分钟后再试。',
              ),
          res.ok,
        );
        return;
      }
      if (target) target.btn.disabled = false;
      say(res?.data?.error || t('Could not send the email.', '邮件发送失败。'), false);
    });
  }
}

function toggleEditor(tr, m) {
  clearEditorTimers(); // closing or replacing the open editor ends its countdowns
  const next = tr.nextElementSibling;
  if (next?.hasAttribute('data-edit-row')) {
    next.remove();
    return;
  }
  $$('tr[data-edit-row]').forEach((r) => r.remove());

  const opt = (val, sel) =>
    `<option value="${val}"${val === sel ? ' selected' : ''}>${STATUS_LABEL[val]?.() || val}</option>`;
  const tierOpts = ['', ...Object.keys(tierName)]
    .map(
      (id) =>
        `<option value="${id}"${id === (m.tier_id || '') ? ' selected' : ''}>${esc(tierName[id] || t('— none —', '— 无 —'))}</option>`,
    )
    .join('');
  const exp = m.expires_at ? new Date(m.expires_at).toISOString().slice(0, 10) : '';

  const row = document.createElement('tr');
  row.setAttribute('data-edit-row', '');
  row.innerHTML = `<td colspan="6" class="bg-surface-secondary">
    <div class="row g-2 align-items-end">
      ${field(
        t('Status', '状态'),
        `<select class="form-select" data-f="status">
          ${['active', 'pending', 'past_due', 'expired', 'cancelled'].map((s) => opt(s, m.status)).join('')}
        </select>`,
        'col-sm-6 col-lg',
      )}
      ${field(
        t('Tier', '类型'),
        `<select class="form-select" data-f="tier_id">${tierOpts}</select>`,
        'col-sm-6 col-lg',
      )}
      ${field(
        t('Expires', '到期'),
        `<input type="date" class="form-control" data-f="expires_at" value="${exp}">`,
        'col-sm-6 col-lg',
      )}
      ${field(t('Family', '家庭'), householdFieldHtml(m.household_id), 'col-sm-6 col-lg')}
      <div class="col-auto btn-list">
        <button type="button" class="btn btn-primary" data-act="save">${t('Save', '保存')}</button>
        <button type="button" class="btn btn-outline-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div>
    </div>
    <div class="btn-list align-items-center mt-2">
      <button type="button" class="btn btn-sm" data-act="send-reset">${t('Send password reset', '发送重置密码邮件')}</button>
      <button type="button" class="btn btn-sm" data-act="send-invite">${t('Send invitation', '发送邀请邮件')}</button>
      <span class="text-secondary small">${t("Members who haven't set up a login yet get an invitation; members who already have one get a link to set their password.", '尚未启用登录账户的会员会收到邀请；已有账户的会员会收到设置密码的链接。')}</span>
    </div>
    <div class="alert mb-0 mt-2" data-msg hidden></div></td>`;
  tr.after(row);
  wireAuthEmails(row, m);

  row.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
    const msg = row.querySelector('[data-msg]');
    const body = {
      id: m.id,
      status: get('status'),
      tier_id: get('tier_id'),
      expires_at: get('expires_at'),
    };
    // Left out, the API keeps the member's family as it is.
    if (householdsLoaded) body.household_id = get('household_id');
    const { ok, data } = await api('/api/admin/members', { method: 'POST', body });
    if (!ok) {
      notice(msg, data.error || t('Update failed.', '更新失败。'), false);
      return;
    }
    notice(msg, t('Saved.', '已保存。'), true);
    await loadMembers();
  });

  row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const msg = row.querySelector('[data-msg]');
    const who = m.full_name || m.email;
    if (
      !window.confirm(
        t(
          `Delete ${who}? This also removes their login account.`,
          `删除 ${who}？这将同时删除其登录账户。`,
        ),
      )
    )
      return;
    const { ok, data } = await api(`/api/admin/members?id=${encodeURIComponent(m.id)}`, {
      method: 'DELETE',
    });
    if (!ok) {
      notice(msg, data.error || t('Delete failed.', '删除失败。'), false);
      return;
    }
    await loadMembers();
  });
}

function wireMembers() {
  let timer;
  $('#caaci-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      offset = 0;
      loadMembers();
    }, 300);
  });
  $('#caaci-status').addEventListener('change', () => {
    offset = 0;
    loadMembers();
  });
  $('#caaci-tier').addEventListener('change', () => {
    offset = 0;
    loadMembers();
  });
  $('#caaci-prev').addEventListener('click', () => {
    offset = Math.max(0, offset - LIMIT);
    loadMembers();
  });
  $('#caaci-next').addEventListener('click', () => {
    offset += LIMIT;
    loadMembers();
  });
}

// ---------- payments ledger (membership tracking) ----------
const PAY_LIMIT = 50;
let payOffset = 0,
  payTotal = 0;

const usdFmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
const KIND_LABEL = {
  membership: () => t('First year', '首年入会'),
  renewal: () => t('Auto-renewal', '自动续费'),
};

async function loadPayments() {
  const notb = $('#caaci-payments-notice');
  const params = new URLSearchParams({ limit: String(PAY_LIMIT), offset: String(payOffset) });
  const { ok, data } = await api(`/api/admin/payments?${params}`);
  if (!ok) {
    notice(notb, data.error || t('Could not load payments.', '无法加载收款记录。'), false);
    return;
  }
  notb.hidden = true;

  // Stat tiles: membership head-counts + revenue this year.
  const sc = data.status_counts || {};
  const tiles = [
    [t('Active members', '有效会员'), sc.active ?? '—', 'active'],
    [t('Past due — follow up', '逾期需补交'), sc.past_due ?? '—', 'past_due'],
    [t('Expired', '已过期'), sc.expired ?? '—', 'expired'],
    [t('Revenue this year', '今年收款'), usdFmt(data.revenue_ytd_cents), ''],
  ];
  const STAT_FG = { active: 'text-success', past_due: 'text-orange', expired: 'text-secondary' };
  $('#caaci-pay-stats').innerHTML = tiles
    .map(
      ([label, value, state]) => `
      <div class="col-6 col-sm-3">
        <div class="card card-sm"><div class="card-body">
          <div class="subheader">${esc(label)}</div>
          <div class="h1 mb-0 ${STAT_FG[state] || ''}">${esc(String(value))}</div>
        </div></div>
      </div>`,
    )
    .join('');

  const tb = $('#caaci-payments-body');
  tb.innerHTML = '';
  const rows = data.rows || [];
  if (!rows.length && payOffset === 0) {
    tb.innerHTML = `<tr><td colspan="6" class="text-secondary">${t('No payments recorded yet.', '暂无收款记录。')}</td></tr>`;
  }
  for (const p of rows) {
    const who = p.members
      ? `${esc(p.members.full_name || '—')}<br><span class="text-secondary">${esc(p.members.email || '')}</span>`
      : `<span class="text-secondary">${t('(deleted member)', '（已删除会员）')}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(p.paid_at)}</td>
      <td>${who}</td>
      <td>${KIND_LABEL[p.kind]?.() || esc(p.kind)}</td>
      <td>${esc(tierName[p.tier_id] || p.tier_id || '—')}</td>
      <td>${p.discount_code ? `<code>${esc(p.discount_code)}</code>` : '—'}</td>
      <td>${usdFmt(p.amount_cents)}${p.refunded_cents ? `<br><span class="text-secondary">−${usdFmt(p.refunded_cents)} ${t('refunded', '已退')}</span>` : ''}</td>`;
    tb.appendChild(tr);
  }

  payTotal = data.total || 0;
  $('#caaci-pay-info').textContent = payTotal
    ? t(
        `${payOffset + 1}–${Math.min(payOffset + PAY_LIMIT, payTotal)} of ${payTotal}`,
        `${payOffset + 1}–${Math.min(payOffset + PAY_LIMIT, payTotal)} / 共 ${payTotal}`,
      )
    : t('No payments', '暂无记录');
  $('#caaci-pay-prev').disabled = payOffset === 0;
  $('#caaci-pay-next').disabled = payOffset + PAY_LIMIT >= payTotal;
}

function wirePayments() {
  $('#caaci-pay-prev').addEventListener('click', () => {
    payOffset = Math.max(0, payOffset - PAY_LIMIT);
    loadPayments();
  });
  $('#caaci-pay-next').addEventListener('click', () => {
    payOffset += PAY_LIMIT;
    loadPayments();
  });
  const tab = $('[data-tab="payments"]');
  if (tab) tab.addEventListener('click', () => loadPayments());
}

// ---------- refunds ----------
// Reuses the payments ledger (same /api/admin/payments feed) and adds a Refund
// action per row. Issuing a refund POSTs /api/admin/refunds, which talks to
// Stripe and updates the row's running refunded_cents total.
const REF_LIMIT = 50;
let refOffset = 0,
  refTotal = 0;

async function loadRefunds() {
  const notb = $('#caaci-refunds-notice');
  const params = new URLSearchParams({ limit: String(REF_LIMIT), offset: String(refOffset) });
  const { ok, data } = await api(`/api/admin/payments?${params}`);
  if (!ok) {
    notice(notb, data.error || t('Could not load payments.', '无法加载收款记录。'), false);
    return;
  }
  notb.hidden = true;

  const tb = $('#caaci-refunds-body');
  tb.innerHTML = '';
  const rows = data.rows || [];
  if (!rows.length && refOffset === 0) {
    tb.innerHTML = `<tr><td colspan="6" class="text-secondary">${t('No payments to refund.', '暂无可退款的付款。')}</td></tr>`;
  }
  for (const p of rows) {
    const who = p.members
      ? `${esc(p.members.full_name || '—')}<br><span class="text-secondary">${esc(p.members.email || '')}</span>`
      : `<span class="text-secondary">${t('(deleted member)', '（已删除会员）')}</span>`;
    const refunded = p.refunded_cents || 0;
    const remaining = (p.amount_cents || 0) - refunded;
    const refCell = refunded
      ? `${usdFmt(refunded)}${remaining <= 0 ? ` <span class="text-secondary">(${t('full', '全额')})</span>` : ''}`
      : '—';
    const action =
      remaining > 0
        ? `<button type="button" class="btn btn-sm" data-refund="${esc(p.id)}">${t('Refund', '退款')}</button>`
        : `<span class="text-secondary">${t('Refunded', '已退款')}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(p.paid_at)}</td>
      <td>${who}</td>
      <td>${KIND_LABEL[p.kind]?.() || esc(p.kind)}</td>
      <td>${usdFmt(p.amount_cents)}</td>
      <td>${refCell}</td>
      <td>${action}</td>`;
    const btn = tr.querySelector('[data-refund]');
    if (btn) btn.addEventListener('click', () => refundForm(p, remaining));
    tb.appendChild(tr);
  }

  refTotal = data.total || 0;
  $('#caaci-refund-info').textContent = refTotal
    ? t(
        `${refOffset + 1}–${Math.min(refOffset + REF_LIMIT, refTotal)} of ${refTotal}`,
        `${refOffset + 1}–${Math.min(refOffset + REF_LIMIT, refTotal)} / 共 ${refTotal}`,
      )
    : t('No payments', '暂无记录');
  $('#caaci-refund-prev').disabled = refOffset === 0;
  $('#caaci-refund-next').disabled = refOffset + REF_LIMIT >= refTotal;
}

// Inline "issue a refund" form for one ledger row. Amount defaults to the full
// refundable balance; staff may enter a smaller partial amount.
function refundForm(p, remaining) {
  const host = $('#caaci-refund-form-host');
  const max = (remaining / 100).toFixed(2);
  const who = p.members?.full_name || p.members?.email || t('this member', '该会员');
  host.innerHTML = `
    <form class="card card-body mb-3">
      <h3>${t('Refund', '退款')} — ${esc(who)}</h3>
      <p class="text-secondary">${t('Refundable balance', '可退余额')}: ${usdFmt(remaining)}</p>
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(t('Amount (USD)', '金额（美元）'), `<input type="number" class="form-control" data-f="amount" min="0.01" max="${max}" step="0.01" value="${max}">`)}
        ${field(t('Reason (optional)', '原因（可选）'), `<input type="text" class="form-control" data-f="reason" maxlength="200">`)}
      </div>
      <p>
        <button type="submit" class="btn btn-primary">${t('Issue refund', '确认退款')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dollars = parseFloat(form.querySelector('[data-f="amount"]').value);
    if (!Number.isFinite(dollars) || dollars <= 0)
      return notice(msg, t('Enter a valid amount.', '请输入有效金额。'), false);
    const cents = Math.round(dollars * 100);
    if (cents > remaining)
      return notice(msg, t('Amount exceeds the refundable balance.', '金额超过可退余额。'), false);
    if (
      !confirm(
        t(
          `Refund ${usdFmt(cents)} to ${who}? This returns the money through Stripe.`,
          `确认向 ${who} 退款 ${usdFmt(cents)}？款项将通过 Stripe 原路退回。`,
        ),
      )
    )
      return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = await api('/api/admin/refunds', {
      method: 'POST',
      body: {
        payment_id: p.id,
        amount_cents: cents,
        reason: form.querySelector('[data-f="reason"]').value.trim() || undefined,
      },
    });
    submit.disabled = false;
    if (!ok) return notice(msg, data.error || t('Refund failed.', '退款失败。'), false);
    host.innerHTML = '';
    notice(
      $('#caaci-refunds-notice'),
      t(
        `Refunded ${usdFmt(data.amount_cents)}${data.fully_refunded ? ' (payment now fully refunded)' : ''}.`,
        `已退款 ${usdFmt(data.amount_cents)}${data.fully_refunded ? '（该付款已全额退回）' : ''}。`,
      ),
      true,
    );
    await loadRefunds();
  });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function wireRefunds() {
  $('#caaci-refund-prev').addEventListener('click', () => {
    refOffset = Math.max(0, refOffset - REF_LIMIT);
    loadRefunds();
  });
  $('#caaci-refund-next').addEventListener('click', () => {
    refOffset += REF_LIMIT;
    loadRefunds();
  });
  const tab = $('[data-tab="refunds"]');
  if (tab) tab.addEventListener('click', () => loadRefunds());
}

// ---------- discount codes (+ shareable QR) ----------
// The QR encodes /membership/?code=XYZ so scanning lands on the plan grid with
// the discount pre-applied. window.qrcode is the self-hosted UMD generator the
// admin page loads before this module (assets/qrcode.js).
const discountUrl = (code) => `${location.origin}/membership/?code=${encodeURIComponent(code)}`;

function qrDataUrl(text) {
  const qr = window.qrcode(0, 'M'); // type 0 = auto-size to the payload
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 16); // cellSize 8px, 16px quiet-zone margin
}

// Why a code can't be used right now (mirrors functions/api/discount.js).
function discountState(d) {
  if (!d.active) return { key: 'cancelled', label: t('Inactive', '已停用') };
  if (d.expires_at && new Date(d.expires_at) <= new Date())
    return { key: 'expired', label: t('Expired', '已过期') };
  if (d.max_redemptions != null && d.times_redeemed >= d.max_redemptions)
    return { key: 'expired', label: t('Used up', '已用完') };
  return { key: 'active', label: t('Active', '有效') };
}

async function loadDiscounts() {
  const notb = $('#caaci-discounts-notice');
  const { ok, data } = await api('/api/admin/discounts');
  if (!ok) {
    notice(notb, data.error || t('Could not load discount codes.', '无法加载折扣码。'), false);
    return;
  }
  notb.hidden = true;
  const rows = data.rows || [];
  const tb = $('#caaci-discounts-body');
  tb.innerHTML = '';
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="7" class="text-secondary">${t('No discount codes yet.', '暂无折扣码。')}</td></tr>`;
    return;
  }
  for (const d of rows) {
    const st = discountState(d);
    const used = `${d.times_redeemed}${d.max_redemptions != null ? ` / ${d.max_redemptions}` : ''}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${esc(d.code)}</code></td>
      <td>−${d.percent_off}%</td>
      <td>${esc(d.description || '—')}</td>
      <td>${badgeHtml(st.key, st.label)}</td>
      <td>${used}</td>
      <td>${fmtDate(d.expires_at)}</td>
      <td><div class="btn-list flex-nowrap">
        <button type="button" class="btn btn-sm" data-act="qr">${t('QR code', '二维码')}</button>
        <button type="button" class="btn btn-sm" data-act="toggle">${d.active ? t('Deactivate', '停用') : t('Activate', '启用')}</button>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div></td>`;
    tr.querySelector('[data-act="qr"]').addEventListener('click', () => showDiscountQr(d));
    tr.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      const { ok: ok2, data: d2 } = await api('/api/admin/discounts', {
        method: 'POST',
        body: { code: d.code, active: !d.active },
      });
      if (!ok2) return notice(notb, d2.error || t('Update failed.', '更新失败。'), false);
      await loadDiscounts();
    });
    tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (
        !window.confirm(
          t(
            `Delete code ${d.code}? Existing QR flyers will stop working.`,
            `删除折扣码 ${d.code}？已印发的二维码将失效。`,
          ),
        )
      )
        return;
      const { ok: ok2, data: d2 } = await api(
        `/api/admin/discounts?code=${encodeURIComponent(d.code)}`,
        { method: 'DELETE' },
      );
      if (!ok2) return notice(notb, d2.error || t('Delete failed.', '删除失败。'), false);
      $('#caaci-discount-qr-host').innerHTML = '';
      await loadDiscounts();
    });
    tb.appendChild(tr);
  }
}

function showDiscountQr(d) {
  const host = $('#caaci-discount-qr-host');
  const url = discountUrl(d.code);
  let png;
  try {
    png = qrDataUrl(url);
  } catch (e) {
    notice($('#caaci-discounts-notice'), `QR: ${e.message}`, false);
    return;
  }
  host.innerHTML = `
    <div class="card card-body mb-3">
      <div class="row g-3 align-items-center">
        <div class="col-auto">
          <img class="img-thumbnail" style="width: 180px" alt="QR code for ${esc(d.code)}" src="${png}">
        </div>
        <div class="col">
          <h3 class="mb-1">${esc(d.code)} — −${d.percent_off}%</h3>
          <p class="text-secondary">${t('Scanning opens', '扫码打开')} <code>${esc(url)}</code></p>
          <div class="btn-list">
            <a class="btn" download="caaci-${esc(d.code)}-qr.gif" href="${png}">${t('Download image', '下载图片')}</a>
            <button type="button" class="btn" data-act="close">${t('Close', '关闭')}</button>
          </div>
        </div>
      </div>
    </div>`;
  host.querySelector('[data-act="close"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function discountForm(host) {
  if (host.firstChild) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <form class="card card-body mb-3">
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(`${t('Code', '折扣码')} *`, `<input type="text" class="form-control" data-f="code" maxlength="32" placeholder="SPRING2026" style="text-transform:uppercase">`)}
        ${field(`${t('Percent off', '折扣百分比')} *`, `<input type="number" class="form-control" data-f="percent_off" min="1" max="100" step="1" placeholder="20">`)}
        ${field(t('Description', '说明'), `<input type="text" class="form-control" data-f="description">`)}
        ${field(t('Expires (optional)', '到期（可选）'), `<input type="date" class="form-control" data-f="expires_at">`)}
        ${field(t('Max redemptions (optional)', '最多使用次数（可选）'), `<input type="number" class="form-control" data-f="max_redemptions" min="1" step="1">`)}
      </div>
      <p>
        <button type="submit" class="btn btn-primary">${t('Create code', '创建折扣码')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (f) => form.querySelector(`[data-f="${f}"]`).value;
    const body = {
      code: val('code').trim().toUpperCase(),
      percent_off: val('percent_off'),
      description: val('description').trim(),
      expires_at: val('expires_at'),
      max_redemptions: val('max_redemptions'),
    };
    if (!body.code) return notice(msg, t('Code is required.', '折扣码为必填项。'), false);
    if (!body.percent_off)
      return notice(msg, t('Percent off is required.', '折扣百分比为必填项。'), false);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = await api('/api/admin/discounts', { method: 'PUT', body });
    submit.disabled = false;
    if (!ok)
      return notice(msg, data.error || t('Could not create code.', '无法创建折扣码。'), false);
    host.innerHTML = '';
    await loadDiscounts();
    if (data.discount) showDiscountQr(data.discount); // hand the QR over right away
  });
}

function wireDiscounts() {
  $('#caaci-discount-add-btn').addEventListener('click', () =>
    discountForm($('#caaci-discount-form-host')),
  );
  const tab = $('[data-tab="discounts"]');
  if (tab) tab.addEventListener('click', () => loadDiscounts());
}

// ---------- news composer ----------
// The "Event announcement" template: the API renders the email for a published
// event (GET /api/admin/news-template → { subject, html }) into the subject and
// message boxes, where it stays editable and is sent like any other news email.
let newsFilled = null; // the template text last put in the boxes
let newsSeq = 0; // a slow template answer for an event since deselected is dropped

async function loadNewsEvents() {
  const sel = $('#caaci-news-event');
  const { ok, data } = await api('/api/admin/events?published=true&limit=50');
  if (!ok) {
    notice(
      $('#caaci-news-notice'),
      data.error || t('Could not load events.', '无法加载活动。'),
      false,
    );
    return;
  }
  const current = sel.value;
  sel.innerHTML = [
    `<option value="">${t('— Choose an event —', '— 选择活动 —')}</option>`,
    ...(data.rows || []).map(
      (e) =>
        `<option value="${esc(e.id)}">${esc(e.title_zh ? `${e.title_zh} · ${e.title}` : e.title)} (${fmtDate(e.starts_at)})</option>`,
    ),
  ].join('');
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

async function applyNewsTemplate() {
  const eventId = $('#caaci-news-event').value;
  if ($('#caaci-news-template').value !== 'event' || !eventId) return;
  const subject = $('#caaci-news-subject');
  const body = $('#caaci-news-body');
  const notb = $('#caaci-news-notice');
  // Never silently replace something the admin wrote or edited.
  const untouched =
    newsFilled && subject.value === newsFilled.subject && body.value === newsFilled.html;
  if (
    (subject.value.trim() || body.value.trim()) &&
    !untouched &&
    !window.confirm(
      t(
        'Replace the subject and message with the event announcement?',
        '用活动通知替换当前的主题和正文？',
      ),
    )
  )
    return;
  const seq = ++newsSeq;
  const { ok, data } = await api(
    `/api/admin/news-template?event_id=${encodeURIComponent(eventId)}`,
  );
  if (seq !== newsSeq) return;
  if (!ok)
    return notice(notb, data.error || t('Could not load the template.', '无法加载模板。'), false);
  subject.value = data.subject || '';
  body.value = data.html || '';
  newsFilled = { subject: subject.value, html: body.value };
  notb.hidden = true;
  if (!$('#caaci-news-preview').hidden) showNewsPreview(); // keep an open preview current
}

// The message as the email will render, in a frame sandboxed with no allow-* at
// all (so no scripts and no same-origin access to this admin session). The
// sandbox attribute is set before srcdoc so the content never loads unsandboxed.
function showNewsPreview() {
  const host = $('#caaci-news-preview');
  const html = $('#caaci-news-body').value;
  if (!html.trim()) {
    host.hidden = true;
    host.innerHTML = '';
    return notice(
      $('#caaci-news-notice'),
      t('Write a message to preview.', '请先填写正文再预览。'),
      false,
    );
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', '');
  frame.setAttribute('title', t('Message preview', '正文预览'));
  frame.setAttribute('srcdoc', html);
  const box = document.createElement('div');
  box.className = 'ratio ratio-4x3 border';
  box.appendChild(frame);
  host.replaceChildren(box);
  host.hidden = false;
}

function wireNews() {
  $('#caaci-news-template').addEventListener('change', async () => {
    const isEvent = $('#caaci-news-template').value === 'event';
    $('#caaci-news-event-wrap').hidden = !isEvent;
    if (!isEvent) return; // Blank leaves the boxes as they are
    await loadNewsEvents();
    await applyNewsTemplate();
  });
  $('#caaci-news-event').addEventListener('change', applyNewsTemplate);
  $('#caaci-news-preview-btn').addEventListener('click', showNewsPreview);
  $('#caaci-news-send').addEventListener('click', async () => {
    const notb = $('#caaci-news-notice');
    const btn = $('#caaci-news-send');
    const body = {
      subject: $('#caaci-news-subject').value.trim(),
      body_html: $('#caaci-news-body').value.trim(),
      audience: $('#caaci-news-audience').value,
      confirm: $('#caaci-news-confirm').checked,
    };
    if (!body.subject || !body.body_html)
      return notice(notb, t('Subject and message are required.', '主题和正文为必填项。'), false);
    if (!body.confirm)
      return notice(notb, t('Please check the confirmation box.', '请勾选确认框。'), false);
    btn.disabled = true;
    const { ok, data } = await api('/api/admin/news', { method: 'POST', body });
    btn.disabled = false;
    if (!ok) return notice(notb, data.error || t('Send failed.', '发送失败。'), false);
    notice(
      notb,
      t(
        `Sent to ${data.sent} member(s)${data.failed ? `, ${data.failed} failed` : ''}.`,
        `已发送给 ${data.sent} 位会员${data.failed ? `，${data.failed} 封失败` : ''}。`,
      ),
      true,
    );
    $('#caaci-news-confirm').checked = false;
  });
}

// ---------- shared form helpers ----------
// `wrap` is the wrapper class: 'col' inside a form row grid (default), 'mb-3'
// for a standalone full-width field.
// Controls here are addressed by `data-f`, not by id, so nothing gave the
// labels anything to point at and every field came out unlabelled to a screen
// reader. Mint an id per field and wire `for`/`id` together.
let fieldSeq = 0;
const field = (label, inputHtml, wrap = 'col') => {
  const id = `caaci-f${++fieldSeq}`;
  // Inject the id into the first control tag of the supplied markup.
  const withId = inputHtml.replace(/<(input|select|textarea)\b/, `<$1 id="${id}"`);
  const forAttr = withId === inputHtml ? '' : ` for="${id}"`;
  return `<div class="${wrap}"><label class="form-label"${forAttr}>${label}</label>${withId}</div>`;
};
const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function tierOptionsHtml(selected) {
  const none = t('— none —', '— 无 —');
  return ['', ...Object.keys(tierName)]
    .map(
      (id) =>
        `<option value="${id}"${id === (selected || '') ? ' selected' : ''}>${esc(tierName[id] || none)}</option>`,
    )
    .join('');
}
function statusOptionsHtml(selected, list) {
  return (list || ['active', 'pending', 'expired', 'cancelled'])
    .map(
      (s) =>
        `<option value="${s}"${s === selected ? ' selected' : ''}>${STATUS_LABEL[s]?.() || s}</option>`,
    )
    .join('');
}

// Families this member could belong to. Populated by loadHouseholds/loadFamilies.
let households = [];
function householdOptionsHtml(selected) {
  const opts = [`<option value="">${t('— none —', '— 无 —')}</option>`];
  for (const h of households) {
    opts.push(
      `<option value="${h.id}"${h.id === (selected || '') ? ' selected' : ''}>${esc(h.name)}</option>`,
    );
  }
  return opts.join('');
}
// False until the families list has loaded once. Until then the Family dropdown
// only offers "— none —", so the member editor must not send it (it would unlink).
let householdsLoaded = false;
function householdFieldHtml(selected) {
  const select = `<select class="form-select" data-f="household_id"${householdsLoaded ? '' : ' disabled'}>${householdOptionsHtml(selected)}</select>`;
  if (householdsLoaded) return select;
  return `${select}<div class="form-hint" data-household-unavailable>${t("Families couldn't be loaded, so family is unchanged", '家庭列表加载失败，家庭不会被修改')}</div>`;
}
async function loadHouseholds() {
  const { ok, data } = await api('/api/admin/households');
  if (!ok) return;
  households = data.rows || [];
  householdsLoaded = true;
}

// ---------- add a member (creates a login account) ----------
function wireMemberAdd() {
  const btn = $('#caaci-member-add-btn');
  const host = $('#caaci-member-add-host');
  btn.addEventListener('click', () => {
    if (host.firstChild) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `
      <form class="card card-body mb-3">
        <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
          ${field(t('Full name', '姓名'), `<input type="text" class="form-control" data-f="full_name">`)}
          ${field(`${t('Email (login)', '邮箱（登录）')} *`, `<input type="email" class="form-control" data-f="email" required>`)}
          ${field(t('Password (optional)', '密码（可选）'), `<input type="password" class="form-control" data-f="password">`)}
          ${field(t('Phone', '电话'), `<input type="tel" class="form-control" data-f="phone">`)}
          ${field(t('Tier', '类型'), `<select class="form-select" data-f="tier_id">${tierOptionsHtml('')}</select>`)}
          ${field(t('Status', '状态'), `<select class="form-select" data-f="status">${statusOptionsHtml('active', ['active', 'pending', 'past_due', 'expired', 'cancelled'])}</select>`)}
          ${field(t('Member since', '加入时间'), `<input type="date" class="form-control" data-f="member_since">`)}
          ${field(t('Expires', '到期'), `<input type="date" class="form-control" data-f="expires_at">`)}
          ${field(t('Family', '家庭'), `<select class="form-select" data-f="household_id">${householdOptionsHtml('')}</select>`)}
        </div>
        <label class="form-check"><input type="checkbox" class="form-check-input" data-f="is_admin" />
          <span class="form-check-label">${t('Administrator', '管理员')}</span></label>
        ${field(t('Notes', '备注'), `<textarea class="form-control" data-f="notes" rows="2"></textarea>`, 'mb-3')}
        <p>
          <button type="submit" class="btn btn-primary">${t('Create member', '创建会员')}</button>
          <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
        </p>
        <div class="alert" data-msg hidden></div>
      </form>`;
    const form = host.querySelector('form');
    const msg = form.querySelector('[data-msg]');
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      host.innerHTML = '';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (f) => form.querySelector(`[data-f="${f}"]`);
      const body = {
        full_name: val('full_name').value.trim(),
        email: val('email').value.trim(),
        password: val('password').value,
        phone: val('phone').value.trim(),
        tier_id: val('tier_id').value,
        status: val('status').value,
        member_since: val('member_since').value,
        expires_at: val('expires_at').value,
        household_id: val('household_id').value,
        is_admin: val('is_admin').checked,
        notes: val('notes').value.trim(),
      };
      if (!body.email) return notice(msg, t('Email is required.', '邮箱为必填项。'), false);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      const { ok, data } = await api('/api/admin/members', { method: 'PUT', body });
      submit.disabled = false;
      if (!ok)
        return notice(msg, data.error || t('Could not create member.', '无法创建会员。'), false);
      host.innerHTML = '';
      offset = 0;
      await loadMembers();
    });
  });
}

// ---------- families ----------
async function loadFamilies() {
  const notb = $('#caaci-families-notice');
  const { ok, data } = await api('/api/admin/households');
  if (!ok) {
    notice(notb, data.error || t('Could not load families.', '无法加载家庭。'), false);
    return;
  }
  notb.hidden = true;
  households = data.rows || [];
  householdsLoaded = true;
  const host = $('#caaci-families-list');
  host.innerHTML = '';
  if (!households.length) {
    host.innerHTML = `<p class="text-secondary">${t('No families yet.', '暂无家庭。')}</p>`;
    return;
  }
  // false when the server could not read invitations (migration 0017 not applied yet).
  const invitesAvailable = data.invites_available !== false;
  for (const h of households) host.appendChild(familyCard(h, invitesAvailable));
}

const RELATIONSHIP_LABEL = {
  head: () => t('Head', '户主'),
  spouse: () => t('Spouse', '配偶'),
  child: () => t('Child', '子女'),
  parent: () => t('Parent', '父母'),
  other: () => t('Other', '其他'),
};
const FAMILY_EVENT_LABEL = {
  invite_sent: () => t('Invitation sent', '已发送邀请'),
  invite_cancelled: () => t('Invitation cancelled', '邀请已取消'),
  invite_declined: () => t('Invitation declined', '邀请被拒绝'),
  joined: () => t('Joined the family', '加入家庭'),
  left: () => t('Left the family', '退出家庭'),
  member_removed: () => t('Removed from the family', '被移出家庭'),
  person_added: () => t('Person added', '已添加成员'),
  person_removed: () => t('Person removed', '已移除成员'),
  dissolved: () => t('Family dissolved', '家庭已解散'),
};

function inviteItem(i) {
  const rel = RELATIONSHIP_LABEL[i.relationship]?.() || i.relationship;
  return `<li>${esc(i.email)}${rel ? ` · ${esc(rel)}` : ''} · ${t('expires', '到期')} ${esc(fmtDate(i.expires_at))}</li>`;
}

function familyEventItem(e) {
  const label = FAMILY_EVENT_LABEL[e.type]?.() || e.type;
  const subject = [e.subject_name, e.subject_email].filter(Boolean).join(' ');
  const by = e.actor_email ? ` · ${t('by', '操作人')} ${esc(e.actor_email)}` : '';
  return `<li>${esc(fmtDate(e.created_at))} · ${esc(label)}${subject ? ` · ${esc(subject)}` : ''}${by}</li>`;
}

// Founder, pending invitations and activity — or a note when they couldn't be read.
function familyInvitesBlock(h, available) {
  if (!available)
    return `<p class="text-secondary small mb-0" data-invites-unavailable>${t('Invitations and activity are unavailable right now.', '邀请和动态暂不可用。')}</p>`;
  const invites = h.invites || [];
  const events = h.events || [];
  const list = invites.length
    ? `<ul class="list-unstyled mb-0" data-invites>${invites.map(inviteItem).join('')}</ul>`
    : `<p class="text-secondary mb-0">${t('No pending invitations.', '暂无待接受的邀请。')}</p>`;
  const activity = events.length
    ? `<details class="mt-3" data-activity><summary class="subheader">${t('Activity', '动态')}</summary>
        <ul class="list-unstyled small mt-2 mb-0">${events.map(familyEventItem).join('')}</ul></details>`
    : '';
  return `<div class="subheader mb-2">${t('Pending invitations', '待接受的邀请')}</div>${list}${activity}`;
}

function personRow(p) {
  const primary = p.is_primary ? ` <span class="badge">${t('primary', '主要')}</span>` : '';
  const unlinked = p.member_id
    ? ''
    : ` <span class="badge bg-secondary-lt">${t('Not linked to an account', '未关联账号')}</span>`;
  return `<tr>
    <td>${esc(p.full_name)}${primary}${unlinked}</td>
    <td>${esc(p.relationship || '—')}</td>
    <td>${esc(p.email || '—')}</td>
    <td>${esc(p.phone || '—')}</td>
    <td><div class="btn-list flex-nowrap">
      <button type="button" class="btn btn-sm" data-person="${p.id}" data-act="edit-person">${t('Edit', '编辑')}</button>
      <button type="button" class="btn btn-sm btn-ghost-danger" data-person="${p.id}" data-act="del-person">${t('Delete', '删除')}</button>
    </div></td></tr>`;
}

function familyCard(h, invitesAvailable = true) {
  const card = document.createElement('section');
  card.className = 'card mb-3';
  const tierTxt = esc(tierName[h.tier_id] || h.tier_id || t('— no tier —', '— 无类型 —'));
  const statusTxt = STATUS_LABEL[h.status]?.() || h.status;
  const expTxt = h.expires_at ? ` · ${t('expires', '到期')} ${fmtDate(h.expires_at)}` : '';
  const accounts = h.accounts || [];
  const people = h.people || [];
  const founderId = h.founder?.id || h.founder_member_id;
  const founderBadge = (a) =>
    founderId && a.id === founderId
      ? ` <span class="badge bg-primary-lt">${t('Founder', '创始人')}</span>`
      : '';
  // A founder an admin moved out of the family is still named, marked as outside.
  const f = h.founder;
  const founderOutside =
    f && !accounts.some((a) => a.id === f.id)
      ? `<div class="text-secondary small mt-2" data-founder-outside>${t(
          `Founder: ${esc(f.full_name || '—')} — ${esc(f.email || '')} (not in this family)`,
          `创始人：${esc(f.full_name || '—')} — ${esc(f.email || '')}（不在此家庭）`,
        )}</div>`
      : '';
  const seatsTxt = `${t('Seats', '名额')}: ${esc(h.seats_used ?? '—')} / ${esc(h.seats_limit ?? '—')}`;
  const acctList = accounts.length
    ? `<ul class="list-unstyled mb-0" data-accounts>${accounts
        .map(
          (a) =>
            `<li>${esc(a.full_name || '—')} — ${esc(a.email || '')}${founderBadge(a)} ${badgeHtml(a.status, STATUS_LABEL[a.status]?.() || a.status || '—')}</li>`,
        )
        .join('')}</ul>`
    : `<p class="text-secondary mb-0">${t('None linked. Edit a member and choose this family.', '暂无关联账户。编辑会员并选择该家庭即可关联。')}</p>`;
  const peopleBlock = people.length
    ? `<div class="table-responsive"><table class="table table-sm table-vcenter"><thead><tr>
        <th>${t('Name', '姓名')}</th><th>${t('Relationship', '关系')}</th>
        <th>${t('Email', '邮箱')}</th><th>${t('Phone', '电话')}</th><th></th></tr></thead>
        <tbody>${people.map(personRow).join('')}</tbody></table></div>`
    : `<p class="text-secondary mb-0">${t('No family members added yet.', '尚未添加家庭成员。')}</p>`;
  card.innerHTML = `
    <div class="card-header">
      <div>
        <h3 class="card-title mb-0">${esc(h.name)}</h3>
        <div class="text-secondary small">${tierTxt} · ${statusTxt}${expTxt}</div>
        ${h.notes ? `<div class="text-secondary small">${esc(h.notes)}</div>` : ''}
      </div>
      <div class="card-actions btn-list">
        <button type="button" class="btn btn-sm" data-act="edit">${t('Edit', '编辑')}</button>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div>
    </div>
    <div data-edit-host></div>
    <div class="card-body border-top">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="subheader">${t('Login accounts', '登录账户')}</div>
        <div class="text-secondary small" data-seats>${seatsTxt}</div>
      </div>
      ${acctList}
      ${founderOutside}
    </div>
    <div class="card-body border-top">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="subheader">${t('Family members', '家庭成员')}</div>
        <button type="button" class="btn btn-sm" data-act="add-person">${t('+ Add person', '+ 添加成员')}</button>
      </div>
      <div data-person-host></div>
      ${peopleBlock}
    </div>
    <div class="card-body border-top">
      ${familyInvitesBlock(h, invitesAvailable)}
    </div>`;

  const editHost = card.querySelector('[data-edit-host]');
  const personHost = card.querySelector('[data-person-host]');
  card.querySelector('[data-act="edit"]').addEventListener('click', () => familyForm(editHost, h));
  card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteFamily(h));
  card
    .querySelector('[data-act="add-person"]')
    .addEventListener('click', () => personForm(personHost, h.id));
  for (const b of card.querySelectorAll('[data-person]')) {
    const p = people.find((x) => x.id === b.dataset.person);
    if (b.dataset.act === 'edit-person')
      b.addEventListener('click', () => personForm(personHost, h.id, p));
    else b.addEventListener('click', () => deletePerson(p));
  }
  return card;
}

function familyForm(host, h) {
  if (host.firstChild) {
    host.innerHTML = '';
    return;
  }
  const edit = !!h;
  host.innerHTML = `
    <form class="card card-body mb-3">
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(`${t('Family name', '家庭名称')} *`, `<input type="text" class="form-control" data-f="name" value="${edit ? esc(h.name) : ''}" required>`)}
        ${field(t('Tier', '类型'), `<select class="form-select" data-f="tier_id">${tierOptionsHtml(edit ? h.tier_id : 'family')}</select>`)}
        ${field(t('Status', '状态'), `<select class="form-select" data-f="status">${statusOptionsHtml(edit ? h.status : 'active')}</select>`)}
        ${field(t('Member since', '加入时间'), `<input type="date" class="form-control" data-f="member_since" value="${edit ? dateInput(h.member_since) : ''}">`)}
        ${field(t('Expires', '到期'), `<input type="date" class="form-control" data-f="expires_at" value="${edit ? dateInput(h.expires_at) : ''}">`)}
      </div>
      ${field(t('Notes', '备注'), `<textarea class="form-control" data-f="notes" rows="2">${edit ? esc(h.notes || '') : ''}</textarea>`, 'mb-3')}
      <p>
        <button type="submit" class="btn btn-primary">${edit ? t('Save', '保存') : t('Create', '创建')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (f) => form.querySelector(`[data-f="${f}"]`).value;
    const body = {
      name: val('name').trim(),
      tier_id: val('tier_id'),
      status: val('status'),
      member_since: val('member_since'),
      expires_at: val('expires_at'),
      notes: val('notes').trim(),
    };
    if (!body.name) return notice(msg, t('Family name is required.', '家庭名称为必填项。'), false);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = edit
      ? await api('/api/admin/households', { method: 'POST', body: { id: h.id, ...body } })
      : await api('/api/admin/households', { method: 'PUT', body });
    submit.disabled = false;
    if (!ok) return notice(msg, data.error || t('Save failed.', '保存失败。'), false);
    await loadFamilies();
  });
}

function personForm(host, householdId, p) {
  if (host.firstChild) {
    host.innerHTML = '';
    return;
  }
  const edit = !!p;
  const relOpts = ['head', 'spouse', 'child', 'parent', 'other']
    .map(
      (r) => `<option value="${r}"${edit && p.relationship === r ? ' selected' : ''}>${r}</option>`,
    )
    .join('');
  host.innerHTML = `
    <form class="card card-body mb-3">
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(`${t('Full name', '姓名')} *`, `<input type="text" class="form-control" data-f="full_name" value="${edit ? esc(p.full_name) : ''}" required>`)}
        ${field(t('Relationship', '关系'), `<select class="form-select" data-f="relationship"><option value=""></option>${relOpts}</select>`)}
        ${field(t('Email', '邮箱'), `<input type="email" class="form-control" data-f="email" value="${edit ? esc(p.email || '') : ''}">`)}
        ${field(t('Phone', '电话'), `<input type="tel" class="form-control" data-f="phone" value="${edit ? esc(p.phone || '') : ''}">`)}
      </div>
      <label class="form-check"><input type="checkbox" class="form-check-input" data-f="is_primary"${edit && p.is_primary ? ' checked' : ''} />
        <span class="form-check-label">${t('Primary contact', '主要联系人')}</span></label>
      <p>
        <button type="submit" class="btn btn-primary">${edit ? t('Save', '保存') : t('Add', '添加')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (f) => form.querySelector(`[data-f="${f}"]`);
    const body = {
      full_name: val('full_name').value.trim(),
      relationship: val('relationship').value,
      email: val('email').value.trim(),
      phone: val('phone').value.trim(),
      is_primary: val('is_primary').checked,
    };
    if (!body.full_name) return notice(msg, t('Full name is required.', '姓名为必填项。'), false);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = edit
      ? await api('/api/admin/household-members', { method: 'POST', body: { id: p.id, ...body } })
      : await api('/api/admin/household-members', {
          method: 'PUT',
          body: { household_id: householdId, ...body },
        });
    submit.disabled = false;
    if (!ok) return notice(msg, data.error || t('Save failed.', '保存失败。'), false);
    await loadFamilies();
  });
}

async function deleteFamily(h) {
  const warn = t(
    `Delete family "${h.name}"? Its family members are removed; linked login accounts are kept.`,
    `删除家庭“${h.name}”？其家庭成员将被移除；关联的登录账户会保留。`,
  );
  if (!window.confirm(warn)) return;
  const { ok, data } = await api('/api/admin/households', { method: 'DELETE', body: { id: h.id } });
  if (!ok)
    return notice(
      $('#caaci-families-notice'),
      data.error || t('Delete failed.', '删除失败。'),
      false,
    );
  await loadFamilies();
}

async function deletePerson(p) {
  if (!window.confirm(t(`Remove ${p.full_name}?`, `移除 ${p.full_name}？`))) return;
  const { ok, data } = await api('/api/admin/household-members', {
    method: 'DELETE',
    body: { id: p.id },
  });
  if (!ok)
    return notice(
      $('#caaci-families-notice'),
      data.error || t('Delete failed.', '删除失败。'),
      false,
    );
  await loadFamilies();
}

function wireFamilies() {
  $('#caaci-family-add-btn').addEventListener('click', () =>
    familyForm($('#caaci-family-form-host')),
  );
  const tab = $('[data-tab="families"]');
  if (tab) tab.addEventListener('click', () => loadFamilies());
}

// ---------- media uploads (FilePond + Supabase Storage) ----------
// The upload UI is FilePond (MIT, pqina/filepond) — self-hosted classic scripts
// the admin page loads before this module (assets/filepond*.js), same pattern
// as qrcode.js. We only supply the transport: an XHR to /api/admin/media so
// FilePond gets real progress events and we get the bearer-token header.
const pondLib = window.FilePond;
if (pondLib) {
  pondLib.registerPlugin(
    window.FilePondPluginFileValidateType,
    window.FilePondPluginFileValidateSize,
    window.FilePondPluginImagePreview,
  );
}

// FilePond "server.process" — uploads one file, reports progress, and hands the
// stored file's public URL back as the serverId.
function pondProcess(fieldName, file, metadata, load, error, progress, abort) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', '/api/admin/media');
  xhr.setRequestHeader('authorization', `Bearer ${token}`);
  xhr.upload.onprogress = (e) => progress(e.lengthComputable, e.loaded, e.total);
  xhr.onload = () => {
    let data = {};
    try {
      data = JSON.parse(xhr.responseText);
    } catch {
      /* non-JSON error body */
    }
    if (xhr.status >= 200 && xhr.status < 300 && data.file) load(data.file.url);
    else error(data.error || t('Upload failed.', '上传失败。'));
  };
  xhr.onerror = () => error(t('Upload failed.', '上传失败。'));
  xhr.send(fd);
  return {
    abort: () => {
      xhr.abort();
      abort();
    },
  };
}

function createPond(input, opts = {}) {
  if (!pondLib) return null;
  return pondLib.create(input, {
    acceptedFileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxFileSize: '5MB',
    server: { process: pondProcess },
    credits: false,
    labelIdle: t(
      'Drag & drop an image or <span class="filepond--label-action">Browse</span>',
      '拖放图片，或<span class="filepond--label-action">浏览文件</span>',
    ),
    labelFileProcessing: t('Uploading…', '上传中…'),
    labelFileProcessingComplete: t('Uploaded', '已上传'),
    labelFileProcessingError: t('Upload failed', '上传失败'),
    labelFileTypeNotAllowed: t(
      'Images only (JPEG/PNG/WebP/GIF)',
      '仅支持图片（JPEG/PNG/WebP/GIF）',
    ),
    labelMaxFileSizeExceeded: t('Too large (max 5 MB)', '文件过大（最大 5 MB）'),
    labelTapToCancel: t('tap to cancel', '点按取消'),
    labelTapToRetry: t('tap to retry', '点按重试'),
    labelTapToUndo: '',
    ...opts,
  });
}

// The image field used by the event + business forms: a URL input plus a
// single-file FilePond that fills it in on upload.
const imageFieldHtml = (current) =>
  field(
    t('Image', '图片'),
    `<input type="text" class="form-control mb-2" data-f="image_url" value="${esc(current || '')}" placeholder="https://…">
     <input type="file" data-pond accept="image/jpeg,image/png,image/webp,image/gif">`,
  );

function wireImageField(form) {
  const input = form.querySelector('[data-pond]');
  if (!input) return;
  const pond = createPond(input, { allowMultiple: false });
  if (!pond) return; // FilePond missing — the URL input still works by hand
  pond.on('processfile', (err, f) => {
    if (!err && f.serverId) form.querySelector('[data-f="image_url"]').value = f.serverId;
  });
}

async function loadMedia() {
  const notb = $('#caaci-media-notice');
  const { ok, data } = await api('/api/admin/media');
  if (!ok) {
    notice(notb, data.error || t('Could not load media.', '无法加载媒体库。'), false);
    return;
  }
  notb.hidden = true;
  const rows = data.rows || [];
  const grid = $('#caaci-media-grid');
  grid.innerHTML = '';
  if (!rows.length) {
    grid.innerHTML = `<p class="text-secondary">${t('No images yet — upload one above.', '暂无图片——请在上方上传。')}</p>`;
    return;
  }
  for (const f of rows) {
    const kb = f.size != null ? `${Math.max(1, Math.round(f.size / 1024))} KB` : '';
    const item = document.createElement('div');
    item.className = 'col-6 col-sm-4 col-lg-3';
    item.innerHTML = `
      <div class="card">
        <div class="ratio ratio-4x3">
          <img class="object-cover card-img-top" loading="lazy" src="${esc(f.url)}" alt="${esc(f.name)}">
        </div>
        <div class="card-body p-2">
          <span class="text-truncate d-block" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="text-secondary small">${kb}</span>
        </div>
        <div class="card-footer p-2 btn-list">
          <button type="button" class="btn btn-sm" data-act="copy">${t('Copy URL', '复制链接')}</button>
          <button type="button" class="btn btn-sm btn-ghost-danger" data-act="delete">${t('Delete', '删除')}</button>
        </div>
      </div>`;
    item.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(f.url);
        notice(notb, t('URL copied.', '链接已复制。'), true);
      } catch {
        window.prompt(t('Copy the URL:', '请复制链接：'), f.url);
      }
    });
    item.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (
        !window.confirm(
          t(
            `Delete ${f.name}? Any event or listing using it will lose the image.`,
            `删除 ${f.name}？正在使用它的活动或商家条目将失去该图片。`,
          ),
        )
      )
        return;
      const { ok: ok2, data: d2 } = await api(
        `/api/admin/media?name=${encodeURIComponent(f.name)}`,
        { method: 'DELETE' },
      );
      if (!ok2) return notice(notb, d2.error || t('Delete failed.', '删除失败。'), false);
      await loadMedia();
    });
    grid.appendChild(item);
  }
}

let mediaPond = null;
function wireMedia() {
  const tab = $('[data-tab="media"]');
  if (!tab) return;
  tab.addEventListener('click', () => {
    if (!mediaPond) {
      mediaPond = createPond($('#caaci-media-file'), { allowMultiple: true });
      if (!mediaPond) {
        notice($('#caaci-media-notice'), 'FilePond failed to load.', false);
      } else {
        mediaPond.on('processfile', (err, f) => {
          if (err) return;
          loadMedia();
          setTimeout(() => mediaPond.removeFile(f.id), 1500); // tidy the drop area
        });
      }
    }
    loadMedia();
  });
}

// ---------- events (publish = make it official) ----------
const EV_LIMIT = 25;
let evOffset = 0,
  evTotal = 0;

// datetime-local wants local wall-clock time; toISOString is UTC — shift first.
const dtInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
// …and back: a datetime-local value parses as local time. Anything unparseable
// is passed through for the server to refuse.
const localToIso = (v) => {
  const d = new Date(v);
  return v && !isNaN(d.getTime()) ? d.toISOString() : v;
};
const fmtWhen = (e) => {
  const s = new Date(e.starts_at);
  const txt = s.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return e.ends_at
    ? `${txt} – ${new Date(e.ends_at).toLocaleTimeString(undefined, { timeStyle: 'short' })}`
    : txt;
};

// Registration is open for a published event that takes registrations (the public
// API answers 404 otherwise) and has not ended; the end check is the API's own
// registrationOpen rule, now <= (ends_at ?? starts_at).
const registrationOpen = (e) =>
  !!e.published &&
  !!e.slug &&
  Array.isArray(e.registration_questions) &&
  Date.now() <= Date.parse(e.ends_at ?? e.starts_at);
const registrationUrl = (e) => `${location.origin}/events/${encodeURIComponent(e.slug)}/register/`;

async function copyRegistrationLink(e) {
  const url = registrationUrl(e);
  try {
    await navigator.clipboard.writeText(url);
    notice(
      $('#caaci-events-notice'),
      t(`Registration link copied: ${url}`, `报名链接已复制：${url}`),
      true,
    );
  } catch {
    window.prompt(t('Copy the registration link:', '请复制报名链接：'), url);
  }
}

// A printable QR code for the registration page — the same generator as the
// discount codes' QR (qrDataUrl, assets/qrcode.js).
function showRegistrationQr(e) {
  const host = $('#caaci-event-qr-host');
  const url = registrationUrl(e);
  let png;
  try {
    png = qrDataUrl(url);
  } catch (err) {
    notice($('#caaci-events-notice'), `QR: ${err.message}`, false);
    return;
  }
  const title = e.title_zh ? `${e.title_zh} · ${e.title}` : e.title;
  host.innerHTML = `
    <div class="card card-body mb-3">
      <div class="row g-3 align-items-center">
        <div class="col-auto">
          <img class="img-thumbnail" alt="${esc(t(`Registration QR code for ${e.title}`, `${title} 报名二维码`))}" src="${png}">
        </div>
        <div class="col">
          <h3 class="mb-1">${esc(title)}</h3>
          <p class="text-secondary">${t('Scanning opens the registration page', '扫码打开报名页面')} <code>${esc(url)}</code></p>
          <div class="btn-list">
            <a class="btn" download="caaci-${esc(e.slug)}-registration-qr.gif" href="${png}">${t('Download image', '下载图片')}</a>
            <button type="button" class="btn" data-act="copy">${t('Copy link', '复制链接')}</button>
            <button type="button" class="btn" data-act="close">${t('Close', '关闭')}</button>
          </div>
        </div>
      </div>
    </div>`;
  host.querySelector('[data-act="copy"]').addEventListener('click', () => copyRegistrationLink(e));
  host.querySelector('[data-act="close"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadEvents() {
  const notb = $('#caaci-events-notice');
  const params = new URLSearchParams({ limit: String(EV_LIMIT), offset: String(evOffset) });
  const q = $('#caaci-ev-q').value.trim();
  const pub = $('#caaci-ev-pub').value;
  if (q) params.set('q', q);
  if (pub) params.set('published', pub);

  const { ok, data } = await api(`/api/admin/events?${params}`);
  if (!ok) {
    notice(notb, data.error || t('Could not load events.', '无法加载活动。'), false);
    return;
  }
  notb.hidden = true;
  const rows = data.rows || [];
  const tb = $('#caaci-events-body');
  tb.innerHTML = '';
  if (!rows.length && evOffset === 0) {
    tb.innerHTML = `<tr><td colspan="5" class="text-secondary">${t('No events yet.', '暂无活动。')}</td></tr>`;
  }
  for (const e of rows) {
    const st = e.published
      ? { key: 'active', label: t('Published', '已发布') }
      : { key: 'pending', label: t('Draft', '草稿') };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(e.title)}${e.image_url ? ` <span class="avatar avatar-sm ms-1" style="background-image: url('${esc(e.image_url)}')"></span>` : ''}${
        registrationOpen(e)
          ? `<div class="btn-list mt-1">
          <button type="button" class="btn btn-sm btn-ghost-primary" data-act="reg-link">${t('Copy registration link', '复制报名链接')}</button>
          <button type="button" class="btn btn-sm btn-ghost-primary" data-act="reg-qr">${t('Registration QR code', '报名二维码')}</button>
        </div>`
          : ''
      }</td>
      <td>${fmtWhen(e)}</td>
      <td>${esc(e.location || '—')}</td>
      <td>${badgeHtml(st.key, st.label)}</td>
      <td><div class="btn-list flex-nowrap">
        <button type="button" class="btn btn-sm" data-act="edit">${t('Edit', '编辑')}</button>
        <button type="button" class="btn btn-sm" data-act="registrations">${t('Registrations', '报名')}</button>
        <button type="button" class="btn btn-sm" data-act="toggle">${e.published ? t('Unpublish', '取消发布') : t('Publish', '发布')}</button>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div></td>`;
    tr.querySelector('[data-act="edit"]').addEventListener('click', () =>
      eventForm($('#caaci-event-form-host'), e),
    );
    tr.querySelector('[data-act="registrations"]').addEventListener('click', () =>
      openRegistrations(e),
    );
    tr.querySelector('[data-act="reg-link"]')?.addEventListener('click', () =>
      copyRegistrationLink(e),
    );
    tr.querySelector('[data-act="reg-qr"]')?.addEventListener('click', () => showRegistrationQr(e));
    tr.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      const { ok: ok2, data: d2 } = await api('/api/admin/events', {
        method: 'POST',
        body: { id: e.id, published: !e.published },
      });
      if (!ok2) return notice(notb, d2.error || t('Update failed.', '更新失败。'), false);
      await loadEvents();
    });
    tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (
        !window.confirm(
          t(
            `Delete "${e.title}"? Its RSVPs and registrations are removed too.`,
            `删除“${e.title}”？其 RSVP 与报名记录也将被删除。`,
          ),
        )
      )
        return;
      const { ok: ok2, data: d2 } = await api(`/api/admin/events?id=${encodeURIComponent(e.id)}`, {
        method: 'DELETE',
      });
      if (!ok2) return notice(notb, d2.error || t('Delete failed.', '删除失败。'), false);
      await loadEvents();
    });
    tb.appendChild(tr);
  }

  evTotal = data.total || 0;
  $('#caaci-ev-info').textContent = evTotal
    ? t(
        `${evOffset + 1}–${Math.min(evOffset + EV_LIMIT, evTotal)} of ${evTotal}`,
        `${evOffset + 1}–${Math.min(evOffset + EV_LIMIT, evTotal)} / 共 ${evTotal}`,
      )
    : t('No events', '暂无活动');
  $('#caaci-ev-prev').disabled = evOffset === 0;
  $('#caaci-ev-next').disabled = evOffset + EV_LIMIT >= evTotal;
}

// ---------- event registration questions (the editor's question builder) ----------
// Questions are plain state: typing only updates it (so focus stays put) and each
// structural change (add, remove, move, type) re-renders the list from it. Ids are
// minted once and never derived from a label, so answers already stored under an
// id keep matching after a relabel or a reorder. The limits mirror the API's
// validateQuestions (functions/api/_event-form.js), which has the last word.
const Q_TYPES = ['single', 'multi', 'text', 'textarea'];
const CHOICE_TYPES = new Set(['single', 'multi']);
const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 30;
const MAX_LABEL = 200;
const QUESTION_ID = /^[a-z0-9_]{1,40}$/;

// `prefix` + 6 random [a-z0-9], not already in `taken`.
function newQuestionId(prefix, taken) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    const id = prefix + [...rnd].map((b) => chars[b % chars.length]).join('');
    if (!taken.includes(id)) return id;
  }
}
const blankOption = (q) => ({
  id: newQuestionId(
    'o_',
    q.options.map((o) => o.id),
  ),
  label_en: '',
  label_zh: '',
});
function blankQuestion(qs) {
  const q = {
    id: newQuestionId(
      'q_',
      qs.map((x) => x.id),
    ),
    type: 'single',
    label_en: '',
    label_zh: '',
    required: false,
    options: [],
    other: false,
  };
  q.options.push(blankOption(q));
  return q;
}

// Editable copy of an event's registration_questions (null → no questions yet).
const questionState = (raw) =>
  (Array.isArray(raw) ? raw : []).map((q) => ({
    id: String(q?.id ?? ''),
    type: Q_TYPES.includes(q?.type) ? q.type : 'text',
    label_en: String(q?.label_en ?? ''),
    label_zh: String(q?.label_zh ?? ''),
    required: !!q?.required,
    options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({
      id: String(o?.id ?? ''),
      label_en: String(o?.label_en ?? ''),
      label_zh: String(o?.label_zh ?? ''),
    })),
    other: !!q?.other,
  }));

// What the API stores: labels trimmed; options and `other` on choice questions only.
// A text question keeps its options in the editor state, so switching the type
// back restores them, but they are not sent.
const questionsPayload = (qs) =>
  qs.map((q) => ({
    id: q.id,
    type: q.type,
    label_en: q.label_en.trim(),
    label_zh: q.label_zh.trim(),
    required: q.required,
    ...(CHOICE_TYPES.has(q.type)
      ? {
          options: q.options.map((o) => ({
            id: o.id,
            label_en: o.label_en.trim(),
            label_zh: o.label_zh.trim(),
          })),
          other: q.other,
        }
      : {}),
  }));

// The first problem with the questions, for the admin; null when they look valid.
function questionsError(qs) {
  if (qs.length > MAX_QUESTIONS)
    return t(`Use at most ${MAX_QUESTIONS} questions.`, `最多只能有 ${MAX_QUESTIONS} 个问题。`);
  const labelled = (x) =>
    [x.label_en.trim(), x.label_zh.trim()].every((s) => s.length >= 1 && s.length <= MAX_LABEL);
  const ids = new Set();
  for (const [i, q] of qs.entries()) {
    const n = i + 1;
    if (!QUESTION_ID.test(q.id) || ids.has(q.id))
      return t(
        `Question ${n} has an invalid id. Remove it and add it again.`,
        `问题 ${n} 的编号无效，请删除后重新添加。`,
      );
    ids.add(q.id);
    if (!labelled(q))
      return t(
        `Question ${n}: enter the question in both English and Chinese (up to ${MAX_LABEL} characters).`,
        `问题 ${n}：请用英文和中文填写问题（最多 ${MAX_LABEL} 个字符）。`,
      );
    if (!CHOICE_TYPES.has(q.type)) continue;
    if (q.options.length < 1 || q.options.length > MAX_OPTIONS)
      return t(
        `Question ${n}: give it 1 to ${MAX_OPTIONS} options.`,
        `问题 ${n}：请设置 1 到 ${MAX_OPTIONS} 个选项。`,
      );
    const optionIds = new Set();
    for (const [j, o] of q.options.entries()) {
      if (!QUESTION_ID.test(o.id) || optionIds.has(o.id))
        return t(
          `Question ${n}, option ${j + 1} has an invalid id. Remove it and add it again.`,
          `问题 ${n} 的选项 ${j + 1} 编号无效，请删除后重新添加。`,
        );
      optionIds.add(o.id);
      if (!labelled(o))
        return t(
          `Question ${n}, option ${j + 1}: enter the option in both English and Chinese (up to ${MAX_LABEL} characters).`,
          `问题 ${n} 的选项 ${j + 1}：请用英文和中文填写选项（最多 ${MAX_LABEL} 个字符）。`,
        );
    }
  }
  return null;
}

function renderQuestionBuilder(host, qs) {
  const typeName = {
    single: t('One choice', '单选'),
    multi: t('Several choices', '多选'),
    text: t('Short text', '简短文字'),
    textarea: t('Long text', '长文字'),
  };
  // A small move/remove button; `label` is its accessible name.
  const tool = (act, symbol, label, disabled, tone = 'btn-ghost-secondary') =>
    `<button type="button" class="btn btn-sm btn-icon ${tone}" data-act="${act}" aria-label="${label}" title="${label}"${disabled ? ' disabled' : ''}>${symbol}</button>`;
  const optionRow = (q, o, j) => `
    <div class="row g-2 align-items-center mb-2" data-o="${j}">
      <div class="col-sm"><input type="text" class="form-control form-control-sm" data-of="label_en" maxlength="${MAX_LABEL}" value="${esc(o.label_en)}" placeholder="English" aria-label="${t(`Option ${j + 1} (English)`, `选项 ${j + 1}（英文）`)}"></div>
      <div class="col-sm"><input type="text" class="form-control form-control-sm" data-of="label_zh" maxlength="${MAX_LABEL}" value="${esc(o.label_zh)}" placeholder="中文" aria-label="${t(`Option ${j + 1} (Chinese)`, `选项 ${j + 1}（中文）`)}"></div>
      <div class="col-auto btn-list flex-nowrap">
        ${tool('opt-up', '↑', t('Move option up', '上移选项'), j === 0)}
        ${tool('opt-down', '↓', t('Move option down', '下移选项'), j === q.options.length - 1)}
        ${tool('opt-remove', '×', t('Remove option', '删除选项'), false, 'btn-ghost-danger')}
      </div>
    </div>`;
  const choices = (q) => `
    <div class="mt-3">
      <div class="form-label">${t('Options', '选项')}</div>
      ${q.options.map((o, j) => optionRow(q, o, j)).join('')}
      <div class="d-flex flex-wrap align-items-center gap-3">
        <button type="button" class="btn btn-sm" data-act="opt-add"${q.options.length >= MAX_OPTIONS ? ' disabled' : ''}>${t('+ Add option', '+ 添加选项')}</button>
        <label class="form-check mb-0"><input type="checkbox" class="form-check-input" data-qf="other"${q.other ? ' checked' : ''} />
          <span class="form-check-label">${t('Allow “Other” with a text box', '允许选“其他”并填写文字')}</span></label>
      </div>
    </div>`;
  const card = (q, i) => `
    <div class="card card-sm mb-2" data-q="${i}">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span class="badge bg-secondary-lt">${t(`Question ${i + 1}`, `问题 ${i + 1}`)}</span>
          <select class="form-select form-select-sm w-auto" data-qf="type" aria-label="${t('Answer type', '答题类型')}">
            ${Q_TYPES.map((ty) => `<option value="${ty}"${ty === q.type ? ' selected' : ''}>${typeName[ty]}</option>`).join('')}
          </select>
          <label class="form-check mb-0"><input type="checkbox" class="form-check-input" data-qf="required"${q.required ? ' checked' : ''} />
            <span class="form-check-label">${t('Required', '必填')}</span></label>
          <div class="btn-list flex-nowrap ms-auto">
            ${tool('q-up', '↑', t('Move question up', '上移问题'), i === 0)}
            ${tool('q-down', '↓', t('Move question down', '下移问题'), i === qs.length - 1)}
            ${tool('q-remove', '×', t('Remove question', '删除问题'), false, 'btn-ghost-danger')}
          </div>
        </div>
        <div class="row g-2">
          ${field(t('Question (English)', '问题（英文）'), `<input type="text" class="form-control" data-qf="label_en" maxlength="${MAX_LABEL}" value="${esc(q.label_en)}">`, 'col-md-6')}
          ${field(t('Question (Chinese)', '问题（中文）'), `<input type="text" class="form-control" data-qf="label_zh" maxlength="${MAX_LABEL}" value="${esc(q.label_zh)}">`, 'col-md-6')}
        </div>
        ${CHOICE_TYPES.has(q.type) ? choices(q) : ''}
      </div>
    </div>`;
  host.innerHTML = `
    ${qs.length ? qs.map(card).join('') : `<p class="text-secondary">${t('No questions yet: the form asks only for an email address.', '暂无问题：表单只收集邮箱地址。')}</p>`}
    <button type="button" class="btn btn-sm" data-act="q-add"${qs.length >= MAX_QUESTIONS ? ' disabled' : ''}>${t('+ Add question', '+ 添加问题')}</button>`;
}

// One set of listeners on the builder host; `qs` is mutated in place.
function wireQuestionBuilder(host, qs) {
  const render = (focus) => {
    renderQuestionBuilder(host, qs);
    if (focus) host.querySelector(focus)?.focus();
  };
  const at = (el) => {
    const card = el.closest('[data-q]');
    const row = el.closest('[data-o]');
    return { qi: card ? Number(card.dataset.q) : -1, oi: row ? Number(row.dataset.o) : -1 };
  };
  // Moves list[from] to list[to]; false when `to` is out of range.
  const move = (list, from, to) => {
    if (to < 0 || to >= list.length) return false;
    list.splice(to, 0, list.splice(from, 1)[0]);
    return true;
  };
  host.addEventListener('input', (e) => {
    const { qi, oi } = at(e.target);
    const q = qs[qi];
    if (!q) return;
    const { qf, of: optionKey } = e.target.dataset;
    if (optionKey && q.options[oi]) q.options[oi][optionKey] = e.target.value;
    else if (qf === 'label_en' || qf === 'label_zh') q[qf] = e.target.value;
  });
  host.addEventListener('change', (e) => {
    const { qi } = at(e.target);
    const q = qs[qi];
    if (!q) return;
    const { qf } = e.target.dataset;
    if (qf === 'required' || qf === 'other') q[qf] = e.target.checked;
    if (qf !== 'type') return;
    q.type = e.target.value;
    if (CHOICE_TYPES.has(q.type) && !q.options.length) q.options.push(blankOption(q));
    render(`[data-q="${qi}"] [data-qf="type"]`);
  });
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const { qi, oi } = at(btn);
    const q = qs[qi];
    let focus = null;
    if (act === 'q-add') {
      if (qs.length >= MAX_QUESTIONS) return;
      qs.push(blankQuestion(qs));
      focus = `[data-q="${qs.length - 1}"] [data-qf="label_en"]`;
    } else if (act === 'q-up' || act === 'q-down') {
      const to = act === 'q-up' ? qi - 1 : qi + 1;
      if (!move(qs, qi, to)) return;
      focus = `[data-q="${to}"] [data-act="${act}"]`;
    } else if (act === 'q-remove') {
      qs.splice(qi, 1);
    } else if (act === 'opt-add') {
      if (q.options.length >= MAX_OPTIONS) return;
      q.options.push(blankOption(q));
      focus = `[data-q="${qi}"] [data-o="${q.options.length - 1}"] [data-of="label_en"]`;
    } else if (act === 'opt-up' || act === 'opt-down') {
      const to = act === 'opt-up' ? oi - 1 : oi + 1;
      if (!move(q.options, oi, to)) return;
      focus = `[data-q="${qi}"] [data-o="${to}"] [data-act="${act}"]`;
    } else if (act === 'opt-remove') {
      q.options.splice(oi, 1);
    } else {
      return;
    }
    render(focus);
  });
  render();
}

function eventForm(host, ev) {
  if (host.firstChild) {
    host.innerHTML = '';
    if (ev === undefined) return; // toggle: + New event closes an open form
  }
  const edit = !!ev;
  // null registration_questions = the event takes no registrations.
  const accepting = edit && Array.isArray(ev.registration_questions);
  const regCount = (edit && Number(ev.registration_count)) || 0;
  host.innerHTML = `
    <form class="card card-body mb-3">
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(`${t('Title', '标题')} *`, `<input type="text" class="form-control" data-f="title" value="${edit ? esc(ev.title) : ''}" required>`)}
        ${field(t('Chinese title (optional)', '中文标题（可选）'), `<input type="text" class="form-control" data-f="title_zh" value="${edit ? esc(ev.title_zh || '') : ''}">`)}
        ${field(t('Location', '地点'), `<input type="text" class="form-control" data-f="location" value="${edit ? esc(ev.location || '') : ''}">`)}
        ${field(`${t('Starts', '开始')} *`, `<input type="datetime-local" class="form-control" data-f="starts_at" value="${edit ? dtInput(ev.starts_at) : ''}">`)}
        ${field(t('Ends (optional)', '结束（可选）'), `<input type="datetime-local" class="form-control" data-f="ends_at" value="${edit ? dtInput(ev.ends_at) : ''}">`)}
        ${field(t('Free-gift deadline', '福利截止时间'), `<input type="datetime-local" class="form-control" data-f="perk_deadline" value="${edit ? dtInput(ev.perk_deadline) : ''}"><small class="form-hint">${t('Register and create an account by this time to get the free gift. Empty = event start.', '在此时间前报名并注册账户可领取福利。留空 = 活动开始时间。')}</small>`)}
        ${field(t('Free gift (Chinese)', '福利礼品（中文）'), `<input type="text" class="form-control" data-f="perk_item_zh" value="${edit ? esc(ev.perk_item_zh || '') : ''}" placeholder="月饼"><small class="form-hint">${t('Name the gift in both languages, or leave both empty for no free gift.', '请用中英文填写礼品名称；都留空表示没有福利。')}</small>`)}
        ${field(t('Free gift (English)', '福利礼品（英文）'), `<input type="text" class="form-control" data-f="perk_item_en" value="${edit ? esc(ev.perk_item_en || '') : ''}" placeholder="mooncake">`)}
        ${imageFieldHtml(edit ? ev.image_url : '')}
      </div>
      ${field(t('Description', '描述'), `<textarea class="form-control" data-f="description" rows="3">${edit ? esc(ev.description || '') : ''}</textarea>`, 'mb-3')}
      <label class="form-check"><input type="checkbox" class="form-check-input" data-f="published"${!edit || ev.published ? ' checked' : ''} />
        <span class="form-check-label">${t('Published (publicly visible)', '发布（公开可见）')}</span></label>
      <div class="border-top pt-3 mb-3">
        <div class="subheader mb-2">${t('Registration', '报名')}</div>
        <label class="form-check form-switch"><input type="checkbox" class="form-check-input" data-f="accept_registrations"${accepting ? ' checked' : ''} />
          <span class="form-check-label">${t('Accept registrations', '接受报名')}</span></label>
        <p class="form-hint">${t('While the event is published and has not ended, people can register on its registration page. Email is always asked; add any other questions below.', '活动发布后、结束前，大家可以在活动报名页报名。报名表始终收集邮箱；其他问题请在下方添加。')}</p>
        ${regCount ? `<div class="alert alert-warning" data-reg-count>${t(`${regCount} registration(s) so far. Changing the questions does not change the answers already given.`, `目前已有 ${regCount} 人报名。修改问题不会改变已提交的答案。`)}</div>` : ''}
        <div data-questions${accepting ? '' : ' hidden'}></div>
      </div>
      <p>
        <button type="submit" class="btn btn-primary">${edit ? t('Save', '保存') : t('Create event', '创建活动')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  wireImageField(form);
  const questions = questionState(edit ? ev.registration_questions : null);
  const questionsHost = form.querySelector('[data-questions]');
  wireQuestionBuilder(questionsHost, questions);
  form.querySelector('[data-f="accept_registrations"]').addEventListener('change', (e) => {
    questionsHost.hidden = !e.target.checked; // the questions are kept while it is off
  });
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (f) => form.querySelector(`[data-f="${f}"]`);
    const body = {
      title: val('title').value.trim(),
      title_zh: val('title_zh').value.trim(),
      location: val('location').value.trim(),
      // The admin's wall-clock times as real instants. A bare datetime-local value
      // would be read as UTC by the Worker, shifting the event by the admin's
      // offset on every save. '' clears an end (→ null) or a deadline (→ start).
      starts_at: localToIso(val('starts_at').value),
      ends_at: localToIso(val('ends_at').value),
      perk_deadline: localToIso(val('perk_deadline').value),
      // The free gift, e.g. 月饼 / mooncake; '' for both = no gift.
      perk_item_zh: val('perk_item_zh').value.trim(),
      perk_item_en: val('perk_item_en').value.trim(),
      description: val('description').value.trim(),
      image_url: val('image_url').value.trim(),
      published: val('published').checked,
    };
    if (!body.title) return notice(msg, t('Title is required.', '标题为必填项。'), false);
    if (!body.starts_at)
      return notice(msg, t('Start date is required.', '开始时间为必填项。'), false);
    if (!body.perk_item_zh !== !body.perk_item_en)
      return notice(
        msg,
        t(
          'Enter the gift name in both languages, or neither.',
          '请用中英文填写礼品名称，或都不填。',
        ),
        false,
      );
    // Switched off → null: no registration page, and the public API answers 404.
    const open = val('accept_registrations').checked;
    if (open) {
      const problem = questionsError(questions);
      if (problem) return notice(msg, problem, false);
    }
    body.registration_questions = open ? questionsPayload(questions) : null;
    // Stored answers are keyed by question and option id and are never rewritten,
    // so check before changing the form under people who already registered.
    const saved = accepting ? questionsPayload(questionState(ev.registration_questions)) : null;
    if (
      regCount > 0 &&
      JSON.stringify(body.registration_questions) !== JSON.stringify(saved) &&
      !window.confirm(
        t(
          `${regCount} people have already registered for this event. Their answers stay as they are, so answers to changed or removed questions and options may no longer match the form. Save the new questions?`,
          `已有 ${regCount} 人报名此活动。已提交的答案不会随之修改，修改或删除的问题和选项可能与已有答案对不上。确定保存新的问题吗？`,
        ),
      )
    )
      return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = edit
      ? await api('/api/admin/events', { method: 'POST', body: { id: ev.id, ...body } })
      : await api('/api/admin/events', { method: 'PUT', body });
    submit.disabled = false;
    if (!ok) return notice(msg, data.error || t('Save failed.', '保存失败。'), false);
    host.innerHTML = '';
    await loadEvents();
  });
}

// ---------- event registrations (who signed up; who gets the free gift) ----------
// The event is in Champaign and registration times are recorded to the second,
// so times here are Chicago wall-clock "YYYY-MM-DD HH:mm:ss" whatever the
// admin's own zone — the same text on screen and in the CSV.
const chicagoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const chicagoTime = (d) => {
  const x = d ? new Date(d) : null;
  if (!x || isNaN(x.getTime())) return '';
  const p = Object.fromEntries(chicagoParts.formatToParts(x).map((q) => [q.type, q.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

// A question's or option's label in `inLang` (English when the Chinese is missing).
const labelIn = (x, inLang) => (inLang === 'zh' && x.label_zh) || x.label_en || '';

// One registrant's answer to one question as plain text ('' = unanswered); the
// caller escapes it. Choices show their option labels and a typed Other as
// "Other: <text>"; an option removed from the form since shows its stored id.
function answerText(q, answer, inLang) {
  if (answer == null) return '';
  if (!CHOICE_TYPES.has(q.type)) return typeof answer === 'string' ? answer : '';
  const option = (id) => {
    const o = (q.options || []).find((x) => x.id === id);
    return o ? labelIn(o, inLang) : String(id);
  };
  let parts = [];
  if (q.type === 'multi') parts = (Array.isArray(answer.options) ? answer.options : []).map(option);
  else if (answer.option != null) parts = [option(answer.option)];
  if (answer.other) parts.push(`${inLang === 'zh' ? '其他：' : 'Other: '}${answer.other}`);
  return parts.join('; ');
}

const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
// RFC 4180: quote a cell holding a comma, quote or line break, doubling quotes.
// Registrant text that starts like a spreadsheet formula gets a leading ' so
// Excel shows it instead of evaluating it.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The registrations CSV (pure — no DOM) from an /api/admin/event-registrations
// answer: the same columns as the panel, with English labels — one per question,
// then the account and, for an event with a free gift, eligibility. `#` is the
// position in registration order, so it stays the same when only eligible rows
// are exported. Starts with a UTF-8 BOM so Excel reads Chinese names correctly;
// CRLF line ends.
export function registrationsCsv(
  { event, questions = [], rows = [] },
  { eligibleOnly = false } = {},
) {
  const perk = event?.perk || null;
  const lines = [
    [
      '#',
      'registered_at (Chicago)',
      'email',
      ...questions.map((q) => q.label_en),
      'has_account',
      'account_confirmed',
      'account_created_at (Chicago)',
      ...(perk ? [`gift_eligible (${perk.item_en})`] : []),
    ],
  ];
  rows.forEach((r, i) => {
    if (eligibleOnly && !r.perk_eligible) return;
    lines.push([
      i + 1,
      chicagoTime(r.created_at),
      r.email,
      ...questions.map((q) => answerText(q, r.answers?.[q.id], 'en')),
      yesNo(!!r.account),
      r.account ? yesNo(!!r.account.confirmed) : '',
      chicagoTime(r.account?.created_at),
      ...(perk ? [yesNo(!!r.perk_eligible)] : []),
    ]);
  });
  return `\uFEFF${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

let regData = null; // the /api/admin/event-registrations answer the panel shows
let regSeq = 0; // a slow answer for an event the admin has since left is dropped

const eventTitleIn = (e) => (lang === 'zh' && e.title_zh) || e.title;

async function openRegistrations(ev) {
  const panel = $('#caaci-reg-panel');
  const notb = $('#caaci-reg-notice');
  const seq = ++regSeq;
  regData = null;
  panel.hidden = false;
  notb.hidden = true;
  $('#caaci-reg-eligible').checked = false;
  $('#caaci-reg-eligible-wrap').hidden = true;
  $('#caaci-reg-csv').disabled = true;
  $('#caaci-reg-title').textContent = eventTitleIn(ev);
  $('#caaci-reg-deadline').textContent = '';
  $('#caaci-reg-stats').innerHTML = '';
  $('#caaci-reg-head').innerHTML = '';
  $('#caaci-reg-body').innerHTML =
    `<tr><td class="text-secondary">${t('Loading…', '加载中…')}</td></tr>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const { ok, data } = await api(
    `/api/admin/event-registrations?event_id=${encodeURIComponent(ev.id)}`,
  );
  if (seq !== regSeq) return;
  if (!ok) {
    $('#caaci-reg-body').innerHTML = '';
    return notice(notb, data.error || t('Could not load registrations.', '无法加载报名。'), false);
  }
  regData = {
    ...data,
    questions: Array.isArray(data.questions) ? data.questions : [],
    rows: data.rows || [],
  };
  const { event, questions } = regData;
  const summary = data.summary || {};
  const perk = event.perk || null; // { item_en, item_zh, deadline } | null
  $('#caaci-reg-title').textContent = eventTitleIn(event);
  if (perk) {
    const when = chicagoTime(perk.deadline);
    const atStart = Date.parse(perk.deadline) === Date.parse(event.starts_at);
    $('#caaci-reg-deadline').textContent = t(
      `Free gift: ${perk.item_en} · deadline ${when} (Chicago)${atStart ? ' — the event start' : ''}`,
      `福利：${perk.item_zh} · 截止时间 ${when}（芝加哥时间）${atStart ? '——即活动开始时间' : ''}`,
    );
  } else {
    $('#caaci-reg-deadline').textContent = t('No free gift for this event.', '该活动没有福利。');
  }
  const stat = (label, n, cls = '') => `
    <div class="col-6 col-sm-4 col-lg-2">
      <div class="card card-sm"><div class="card-body">
        <div class="subheader">${esc(label)}</div>
        <div class="h1 mb-0${cls}">${Number(n) || 0}</div>
      </div></div>
    </div>`;
  // How many picked each option of a choice question (summary.choices), Other last.
  const choiceCounts = (q) => {
    const counts = summary.choices?.[q.id] || {};
    const lines = (q.options || []).map((o) => [labelIn(o, lang), counts[o.id]]);
    if (q.other || counts.other) lines.push([t('Other', '其他'), counts.other]);
    return `
    <div class="col-sm-6 col-lg-4" data-choice="${esc(q.id)}">
      <div class="card card-sm"><div class="card-body">
        <div class="subheader mb-2">${esc(labelIn(q, lang))}</div>
        ${lines
          .map(
            ([label, n]) =>
              `<div class="d-flex justify-content-between gap-2"><span>${esc(label)}</span><strong>${Number(n) || 0}</strong></div>`,
          )
          .join('')}
      </div></div>
    </div>`;
  };
  $('#caaci-reg-stats').innerHTML = [
    stat(t('Total', '总数'), summary.total),
    stat(t('Confirmed account', '已验证账户'), summary.with_account),
    ...(perk
      ? [
          stat(
            t(`Free ${perk.item_en} eligible`, `可领${perk.item_zh}`),
            summary.perk_eligible,
            ' text-success',
          ),
        ]
      : []),
    ...questions.filter((q) => CHOICE_TYPES.has(q.type)).map(choiceCounts),
  ].join('');
  $('#caaci-reg-eligible-wrap').hidden = !perk; // nobody is eligible without a gift
  $('#caaci-reg-csv').disabled = false;
  renderRegistrations();
}

function renderRegistrations() {
  if (!regData) return;
  const { event, questions, rows } = regData;
  const perk = event.perk || null;
  const eligibleOnly = !!perk && $('#caaci-reg-eligible').checked;
  const mark = (yes) =>
    yes ? '<span class="text-success">✓</span>' : '<span class="text-secondary">—</span>';
  // A signup that never confirmed its email doesn't count, but staff should see it.
  const account = (a) => {
    if (!a) return mark(false);
    return a.confirmed ? mark(true) : badgeHtml('pending', t('Unconfirmed', '未验证'));
  };
  // Admin-written labels and everything a registrant typed go through esc().
  $('#caaci-reg-head').innerHTML = `<tr>
      <th>#</th>
      <th>${t('Registered (Chicago)', '报名时间（芝加哥）')}</th>
      <th>${t('Email', '邮箱')}</th>
      ${questions.map((q) => `<th>${esc(labelIn(q, lang))}</th>`).join('')}
      <th>${t('Account', '账户')}</th>
      ${perk ? `<th>${esc(t(`Free ${perk.item_en}`, `免费${perk.item_zh}`))}</th>` : ''}
    </tr>`;
  const html = [];
  rows.forEach((r, i) => {
    if (eligibleOnly && !r.perk_eligible) return;
    html.push(`<tr>
      <td class="text-secondary">${i + 1}</td>
      <td class="text-nowrap">${chicagoTime(r.created_at)}</td>
      <td>${esc(r.email)}</td>
      ${questions.map((q) => `<td class="text-wrap">${esc(answerText(q, r.answers?.[q.id], lang) || '—')}</td>`).join('')}
      <td>${account(r.account)}</td>
      ${perk ? `<td>${mark(r.perk_eligible)}</td>` : ''}
    </tr>`);
  });
  const columns = 4 + questions.length + (perk ? 1 : 0);
  $('#caaci-reg-body').innerHTML =
    html.join('') ||
    `<tr><td colspan="${columns}" class="text-secondary">${
      eligibleOnly
        ? t('No eligible registrations.', '暂无可领福利的报名。')
        : t('No registrations yet.', '暂无报名。')
    }</td></tr>`;
}

function downloadRegistrationsCsv() {
  if (!regData) return;
  const eligibleOnly = !!regData.event.perk && $('#caaci-reg-eligible').checked;
  const csv = registrationsCsv(regData, { eligibleOnly });
  const name =
    String(regData.event.slug || regData.event.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-registrations${eligibleOnly ? '-eligible' : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireEvents() {
  $('#caaci-event-add-btn').addEventListener('click', () => eventForm($('#caaci-event-form-host')));
  $('#caaci-reg-eligible').addEventListener('change', renderRegistrations);
  $('#caaci-reg-csv').addEventListener('click', downloadRegistrationsCsv);
  $('#caaci-reg-close').addEventListener('click', () => {
    regSeq++;
    regData = null;
    $('#caaci-reg-panel').hidden = true;
  });
  let timer;
  $('#caaci-ev-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      evOffset = 0;
      loadEvents();
    }, 300);
  });
  $('#caaci-ev-pub').addEventListener('change', () => {
    evOffset = 0;
    loadEvents();
  });
  $('#caaci-ev-prev').addEventListener('click', () => {
    evOffset = Math.max(0, evOffset - EV_LIMIT);
    loadEvents();
  });
  $('#caaci-ev-next').addEventListener('click', () => {
    evOffset += EV_LIMIT;
    loadEvents();
  });
  const tab = $('[data-tab="events"]');
  if (tab) tab.addEventListener('click', () => loadEvents());
}

// ---------- business directory (approve = make it official) ----------
const BIZ_LIMIT = 25;
let bizOffset = 0,
  bizTotal = 0;
const BIZ_CATEGORIES = ['restaurant', 'bakery', 'supermarket', 'other'];
const CATEGORY_LABEL = {
  restaurant: () => t('Restaurant', '餐馆'),
  bakery: () => t('Bakery', '烘焙店'),
  supermarket: () => t('Supermarket', '超市'),
  other: () => t('Other', '其他'),
};

async function loadBusiness() {
  const notb = $('#caaci-biz-notice');
  const params = new URLSearchParams({ limit: String(BIZ_LIMIT), offset: String(bizOffset) });
  const q = $('#caaci-biz-q').value.trim();
  const approved = $('#caaci-biz-approved').value;
  if (q) params.set('q', q);
  if (approved) params.set('approved', approved);

  const { ok, data } = await api(`/api/admin/business?${params}`);
  if (!ok) {
    notice(notb, data.error || t('Could not load listings.', '无法加载商家条目。'), false);
    return;
  }
  notb.hidden = true;

  const pending = data.pending_total ?? 0;
  $('#caaci-biz-stats').innerHTML = `
    <div class="col-6 col-sm-3">
      <div class="card card-sm"><div class="card-body">
        <div class="subheader">${t('Pending review', '待审核')}</div>
        <div class="h1 mb-0${pending ? ' text-orange' : ''}">${pending}</div>
      </div></div>
    </div>`;

  const rows = data.rows || [];
  const tb = $('#caaci-biz-body');
  tb.innerHTML = '';
  if (!rows.length && bizOffset === 0) {
    tb.innerHTML = `<tr><td colspan="5" class="text-secondary">${t('No listings yet.', '暂无商家条目。')}</td></tr>`;
  }
  for (const r of rows) {
    const st = r.approved
      ? { key: 'active', label: t('Approved', '已批准') }
      : { key: 'pending', label: t('Pending', '待审核') };
    const contact = [r.phone, r.website].filter(Boolean).map(esc).join('<br>') || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.name)}${r.image_url ? ` <span class="avatar avatar-sm ms-1" style="background-image: url('${esc(r.image_url)}')"></span>` : ''}</td>
      <td>${r.category ? CATEGORY_LABEL[r.category]?.() || esc(r.category) : '—'}</td>
      <td>${contact}</td>
      <td>${badgeHtml(st.key, st.label)}</td>
      <td><div class="btn-list flex-nowrap">
        <button type="button" class="btn btn-sm" data-act="edit">${t('Edit', '编辑')}</button>
        <button type="button" class="btn btn-sm" data-act="toggle">${r.approved ? t('Unapprove', '取消批准') : t('Approve', '批准')}</button>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div></td>`;
    tr.querySelector('[data-act="edit"]').addEventListener('click', () =>
      businessForm($('#caaci-biz-form-host'), r),
    );
    tr.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      const { ok: ok2, data: d2 } = await api('/api/admin/business', {
        method: 'POST',
        body: { id: r.id, approved: !r.approved },
      });
      if (!ok2) return notice(notb, d2.error || t('Update failed.', '更新失败。'), false);
      await loadBusiness();
    });
    tr.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!window.confirm(t(`Delete "${r.name}"?`, `删除“${r.name}”？`))) return;
      const { ok: ok2, data: d2 } = await api(
        `/api/admin/business?id=${encodeURIComponent(r.id)}`,
        { method: 'DELETE' },
      );
      if (!ok2) return notice(notb, d2.error || t('Delete failed.', '删除失败。'), false);
      await loadBusiness();
    });
    tb.appendChild(tr);
  }

  bizTotal = data.total || 0;
  $('#caaci-biz-info').textContent = bizTotal
    ? t(
        `${bizOffset + 1}–${Math.min(bizOffset + BIZ_LIMIT, bizTotal)} of ${bizTotal}`,
        `${bizOffset + 1}–${Math.min(bizOffset + BIZ_LIMIT, bizTotal)} / 共 ${bizTotal}`,
      )
    : t('No listings', '暂无条目');
  $('#caaci-biz-prev').disabled = bizOffset === 0;
  $('#caaci-biz-next').disabled = bizOffset + BIZ_LIMIT >= bizTotal;
}

function businessForm(host, biz) {
  if (host.firstChild) {
    host.innerHTML = '';
    if (biz === undefined) return; // toggle: + New listing closes an open form
  }
  const edit = !!biz;
  const catOpts = ['', ...BIZ_CATEGORIES]
    .map(
      (c) =>
        `<option value="${c}"${c === ((edit && biz.category) || '') ? ' selected' : ''}>${c ? CATEGORY_LABEL[c]() : t('— none —', '— 无 —')}</option>`,
    )
    .join('');
  host.innerHTML = `
    <form class="card card-body mb-3">
      <div class="row row-cols-1 row-cols-md-2 g-3 mb-3">
        ${field(`${t('Name', '名称')} *`, `<input type="text" class="form-control" data-f="name" value="${edit ? esc(biz.name) : ''}" required>`)}
        ${field(t('Category', '类别'), `<select class="form-select" data-f="category">${catOpts}</select>`)}
        ${field(t('Phone', '电话'), `<input type="tel" class="form-control" data-f="phone" value="${edit ? esc(biz.phone || '') : ''}">`)}
        ${field(t('Website', '网站'), `<input type="url" class="form-control" data-f="website" value="${edit ? esc(biz.website || '') : ''}">`)}
        ${field(t('Address', '地址'), `<input type="text" class="form-control" data-f="address" value="${edit ? esc(biz.address || '') : ''}">`)}
        ${imageFieldHtml(edit ? biz.image_url : '')}
      </div>
      ${field(t('Description', '描述'), `<textarea class="form-control" data-f="description" rows="3">${edit ? esc(biz.description || '') : ''}</textarea>`, 'mb-3')}
      <label class="form-check"><input type="checkbox" class="form-check-input" data-f="approved"${!edit || biz.approved ? ' checked' : ''} />
        <span class="form-check-label">${t('Approved (publicly listed)', '已批准（公开显示）')}</span></label>
      <p>
        <button type="submit" class="btn btn-primary">${edit ? t('Save', '保存') : t('Create listing', '创建条目')}</button>
        <button type="button" class="btn" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <div class="alert" data-msg hidden></div>
    </form>`;
  const form = host.querySelector('form');
  const msg = form.querySelector('[data-msg]');
  wireImageField(form);
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    host.innerHTML = '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (f) => form.querySelector(`[data-f="${f}"]`);
    const body = {
      name: val('name').value.trim(),
      category: val('category').value,
      phone: val('phone').value.trim(),
      website: val('website').value.trim(),
      address: val('address').value.trim(),
      description: val('description').value.trim(),
      image_url: val('image_url').value.trim(),
      approved: val('approved').checked,
    };
    if (!body.name) return notice(msg, t('Name is required.', '名称为必填项。'), false);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { ok, data } = edit
      ? await api('/api/admin/business', { method: 'POST', body: { id: biz.id, ...body } })
      : await api('/api/admin/business', { method: 'PUT', body });
    submit.disabled = false;
    if (!ok) return notice(msg, data.error || t('Save failed.', '保存失败。'), false);
    host.innerHTML = '';
    await loadBusiness();
  });
}

function wireBusiness() {
  $('#caaci-biz-add-btn').addEventListener('click', () => businessForm($('#caaci-biz-form-host')));
  let timer;
  $('#caaci-biz-q').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      bizOffset = 0;
      loadBusiness();
    }, 300);
  });
  $('#caaci-biz-approved').addEventListener('change', () => {
    bizOffset = 0;
    loadBusiness();
  });
  $('#caaci-biz-prev').addEventListener('click', () => {
    bizOffset = Math.max(0, bizOffset - BIZ_LIMIT);
    loadBusiness();
  });
  $('#caaci-biz-next').addEventListener('click', () => {
    bizOffset += BIZ_LIMIT;
    loadBusiness();
  });
  const tab = $('[data-tab="directory"]');
  if (tab) tab.addEventListener('click', () => loadBusiness());
}

// ---------- boot ----------
(async function () {
  applyLang();
  $('#caaci-lang').addEventListener('click', () => {
    lang = lang === 'en' ? 'zh' : 'en';
    localStorage.setItem('caaci-admin-lang', lang);
    applyLang();
    renderGate(); // re-apply gate text in the new language (it owns its heading)
  });
  $('#caaci-admin-signout').addEventListener('click', async (e) => {
    e.preventDefault();
    if (supa) await supa.auth.signOut();
    location.href = '/login/';
  });

  const allowed = await gate();
  if (!allowed) return;

  $('#caaci-admin-gate').hidden = true;
  $('#caaci-admin-app').hidden = false;
  wireTabs();
  wireMembers();
  wireMemberAdd();
  wireFamilies();
  wirePayments();
  wireRefunds();
  wireDiscounts();
  wireEvents();
  wireBusiness();
  wireMedia();
  wireNews();
  await loadTiers();
  await loadHouseholds(); // for the member "Family" dropdown
  await loadMembers();
})();
