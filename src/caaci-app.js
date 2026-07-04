// caaci-app.js — progressive enhancement layer.
// Injected before </body> on every mirrored page. It attaches behaviour to the
// existing WordPress/Divi markup so the UI stays byte-identical while the backend
// becomes Supabase + Cloudflare Functions. All wiring is feature-detected and
// wrapped in try/catch so a page without a given form is simply left untouched.

// The Supabase client is created lazily inside init() so this module can be
// imported in a test environment (Node/jsdom) without pulling the remote ESM
// bundle. Tests inject a fake client via __setSupa().
let supa = null;
export function __setSupa(client) {
  supa = client;
}

const $ = (s, r = document) => r.querySelector(s);
// POST helper. A rejected fetch (offline, DNS, CORS) resolves to a normal error
// result instead of throwing — otherwise the await inside a click handler dies
// silently and leaves the button stuck on "Redirecting…" forever.
const api = (path, body, headers = {}) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
    .catch(() => ({
      ok: false,
      data: { error: 'Network error — please try again. · 网络错误，请重试。' },
    }));

// Escape user/DB-sourced text before it lands in innerHTML.
export const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

// Styling for all custom UI lives in src/caaci-ui.css (see UI_GUIDELINE.md).
export function notice(el, msg, good = true) {
  let n = el.querySelector('.caaci-notice');
  if (!n) {
    n = document.createElement('p');
    n.className = 'caaci-notice';
    el.appendChild(n);
  }
  n.textContent = msg;
  if (good) n.removeAttribute('data-state');
  else n.setAttribute('data-state', 'error');
}

export const TIER_BY_SLUG = {
  'student-membership': 'student',
  'individual-membership': 'individual',
  'family-membership': 'family',
  'business-membership': 'business',
};

// ~3.5% card surcharge — must match CARD_SURCHARGE in functions/api/checkout.js
// and functions/api/change-plan.js.
export const CARD_SURCHARGE = 0.035;

// Fallback tier catalogue (mirrors supabase/seed.sql). Used verbatim when
// Supabase isn't configured, and merged over live rows so the plan view and
// checkout summary always render. Keep ids/prices in sync with the seed.
export const TIERS_FALLBACK = [
  {
    id: 'student',
    name: 'Student Membership',
    name_zh: '学生会员',
    price_cents: 1000,
    description: 'For currently enrolled college students.',
    highlight: 'Best for students',
  },
  {
    id: 'individual',
    name: 'Individual Membership',
    name_zh: '个人会员',
    price_cents: 3000,
    description: 'Full membership for one person.',
    highlight: 'Most popular',
    featured: true,
  },
  {
    id: 'family',
    name: 'Family Membership',
    name_zh: '家庭会员',
    price_cents: 6000,
    description: 'Covers your whole household.',
    highlight: 'Best value',
  },
  {
    id: 'business',
    name: 'Business Membership',
    name_zh: '商业会员',
    price_cents: 10000,
    description: 'Includes a listing in the business directory.',
    highlight: 'For businesses',
  },
];

export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
export const withFee = (cents) => Math.round(cents * (1 + CARD_SURCHARGE)); // total charged on card

