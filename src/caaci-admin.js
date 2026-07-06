// caaci-admin.js — back-office panel logic. Loaded ONLY by /admin/index.html.
// Gates on a live Supabase session + members.is_admin (real enforcement is
// server-side in /api/admin/*; this is UX). All privileged data comes from
// authenticated API calls, never baked into the page.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js,
// a classic <script> the build injects before this deferred module), which sets
// window.supabase.createClient. Serving it from our own origin drops the runtime
// dependency on esm.sh — blocked/slow on some networks (e.g. China), which
// otherwise leaves this panel stuck on "Checking access…".
const cfg = window.CAACI_CONFIG || {};
const sb = window.supabase;
const supa =
  sb && sb.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
    ? sb.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- i18n (EN / 中文) ----------
let lang = localStorage.getItem('caaci-admin-lang') || 'en';
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

function notice(el, msg, good = true) {
  el.hidden = false;
  el.textContent = msg;
  if (good) el.removeAttribute('data-state');
  else el.setAttribute('data-state', 'error');
}

// ---------- tabs ----------
function wireTabs() {
  for (const tab of $$('.caaci-tab')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      for (const tt of $$('.caaci-tab')) tt.setAttribute('aria-selected', String(tt === tab));
      for (const p of $$('.caaci-panel')) p.hidden = p.dataset.panel !== name;
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
  tb.innerHTML = '';
  for (const m of rows) {
    const tr = document.createElement('tr');
    const statusTxt = STATUS_LABEL[m.status]?.() || m.status || '—';
    tr.innerHTML = `
      <td>${esc(m.full_name) || '—'}</td>
      <td>${esc(m.email)}</td>
      <td>${esc(tierName[m.tier_id] || m.tier_id || '—')}</td>
      <td><span class="caaci-badge" data-state="${esc(m.status || '')}">${esc(statusTxt)}</span></td>
      <td>${fmtDate(m.expires_at)}</td>
      <td><button type="button" class="caaci-link-btn">${t('Edit', '编辑')}</button></td>`;
    tr.querySelector('button').addEventListener('click', () => toggleEditor(tr, m));
    tb.appendChild(tr);
  }
}

function toggleEditor(tr, m) {
  const next = tr.nextElementSibling;
  if (next?.classList.contains('caaci-edit-row')) {
    next.remove();
    return;
  }
  $$('.caaci-edit-row').forEach((r) => r.remove());

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
  row.className = 'caaci-edit-row';
  row.innerHTML = `<td colspan="6">
    <div class="caaci-edit">
      <label>${t('Status', '状态')}
        <select class="caaci-input" data-f="status">
          ${['active', 'pending', 'past_due', 'expired', 'cancelled'].map((s) => opt(s, m.status)).join('')}
        </select></label>
      <label>${t('Tier', '类型')}
        <select class="caaci-input" data-f="tier_id">${tierOpts}</select></label>
      <label>${t('Expires', '到期')}
        <input type="date" class="caaci-input" data-f="expires_at" value="${exp}"></label>
      <label>${t('Family', '家庭')}
        <select class="caaci-input" data-f="household_id">${householdOptionsHtml(m.household_id)}</select></label>
      <button type="button" class="caaci-btn" data-act="save">${t('Save', '保存')}</button>
      <button type="button" class="caaci-btn caaci-btn--secondary caaci-danger" data-act="delete">${t('Delete', '删除')}</button>
      <span class="caaci-notice caaci-edit-msg" hidden></span>
    </div></td>`;
  tr.after(row);

  row.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
    const msg = row.querySelector('.caaci-edit-msg');
    const { ok, data } = await api('/api/admin/members', {
      method: 'POST',
      body: {
        id: m.id,
        status: get('status'),
        tier_id: get('tier_id'),
        expires_at: get('expires_at'),
        household_id: get('household_id'),
      },
    });
    if (!ok) {
      notice(msg, data.error || t('Update failed.', '更新失败。'), false);
      return;
    }
    notice(msg, t('Saved.', '已保存。'), true);
    await loadMembers();
  });

  row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const msg = row.querySelector('.caaci-edit-msg');
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
  $('#caaci-pay-stats').innerHTML = tiles
    .map(
      ([label, value, state]) => `
      <div class="caaci-stat"${state ? ` data-state="${state}"` : ''}>
        <span class="caaci-stat-value">${esc(String(value))}</span>
        <span class="caaci-stat-label">${esc(label)}</span>
      </div>`,
    )
    .join('');

  const tb = $('#caaci-payments-body');
  tb.innerHTML = '';
  const rows = data.rows || [];
  if (!rows.length && payOffset === 0) {
    tb.innerHTML = `<tr><td colspan="6" class="caaci-muted-text">${t('No payments recorded yet.', '暂无收款记录。')}</td></tr>`;
  }
  for (const p of rows) {
    const who = p.members
      ? `${esc(p.members.full_name || '—')}<br><span class="caaci-muted-text">${esc(p.members.email || '')}</span>`
      : `<span class="caaci-muted-text">${t('(deleted member)', '（已删除会员）')}</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(p.paid_at)}</td>
      <td>${who}</td>
      <td>${KIND_LABEL[p.kind]?.() || esc(p.kind)}</td>
      <td>${esc(tierName[p.tier_id] || p.tier_id || '—')}</td>
      <td>${p.discount_code ? `<code>${esc(p.discount_code)}</code>` : '—'}</td>
      <td>${usdFmt(p.amount_cents)}</td>`;
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
  const tab = $('.caaci-tab[data-tab="payments"]');
  if (tab) tab.addEventListener('click', () => loadPayments());
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
    tb.innerHTML = `<tr><td colspan="7" class="caaci-muted-text">${t('No discount codes yet.', '暂无折扣码。')}</td></tr>`;
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
      <td><span class="caaci-badge" data-state="${st.key}">${st.label}</span></td>
      <td>${used}</td>
      <td>${fmtDate(d.expires_at)}</td>
      <td>
        <button type="button" class="caaci-link-btn" data-act="qr">${t('QR code', '二维码')}</button>
        <button type="button" class="caaci-link-btn" data-act="toggle">${d.active ? t('Deactivate', '停用') : t('Activate', '启用')}</button>
        <button type="button" class="caaci-link-btn caaci-danger" data-act="delete">${t('Delete', '删除')}</button>
      </td>`;
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
    <div class="caaci-qr">
      <img alt="QR code for ${esc(d.code)}" src="${png}">
      <div class="caaci-qr-meta">
        <h3>${esc(d.code)} — −${d.percent_off}%</h3>
        <p>${t('Scanning opens', '扫码打开')} <code>${esc(url)}</code></p>
        <p>
          <a class="caaci-btn caaci-btn--secondary" download="caaci-${esc(d.code)}-qr.gif" href="${png}">${t('Download image', '下载图片')}</a>
          <button type="button" class="caaci-btn caaci-btn--secondary" data-act="close">${t('Close', '关闭')}</button>
        </p>
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
    <form class="caaci-card-inset">
      <div class="caaci-form-grid">
        ${field(`${t('Code', '折扣码')} *`, `<input type="text" class="caaci-input" data-f="code" maxlength="32" placeholder="SPRING2026" style="text-transform:uppercase">`)}
        ${field(`${t('Percent off', '折扣百分比')} *`, `<input type="number" class="caaci-input" data-f="percent_off" min="1" max="100" step="1" placeholder="20">`)}
        ${field(t('Description', '说明'), `<input type="text" class="caaci-input" data-f="description">`)}
        ${field(t('Expires (optional)', '到期（可选）'), `<input type="date" class="caaci-input" data-f="expires_at">`)}
        ${field(t('Max redemptions (optional)', '最多使用次数（可选）'), `<input type="number" class="caaci-input" data-f="max_redemptions" min="1" step="1">`)}
      </div>
      <p>
        <button type="submit" class="caaci-btn">${t('Create code', '创建折扣码')}</button>
        <button type="button" class="caaci-btn caaci-btn--secondary" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <p class="caaci-notice" data-msg hidden></p>
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
  const tab = $('.caaci-tab[data-tab="discounts"]');
  if (tab) tab.addEventListener('click', () => loadDiscounts());
}

// ---------- news composer ----------
function wireNews() {
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
const field = (label, inputHtml) =>
  `<div class="caaci-field"><label>${label}</label>${inputHtml}</div>`;
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
async function loadHouseholds() {
  const { ok, data } = await api('/api/admin/households');
  if (ok) households = data.rows || [];
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
      <form class="caaci-card-inset caaci-add-form">
        <div class="caaci-form-grid">
          ${field(t('Full name', '姓名'), `<input type="text" class="caaci-input" data-f="full_name">`)}
          ${field(`${t('Email (login)', '邮箱（登录）')} *`, `<input type="email" class="caaci-input" data-f="email" required>`)}
          ${field(t('Password (optional)', '密码（可选）'), `<input type="password" class="caaci-input" data-f="password">`)}
          ${field(t('Phone', '电话'), `<input type="tel" class="caaci-input" data-f="phone">`)}
          ${field(t('Tier', '类型'), `<select class="caaci-input" data-f="tier_id">${tierOptionsHtml('')}</select>`)}
          ${field(t('Status', '状态'), `<select class="caaci-input" data-f="status">${statusOptionsHtml('active', ['active', 'pending', 'past_due', 'expired', 'cancelled'])}</select>`)}
          ${field(t('Member since', '加入时间'), `<input type="date" class="caaci-input" data-f="member_since">`)}
          ${field(t('Expires', '到期'), `<input type="date" class="caaci-input" data-f="expires_at">`)}
          ${field(t('Family', '家庭'), `<select class="caaci-input" data-f="household_id">${householdOptionsHtml('')}</select>`)}
        </div>
        <label class="caaci-check"><input type="checkbox" data-f="is_admin" />
          <span>${t('Administrator', '管理员')}</span></label>
        ${field(t('Notes', '备注'), `<textarea class="caaci-input" data-f="notes" rows="2"></textarea>`)}
        <p>
          <button type="submit" class="caaci-btn">${t('Create member', '创建会员')}</button>
          <button type="button" class="caaci-btn caaci-btn--secondary" data-act="cancel">${t('Cancel', '取消')}</button>
        </p>
        <p class="caaci-notice" data-msg hidden></p>
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
  const host = $('#caaci-families-list');
  host.innerHTML = '';
  if (!households.length) {
    host.innerHTML = `<p class="caaci-muted-text">${t('No families yet.', '暂无家庭。')}</p>`;
    return;
  }
  for (const h of households) host.appendChild(familyCard(h));
}

function personRow(p) {
  const primary = p.is_primary ? ` <span class="caaci-badge">${t('primary', '主要')}</span>` : '';
  return `<tr>
    <td>${esc(p.full_name)}${primary}</td>
    <td>${esc(p.relationship || '—')}</td>
    <td>${esc(p.email || '—')}</td>
    <td>${esc(p.phone || '—')}</td>
    <td>
      <button type="button" class="caaci-link-btn" data-person="${p.id}" data-act="edit-person">${t('Edit', '编辑')}</button>
      <button type="button" class="caaci-link-btn caaci-danger" data-person="${p.id}" data-act="del-person">${t('Delete', '删除')}</button>
    </td></tr>`;
}

function familyCard(h) {
  const card = document.createElement('section');
  card.className = 'caaci-card caaci-family';
  const tierTxt = esc(tierName[h.tier_id] || h.tier_id || t('— no tier —', '— 无类型 —'));
  const statusTxt = STATUS_LABEL[h.status]?.() || h.status;
  const expTxt = h.expires_at ? ` · ${t('expires', '到期')} ${fmtDate(h.expires_at)}` : '';
  const accounts = h.accounts || [];
  const people = h.people || [];
  const acctList = accounts.length
    ? `<ul class="caaci-family-accts">${accounts
        .map(
          (a) =>
            `<li>${esc(a.full_name || '—')} — ${esc(a.email || '')} <span class="caaci-badge" data-state="${esc(a.status || '')}">${STATUS_LABEL[a.status]?.() || a.status || '—'}</span></li>`,
        )
        .join('')}</ul>`
    : `<p class="caaci-muted-text">${t('None linked. Edit a member and choose this family.', '暂无关联账户。编辑会员并选择该家庭即可关联。')}</p>`;
  const peopleBlock = people.length
    ? `<div class="caaci-table-wrap"><table class="caaci-table"><thead><tr>
        <th>${t('Name', '姓名')}</th><th>${t('Relationship', '关系')}</th>
        <th>${t('Email', '邮箱')}</th><th>${t('Phone', '电话')}</th><th></th></tr></thead>
        <tbody>${people.map(personRow).join('')}</tbody></table></div>`
    : `<p class="caaci-muted-text">${t('No family members added yet.', '尚未添加家庭成员。')}</p>`;
  card.innerHTML = `
    <div class="caaci-family-head">
      <div>
        <h3>${esc(h.name)}</h3>
        <p class="caaci-muted-text">${tierTxt} · ${statusTxt}${expTxt}</p>
        ${h.notes ? `<p class="caaci-muted-text">${esc(h.notes)}</p>` : ''}
      </div>
      <div class="caaci-family-actions">
        <button type="button" class="caaci-link-btn" data-act="edit">${t('Edit', '编辑')}</button>
        <button type="button" class="caaci-link-btn caaci-danger" data-act="delete">${t('Delete', '删除')}</button>
      </div>
    </div>
    <div data-edit-host></div>
    <div class="caaci-family-sub">
      <span class="caaci-eyebrow">${t('Login accounts', '登录账户')}</span>
      ${acctList}
    </div>
    <div class="caaci-family-sub">
      <div class="caaci-family-subhead">
        <span class="caaci-eyebrow">${t('Family members', '家庭成员')}</span>
        <button type="button" class="caaci-link-btn" data-act="add-person">${t('+ Add person', '+ 添加成员')}</button>
      </div>
      <div data-person-host></div>
      ${peopleBlock}
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
    <form class="caaci-card-inset">
      <div class="caaci-form-grid">
        ${field(`${t('Family name', '家庭名称')} *`, `<input type="text" class="caaci-input" data-f="name" value="${edit ? esc(h.name) : ''}" required>`)}
        ${field(t('Tier', '类型'), `<select class="caaci-input" data-f="tier_id">${tierOptionsHtml(edit ? h.tier_id : 'family')}</select>`)}
        ${field(t('Status', '状态'), `<select class="caaci-input" data-f="status">${statusOptionsHtml(edit ? h.status : 'active')}</select>`)}
        ${field(t('Member since', '加入时间'), `<input type="date" class="caaci-input" data-f="member_since" value="${edit ? dateInput(h.member_since) : ''}">`)}
        ${field(t('Expires', '到期'), `<input type="date" class="caaci-input" data-f="expires_at" value="${edit ? dateInput(h.expires_at) : ''}">`)}
      </div>
      ${field(t('Notes', '备注'), `<textarea class="caaci-input" data-f="notes" rows="2">${edit ? esc(h.notes || '') : ''}</textarea>`)}
      <p>
        <button type="submit" class="caaci-btn">${edit ? t('Save', '保存') : t('Create', '创建')}</button>
        <button type="button" class="caaci-btn caaci-btn--secondary" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <p class="caaci-notice" data-msg hidden></p>
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
    <form class="caaci-card-inset">
      <div class="caaci-form-grid">
        ${field(`${t('Full name', '姓名')} *`, `<input type="text" class="caaci-input" data-f="full_name" value="${edit ? esc(p.full_name) : ''}" required>`)}
        ${field(t('Relationship', '关系'), `<select class="caaci-input" data-f="relationship"><option value=""></option>${relOpts}</select>`)}
        ${field(t('Email', '邮箱'), `<input type="email" class="caaci-input" data-f="email" value="${edit ? esc(p.email || '') : ''}">`)}
        ${field(t('Phone', '电话'), `<input type="tel" class="caaci-input" data-f="phone" value="${edit ? esc(p.phone || '') : ''}">`)}
      </div>
      <label class="caaci-check"><input type="checkbox" data-f="is_primary"${edit && p.is_primary ? ' checked' : ''} />
        <span>${t('Primary contact', '主要联系人')}</span></label>
      <p>
        <button type="submit" class="caaci-btn">${edit ? t('Save', '保存') : t('Add', '添加')}</button>
        <button type="button" class="caaci-btn caaci-btn--secondary" data-act="cancel">${t('Cancel', '取消')}</button>
      </p>
      <p class="caaci-notice" data-msg hidden></p>
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
  const tab = $('.caaci-tab[data-tab="families"]');
  if (tab) tab.addEventListener('click', () => loadFamilies());
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
  wireDiscounts();
  wireNews();
  await loadTiers();
  await loadHouseholds(); // for the member "Family" dropdown
  await loadMembers();
})();
