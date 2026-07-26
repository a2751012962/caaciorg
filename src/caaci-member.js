// caaci-member.js — the standalone member-facing pages (Tabler UI, like /admin/):
//   /login-3/     sign in · create account · forgot password  (data-page="login")
//   /membership/  plan grid · discount codes · checkout       (data-page="membership")
//   /account/     subscription · billing · card · history     (data-page="account")
// These pages replace the old mirror-enhancement flow (caaci-app.js) on their
// routes; the behavioral contracts are identical — same API bodies, the same
// 3.5% fee math, the same duplicate-email guard — only the markup is Tabler.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js).
import { esc, usd, withFee, STATUS_LABEL, mergeTiers } from './caaci-shared.js';

const cfg = window.CAACI_CONFIG || {};
const sbLib = window.supabase;
let supa =
  sbLib && sbLib.createClient && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
    ? sbLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;
export function __setSupa(client) {
  supa = client;
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- i18n (EN / 中文) — same mechanism as the admin panel ----------
// ?lang=zh (used by the /zh/ redirect stubs) wins once, then localStorage.
// Resolved lazily in boot() so the module imports cleanly outside a browser.
let lang = 'en';
function initLang() {
  const urlLang = new URLSearchParams(location.search || '').get('lang');
  if (urlLang === 'zh' || urlLang === 'en') localStorage.setItem('caaci-lang', urlLang);
  lang = localStorage.getItem('caaci-lang') || 'en';
}

export function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh' : 'en';
  for (const el of $$('[data-en]')) {
    const v = el.getAttribute(`data-${lang}`);
    if (v != null) el.textContent = v;
  }
  for (const el of $$('[data-ph-en]')) {
    const v = el.getAttribute(`data-ph-${lang}`);
    if (v != null) el.placeholder = v;
  }
  const tgl = $('#caaci-lang');
  if (tgl) tgl.textContent = lang === 'en' ? '中文' : 'EN';
}
const t = (en, zh) => (lang === 'zh' ? zh : en);

// ---------- helpers ----------
// POST helper: a rejected fetch resolves to a normal error result.
const api = (path, body, headers = {}) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
    .catch(() => ({
      ok: false,
      data: { error: t('Network error — please try again.', '网络错误，请重试。') },
    }));