// Resolve a promise but give up after `ms`, returning `fallback` — so a slow or
// unreachable Supabase never blocks the UI from rendering. The timer is cleared
// once the race settles so it never lingers past the work it was guarding.
const withTimeout = (promise, ms, fallback) => {
  let t;
  const timer = new Promise((r) => {
    t = setTimeout(() => r(fallback), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
};

// Merge live membership_tiers (if any) over the fallback, preserving order/labels.
export async function loadTiers() {
  const base = TIERS_FALLBACK.map((t) => ({ ...t }));
  if (!supa) return base;
  try {
    const { data } = await withTimeout(
      supa.from('membership_tiers').select('*').eq('active', true),
      3500,
      { data: null },
    );
    if (Array.isArray(data)) {
      for (const row of data) {
        const t = base.find((b) => b.id === row.id);
        if (t)
          Object.assign(t, {
            name: row.name || t.name,
            price_cents: row.price_cents ?? t.price_cents,
            description: row.description || t.description,
          });
        else base.push({ ...row, highlight: '' });
      }
    }
  } catch (e) {
    console.warn('caaci-app: loadTiers', e);
  }
  return base.sort((a, b) => a.price_cents - b.price_cents);
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

// Member status → bilingual label. Shared by the plan view and account page.
export const STATUS_LABEL = {
  active: 'Active · 有效',
  pending: 'Pending payment · 待付款',
  past_due: 'Payment past due · 付款逾期',
  expired: 'Expired · 已过期',
  cancelled: 'Cancelled · 已取消',
};

// Read + validate a ?code=XYZ discount from the URL (QR codes encode
// /membership/?code=XYZ). Returns { code, percent_off } when the server accepts
// it, { invalid: true, code, error } when it rejects it, or null when absent.
export async function urlDiscount() {
  const code = new URLSearchParams(location.search || '').get('code');
  if (!code) return null;
  const { ok, data } = await api('/api/discount', { code });
  if (ok && data.code) return data;
  return { invalid: true, code, error: data.error || 'Invalid discount code.' };
}

// ---------- Checkout (review + account step; card entry is on Stripe) ----------
// opts: { type:'membership', tier, user, member, allTiers, discount } | { type:'donation' }
export function openCheckout(opts) {
  document.querySelector('.caaci-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'caaci-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const isDonation = opts.type === 'donation';
  const loggedIn = !!opts.user;
  // A switch = a signed-in member with an active membership picking a different tier.
  const fromTier = opts.member?.status === 'active' ? opts.member?.tier_id : null;
  const isSwitch = !isDonation && loggedIn && fromTier && fromTier !== opts.tier?.id;
  // For a logged-out membership checkout the account step can either create an
  // account ('signup') or sign in to an existing one ('login').
  let authMode = 'signup';

  // ----- left column: account / amount fields -----
  let mainHTML;
  if (isDonation) {
    mainHTML = `
      <h2>Make a donation <span lang="zh">· 捐款</span></h2>
      <div class="caaci-toggle" role="group" aria-label="Frequency">
        <button type="button" data-freq="once" aria-pressed="true">One-time · 一次</button>
        <button type="button" data-freq="month" aria-pressed="false">Monthly · 每月</button>
      </div>
      <div class="caaci-chips">
        ${[2500, 5000, 10000, 25000]
          .map(
            (c, i) =>
              `<button type="button" class="caaci-chip" data-amt="${c}" aria-pressed="${i === 1}">${usd(c)}</button>`,
          )
          .join('')}
      </div>
      <div class="caaci-field">
        <label for="caaci-amt">Amount (USD) · 金额</label>
        <input id="caaci-amt" type="number" min="1" step="1" value="50" inputmode="decimal">
      </div>
      <div class="caaci-field"><label for="caaci-name">Name · 姓名 <small>(optional)</small></label><input id="caaci-name" type="text" autocomplete="name"></div>
      <div class="caaci-field"><label for="caaci-email">Email · 邮箱 <small>(optional)</small></label><input id="caaci-email" type="email" autocomplete="email"></div>`;
  } else if (isSwitch) {
    const fromName = (opts.allTiers || []).find((t) => t.id === fromTier)?.name || fromTier;
    mainHTML = `
      <h2>Change your plan <span lang="zh">· 更改方案</span></h2>
      <p>Signed in as <b>${esc(opts.user.email)}</b>.</p>
      <p class="caaci-switch-from"><span>${esc(fromName)}</span><span aria-hidden="true">→</span><span>${esc(opts.tier.name)}</span></p>
      <p style="color:var(--caaci-muted);font-size:var(--caaci-fs-sm)">
        We'll update your current subscription right away. Stripe prorates the
        difference for the rest of this billing period; your renewal date stays the same.
        <span lang="zh">将立即更新您当前的订阅，Stripe 会按本计费周期剩余时间计算差额，续费日期不变。</span></p>`;
  } else if (loggedIn) {
    mainHTML = `
      <h2>Confirm your membership <span lang="zh">· 确认会员</span></h2>
      <p>Signed in as <b>${esc(opts.user.email)}</b>.</p>
      <p style="color:var(--caaci-muted);font-size:var(--caaci-fs-sm)">
        Your membership renews automatically each year. You can cancel anytime from your account.
        <span lang="zh">会员资格每年自动续费，可随时在账户中取消。</span></p>`;
  } else {
    mainHTML = `
      <h2 class="caaci-auth-title">Create your account <span lang="zh">· 创建账户</span></h2>
      <div class="caaci-field caaci-auth-name"><label for="caaci-name">Full name · 姓名</label><input id="caaci-name" type="text" autocomplete="name"></div>
      <div class="caaci-field"><label for="caaci-email">Email · 邮箱</label><input id="caaci-email" type="email" autocomplete="email" required></div>
      <div class="caaci-field"><label for="caaci-pwd">Password · 密码 <small>(at least 8 characters · 至少 8 位)</small></label><input id="caaci-pwd" type="password" autocomplete="new-password" minlength="8" required></div>
      <p class="caaci-auth-switch"><span class="caaci-auth-prefix">Already have an account?</span> <a href="#" id="caaci-auth-toggle">Log in · 登录</a></p>`;
  }

  // ----- right column: order summary -----
  const lock = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  overlay.innerHTML = `
    <div class="caaci-checkout">
      <button type="button" class="caaci-checkout-close" aria-label="Close">&times;</button>
      <div class="caaci-checkout-main">${mainHTML}</div>
      <aside class="caaci-summary">
        <span class="caaci-eyebrow">Order summary · 订单</span>
        <h3 class="caaci-summary-title"></h3>
        <div class="caaci-summary-lines"></div>
        <button type="button" class="caaci-btn caaci-pay"></button>
        <p class="caaci-trust">${lock}<span>Secure checkout on Stripe. We never see your card details.<br><span lang="zh">由 Stripe 安全处理，我们不会接触您的卡信息。</span></span></p>
      </aside>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.caaci-checkout-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const titleEl = overlay.querySelector('.caaci-summary-title');
  const linesEl = overlay.querySelector('.caaci-summary-lines');
  const payEl = overlay.querySelector('.caaci-pay');
  const mainEl = overlay.querySelector('.caaci-checkout-main');

  // ----- logged-out membership: OAuth + sign-up / log-in toggle -----
  if (!isDonation && !loggedIn) {
    // Google / Microsoft — return to this page (not /account/) so the visitor
    // can carry on with checkout after authenticating.
    mainEl.appendChild(oauthButtons(location.href));
    const titleH2 = overlay.querySelector('.caaci-auth-title');
    const nameField = overlay.querySelector('.caaci-auth-name');
    const pwd = overlay.querySelector('#caaci-pwd');
    const prefix = overlay.querySelector('.caaci-auth-prefix');
    const toggle = overlay.querySelector('#caaci-auth-toggle');
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      authMode = authMode === 'signup' ? 'login' : 'signup';
      const signup = authMode === 'signup';
      titleH2.innerHTML = signup
        ? 'Create your account <span lang="zh">· 创建账户</span>'
        : 'Log in <span lang="zh">· 登录</span>';
      nameField.style.display = signup ? '' : 'none';
      pwd.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      prefix.textContent = signup ? 'Already have an account?' : 'Need an account?';
      toggle.textContent = signup ? 'Log in · 登录' : 'Create one · 注册';
    });
  }

  // ----- donation: live amount state -----
  if (isDonation) {
    let freq = 'once';
    const amtInput = overlay.querySelector('#caaci-amt');
    const refresh = () => {
      const cents = Math.round(parseFloat(amtInput.value || '0') * 100);
      titleEl.textContent =
        freq === 'month' ? 'Monthly donation · 每月捐款' : 'One-time donation · 一次性捐款';
      linesEl.innerHTML = `<div class="caaci-line caaci-line--total"><span>Total · 合计</span><span>${usd(cents || 0)}${freq === 'month' ? '/mo' : ''}</span></div>`;
      payEl.textContent = cents ? `Donate ${usd(cents)} · 捐赠` : 'Donate · 捐赠';
    };
    overlay.querySelectorAll('.caaci-chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        overlay
          .querySelectorAll('.caaci-chip')
          .forEach((c) => c.setAttribute('aria-pressed', 'false'));
        chip.setAttribute('aria-pressed', 'true');
        amtInput.value = (parseInt(chip.dataset.amt, 10) / 100).toString();
        refresh();
      }),
    );
    overlay.querySelectorAll('[data-freq]').forEach((btn) =>
      btn.addEventListener('click', () => {
        overlay
          .querySelectorAll('[data-freq]')
          .forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        freq = btn.dataset.freq;
        refresh();
      }),
    );
    amtInput.addEventListener('input', () => {
      overlay
        .querySelectorAll('.caaci-chip')
        .forEach((c) => c.setAttribute('aria-pressed', 'false'));
      refresh();
    });
    refresh();

    payEl.addEventListener('click', async () => {
      const cents = Math.round(parseFloat(amtInput.value || '0') * 100);
      if (!cents || cents < 100)
        return notice(mainEl, 'Minimum donation is $1. · 最低 $1。', false);
      payEl.disabled = true;
      payEl.textContent = 'Redirecting… · 跳转中…';
      const { data: r } = await api('/api/checkout', {
        type: 'donation',
        amount_cents: cents,
        recurring: freq === 'month',
        name: (overlay.querySelector('#caaci-name') || {}).value || '',
        email: (overlay.querySelector('#caaci-email') || {}).value || '',
      });
      if (r.url) location.href = r.url;
      else {
        payEl.disabled = false;
        refresh();
        notice(mainEl, r.error || 'Could not start donation.', false);
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  // ----- membership: order summary (re-rendered when a discount is applied) -----
  const tier = opts.tier;
  // Discounts apply to a fresh checkout only — an in-place plan switch is
  // prorated by Stripe on the existing subscription, so no coupon is involved.
  let discount = !isSwitch && opts.discount?.percent_off ? opts.discount : null;
  const renderSummary = () => {
    const total = withFee(tier.price_cents);
    const fee = total - tier.price_cents;
    // Stripe applies percent_off to the invoice subtotal (= our fee-inclusive
    // unit_amount), so mirror that math here.
    const off = discount ? Math.round((total * discount.percent_off) / 100) : 0;
    titleEl.textContent = tier.name;
    linesEl.innerHTML = `
      <div class="caaci-line"><span>${esc(tier.name)} · billed yearly</span><span>${usd(tier.price_cents)}</span></div>
      <div class="caaci-line"><span>Card processing fee (3.5%)</span><span>${usd(fee)}</span></div>
      ${
        discount
          ? `<div class="caaci-line caaci-line--discount"><span>Discount ${esc(discount.code)} (−${discount.percent_off}%)</span><span>−${usd(off)}</span></div>`
          : ''
      }
      <div class="caaci-line caaci-line--total"><span>${isSwitch ? 'New rate · 新费率' : 'Total today · 今日合计'}</span><span>${usd(total - off)}${discount ? '' : '/yr'}</span></div>
      ${isSwitch ? `<p class="caaci-note">Prorated difference is charged today. · 今日按差额计费。</p>` : ''}
      ${discount ? `<p class="caaci-note">Discount applies to your first year; renews at ${usd(total)}/yr. · 折扣仅限首年，续费 ${usd(total)}/年。</p>` : ''}`;
  };
  renderSummary();
  const payLabel = isSwitch ? 'Confirm change · 确认更改' : 'Continue to payment · 前往支付';
  payEl.textContent = payLabel;

  // ----- discount code entry (fresh checkouts only) -----
  if (!isSwitch) {
    const dWrap = document.createElement('div');
    dWrap.className = 'caaci-discount';
    dWrap.innerHTML = `
      <label for="caaci-code">Discount code <span lang="zh">· 折扣码</span></label>
      <div class="caaci-discount-row">
        <input id="caaci-code" type="text" autocomplete="off" spellcheck="false" value="${discount ? esc(discount.code) : ''}">
        <button type="button" class="caaci-discount-apply">Apply · 使用</button>
      </div>
      <p class="caaci-discount-msg" hidden></p>`;
    payEl.parentNode.insertBefore(dWrap, payEl);
    const codeInput = dWrap.querySelector('#caaci-code');
    const msgEl = dWrap.querySelector('.caaci-discount-msg');
    const showMsg = (text, good) => {
      msgEl.hidden = false;
      msgEl.textContent = text;
      if (good) msgEl.removeAttribute('data-state');
      else msgEl.setAttribute('data-state', 'error');
    };
    if (discount)
      showMsg(
        `${discount.code} — ${discount.percent_off}% off · 已减 ${discount.percent_off}%`,
        true,
      );
    dWrap.querySelector('.caaci-discount-apply').addEventListener('click', async () => {
      const code = codeInput.value.trim();
      if (!code) {
        discount = null;
        msgEl.hidden = true;
        renderSummary();
        return;
      }
      const { ok, data } = await api('/api/discount', { code });
      if (ok && data.code) {
        discount = data;
        showMsg(`${data.code} — ${data.percent_off}% off · 已减 ${data.percent_off}%`, true);
      } else {
        discount = null;
        showMsg(data.error || 'Invalid discount code. · 折扣码无效。', false);
      }
      renderSummary();
    });
  }

  payEl.addEventListener('click', async () => {
    // Switch path: update the existing subscription in place — no redirect.
    if (isSwitch) {
      payEl.disabled = true;
      payEl.textContent = 'Updating… · 更新中…';
      const { data: r } = await api('/api/change-plan', {
        member_id: opts.user.id,
        tier_id: tier.id,
      });
      if (r.url) {
        location.href = r.url; // fell back to a fresh Checkout
        return;
      }
      if (r.ok) {
        notice(mainEl, 'Your plan has been updated. · 方案已更新。', true);
        setTimeout(() => location.reload(), 1200);
        return;
      }
      payEl.disabled = false;
      payEl.textContent = payLabel;
      return notice(mainEl, r.error || 'Could not change your plan.', false);
    }

    let email = opts.user?.email;
    let memberId = opts.user?.id;
    if (!loggedIn) {
      email = (overlay.querySelector('#caaci-email') || {}).value?.trim();
      const password = (overlay.querySelector('#caaci-pwd') || {}).value;
      if (!email) return notice(mainEl, 'Email is required. · 请填写邮箱。', false);
      if (authMode === 'login') {
        // Sign in to an existing account, then carry on to checkout.
        if (!password) return notice(mainEl, 'Enter your password. · 请输入密码。', false);
        payEl.disabled = true;
        payEl.textContent = 'Signing in… · 登录中…';
        const { data, error } = await supa.auth.signInWithPassword({ email, password });
        if (error) {
          payEl.disabled = false;
          payEl.textContent = payLabel;
          return notice(mainEl, error.message, false);
        }
        memberId = data.user?.id;
      } else {
        const full_name = (overlay.querySelector('#caaci-name') || {}).value || '';
        // A real password is required — the old silent random-UUID fallback left
        // people with an account they could never sign back into.
        if (!password || password.length < 8)
          return notice(mainEl, 'Password must be at least 8 characters. · 密码至少 8 位。', false);
        payEl.disabled = true;
        payEl.textContent = 'Creating account…';
        const { data, error } = await supa.auth.signUp({
          email,
          password,
          options: { data: { full_name }, emailRedirectTo: location.origin + '/account/' },
        });
        if (error) {
          payEl.disabled = false;
          payEl.textContent = payLabel;
          return notice(mainEl, error.message, false);
        }
        // Supabase obfuscates an already-registered email: signUp "succeeds" but
        // returns a user with no identities. Continuing would start a checkout
        // for a member row that doesn't exist — paid but never activated.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          payEl.disabled = false;
          payEl.textContent = payLabel;
          return notice(
            mainEl,
            'This email already has an account — please log in. · 该邮箱已注册，请登录。',
            false,
          );
        }
        memberId = data.user?.id;
      }
    }
    payEl.disabled = true;
    payEl.textContent = 'Redirecting… · 跳转中…';
    const { data: r } = await api('/api/checkout', {
      type: 'membership',
      tier_id: tier.id,
      email,
      member_id: memberId,
      ...(discount ? { discount_code: discount.code } : {}),
    });
    if (r.url) location.href = r.url;
    else {
      payEl.disabled = false;
      payEl.textContent = payLabel;
      notice(mainEl, r.error || 'Checkout failed.', false);
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

// ---------- OAuth (Google / Microsoft) ----------
// redirectTo lets callers come back where they started (e.g. the checkout on
// /membership/) instead of always landing on /account/.
export async function oauth(provider, redirectTo) {
  if (!supa) return;
  const { error } = await supa.auth.signInWithOAuth({
    provider, // 'google' | 'azure' (Microsoft)
    options: { redirectTo: redirectTo || location.origin + '/account/' },
  });
  if (error) alert(error.message);
}

export function oauthButtons(redirectTo) {
  const wrap = document.createElement('div');
  wrap.className = 'caaci-oauth';
  const btn = (p, label, svg) =>
    `<button type="button" class="caaci-oauth-btn" data-p="${p}">${svg}<span>${label}</span></button>`;
  const gSvg = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.3 13.3 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.7 2.1-6.4 0-11.7-3.8-13.5-9.4l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>`;
  const mSvg = `<svg width="18" height="18" viewBox="0 0 23 23"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>`;
  wrap.innerHTML =
    `<div class="caaci-oauth-sep">— or continue with —</div>` +
    btn('google', 'Continue with Google', gSvg) +
    btn('azure', 'Continue with Microsoft', mSvg);
  wrap
    .querySelectorAll('button')
    .forEach((b) => b.addEventListener('click', () => oauth(b.dataset.p, redirectTo)));
  return wrap;
}

// ---------- Login (MemberPress form: #mepr_loginform, fields log/pwd) + OAuth ----------
export function wireLogin() {
  if (!supa || !/login/.test(location.pathname)) return;
  const form = $('#mepr_loginform') || $('form:not(.et-search-form)');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (form.querySelector('[name=log]') || {}).value?.trim();
      const password = (form.querySelector('[name=pwd]') || {}).value;
      if (!email || !password) return notice(form, 'Enter your email and password.', false);
      const { data, error } = await supa.auth.signInWithPassword({ email, password });
      if (error) return notice(form, error.message, false);
      // Admins land in the back-office; everyone else on their account page.
      // Same is_admin check the /admin/ gate uses (RLS lets a user read their own row).
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
  }
  // inject the OAuth buttons once, right after the login form (or into the main area)
  if (!document.querySelector('.caaci-oauth')) {
    const anchor = form || $('.et_pb_section') || $('main') || document.body;
    if (form) form.parentNode.insertBefore(oauthButtons(), form.nextSibling);
    else anchor.prepend(oauthButtons());
  }
  // Forgot-password + create-account links, then the (initially hidden) signup card.
  if (form && !document.querySelector('.caaci-auth-links')) {
    const links = document.createElement('p');
    links.className = 'caaci-auth-links';
    links.innerHTML =
      `<a href="#" id="caaci-forgot">Forgot your password? · 忘记密码</a>` +
      `<span aria-hidden="true"> · </span>` +
      `<a href="#" id="caaci-show-signup">New here? Create an account · 注册新账户</a>`;
    form.parentNode.insertBefore(links, form.nextSibling);

    links.querySelector('#caaci-forgot').addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (form.querySelector('[name=log]') || {}).value?.trim();
      if (!email)
        return notice(form, 'Enter your email above first. · 请先在上方填写邮箱。', false);
      const { error } = await supa.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/account/?recovery=1',
      });
      if (error) return notice(form, error.message, false);
      notice(
        form,
        'Password reset email sent — check your inbox. · 重置密码邮件已发送，请查收。',
        true,
      );
    });

    links.querySelector('#caaci-show-signup').addEventListener('click', (e) => {
      e.preventDefault();
      let card = document.querySelector('.caaci-signup-card');
      if (card) {
        card.hidden = !card.hidden;
        return;
      }
      card = signupCard();
      links.parentNode.insertBefore(card, links.nextSibling);
    });
  }
}

// ---------- Registration (full signup form, shown from the login page) ----------
export function signupCard() {
  const card = document.createElement('div');
  card.className = 'caaci-card caaci-signup-card';
  card.innerHTML = `
    <span class="caaci-eyebrow">New member · 新用户</span>
    <h2>Create your account <span lang="zh">· 创建账户</span></h2>
    <div class="caaci-field"><label for="caaci-su-name">Full name · 姓名</label><input id="caaci-su-name" type="text" autocomplete="name"></div>
    <div class="caaci-field"><label for="caaci-su-email">Email · 邮箱 *</label><input id="caaci-su-email" type="email" autocomplete="email" required></div>
    <div class="caaci-field"><label for="caaci-su-phone">Phone · 电话 <small>(optional)</small></label><input id="caaci-su-phone" type="tel" autocomplete="tel"></div>
    <div class="caaci-field"><label for="caaci-su-pwd">Password · 密码 <small>(at least 8 characters · 至少 8 位)</small></label><input id="caaci-su-pwd" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="caaci-field"><label for="caaci-su-pwd2">Confirm password · 确认密码</label><input id="caaci-su-pwd2" type="password" autocomplete="new-password" required></div>
    <p><button type="button" class="caaci-btn" id="caaci-su-submit">Create account · 注册</button></p>
    <p class="caaci-auth-switch">Creating an account is free — pick a plan on the <a href="/membership/">membership page</a> when you're ready. <span lang="zh">注册免费，随后可在会员页面选择方案。</span></p>`;

  card.querySelector('#caaci-su-submit').addEventListener('click', async () => {
    const v = (id) => (card.querySelector(id) || {}).value || '';
    const email = v('#caaci-su-email').trim();
    const password = v('#caaci-su-pwd');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return notice(card, 'Enter a valid email address. · 请填写有效邮箱。', false);
    if (password.length < 8)
      return notice(card, 'Password must be at least 8 characters. · 密码至少 8 位。', false);
    if (password !== v('#caaci-su-pwd2'))
      return notice(card, 'Passwords do not match. · 两次输入的密码不一致。', false);
    const btn = card.querySelector('#caaci-su-submit');
    btn.disabled = true;
    const { data, error } = await supa.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: v('#caaci-su-name').trim(), phone: v('#caaci-su-phone').trim() },
        emailRedirectTo: location.origin + '/account/',
      },
    });
    btn.disabled = false;
    if (error) return notice(card, error.message, false);
    // Supabase obfuscates an existing email: a "successful" signUp with no
    // identities means the account already exists.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      return notice(
        card,
        'This email already has an account — log in above instead. · 该邮箱已注册，请直接登录。',
        false,
      );
    if (data.session) {
      location.href = '/account/';
      return;
    }
    notice(
      card,
      'Account created! Check your email to confirm it, then log in. · 账户已创建！请查收确认邮件后登录。',
      true,
    );
  });
  return card;
}