const withTimeout = (promise, ms, fallback) => {
  let tm;
  const timer = new Promise((r) => {
    tm = setTimeout(() => r(fallback), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(tm));
};

// Feedback line — a Tabler alert, green for success, red for errors.
function notice(el, msg, good = true) {
  el.hidden = false;
  el.textContent = msg;
  el.classList.remove('alert-success', 'alert-danger');
  el.classList.add('alert', good ? 'alert-success' : 'alert-danger');
}

export async function loadTiers() {
  if (!supa) return mergeTiers(null);
  try {
    const { data } = await withTimeout(
      supa.from('membership_tiers').select('*').eq('active', true),
      3500,
      { data: null },
    );
    return mergeTiers(data);
  } catch {
    return mergeTiers(null);
  }
}

export async function currentMember() {
  if (!supa) return { user: null, member: null };
  const { data: { user } = { user: null } } = await withTimeout(supa.auth.getUser(), 3500, {
    data: { user: null },
  });
  if (!user) return { user: null, member: null };
  const { data: member } = await withTimeout(
    supa.from('members').select('*').eq('id', user.id).maybeSingle(),
    3500,
    { data: null },
  );
  return { user, member };
}

async function urlDiscount() {
  const code = new URLSearchParams(location.search || '').get('code');
  if (!code) return null;
  const { ok, data } = await api('/api/discount', { code });
  if (ok && data.code) return data;
  return { invalid: true, code, error: data.error || t('Invalid discount code.', '折扣码无效。') };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supabase obfuscates an existing account: signUp "succeeds" but returns a user
// with an EMPTY identities array. Without this guard someone could pay for a
// membership that never activates on their real account.
const isDuplicateSignup = (data) =>
  data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;

// ---------- OAuth (Google + Microsoft) ----------
async function oauth(provider, redirectTo) {
  if (!supa) return;
  const { error } = await supa.auth.signInWithOAuth({
    provider, // 'google' | 'azure' (Microsoft)
    options: { redirectTo: redirectTo || location.origin + '/account/' },
  });
  if (error) alert(error.message);
}

const G_SVG = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.3 13.3 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.7 2.1-6.4 0-11.7-3.8-13.5-9.4l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>`;
const M_SVG = `<svg width="18" height="18" viewBox="0 0 23 23"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>`;

// Renders the two provider buttons into `host` (a .row) as full-width buttons.
export function oauthButtons(host, redirectTo) {
  host.innerHTML = `
    <div class="col-12 col-sm-6">
      <button type="button" class="btn w-100" data-p="google">${G_SVG}<span class="ms-2">Google</span></button>
    </div>
    <div class="col-12 col-sm-6">
      <button type="button" class="btn w-100" data-p="azure">${M_SVG}<span class="ms-2">Microsoft</span></button>
    </div>`;
  for (const b of host.querySelectorAll('button'))
    b.addEventListener('click', () => oauth(b.dataset.p, redirectTo));
}

// ---------- shared navbar (membership + account) ----------
async function wireNav() {
  const auth = $('#caaci-nav-auth');
  if (!auth || !supa) return;
  try {
    const { data: { session } = { session: null } } = (await supa.auth.getSession?.()) || {};
    if (session) {
      auth.textContent = t('Sign out', '退出登录');
      auth.removeAttribute('data-en');
      auth.removeAttribute('data-zh');
      auth.href = '#';
      auth.addEventListener('click', async (e) => {
        e.preventDefault();
        await supa.auth.signOut();
        location.href = '/';
      });
    }
  } catch {
    /* leave the Sign in link */
  }
}

// ---------- /login-3/ ----------
export async function wireAuthPage() {
  const notb = $('#caaci-login-notice');
  if (!supa) {
    notice(notb, 'Supabase is not configured.', false);
    return;
  }

  $('#caaci-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#caaci-li-email').value.trim();
    const password = $('#caaci-li-pwd').value;
    if (!email || !password)
      return notice(notb, t('Enter your email and password.', '请输入邮箱和密码。'), false);
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) return notice(notb, error.message, false);
    // Admins land in the back-office; everyone else on their account page.
    let dest = '/account/';
    const uid = data?.user?.id;
    if (uid) {
      const { data: me } = await supa
        .from('members')
        .select('is_admin')
        .eq('id', uid)
        .maybeSingle();
      if (me?.is_admin) dest = '/admin/';
    }
    location.href = dest;
  });

  $('#caaci-forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#caaci-li-email').value.trim();
    if (!email)
      return notice(notb, t('Enter your email above first.', '请先在上方填写邮箱。'), false);
    const { error } = await supa.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + '/account/?recovery=1',
    });
    if (error) return notice(notb, error.message, false);
    notice(
      notb,
      t('Password reset email sent — check your inbox.', '重置密码邮件已发送，请查收。'),
      true,
    );
  });

  oauthButtons($('#caaci-oauth-host'), location.origin + '/account/');

  $('#caaci-show-signup').addEventListener('click', (e) => {
    e.preventDefault();
    const card = $('#caaci-signup-card');
    card.hidden = !card.hidden;
    if (!card.hidden) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  const suNote = $('#caaci-signup-notice');
  $('#caaci-signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#caaci-su-email').value.trim();
    const pwd = $('#caaci-su-pwd').value;
    if (!EMAIL_RE.test(email))
      return notice(suNote, t('Enter a valid email address.', '请填写有效邮箱。'), false);
    if (pwd.length < 8)
      return notice(suNote, t('Password must be at least 8 characters.', '密码至少 8 位。'), false);
    if (pwd !== $('#caaci-su-pwd2').value)
      return notice(suNote, t('Passwords do not match.', '两次输入的密码不一致。'), false);
    const btn = $('#caaci-su-submit');
    btn.disabled = true;
    const { data, error } = await supa.auth.signUp({
      email,
      password: pwd,
      options: {
        data: {
          full_name: $('#caaci-su-name').value.trim(),
          phone: $('#caaci-su-phone').value.trim(),
        },
        emailRedirectTo: location.origin + '/account/',
      },
    });
    btn.disabled = false;
    if (error) return notice(suNote, error.message, false);
    if (isDuplicateSignup(data))
      return notice(
        suNote,
        t(
          'This email already has an account — log in above instead.',
          '该邮箱已注册，请直接登录。',
        ),
        false,
      );
    if (data?.session) {
      location.href = '/account/';
      return;
    }
    notice(
      suNote,
      t(
        'Account created! Check your email to confirm it, then log in.',
        '账户已创建！请查收确认邮件后登录。',
      ),
      true,
    );
  });
}

// ---------- /membership/ ----------
export async function wireMembershipPage() {
  const notb = $('#caaci-plans-notice');
  const [tiers, { user, member }, discount] = await Promise.all([
    loadTiers(),
    currentMember(),
    urlDiscount(),
  ]);
  const currentTier = member?.status && member.status !== 'cancelled' ? member.tier_id : null;

  // Signed-in banner
  const you = $('#caaci-plans-you');
  if (user) {
    const tierName = tiers.find((x) => x.id === currentTier);
    you.innerHTML = `
      <div class="alert alert-info d-flex flex-wrap align-items-center gap-2">
        <span>${t('Signed in as', '当前登录')} <b>${esc(user.email)}</b>${
          tierName
            ? ` — ${esc(lang === 'zh' ? tierName.name_zh || tierName.name : tierName.name)} · ${esc(STATUS_LABEL[member.status] || member.status)}`
            : ''
        }</span>
        <a class="ms-auto" href="/account/">${t('Go to my account', '前往我的账户')} →</a>
      </div>`;
  } else {
    you.innerHTML = `
      <div class="alert alert-info">
        ${t('Already a member?', '已是会员？')} <a href="/login-3/">${t('Log in', '登录')}</a>
        ${t('to manage your membership.', '即可管理您的会员资格。')}
      </div>`;
  }

  // Discount banner (?code= from flyers/QR)
  const disc = $('#caaci-plans-discount');
  if (discount) {
    disc.innerHTML = discount.invalid
      ? `<div class="alert alert-danger"><b>${esc(discount.code)}</b> — ${esc(discount.error)}</div>`
      : `<div class="alert alert-success"><b>${esc(discount.code)}</b> — ${discount.percent_off}% ${t('off your first year', '首年折扣')}</div>`;
  }

  // Pricing cards
  const row = $('#caaci-plans-row');
  row.innerHTML = tiers
    .map((tier) => {
      const isCurrent = tier.id === currentTier;
      const name = lang === 'zh' ? tier.name_zh || tier.name : tier.name;
      const badge = isCurrent
        ? `<span class="badge bg-success-lt">${t('Current plan', '当前方案')}</span>`
        : tier.featured
          ? `<span class="badge bg-primary-lt">${esc(tier.highlight || '')}</span>`
          : tier.highlight
            ? `<span class="badge bg-secondary-lt">${esc(tier.highlight)}</span>`
            : '';
      const cta = isCurrent
        ? `<a href="/account/" class="btn w-100">${t('Manage', '管理')}</a>`
        : `<button type="button" class="btn ${tier.featured ? 'btn-primary' : ''} w-100" data-tier="${tier.id}">${
            currentTier ? t('Switch to this', '切换到此方案') : t('Join', '加入')
          }</button>`;
      return `
      <div class="col-sm-6 col-lg-3">
        <div class="card${tier.featured && !isCurrent ? ' card-active' : ''}${isCurrent ? ' border-success' : ''}">
          <div class="card-body text-center">
            <div class="mb-2">${badge}</div>
            <h3 class="card-title mb-1">${esc(name)}</h3>
            <div class="display-6 fw-bold my-2">${usd(withFee(tier.price_cents))}</div>
            <div class="text-secondary small mb-2">/ ${t('year', '年')} · ${t('base', '基础价')} ${usd(tier.price_cents)} + 3.5%</div>
            <p class="text-secondary">${esc(tier.description || '')}</p>
            ${cta}
          </div>
        </div>
      </div>`;
    })
    .join('');

  const openFor = (tierId) => {
    const tier = tiers.find((x) => x.id === tierId);
    if (!tier) return;
    openCheckout({
      tier,
      user,
      member,
      allTiers: tiers,
      discount: discount && !discount.invalid ? discount : null,
      notb,
    });
  };
  for (const b of row.querySelectorAll('[data-tier]'))
    b.addEventListener('click', () => openFor(b.dataset.tier));

  // /register/<tier>/ redirect stubs land here with ?tier=<id> — open directly.
  const preTier = new URLSearchParams(location.search || '').get('tier');
  if (preTier && preTier !== currentTier) openFor(preTier);
}

// ---------- checkout modal (Tabler) ----------
// Same contract as the old overlay: nothing is charged here — card entry
// happens on Stripe. POSTs /api/checkout or /api/change-plan.
export function openCheckout({ tier, user, member, discount, notb }) {
  const host = $('#caaci-checkout-host');
  const isSwitch = !!(
    user &&
    member?.status === 'active' &&
    member.tier_id &&
    member.tier_id !== tier.id
  );
  const loggedIn = !!user;
  let authMode = 'signup';
  let applied = discount || null;

  const name = lang === 'zh' ? tier.name_zh || tier.name : tier.name;
  const title = isSwitch
    ? t('Change your plan', '更改方案')
    : loggedIn
      ? t('Confirm your membership', '确认会员方案')
      : t('Create your account', '创建您的账户');

  host.innerHTML = `
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" style="background: rgba(24, 36, 51, 0.45)">
      <div class="modal-dialog modal-lg modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="caaci-co-title">${title}</h5>
            <button type="button" class="btn-close" data-act="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="row g-4">
              <div class="col-md-7" id="caaci-co-main"></div>
              <div class="col-md-5">
                <div class="card card-body bg-surface-secondary" id="caaci-co-summary"></div>
              </div>
            </div>
            <p class="alert mt-3 mb-0" id="caaci-co-notice" hidden></p>
          </div>
        </div>
      </div>
    </div>`;

  const modal = host.firstElementChild;
  const main = $('#caaci-co-main', host);
  const msg = $('#caaci-co-notice', host);
  const close = () => {
    host.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('[data-act="close"]').addEventListener('click', close);

  // Left column
  if (isSwitch) {
    const fromName = member.tier_id;
    main.innerHTML = `
      <p class="text-secondary">${t('Your subscription is updated in place — Stripe prorates the difference.', '订阅将原地更新——Stripe 会按比例结算差价。')}</p>
      <div class="d-flex align-items-center gap-2 mb-3">
        <span class="badge bg-secondary-lt">${esc(fromName)}</span> →
        <span class="badge bg-primary-lt">${esc(tier.id)}</span>
      </div>`;
  } else if (loggedIn) {
    main.innerHTML = `<p class="text-secondary">${t('Signed in as', '当前登录')} <b>${esc(user.email)}</b></p>`;
  } else {
    main.innerHTML = `
      <div class="mb-3" id="caaci-co-namewrap">
        <label class="form-label">${t('Full name', '姓名')}</label>
        <input type="text" id="caaci-name" class="form-control" autocomplete="name">
      </div>
      <div class="mb-3">
        <label class="form-label">${t('Email address', '邮箱地址')}</label>
        <input type="email" id="caaci-email" class="form-control" autocomplete="username">
      </div>
      <div class="mb-2">
        <label class="form-label">${t('Password (at least 8 characters)', '密码（至少 8 位）')}</label>
        <input type="password" id="caaci-pwd" class="form-control" minlength="8" autocomplete="new-password">
      </div>
      <p class="text-secondary mb-2">
        <span id="caaci-auth-prompt">${t('Already have an account?', '已有账户？')}</span>
        <a href="#" id="caaci-auth-toggle">${t('Log in instead', '直接登录')}</a>
      </p>
      <div class="hr-text">${t('or continue with', '或使用以下方式')}</div>
      <div class="row g-2 mb-2" id="caaci-co-oauth"></div>`;
    oauthButtons($('#caaci-co-oauth', host), location.href);
    $('#caaci-auth-toggle', host).addEventListener('click', (e) => {
      e.preventDefault();
      authMode = authMode === 'signup' ? 'login' : 'signup';
      const signup = authMode === 'signup';
      $('#caaci-co-title', host).textContent = signup
        ? t('Create your account', '创建您的账户')
        : t('Log in', '登录');
      $('#caaci-co-namewrap', host).style.display = signup ? '' : 'none';
      $('#caaci-pwd', host).autocomplete = signup ? 'new-password' : 'current-password';
      $('#caaci-auth-prompt', host).textContent = signup
        ? t('Already have an account?', '已有账户？')
        : t('New here?', '还没有账户？');
      $('#caaci-auth-toggle', host).textContent = signup
        ? t('Log in instead', '直接登录')
        : t('Create an account', '注册新账户');
    });
  }

  // Order summary + pay button (+ discount entry on fresh checkouts)
  function renderSummary() {
    const total = withFee(tier.price_cents);
    const fee = total - tier.price_cents;
    // Discounts apply to the fee-inclusive subtotal — that's what Stripe discounts.
    const off = applied ? Math.round((total * applied.percent_off) / 100) : 0;
    const line = (label, value, cls = '') =>
      `<div class="d-flex justify-content-between ${cls}"><span>${label}</span><span>${value}</span></div>`;
    $('#caaci-co-summary', host).innerHTML = `
      <h4 class="mb-3">${esc(name)}</h4>
      ${line(t('Annual membership', '年度会费'), usd(tier.price_cents), 'text-secondary mb-1')}
      ${line(t('Card processing fee (3.5%)', '银行卡手续费（3.5%）'), usd(fee), 'text-secondary mb-1')}
      ${applied ? line(`${esc(applied.code)} −${applied.percent_off}%`, `−${usd(off)}`, 'text-success mb-1') : ''}
      <hr class="my-2">
      ${line(
        `<b>${isSwitch ? t('New rate', '新费率') : t('Total today', '今日合计')}</b>`,
        `<b>${usd(total - off)}</b>`,
      )}
      ${
        applied
          ? `<div class="text-secondary small mt-2">${t('Discount applies to your first year; renews at', '折扣仅限首年；续费价为')} ${usd(total)}/${t('yr', '年')}</div>`
          : `<div class="text-secondary small mt-2">${t('Renews yearly; cancel anytime.', '按年续费，可随时取消。')}</div>`
      }
      ${
        !isSwitch
          ? `<div class="input-group mt-3">
              <input type="text" id="caaci-code" class="form-control" placeholder="${t('Discount code', '折扣码')}" value="${applied ? esc(applied.code) : ''}">
              <button type="button" class="btn" id="caaci-code-apply">${t('Apply', '应用')}</button>
            </div>
            <div class="small mt-1" id="caaci-code-msg"></div>`
          : ''
      }
      <button type="button" class="btn btn-primary w-100 mt-3" id="caaci-pay">
        ${isSwitch ? t('Confirm change', '确认更改') : t('Continue to payment', '前往支付')}
      </button>
      <div class="text-secondary small text-center mt-2">${t('Secure payment via Stripe', '通过 Stripe 安全支付')}</div>`;

    if (!isSwitch) {
      $('#caaci-code-apply', host).addEventListener('click', async () => {
        const code = $('#caaci-code', host).value.trim();
        const codeMsg = $('#caaci-code-msg', host);
        if (!code) {
          applied = null;
          renderSummary();
          return;
        }
        const { ok, data } = await api('/api/discount', { code });
        if (ok && data.code) {
          applied = data;
          renderSummary();
        } else {
          codeMsg.className = 'small mt-1 text-danger';
          codeMsg.textContent = data.error || t('Invalid discount code.', '折扣码无效。');
        }
      });
    }
    $('#caaci-pay', host).addEventListener('click', pay);
  }

  async function pay() {
    const btn = $('#caaci-pay', host);
    btn.disabled = true;
    btn.textContent = t('Redirecting…', '跳转中…');
    const fail = (m) => {
      btn.disabled = false;
      btn.textContent = isSwitch
        ? t('Confirm change', '确认更改')
        : t('Continue to payment', '前往支付');
      notice(msg, m, false);
    };

    // In-place plan switch — no redirect on success.
    if (isSwitch) {
      const { ok, data } = await api('/api/change-plan', { member_id: user.id, tier_id: tier.id });
      if (data?.url) {
        location.href = data.url;
        return;
      }
      if (!ok) return fail(data.error || t('Could not change the plan.', '无法更改方案。'));
      notice(msg, t('Your plan has been updated.', '方案已更新。'), true);
      setTimeout(() => location.reload(), 1200);
      return;
    }

    // Fresh checkout — establish an account first if anonymous.
    let uid = user?.id;
    let email = user?.email;
    if (!uid) {
      email = $('#caaci-email', host).value.trim();
      const pwd = $('#caaci-pwd', host).value;
      if (!EMAIL_RE.test(email)) return fail(t('Enter a valid email address.', '请填写有效邮箱。'));
      if (authMode === 'login') {
        if (!pwd) return fail(t('Enter your password.', '请输入密码。'));
        const { data, error } = await supa.auth.signInWithPassword({ email, password: pwd });
        if (error) return fail(error.message);
        uid = data?.user?.id;
      } else {
        if (pwd.length < 8)
          return fail(t('Password must be at least 8 characters.', '密码至少 8 位。'));
        const { data, error } = await supa.auth.signUp({
          email,
          password: pwd,
          options: {
            data: { full_name: $('#caaci-name', host).value.trim() },
            emailRedirectTo: location.origin + '/account/',
          },
        });
        if (error) return fail(error.message);
        if (isDuplicateSignup(data))
          return fail(
            t('This email already has an account — log in instead.', '该邮箱已注册，请直接登录。'),
          );
        uid = data?.user?.id;
      }
      if (!uid) return fail(t('Could not sign you in.', '登录失败。'));
    }

    const body = { type: 'membership', tier_id: tier.id, email, member_id: uid };
    if (applied?.code) body.discount_code = applied.code;
    const { ok, data } = await api('/api/checkout', body);
    if (ok && data.url) {
      location.href = data.url;
      return;
    }
    fail(data.error || t('Checkout failed — please try again.', '结账失败，请重试。'));
  }

  renderSummary();
  if (notb) notb.hidden = true;
}

// ---------- /account/ ----------
function recoveryCard(host) {
  host.innerHTML = `
    <div class="card mb-3">
      <div class="card-body">
        <h3 class="card-title">${t('Set a new password', '设置新密码')}</h3>
        <div class="mb-3">
          <label class="form-label">${t('New password (at least 8 characters)', '新密码（至少 8 位）')}</label>
          <input type="password" id="caaci-np" class="form-control" minlength="8" autocomplete="new-password">
        </div>
        <div class="mb-3">
          <label class="form-label">${t('Confirm password', '确认密码')}</label>
          <input type="password" id="caaci-np2" class="form-control" autocomplete="new-password">
        </div>
        <button type="button" class="btn btn-primary" id="caaci-np-save">${t('Save password', '保存密码')}</button>
        <p class="alert mt-3 mb-0" data-msg hidden></p>
      </div>
    </div>`;
  const msg = host.querySelector('[data-msg]');
  $('#caaci-np-save', host).addEventListener('click', async () => {
    const pwd = $('#caaci-np', host).value;
    if (pwd.length < 8)
      return notice(msg, t('Password must be at least 8 characters.', '密码至少 8 位。'), false);
    if (pwd !== $('#caaci-np2', host).value)
      return notice(msg, t('Passwords do not match.', '两次输入的密码不一致。'), false);
    const btn = $('#caaci-np-save', host);
    btn.disabled = true;
    const { error } = await supa.auth.updateUser({ password: pwd });
    btn.disabled = false;
    if (error) return notice(msg, error.message, false);
    notice(msg, t('Password updated — you are signed in.', '密码已更新，您已登录。'), true);
  });
}

// Draw the card as a PNG for download (phones keep it in the photo album).
async function drawCardPng({ name, tierName, until, qrPng }) {
  const W = 1050,
    H = 630; // credit-card aspect ratio
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#8e2e11';
  c.fillRect(0, 0, W, 130);
  c.fillStyle = '#edbb5f';
  c.fillRect(0, 130, W, 6);
  c.fillStyle = '#ffffff';
  c.font = '700 52px Georgia, "Times New Roman", serif';
  c.fillText('CAACI', 48, 84);
  c.font = '20px Helvetica, Arial, sans-serif';
  c.fillText('Chinese American Association of Central Illinois · 华人协会', 232, 78);
  c.fillStyle = '#300200';
  c.font = '700 54px Helvetica, Arial, sans-serif';
  c.fillText(name, 48, 260);
  c.fillStyle = '#555555';
  c.font = '32px Helvetica, Arial, sans-serif';
  c.fillText(tierName, 48, 320);
  if (until) {
    c.fillStyle = '#888888';
    c.font = '24px Helvetica, Arial, sans-serif';
    c.fillText(`Valid through · 有效期至 ${until}`, 48, 372);
  }
  c.fillStyle = '#888888';
  c.font = '20px Helvetica, Arial, sans-serif';
  c.fillText('Scan to verify · 扫码实时验证', W - 320, H - 44);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = qrPng;
  });
  c.drawImage(img, W - 328, H - 330, 260, 260);
  return cv.toDataURL('image/png');
}

function renderMemberCard(host, { user, member, tierName }) {
  const until = member.expires_at ? new Date(member.expires_at).toLocaleDateString() : '';
  const cardName = member.full_name || user.email;
  host.innerHTML = `
    <div class="card">
      <div class="card-header"><h3 class="card-title mb-0">${t('Digital membership card', '电子会员卡')}</h3></div>
      <div class="card-body">
        <div class="caaci-mcard2 mb-3">
          <div class="caaci-mcard2-head"><b>CAACI</b><span>Chinese American Association of Central Illinois · 华人协会</span></div>
          <div class="caaci-mcard2-body">
            <div>
              <div class="h2 mb-1">${esc(cardName)}</div>
              <div class="text-secondary">${esc(tierName)}</div>
              ${until ? `<div class="text-secondary small mt-1">${t('Valid through', '有效期至')} ${until}</div>` : ''}
            </div>
            <div class="caaci-mcard2-qr" aria-label="Verification QR code"></div>
          </div>
        </div>
        <div class="btn-list">
          <button type="button" class="btn" id="caaci-mcard-dl" disabled>${t('Download card', '下载会员卡')}</button>
          <button type="button" class="btn" id="caaci-wallet" hidden>${t('Add to Apple Wallet', '加入 Apple 钱包')}</button>
        </div>
        <p class="text-secondary small mt-2 mb-0">${t(
          'Show this card at partner businesses — scanning the QR verifies your membership live.',
          '在合作商家出示会员卡，扫码即可实时验证会员资格。',
        )}</p>
        <p class="alert mt-2 mb-0" data-msg hidden></p>
      </div>
    </div>`;
  const msg = host.querySelector('[data-msg]');

  // Apple Wallet needs signing certificates on the server — probe once and only
  // reveal the button when the endpoint says it's ready (204).
  try {
    fetch('/api/wallet-pass')
      .then((r) => {
        if (r.status !== 204) return;
        const wbtn = $('#caaci-wallet', host);
        wbtn.hidden = false;
        wbtn.addEventListener('click', async () => {
          wbtn.disabled = true;
          try {
            const { data: { session } = { session: null } } =
              (await supa.auth.getSession?.()) || {};
            const res = await fetch('/api/wallet-pass', {
              method: 'POST',
              headers: session ? { authorization: `Bearer ${session.access_token}` } : {},
            });
            if (!res.ok) throw new Error('wallet pass failed');
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'caaci-membership.pkpass';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 30000);
          } catch {
            notice(msg, t('Could not create the Wallet pass.', '无法生成钱包卡券。'), false);
          }
          wbtn.disabled = false;
        });
      })
      .catch(() => {});
  } catch {
    /* fetch unavailable (tests) — button stays hidden */
  }

  // QR — window.qrcode comes from the classic script the page loads.
  try {
    const verifyUrl = `${location.origin}/api/verify?m=${encodeURIComponent(user.id)}`;
    const qr = window.qrcode(0, 'M');
    qr.addData(verifyUrl);
    qr.make();
    const png = qr.createDataURL(6, 12);
    const img = document.createElement('img');
    img.alt = t('Scan to verify membership', '扫码验证会员');
    img.src = png;
    host.querySelector('.caaci-mcard2-qr').appendChild(img);
    const dl = $('#caaci-mcard-dl', host);
    dl.disabled = false;
    dl.addEventListener('click', async () => {
      try {
        const dataUrl = await drawCardPng({
          name: cardName,
          tierName,
          until,
          qrPng: png,
        });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'caaci-membership-card.png';
        a.click();
      } catch {
        notice(msg, t('Could not render the card image.', '无法生成会员卡图片。'), false);
      }
    });
  } catch {
    /* qrcode lib missing — card shows without QR, download stays disabled */
  }
}

export async function wireAccountPage() {
  const host = $('#caaci-account-host');
  if (!supa) {
    host.innerHTML = `<div class="card card-body"><p class="mb-0">Supabase is not configured.</p></div>`;
    return;
  }

  // Password recovery (reset-email link lands on /account/?recovery=1).
  if (/type=recovery/.test(location.hash) || /[?&]recovery=/.test(location.search))
    recoveryCard($('#caaci-recovery-host'));

  const { user } = await currentMember();
  if (!user) {
    host.innerHTML = `
      <div class="card">
        <div class="card-body text-center py-5">
          <h3>${t('You are not signed in', '您尚未登录')}</h3>
          <p class="text-secondary">${t('Sign in to see your membership, payments, and card.', '登录后即可查看会员资格、付款记录和会员卡。')}</p>
          <a href="/login-3/" class="btn btn-primary">${t('Sign in', '登录')}</a>
          <a href="/membership/" class="btn ms-2">${t('Join a membership', '加入会员')}</a>
        </div>
      </div>`;
    return;
  }

  const [tiers, { data: m }] = await Promise.all([
    loadTiers(),
    withTimeout(supa.from('members').select('*').eq('id', user.id).maybeSingle(), 3500, {
      data: null,
    }),
  ]);
  const member = m || {};
  const tier = tiers.find((x) => x.id === member.tier_id);
  const tierName = tier ? (lang === 'zh' ? tier.name_zh || tier.name : tier.name) : '';
  const stBadge = {
    active: 'bg-success-lt',
    pending: 'bg-warning-lt',
    past_due: 'bg-orange-lt',
    expired: 'bg-secondary-lt',
    cancelled: 'bg-danger-lt',
  };

  const subRows = tier
    ? `
      <div class="datagrid">
        <div class="datagrid-item"><div class="datagrid-title">${t('Plan', '方案')}</div><div class="datagrid-content">${esc(tierName)}</div></div>
        <div class="datagrid-item"><div class="datagrid-title">${t('Status', '状态')}</div>
          <div class="datagrid-content"><span class="badge ${stBadge[member.status] || 'bg-secondary-lt'}">${esc(STATUS_LABEL[member.status] || member.status || '—')}</span></div></div>
        <div class="datagrid-item"><div class="datagrid-title">${t('Price', '价格')}</div><div class="datagrid-content">${usd(withFee(tier.price_cents))}/${t('yr', '年')} <span class="text-secondary">(${t('incl. 3.5% card fee', '含 3.5% 手续费')})</span></div></div>
        <div class="datagrid-item"><div class="datagrid-title">${member.status === 'active' ? t('Renews', '续费日期') : t('Expires', '到期日期')}</div>
          <div class="datagrid-content">${member.expires_at ? new Date(member.expires_at).toLocaleDateString() : '—'}</div></div>
      </div>
      ${
        member.status === 'past_due'
          ? `<div class="alert alert-danger mt-3 mb-0">${t('Your last payment failed — update your card in Manage billing or your membership will expire.', '上次扣款失败——请在“管理账单”中更新银行卡，否则会员将过期。')}</div>`
          : ''
      }`
    : `<p class="text-secondary mb-2">${t('No membership yet.', '尚未加入会员。')}</p>
       <a href="/membership/" class="btn btn-primary">${t('Join a membership', '加入会员')}</a>`;

  host.innerHTML = `
    <div class="row row-cards">
      <div class="col-lg-6">
        <div class="card mb-3">
          <div class="card-header"><h3 class="card-title mb-0">${t('Profile', '个人信息')}</h3></div>
          <div class="card-body">
            <div class="datagrid">
              ${member.full_name ? `<div class="datagrid-item"><div class="datagrid-title">${t('Name', '姓名')}</div><div class="datagrid-content">${esc(member.full_name)}</div></div>` : ''}
              <div class="datagrid-item"><div class="datagrid-title">${t('Email', '邮箱')}</div><div class="datagrid-content">${esc(user.email)}</div></div>
              ${member.phone ? `<div class="datagrid-item"><div class="datagrid-title">${t('Phone', '电话')}</div><div class="datagrid-content">${esc(member.phone)}</div></div>` : ''}
            </div>
          </div>
        </div>
        <div class="card mb-3">
          <div class="card-header">
            <h3 class="card-title mb-0">${t('Subscription', '订阅')}</h3>
            ${
              tier
                ? `<div class="card-actions btn-list">
                    <a href="/membership/" class="btn btn-sm">${t('Change plan', '更改方案')}</a>
                    <button type="button" class="btn btn-sm btn-primary" id="caaci-billing">${t('Manage billing', '管理账单')}</button>
                  </div>`
                : ''
            }
          </div>
          <div class="card-body">${subRows}
            <p class="alert mt-3 mb-0" id="caaci-billing-notice" hidden></p>
          </div>
        </div>
        <div class="card mb-3">
          <div class="card-header"><h3 class="card-title mb-0">${t('Payment history', '付款记录')}</h3></div>
          <div class="card-body" id="caaci-payhist-host">
            <p class="text-secondary mb-0">${t('No payments yet.', '暂无付款记录。')}</p>
          </div>
        </div>
      </div>
      <div class="col-lg-6">
        <div id="caaci-mcard-host"></div>
      </div>
    </div>`;

  // Billing portal (Stripe-hosted card update / invoices / cancel).
  const billing = $('#caaci-billing', host);
  if (billing)
    billing.addEventListener('click', async () => {
      billing.disabled = true;
      const bnote = $('#caaci-billing-notice', host);
      const { data: { session } = { session: null } } = (await supa.auth.getSession?.()) || {};
      const { ok, data } = await api(
        '/api/portal',
        {},
        session ? { authorization: `Bearer ${session.access_token}` } : {},
      );
      billing.disabled = false;
      if (ok && data.url) {
        location.href = data.url;
        return;
      }
      notice(
        bnote,
        data.error || t('Could not open the billing portal.', '无法打开账单管理。'),
        false,
      );
    });

  // Payment history — the member's own rows via RLS (payments_self_read).
  try {
    const { data: pays } = await withTimeout(
      supa
        .from('payments')
        .select('paid_at,kind,amount_cents')
        .eq('member_id', user.id)
        .order('paid_at', { ascending: false })
        .limit(10),
      3500,
      { data: null },
    );
    if (Array.isArray(pays) && pays.length) {
      const KIND = { membership: t('Membership', '入会'), renewal: t('Renewal', '续费') };
      $('#caaci-payhist-host', host).innerHTML = `
        <div class="table-responsive"><table class="table table-sm table-vcenter">
          <thead><tr><th>${t('Date', '日期')}</th><th>${t('Type', '类型')}</th><th class="text-end">${t('Amount', '金额')}</th></tr></thead>
          <tbody>${pays
            .map(
              (p) => `<tr>
                <td>${p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}</td>
                <td>${KIND[p.kind] || esc(p.kind || '—')}</td>
                <td class="text-end">${usd(p.amount_cents || 0)}</td>
              </tr>`,
            )
            .join('')}</tbody>
        </table></div>`;
    }
  } catch {
    /* payments table missing or slow — section keeps its empty state */
  }

  // Digital membership card — active members only.
  if (tier && member.status === 'active')
    renderMemberCard($('#caaci-mcard-host', host), { user, member, tierName });
}

// ---------- boot ----------
export async function boot() {
  initLang();
  applyLang();
  const tgl = $('#caaci-lang');
  if (tgl)
    tgl.addEventListener('click', () => {
      lang = lang === 'en' ? 'zh' : 'en';
      localStorage.setItem('caaci-lang', lang);
      location.reload(); // dynamic content re-renders in the new language
    });
  const page = document.body.dataset.page;
  try {
    if (page === 'login') await wireAuthPage();
    else if (page === 'membership') {
      await wireNav();
      await wireMembershipPage();
    } else if (page === 'account') {
      await wireNav();
      await wireAccountPage();
    }
  } catch (e) {
    console.warn('caaci-member:', e);
  }
}

if (!window.__CAACI_TEST__) boot();