// ---------- Account page: subscription card, billing portal, sign out ----------

// Set-new-password card, shown when the visitor arrives from a Supabase
// password-recovery link (the reset email redirects to /account/?recovery=1 and
// the client establishes a session from the URL hash automatically).
export function passwordResetCard() {
  const card = document.createElement('div');
  card.className = 'caaci-card caaci-reset-card';
  card.innerHTML = `
    <span class="caaci-eyebrow">Password reset · 重置密码</span>
    <h2>Choose a new password <span lang="zh">· 设置新密码</span></h2>
    <div class="caaci-field"><label for="caaci-np">New password · 新密码 <small>(at least 8 characters · 至少 8 位)</small></label><input id="caaci-np" type="password" autocomplete="new-password" minlength="8"></div>
    <div class="caaci-field"><label for="caaci-np2">Confirm password · 确认密码</label><input id="caaci-np2" type="password" autocomplete="new-password"></div>
    <p><button type="button" class="caaci-btn" id="caaci-np-save">Save password · 保存密码</button></p>`;
  card.querySelector('#caaci-np-save').addEventListener('click', async () => {
    const pwd = card.querySelector('#caaci-np').value;
    if (pwd.length < 8)
      return notice(card, 'Password must be at least 8 characters. · 密码至少 8 位。', false);
    if (pwd !== card.querySelector('#caaci-np2').value)
      return notice(card, 'Passwords do not match. · 两次输入的密码不一致。', false);
    const btn = card.querySelector('#caaci-np-save');
    btn.disabled = true;
    const { error } = await supa.auth.updateUser({ password: pwd });
    btn.disabled = false;
    if (error) return notice(card, error.message, false);
    notice(card, 'Password updated — you are signed in. · 密码已更新，您已登录。', true);
  });
  return card;
}

export async function wireAccount() {
  if (!/account/.test(location.pathname) || !supa) return;
  const {
    data: { user },
  } = await supa.auth.getUser();
  const host = $('.et_pb_section') || $('main') || document.body;
  const box = document.createElement('div');
  box.className = 'caaci-card';
  if (!user) {
    box.innerHTML = `<p>You are not logged in. <a href="/login-3/">Log in</a>. <span lang="zh">请<a href="/login-3/">登录</a>。</span></p>`;
    host.prepend(box);
    return;
  }

  // The mirrored /account/ page was snapshotted while logged out, so it still
  // carries MemberPress's "unauthorized" notice + login form. Strip that
  // leftover markup now that we know the visitor is authenticated, otherwise a
  // dead login form lingers below our account card.
  document
    .querySelectorAll('.mepr-unauthorized-excerpt, .mepr-login-form-wrap, #mepr_loginform')
    .forEach((el) => el.remove());

  // Arrived from a password-recovery email → offer the new-password form first.
  const recovery =
    /type=recovery/.test(location.hash || '') || /[?&]recovery=/.test(location.search || '');
  if (recovery) host.prepend(passwordResetCard());

  const [tiers, mres] = await Promise.all([
    loadTiers(),
    supa.from('members').select('*').eq('id', user.id).maybeSingle(),
  ]);
  const m = mres?.data;
  const tier = tiers.find((t) => t.id === m?.tier_id);
  const statusTxt = STATUS_LABEL[m?.status] || m?.status || '';

  const subscription = m?.tier_id
    ? `
      <div class="caaci-subscription">
        <div class="caaci-sub-row"><span>Plan · 方案</span><b>${esc(tier?.name || m.tier_id)}${tier?.name_zh ? ` <span lang="zh">${esc(tier.name_zh)}</span>` : ''}</b></div>
        <div class="caaci-sub-row"><span>Status · 状态</span><span class="caaci-badge" data-state="${esc(m.status || '')}">${esc(statusTxt)}</span></div>
        ${tier ? `<div class="caaci-sub-row"><span>Price · 价格</span><span>${usd(withFee(tier.price_cents))}/yr <small>(incl. 3.5% card fee)</small></span></div>` : ''}
        ${m.expires_at ? `<div class="caaci-sub-row"><span>${m.status === 'active' ? 'Renews · 续费日' : 'Expires · 到期日'}</span><span>${new Date(m.expires_at).toLocaleDateString()}</span></div>` : ''}
        ${m.status === 'past_due' ? `<p class="caaci-notice" data-state="error">Your last payment failed — update your card in "Manage billing". · 上次扣款失败，请在“管理账单”中更新银行卡。</p>` : ''}
      </div>
      <p class="caaci-account-actions">
        <a class="caaci-btn caaci-btn--secondary" href="/membership/">Change plan · 更改方案</a>
        <button type="button" class="caaci-btn caaci-btn--secondary" id="caaci-billing">Manage billing · 管理账单</button>
      </p>
      <p class="caaci-muted-text" style="font-size:13px">"Manage billing" opens Stripe to update your card, view invoices, or cancel. <span lang="zh">“管理账单”将打开 Stripe，可更新银行卡、查看账单或取消订阅。</span></p>`
    : `
      <div class="caaci-subscription">
        <p>No membership yet. · 尚未加入会员。</p>
      </div>
      <p class="caaci-account-actions"><a class="caaci-btn" href="/membership/">Join a membership · 加入会员</a></p>`;

  box.innerHTML = `
    <span class="caaci-eyebrow">Membership · 会员</span>
    <h2>My Account <span lang="zh">· 我的账户</span></h2>
    ${m?.full_name ? `<p><b>Name · 姓名:</b> ${esc(m.full_name)}</p>` : ''}
    <p><b>Email · 邮箱:</b> ${esc(user.email)}</p>
    ${subscription}
    <p style="margin-top:20px"><a href="#" id="caaci-logout">Sign out · 退出登录</a></p>`;
  host.prepend(box);

  $('#caaci-billing')?.addEventListener('click', async () => {
    const btn = $('#caaci-billing');
    btn.disabled = true;
    const { data: { session } = { session: null } } = (await supa.auth.getSession?.()) || {};
    const { data: r } = await api(
      '/api/portal',
      {},
      session ? { authorization: `Bearer ${session.access_token}` } : {},
    );
    if (r.url) {
      location.href = r.url;
      return;
    }
    btn.disabled = false;
    notice(box, r.error || 'Could not open the billing portal. · 无法打开账单管理。', false);
  });

  $('#caaci-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await supa.auth.signOut();
    location.href = '/';
  });
}

// Map a register-page pathname (e.g. "/individual-membership/") to a tier slug.
export function tierFromSlug(pathname) {
  return TIER_BY_SLUG[pathname.replace(/\/+$/, '').split('/').pop()];
}

// ---------- Membership plan view (login-aware) on /membership/ ----------
export async function wirePlans() {
  if (!/\/membership\/?$/.test(location.pathname) || !supa) return;
  if (document.querySelector('.caaci-plans')) return;
  const host = $('main') || $('.et_pb_section') || document.body;

  const [tiers, { user, member }, discount] = await Promise.all([
    loadTiers(),
    currentMember(),
    urlDiscount(),
  ]);
  const currentTier = member?.status && member.status !== 'cancelled' ? member.tier_id : null;

  const section = document.createElement('section');
  section.className = 'caaci-plans';

  const youBanner = user
    ? `<div class="caaci-plans-you">Signed in as <b>${esc(user.email)}</b>${
        currentTier
          ? ` — your plan: <b>${esc(tiers.find((t) => t.id === currentTier)?.name || currentTier)}</b> (${STATUS_LABEL[member.status] || esc(member.status)})`
          : ''
      }. <a href="/account/">My account</a></div>`
    : `<div class="caaci-plans-you">Already a member? <a href="/login-3/">Log in</a> to manage or renew your plan.</div>`;

  // A scanned QR / shared link lands here as /membership/?code=XYZ — surface
  // whether the code is good before the visitor even opens a checkout.
  const discountBanner = !discount
    ? ''
    : discount.invalid
      ? `<div class="caaci-plans-you caaci-plans-discount" data-state="error">Discount code <b>${esc(discount.code)}</b>: ${esc(discount.error)} <span lang="zh">折扣码无效。</span></div>`
      : `<div class="caaci-plans-you caaci-plans-discount">Discount code <b>${esc(discount.code)}</b> applied — ${discount.percent_off}% off your first year. <span lang="zh">折扣码已应用，首年减 ${discount.percent_off}%。</span></div>`;

  section.innerHTML = `
    <div class="caaci-plans-head">
      <span class="caaci-eyebrow">Membership · 会员</span>
      <h2>Choose your plan</h2>
      <p>Annual membership supports CAACI's programs. Prices include the 3.5% card fee. · 价格已含 3.5% 卡费。</p>
    </div>
    ${youBanner}
    ${discountBanner}
    <div class="caaci-plans-grid"></div>`;

  const grid = section.querySelector('.caaci-plans-grid');
  for (const t of tiers) {
    const total = withFee(t.price_cents);
    const isCurrent = t.id === currentTier;
    const card = document.createElement('div');
    card.className = 'caaci-plan';
    if (t.featured && !isCurrent) card.setAttribute('data-featured', '');
    if (isCurrent) card.setAttribute('data-current', '');

    const badge = isCurrent
      ? `<span class="caaci-badge caaci-badge--current">Current plan · 当前</span>`
      : t.featured
        ? `<span class="caaci-badge">${t.highlight || 'Most popular'}</span>`
        : '';

    const status = isCurrent
      ? `<p class="caaci-plan-status"${member.status !== 'active' ? ` data-state="${esc(member.status)}"` : ''}>${
          STATUS_LABEL[member.status] || esc(member.status)
        }${member.expires_at ? ` · until ${new Date(member.expires_at).toLocaleDateString()}` : ''}</p>`
      : '';

    let cta;
    if (isCurrent)
      cta = `<a class="caaci-btn caaci-btn--secondary" href="/account/">Manage · 管理</a>`;
    else
      cta = `<button type="button" class="caaci-btn caaci-plan-cta" data-tier="${t.id}">${
        currentTier ? 'Switch to this · 切换' : 'Join · 加入'
      }</button>`;

    card.innerHTML = `
      ${badge}
      <h3 class="caaci-plan-name">${esc(t.name)}${
        t.name_zh ? ` <span lang="zh" style="font-weight:400">${esc(t.name_zh)}</span>` : ''
      }</h3>
      <div class="caaci-plan-price">${usd(total)} <small>/ year</small></div>
      <div class="caaci-plan-fee">Base ${usd(t.price_cents)} + 3.5% card fee</div>
      ${status}
      <p class="caaci-plan-desc">${esc(t.description || '')}</p>
      ${cta}`;
    grid.appendChild(card);
  }

  section.querySelectorAll('.caaci-plan-cta').forEach((btn) =>
    btn.addEventListener('click', () => {
      const tier = tiers.find((t) => t.id === btn.dataset.tier);
      if (tier)
        openCheckout({
          type: 'membership',
          tier,
          user,
          member,
          allTiers: tiers,
          discount: discount && !discount.invalid ? discount : null,
        });
    }),
  );

  host.prepend(section);
}

// ---------- Register pages -> open the checkout overlay for that tier ----------
export async function wireRegister() {
  const tierId = tierFromSlug(location.pathname);
  if (!tierId || !supa) return;
  const [tiers, { user, member }, discount] = await Promise.all([
    loadTiers(),
    currentMember(),
    urlDiscount(),
  ]);
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) return;

  // Replace the clunky MemberPress form's submit with our checkout overlay, and
  // surface an explicit button so the flow works even if the form isn't found.
  const open = () =>
    openCheckout({
      type: 'membership',
      tier,
      user,
      member,
      allTiers: tiers,
      discount: discount && !discount.invalid ? discount : null,
    });
  const form = $('form[id*=mepr], form.mepr-form, form:not(.et-search-form)');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      open();
    });
    if (!form.querySelector('.caaci-register-cta')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'caaci-btn caaci-register-cta';
      btn.style.marginBottom = '18px';
      btn.textContent = `Join — ${usd(withFee(tier.price_cents))}/yr · 加入`;
      btn.addEventListener('click', open);
      form.parentNode.insertBefore(btn, form);
    }
  } else {
    open();
  }
}

// ---------- Donate page -> open the checkout overlay (donation mode) ----------
export function wireDonate() {
  if (!/donate/.test(location.pathname)) return;
  const btn = [...document.querySelectorAll('a,button')].find((b) =>
    /donat|give/i.test(b.textContent),
  );
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openCheckout({ type: 'donation' });
  });
}

// ---------- Divi contact form -> /api/contact ----------
export function wireContact() {
  const form = $('.et_pb_contact_form') || document.querySelector('form[class*=contact]');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (sel) => (form.querySelector(sel) || {}).value || '';
    const { ok, data } = await api('/api/contact', {
      name: v('[name*=name]'),
      email: v('[name*=email]'),
      phone: v('[name*=phone]'),
      message: v('[name*=message],textarea'),
    });
    notice(
      form,
      ok ? 'Thank you! Your message has been sent.' : data.error || 'Could not send.',
      ok,
    );
    if (ok) form.reset();
  });
}

// ---------- Bootstrap ----------
// Creates the Supabase client from the self-hosted UMD bundle, then runs every
// wiring fn. Each is feature-detected + isolated so a missing form just no-ops.
export async function init() {
  const cfg = (typeof window !== 'undefined' && window.CAACI_CONFIG) || {};
  if (!supa && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
    // The Supabase client comes from assets/supabase.js (a self-hosted UMD bundle
    // loaded as a classic <script> before this module), exposing window.supabase.
    // Serving it from our own origin removes the runtime dependency on third-party
    // CDNs like esm.sh, which are blocked/slow on some networks (e.g. China) and
    // previously left login/account/checkout silently doing nothing. Wrapped so a
    // missing client doesn't block the forms that don't need it (contact, donate).
    try {
      const sb = typeof window !== 'undefined' ? window.supabase : null;
      if (!sb || !sb.createClient) throw new Error('window.supabase not loaded');
      supa = sb.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (err) {
      console.warn('caaci-app: Supabase client unavailable —', err);
    }
  }
  for (const fn of [wireLogin, wireAccount, wirePlans, wireRegister, wireDonate, wireContact]) {
    try {
      // Some wiring fns are async (they fetch tiers/member state); isolate their
      // rejections too so one failing page never blocks the others.
      Promise.resolve(fn()).catch((err) => console.warn('caaci-app:', err));
    } catch (err) {
      console.warn('caaci-app:', err);
    }
  }
}

// Auto-run in the browser; skipped under test (window.__CAACI_TEST__) and in Node.
if (typeof window !== 'undefined' && !window.__CAACI_TEST__) init();
