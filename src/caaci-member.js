// caaci-member.js — the standalone member-facing pages (Tabler UI, like /admin/):
//   /login-3/     sign in · create account · forgot password  (data-page="login")
//   /membership/  plan grid · discount codes · checkout       (data-page="membership")
//   /account/     subscription · billing · card · history     (data-page="account")
//   /mid_autumn_festival_form/  public event registration  (data-page="event-form")
// These pages replace the old mirror-enhancement flow (caaci-app.js) on their
// routes; the behavioral contracts are identical — same API bodies, the same
// 3.5% fee math, the same duplicate-email guard — only the markup is Tabler.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js).
import { esc, usd, withFee, statusLabel, mergeTiers, isFreeTier } from './caaci-shared.js';

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
export function __setLang(l) {
  lang = l;
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
  // Site-nav links point at the /zh/ mirror copies when Chinese is active.
  for (const a of $$('[data-zh-href]')) {
    if (!a.dataset.enHref) a.dataset.enHref = a.getAttribute('href');
    a.setAttribute('href', lang === 'zh' ? a.getAttribute('data-zh-href') : a.dataset.enHref);
  }
  const tgl = $('#caaci-lang');
  if (tgl) tgl.textContent = lang === 'en' ? '中文' : 'EN';
}
const t = (en, zh) => (lang === 'zh' ? zh : en);
// A tier's name/description/highlight in the current language (English fallback).
const tierText = (tier, key) => (lang === 'zh' && tier[`${key}_zh`]) || tier[key] || '';

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

// Put a submit button into a busy state for the duration of a request and
// return the undo. Disabling blocks the double-submit; the label change is what
// tells the user something is actually happening.
function busy(btn, label) {
  if (!btn) return () => {};
  const prev = btn.textContent;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (label) btn.textContent = label;
  return () => {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = prev;
  };
}

// Feedback line — a Tabler alert, green for success, red for errors.
function notice(el, msg, good = true) {
  el.hidden = false;
  el.textContent = msg;
  el.classList.remove('alert-success', 'alert-danger');
  el.classList.add('alert', good ? 'alert-success' : 'alert-danger');
}

// ---------- "send email" buttons: one shared cooldown ----------
// Supabase refuses another auth email to the same address inside the project's
// resend interval (60 s). Every button that sends one counts down instead of
// letting the member click into that error, and the end time is kept per
// action + address in localStorage so a reload does not reset the clock.
const EMAIL_COOLDOWN_S = 60;
const cooldownKey = (action, email) =>
  `caaci-cooldown:${action}:${String(email || '')
    .trim()
    .toLowerCase()}`;
const cooldownTimers = new WeakMap();

// Stop a button's countdown without touching its label or the stored end time.
function stopCooldown(btn) {
  clearInterval(cooldownTimers.get(btn));
  cooldownTimers.delete(btn);
}

// Keep `btn` tied to the address currently typed: resume the countdown stored
// for it (from this page or an earlier one), or free the button as `idleLabel`.
function followCooldown(btn, { action, email, label, idleLabel }) {
  if (btn.getAttribute('aria-busy')) return;
  if (!cooldown(btn, { action, email, label })) btn.textContent = idleLabel;
}

function storedCooldownEnd(action, email) {
  try {
    const end = Number(localStorage.getItem(cooldownKey(action, email)));
    return end > Date.now() ? end : 0;
  } catch {
    return 0;
  }
}

// Count `btn` down from `seconds`, or — with no seconds — resume a countdown a
// previous page left for this action + address. `label` is what the button
// says once it is usable again. Returns whether the button is cooling down.
function cooldown(btn, { action, email, seconds, label }) {
  const key = cooldownKey(action, email);
  let end = storedCooldownEnd(action, email);
  if (seconds > 0) {
    end = Date.now() + seconds * 1000;
    try {
      localStorage.setItem(key, String(end));
    } catch {
      /* storage blocked — the countdown still runs for this page */
    }
  }
  stopCooldown(btn);
  if (!end) {
    btn.disabled = false;
    return false;
  }
  // The button is gone (the checkout modal closed mid-request): the stored end
  // time lets a reopened modal resume, but no timer should tick for nobody.
  if (!btn.isConnected) return true;
  const render = () => {
    const left = Math.ceil((end - Date.now()) / 1000);
    if (left > 0) {
      btn.disabled = true;
      btn.textContent = t(`Resend in ${left}s`, `${left} 秒后可重新发送`);
      return;
    }
    stopCooldown(btn);
    btn.disabled = false;
    btn.textContent = label;
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  };
  cooldownTimers.set(btn, setInterval(render, 1000));
  render();
  return true;
}

// How long Supabase wants us to wait before another email, or 0 when the error
// is not a rate limit. GoTrue's message usually reads "…after N seconds"; that
// wording is not a contract, so a bare rate-limit error falls back to 60 s.
function emailRetryAfter(error) {
  if (!error) return 0;
  const m = /after (\d+) seconds?/i.exec(error.message || '');
  if (m) return Number(m[1]);
  return error.code === 'over_email_send_rate_limit' || error.status === 429 ? EMAIL_COOLDOWN_S : 0;
}

// One "send email" request on `btn`: busy while in flight, a notice with the
// outcome, then the cooldown (Supabase's own wait when it rate-limited us).
async function sendEmail(btn, note, { action, email, send, sent, label }) {
  const done = busy(btn, t('Sending…', '发送中…'));
  let error;
  try {
    ({ error } = await send());
  } catch (e) {
    error = { message: e?.message || t('Network error — please try again.', '网络错误，请重试。') };
  }
  done();
  if (error) {
    notice(note, error.message, false);
    const wait = emailRetryAfter(error);
    if (wait) cooldown(btn, { action, email, seconds: wait, label });
    return false;
  }
  notice(note, sent, true);
  cooldown(btn, { action, email, seconds: EMAIL_COOLDOWN_S, label });
  return true;
}

// The password-reset email. Its link lands on /account/?recovery=1, which is
// what makes the account page render the set-new-password form.
const sendResetLink = (btn, note, email, label) =>
  sendEmail(btn, note, {
    action: 'recovery',
    email,
    label,
    send: () =>
      supa.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + '/account/?recovery=1',
      }),
    sent: t('Password reset email sent — check your inbox.', '重置密码邮件已发送，请查收。'),
  });

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
    options: {
      redirectTo: redirectTo || location.origin + '/account/',
      // See the same note in caaci-app.js: Microsoft's bare `openid` scope does
      // not guarantee the email/name claims GoTrue and handle_new_user need.
      ...(provider === 'azure' ? { scopes: 'openid email profile' } : {}),
    },
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

// ---------- shared navbar (member-src/_nav.html, all member pages) ----------
async function wireNav() {
  const auth = $('#caaci-nav-auth');
  if (!auth) return;
  // The nav partial is shared, so the login page also gets the "Log In"
  // button — pointing at the page you are already on. Drop it there.
  if (document.body.dataset.page === 'login') {
    auth.hidden = true;
    return;
  }
  // Mark the current section the way Divi does, so the active page is obvious.
  // Submenu items count too: on /account/ it is the "Account" entry under
  // Membership that matches, and its parent is highlighted alongside it.
  const here = location.pathname.replace(/^\/zh/, '').replace(/\/+$/, '') || '/';
  for (const link of document.querySelectorAll(
    '.caaci-sitenav .nav-link[href], .caaci-sitenav .dropdown-item[href]',
  )) {
    const href = link.getAttribute('href').replace(/\/+$/, '') || '/';
    if (href !== here) continue;
    link.classList.add('active');
    const parent = link.closest('.nav-item.dropdown')?.querySelector(':scope > a.nav-link');
    if (parent) parent.classList.add('active');
  }
  if (!supa) return;
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

// Where to send someone after they sign in. /login-3/?next=/membership/?tier=…
// brings a visitor back to what they were doing (e.g. requesting Honorable
// Membership). Only same-site paths are honoured — anything else would turn
// the login page into an open redirect, and since a signed-in visitor is sent
// on without clicking anything, a link alone would do it. Compare the resolved
// origin rather than string prefixes: URL parsing drops tabs and reads "\" as
// "/", so "/\t/evil.example" and "/\evil.example" both start with a single
// slash yet resolve to https://evil.example/.
function nextPath() {
  const n = new URLSearchParams(location.search || '').get('next');
  if (!n) return null;
  try {
    const u = new URL(n, location.origin);
    return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}

// Admins land in the back-office; everyone else where they came from, or on
// their account page.
async function destinationAfterSignIn(uid, next) {
  if (uid) {
    const { data: me } = await supa.from('members').select('is_admin').eq('id', uid).maybeSingle();
    if (me?.is_admin) return '/admin/';
  }
  return next || '/account/';
}

// ---------- /login-3/ ----------
export async function wireAuthPage() {
  const notb = $('#caaci-login-notice');
  if (!supa) {
    notice(notb, 'Supabase is not configured.', false);
    return;
  }
  const next = nextPath();

  // "Resend confirmation email": the signup card offers it once an account is
  // created, the sign-in card when an unconfirmed account tries to sign in.
  // Both count down on one shared cooldown per address.
  const confirmLabel = t('Resend confirmation email', '重新发送确认邮件');
  const confirmResend = (btn, note) => {
    let email = '';
    btn.addEventListener('click', () =>
      sendEmail(btn, note, {
        action: 'signup',
        email,
        label: confirmLabel,
        send: () =>
          supa.auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: location.origin + (next || '/account/') },
          }),
        sent: t('Confirmation email sent — check your inbox.', '确认邮件已发送，请查收。'),
      }),
    );
    // Show the button for `address`; `justSent` starts a fresh countdown.
    return (address, justSent = false) => {
      email = address;
      btn.hidden = false;
      const seconds = justSent ? EMAIL_COOLDOWN_S : 0;
      if (!cooldown(btn, { action: 'signup', email, seconds, label: confirmLabel }))
        btn.textContent = confirmLabel;
    };
  };
  const loginResend = $('#caaci-li-resend');
  const offerLoginResend = confirmResend(loginResend, notb);
  const offerSignupResend = confirmResend($('#caaci-su-resend'), $('#caaci-signup-notice'));

  $('#caaci-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#caaci-li-email').value.trim();
    const password = $('#caaci-li-pwd').value;
    if (!email || !password)
      return notice(notb, t('Enter your email and password.', '请输入邮箱和密码。'), false);
    // Sign-in is a network round trip with no other visible feedback; without a
    // busy state the button looks inert and users submit again.
    const btn = e.currentTarget.querySelector('button[type=submit]');
    const done = busy(btn, t('Signing in…', '登录中…'));
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) {
      done();
      // An account whose confirmation link was never opened cannot sign in; say
      // so plainly and offer the email again instead of a bare error string.
      if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) {
        notice(
          notb,
          t(
            'Your email address is not confirmed yet. Open the link in the confirmation email we sent you, or send a new one below.',
            '您的邮箱尚未确认。请点击确认邮件中的链接，或在下方重新发送。',
          ),
          false,
        );
        return offerLoginResend(email);
      }
      loginResend.hidden = true;
      return notice(notb, error.message, false);
    }
    // Leave the button busy — the navigation below replaces the page.
    location.href = await destinationAfterSignIn(data?.user?.id, next);
  });

  // Forgot password: an inline form with its own email field. The button keeps
  // any countdown a reset for that address already started (even before a reload).
  const resetEmail = $('#caaci-reset-email');
  const resetSend = $('#caaci-reset-send');
  const resetNote = $('#caaci-reset-notice');
  const resendLabel = t('Resend', '重新发送');
  const resumeReset = () =>
    followCooldown(resetSend, {
      action: 'recovery',
      email: resetEmail.value,
      label: resendLabel,
      idleLabel: t('Send reset link', '发送重置链接'),
    });
  $('#caaci-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    $('#caaci-reset-panel').hidden = false;
    const typed = $('#caaci-li-email').value.trim();
    if (typed) resetEmail.value = typed;
    resumeReset();
    resetEmail.focus({ preventScroll: true });
  });
  resetEmail.addEventListener('input', resumeReset);
  $('#caaci-reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (resetSend.disabled) return; // Enter pressed mid-request or mid-countdown
    const email = resetEmail.value.trim();
    if (!EMAIL_RE.test(email))
      return notice(resetNote, t('Enter a valid email address.', '请填写有效邮箱。'), false);
    await sendResetLink(resetSend, resetNote, email, resendLabel);
  });

  oauthButtons($('#caaci-oauth-host'), location.origin + (next || '/account/'));

  const suToggle = $('#caaci-show-signup');
  suToggle.setAttribute('aria-controls', 'caaci-signup-card');
  suToggle.setAttribute('aria-expanded', 'false');
  const showSignup = (open) => {
    const card = $('#caaci-signup-card');
    card.hidden = !open;
    suToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      card.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      // Move focus into the revealed form; otherwise a keyboard user is left
      // on the toggle and has to tab past the whole sign-in card to reach it.
      $('#caaci-su-name').focus({ preventScroll: true });
    }
  };
  suToggle.addEventListener('click', (e) => {
    e.preventDefault();
    showSignup($('#caaci-signup-card').hidden);
  });
  // An event form's "Create a free account" lands here with ?signup=1 and the
  // address it registered with in sessionStorage (never in the URL, where it
  // would end up in logs and history). Read it once, then drop it.
  try {
    const handedOver = sessionStorage.getItem('caaci-signup-email');
    if (handedOver) $('#caaci-su-email').value = handedOver;
    sessionStorage.removeItem('caaci-signup-email');
  } catch {
    /* storage blocked — the visitor types the address */
  }
  if (new URLSearchParams(location.search || '').get('signup') === '1') showSignup(true);

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
        emailRedirectTo: location.origin + (next || '/account/'),
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
      location.href = next || '/account/';
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
    offerSignupResend(email, true);
  });

  // Already signed in (a bookmark, the back button, a "Log In" link on a page
  // that could not tell): skip the form. This runs only after every handler
  // above is attached, so a slow check never leaves the form without them. It
  // asks Supabase (getUser) instead of trusting the stored session — a revoked
  // one must leave the form usable, not bounce to /account/ and back.
  const { data: { user } = { user: null } } = await withTimeout(supa.auth.getUser(), 3500, {
    data: { user: null },
  });
  if (user) location.href = await destinationAfterSignIn(user.id, next);
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
            ? ` — ${esc(tierText(tierName, 'name'))} · ${esc(statusLabel(member.status, lang))}`
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

  // A paid member with a live plan can't self-downgrade to the free tier from
  // here (Stripe would keep billing them) — they cancel in the billing portal
  // first, so the free card points them there instead of offering a switch.
  const onPaidPlan =
    !!currentTier &&
    member?.status === 'active' &&
    !isFreeTier(tiers.find((x) => x.id === currentTier));

  // Pricing cards
  const row = $('#caaci-plans-row');
  row.removeAttribute('aria-busy'); // clears the placeholder cards' busy state
  row.innerHTML = tiers
    .map((tier) => {
      const isCurrent = tier.id === currentTier;
      const free = isFreeTier(tier);
      const name = tierText(tier, 'name');
      const highlight = tierText(tier, 'highlight');
      const badge = isCurrent
        ? `<span class="badge bg-success-lt">${t('Current plan', '当前方案')}</span>`
        : tier.featured
          ? `<span class="badge bg-primary-lt">${esc(highlight)}</span>`
          : highlight
            ? `<span class="badge bg-secondary-lt">${esc(highlight)}</span>`
            : '';
      // Invitation-only tiers (Honorable) are granted by the Board, not bought:
      // the button asks for an invitation instead of opening checkout, and the
      // price line says "Free" instead of $0 + 3.5%.
      const cta = isCurrent
        ? `<a href="/account/" class="btn w-100">${t('Manage', '管理')}</a>`
        : tier.invite_only
          ? `<div class="text-secondary small mb-2">${t('By invitation of the CAACI Board', '由 CAACI 理事会邀请授予')}</div>
             <button type="button" class="btn w-100" data-invite="${tier.id}">${
               user ? t('Request an invitation', '申请邀请') : t('Log in to request', '登录后申请')
             }</button>`
          : free && onPaidPlan
            ? `<a href="/account/" class="btn w-100">${t('Cancel your paid plan first', '请先取消付费方案')}</a>`
            : `<button type="button" class="btn ${tier.featured ? 'btn-primary' : ''} w-100" data-tier="${tier.id}">${
                free
                  ? t('Join for free', '免费加入')
                  : currentTier
                    ? t('Switch to this', '切换到此方案')
                    : t('Join', '加入')
              }</button>`;
      const priceLine = tier.invite_only
        ? `<div class="display-6 fw-bold my-2">${t('Free', '免费')}</div>
            <div class="text-secondary small mb-2">${t('Invitation only', '仅限邀请')}</div>`
        : free
          ? `<div class="display-6 fw-bold my-2">${t('Free', '免费')}</div>
            <div class="text-secondary small mb-2">${t('No card needed · no festival perks', '无需付款 · 不含节日福利')}</div>`
          : `<div class="display-6 fw-bold my-2">${usd(withFee(tier.price_cents))}</div>
            <div class="text-secondary small mb-2">/ ${t('year', '年')} · ${t('base', '基础价')} ${usd(tier.price_cents)} + 3.5%</div>`;
      return `
      <div class="col-sm-6 col-lg-4">
        <div class="card${tier.featured && !isCurrent ? ' card-active' : ''}${isCurrent ? ' border-success' : ''}">
          <div class="card-body text-center">
            <div class="mb-2">${badge}</div>
            <h3 class="card-title mb-1">${esc(name)}</h3>
            ${priceLine}
            <p class="text-secondary">${esc(tierText(tier, 'description'))}</p>
            ${cta}
          </div>
        </div>
      </div>`;
    })
    .join('');

  // Honorable Membership is granted to an account by the Board, so a visitor
  // has to have one first: send them through login/signup and come straight
  // back here (?tier=honorary), where the request form opens for them.
  const requestInvite = (tier) => {
    if (!user) {
      location.href = `/login-3/?next=${encodeURIComponent(`/membership/?tier=${tier.id}`)}`;
      return;
    }
    openInviteRequest({ tier, user, member });
  };
  const openFor = (tierId) => {
    const tier = tiers.find((x) => x.id === tierId);
    if (!tier) return;
    if (tier.invite_only) return requestInvite(tier); // never the checkout modal
    openCheckout({
      tier,
      user,
      member,
      allTiers: tiers,
      discount: discount && !discount.invalid ? discount : null,
      notb,
    });
  };
  for (const b of row.querySelectorAll('[data-tier], [data-invite]'))
    b.addEventListener('click', () => openFor(b.dataset.tier || b.dataset.invite));

  // /register/<tier>/ redirect stubs land here with ?tier=<id> — open directly.
  const preTier = new URLSearchParams(location.search || '').get('tier');
  if (preTier && preTier !== currentTier) openFor(preTier);
}

// ---------- invitation request (Honorable Membership) ----------
// Nothing is bought or activated here. The request goes through /api/contact,
// so it lands in form_submissions and emails the Board like any other message;
// staff then grant the tier from the admin panel.
export function openInviteRequest({ tier, user, member }) {
  const host = $('#caaci-checkout-host');
  const name = tierText(tier, 'name');
  host.innerHTML = `
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" style="background: rgba(24, 36, 51, 0.45)">
      <div class="modal-dialog modal-dialog-centered" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${t('Request an invitation', '申请邀请')} · ${esc(name)}</h5>
            <button type="button" class="btn-close" data-act="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="text-secondary">${t(
              'Honorable Membership is granted by the CAACI Board for major contributions to the community. Tell us a little about yourself and the Board will follow up.',
              '荣誉会员由 CAACI 理事会授予对社区有重大贡献的人士。请简单介绍一下您自己，理事会会与您联系。',
            )}</p>
            <div class="mb-3">
              <label class="form-label" for="caaci-inv-name">${t('Full name', '姓名')}</label>
              <input type="text" id="caaci-inv-name" class="form-control" autocomplete="name">
            </div>
            <div class="mb-3">
              <label class="form-label" for="caaci-inv-email">${t('Email address', '邮箱地址')}</label>
              <input type="email" id="caaci-inv-email" class="form-control" autocomplete="email">
            </div>
            <div class="mb-3">
              <label class="form-label" for="caaci-inv-msg">${t('Your contributions to the community', '您对社区的贡献')}</label>
              <textarea id="caaci-inv-msg" class="form-control" rows="4"></textarea>
            </div>
            <button type="button" class="btn btn-primary w-100" data-act="send">${t('Send request', '发送申请')}</button>
            <p class="alert mt-3 mb-0" id="caaci-inv-notice" hidden></p>
          </div>
        </div>
      </div>
    </div>`;

  const modal = host.firstElementChild;
  const nameEl = $('#caaci-inv-name', host);
  const emailEl = $('#caaci-inv-email', host);
  const msgEl = $('#caaci-inv-msg', host);
  const note = $('#caaci-inv-notice', host);
  const send = modal.querySelector('[data-act="send"]');
  if (member?.full_name) nameEl.value = member.full_name;
  if (user?.email) emailEl.value = user.email;

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

  send.addEventListener('click', async () => {
    const fullName = nameEl.value.trim();
    const email = emailEl.value.trim();
    const why = msgEl.value.trim();
    if (!fullName || !email || !why)
      return notice(note, t('Please fill in all three fields.', '请填写全部三项。'), false);
    send.disabled = true;
    const { ok, data } = await api('/api/contact', {
      name: fullName,
      email,
      message: `[Honorable Membership request]\n\n${why}`,
    });
    send.disabled = false;
    if (!ok)
      return notice(
        note,
        data.error || t('Could not send. Please try again.', '发送失败，请重试。'),
        false,
      );
    send.hidden = true;
    notice(
      note,
      t('Request sent — the Board will be in touch.', '申请已发送——理事会会与您联系。'),
      true,
    );
  });
}

// ---------- checkout modal (Tabler) ----------
// Same contract as the old overlay: nothing is charged here — card entry
// happens on Stripe. POSTs /api/checkout or /api/change-plan.
export function openCheckout({ tier, user, member, discount, notb, allTiers = [] }) {
  const host = $('#caaci-checkout-host');
  const free = isFreeTier(tier);
  // Free → paid is a first purchase (there is no subscription to re-price), so
  // it takes the fresh-checkout path even though the member is "active".
  const isSwitch = !!(
    user &&
    member?.status === 'active' &&
    member.tier_id &&
    member.tier_id !== tier.id &&
    !isFreeTier(allTiers.find((x) => x.id === member.tier_id))
  );
  const payLabel = free
    ? t('Join for free', '免费加入')
    : isSwitch
      ? t('Confirm change', '确认更改')
      : t('Continue to payment', '前往支付');
  const loggedIn = !!user;
  let authMode = 'signup';
  let applied = discount || null;

  const name = tierText(tier, 'name');
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
    // A forgot-password countdown must not keep ticking once the modal is gone.
    const forgotBtn = $('#caaci-co-forgot', host);
    if (forgotBtn) stopCooldown(forgotBtn);
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
        <label class="form-label" for="caaci-name">${t('Full name', '姓名')}</label>
        <input type="text" id="caaci-name" class="form-control" autocomplete="name">
      </div>
      <div class="mb-3">
        <label class="form-label" for="caaci-email">${t('Email address', '邮箱地址')}</label>
        <input type="email" id="caaci-email" class="form-control" autocomplete="username">
      </div>
      <div class="mb-2">
        <label class="form-label" for="caaci-pwd">${t('Password (at least 8 characters)', '密码（至少 8 位）')}</label>
        <input type="password" id="caaci-pwd" class="form-control" minlength="8" autocomplete="new-password">
      </div>
      <div class="mb-2" id="caaci-co-forgotwrap" hidden>
        <button type="button" class="btn btn-link px-0" id="caaci-co-forgot">${t('Forgot password?', '忘记密码？')}</button>
      </div>
      <p class="text-secondary mb-2">
        <span id="caaci-auth-prompt">${t('Already have an account?', '已有账户？')}</span>
        <a href="#" id="caaci-auth-toggle">${t('Log in instead', '直接登录')}</a>
      </p>
      <div class="hr-text">${t('or continue with', '或使用以下方式')}</div>
      <div class="row g-2 mb-2" id="caaci-co-oauth"></div>`;
    oauthButtons($('#caaci-co-oauth', host), location.href);
    const forgot = $('#caaci-co-forgot', host);
    const emailInput = $('#caaci-email', host);
    const resendResetLabel = t('Resend reset email', '重新发送重置邮件');
    // The countdown belongs to the address typed — including one that a reset
    // from an earlier modal (or page load) left in localStorage.
    const followForgot = () =>
      followCooldown(forgot, {
        action: 'recovery',
        email: emailInput.value,
        label: resendResetLabel,
        idleLabel: t('Forgot password?', '忘记密码？'),
      });
    emailInput.addEventListener('input', followForgot);
    forgot.addEventListener('click', () => {
      if (forgot.disabled) return;
      const email = emailInput.value.trim();
      if (!EMAIL_RE.test(email))
        return notice(
          msg,
          t('Enter a valid email address above first.', '请先在上方填写有效邮箱。'),
          false,
        );
      return sendResetLink(forgot, msg, email, resendResetLabel);
    });
    $('#caaci-auth-toggle', host).addEventListener('click', (e) => {
      e.preventDefault();
      authMode = authMode === 'signup' ? 'login' : 'signup';
      const signup = authMode === 'signup';
      $('#caaci-co-title', host).textContent = signup
        ? t('Create your account', '创建您的账户')
        : t('Log in', '登录');
      $('#caaci-co-namewrap', host).style.display = signup ? '' : 'none';
      $('#caaci-co-forgotwrap', host).hidden = signup;
      if (!signup) followForgot();
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
    if (free) {
      $('#caaci-co-summary', host).innerHTML = `
        <h4 class="mb-3">${esc(name)}</h4>
        <div class="d-flex justify-content-between text-secondary mb-1"><span>${t('Annual membership', '年度会费')}</span><span>${t('Free', '免费')}</span></div>
        <hr class="my-2">
        <div class="d-flex justify-content-between"><b>${t('Total today', '今日合计')}</b><b>${t('Free', '免费')}</b></div>
        <div class="text-secondary small mt-2">${t(
          'No payment needed and nothing expires. Upgrade to a paid plan any time for the annual meeting and festival perks.',
          '无需付款，永不过期。可随时升级为付费会员，享受会员大会和节日福利。',
        )}</div>
        <button type="button" class="btn btn-primary w-100 mt-3" id="caaci-pay">${payLabel}</button>`;
      $('#caaci-pay', host).addEventListener('click', pay);
      return;
    }
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
      <button type="button" class="btn btn-primary w-100 mt-3" id="caaci-pay">${payLabel}</button>
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
      btn.textContent = payLabel;
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
    // Free tier: activated server-side with no Stripe hop — straight to the account.
    if (ok && data.activated) {
      location.href = '/account/';
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
          <label class="form-label" for="caaci-np">${t('New password (at least 8 characters)', '新密码（至少 8 位）')}</label>
          <input type="password" id="caaci-np" class="form-control" minlength="8" autocomplete="new-password">
        </div>
        <div class="mb-3">
          <label class="form-label" for="caaci-np2">${t('Confirm password', '确认密码')}</label>
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
    clearRecoveryMarker();
    host.innerHTML = `<div class="alert alert-success mb-3" role="status">${t('Password updated — you are signed in.', '密码已更新，您已登录。')}</div>`;
  });
}

// Supabase reports a dead email link (otp_expired, access_denied…) or a failed
// OAuth sign-in through error_code / error_description in the hash or query.
function linkFailed() {
  return [location.hash, location.search].some((part) => {
    const p = new URLSearchParams(String(part || '').replace(/^[#?]/, ''));
    return p.has('error_code') || p.has('error_description');
  });
}

// The error text itself is never shown: it comes from the URL, so anyone could
// put words (or markup) there. A reset link gets reset-specific copy. Any other
// dead link — signup confirmation, email change, OAuth — sends a signed-out
// visitor to sign in, and a signed-in member (who can only act on an email
// change from here) to Account security.
function failedLinkCard(host, { recovery, signedIn }) {
  const link = (href, label) => `<a href="${href}">${label}</a>`;
  let title = t('This link no longer works', '此链接已失效');
  let body;
  let action;
  if (recovery) {
    title = t('This password reset link no longer works', '此重置密码链接已失效');
    body = t(
      'The link has expired or has already been used — each link works once, for a limited time.',
      '该链接已过期或已被使用——每个链接只能使用一次，且有时效。',
    );
    // /login-3/ sends a signed-in visitor straight back here, so point them at
    // the password form on this page instead.
    action = signedIn
      ? link(
          '#caaci-security',
          t(
            "You're signed in — change your password under Account security below",
            '您已登录——请在下方“账户安全”中修改密码',
          ),
        )
      : link('/login-3/', t('Request a new reset link', '重新申请重置链接'));
  } else if (signedIn) {
    body = t(
      'It may have expired or already been used. If it was for changing your email address, request the change again under Account security below.',
      '链接可能已过期或已被使用。如果这是修改邮箱的链接，请在下方“账户安全”中重新申请。',
    );
    action = link('#caaci-security', t('Go to Account security', '前往账户安全'));
  } else {
    body = t(
      'It may have expired or already been used. Sign in to continue — if you still need the email, you can ask for a new one from there.',
      '链接可能已过期或已被使用。请登录后继续——如仍需要该邮件，可在登录后重新申请。',
    );
    action = link('/login-3/', t('Go to sign in', '前往登录'));
  }
  host.innerHTML = `
    <div class="alert alert-warning mb-3" role="alert">
      <h4 class="alert-title">${title}</h4>
      <div>
        ${body}
        ${action}
      </div>
    </div>`;
}

// Drop ?recovery=1 (and the spent hash) once the password is saved, so a reload
// or a bookmark does not bring the set-password form back.
function clearRecoveryMarker() {
  const params = new URLSearchParams(location.search || '');
  params.delete('recovery');
  const qs = params.toString();
  try {
    window.history?.replaceState?.(null, '', location.pathname + (qs ? `?${qs}` : ''));
  } catch {
    /* no history API — the marker just stays */
  }
}

// ---------- account security (change password · change email) ----------
// A member with an email/password identity changes the password and confirms
// the current one; a Google/Microsoft-only member can add a password. Supabase
// checks current_password only when "Require current password when updating"
// is on, and may instead demand a reauthentication code (a nonce it emails).
const hasPasswordLogin = (user) =>
  (user.identities || []).some((i) => i.provider === 'email') ||
  (user.app_metadata?.providers || []).includes('email');

const needsReauth = (error) =>
  !!error &&
  (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message || ''));

function securityCard(host, user) {
  // Flips to true when an OAuth-only member sets a password on this page.
  let hasPassword = hasPasswordLogin(user);
  const field = (id, label, type, autocomplete, extra = '') => `
        <div class="mb-3">
          <label class="form-label" for="${id}">${label}</label>
          <input type="${type}" id="${id}" class="form-control" autocomplete="${autocomplete}"${extra}>
        </div>`;
  const currentField = () =>
    field('caaci-pw-current', t('Current password', '当前密码'), 'password', 'current-password');
  const passwordTitle = () =>
    hasPassword ? t('Change password', '修改密码') : t('Set a password', '设置密码');
  const saveLabel = () =>
    hasPassword ? t('Change password', '修改密码') : t('Set password', '设置密码');
  const codeLabel = t('Resend code', '重新发送验证码');
  host.innerHTML = `
    <div class="card mb-3" id="caaci-security">
      <div class="card-header"><h3 class="card-title mb-0">${t('Account security', '账户安全')}</h3></div>
      <div class="card-body">
        <h4 class="mb-2" id="caaci-pw-title">${passwordTitle()}</h4>
        <div id="caaci-pw-current-slot">${
          hasPassword
            ? currentField()
            : `<p class="text-secondary">${t('You sign in with Google or Microsoft. Set a password to also sign in with your email address.', '您目前通过 Google 或 Microsoft 登录。设置密码后也可以使用邮箱登录。')}</p>`
        }</div>
        ${field('caaci-pw-new', t('New password (at least 8 characters)', '新密码（至少 8 位）'), 'password', 'new-password', ' minlength="8"')}
        ${field('caaci-pw-new2', t('Confirm new password', '确认新密码'), 'password', 'new-password')}
        <button type="button" class="btn btn-primary" id="caaci-pw-save">${saveLabel()}</button>
        <div class="mt-3" id="caaci-pw-reauth" hidden>
          <p class="mb-2" id="caaci-pw-reauth-msg"></p>
          ${field('caaci-pw-code', t('Verification code', '验证码'), 'text', 'one-time-code', ' inputmode="numeric"')}
          <div class="btn-list">
            <button type="button" class="btn btn-primary" id="caaci-pw-confirm">${t('Confirm', '确认')}</button>
            <button type="button" class="btn" id="caaci-pw-code-resend">${codeLabel}</button>
          </div>
        </div>
        <p class="alert mt-3 mb-0" id="caaci-pw-notice" hidden></p>
        <hr class="my-4">
        <h4 class="mb-2">${t('Change email', '修改邮箱')}</h4>
        ${field('caaci-em-new', t('New email address', '新邮箱地址'), 'email', 'email')}
        <button type="button" class="btn" id="caaci-em-save">${t('Change email', '修改邮箱')}</button>
        <p class="alert mt-3 mb-0" id="caaci-em-notice" hidden></p>
        <button type="button" class="btn w-100 mt-2" id="caaci-em-resend" hidden>${t('Resend confirmation email', '重新发送确认邮件')}</button>
      </div>
    </div>`;
  const el = (id) => host.querySelector(`#${id}`);

  // --- password ---
  const pwNote = el('caaci-pw-notice');
  const reauth = el('caaci-pw-reauth');
  const codeResend = el('caaci-pw-code-resend');
  const saveBtn = el('caaci-pw-save');
  const confirmBtn = el('caaci-pw-confirm');

  const sendCode = () =>
    sendEmail(codeResend, pwNote, {
      action: 'reauth',
      email: user.email,
      label: codeLabel,
      send: () => supa.auth.reauthenticate(),
      sent: t('Verification code sent — check your inbox.', '验证码已发送，请查收。'),
    });

  // The update the fields describe right now. Read at Save and again at
  // Confirm, so edits made while the code prompt is open are what gets sent.
  // Returns null after telling the member what is wrong.
  const passwordUpdate = () => {
    const current = hasPassword ? el('caaci-pw-current').value : '';
    const password = el('caaci-pw-new').value;
    let problem = '';
    if (hasPassword && !current) problem = t('Enter your current password.', '请输入当前密码。');
    else if (password.length < 8)
      problem = t('Password must be at least 8 characters.', '密码至少 8 位。');
    else if (password !== el('caaci-pw-new2').value)
      problem = t('Passwords do not match.', '两次输入的密码不一致。');
    if (problem) {
      notice(pwNote, problem, false);
      return null;
    }
    return hasPassword ? { password, current_password: current } : { password };
  };

  const saved = () => {
    const message = hasPassword
      ? t('Password updated.', '密码已更新。')
      : t(
          'Password set — you can now also sign in with your email address.',
          '密码已设置，现在也可以使用邮箱登录。',
        );
    reauth.hidden = true;
    if (!hasPassword) {
      // They have a password now, so the next change on this page confirms it.
      hasPassword = true;
      el('caaci-pw-current-slot').innerHTML = currentField();
      el('caaci-pw-title').textContent = passwordTitle();
      saveBtn.textContent = saveLabel();
    }
    for (const id of ['caaci-pw-current', 'caaci-pw-new', 'caaci-pw-new2', 'caaci-pw-code']) {
      const input = el(id);
      if (input) input.value = '';
    }
    notice(pwNote, message, true);
  };

  saveBtn.addEventListener('click', async () => {
    const attrs = passwordUpdate();
    if (!attrs) return;
    const done = busy(saveBtn, t('Saving…', '保存中…'));
    const { error } = await supa.auth.updateUser(attrs);
    done();
    if (needsReauth(error)) {
      reauth.hidden = false;
      el('caaci-pw-reauth-msg').textContent = t(
        `We emailed a verification code to ${user.email}. Enter it below to finish.`,
        `我们已向 ${user.email} 发送验证码，请在下方输入以完成修改。`,
      );
      // A code sent inside the cooldown is still valid; asking for another
      // here would slip past the Resend button's countdown.
      // A request still in flight counts too: Save is usable again before
      // reauthenticate() answers, and only that answer starts the countdown.
      if (codeResend.getAttribute('aria-busy') || cooldownTimers.has(codeResend)) return;
      if (storedCooldownEnd('reauth', user.email))
        return void cooldown(codeResend, { action: 'reauth', email: user.email, label: codeLabel });
      return sendCode();
    }
    if (error) return notice(pwNote, error.message, false);
    saved();
  });

  confirmBtn.addEventListener('click', async () => {
    if (reauth.hidden) return;
    const attrs = passwordUpdate();
    if (!attrs) return;
    const nonce = el('caaci-pw-code').value.trim();
    if (!nonce)
      return notice(pwNote, t('Enter the code from the email.', '请输入邮件中的验证码。'), false);
    const done = busy(confirmBtn, t('Confirming…', '确认中…'));
    const { error } = await supa.auth.updateUser({ ...attrs, nonce });
    done();
    if (error) return notice(pwNote, error.message, false);
    saved();
  });
  codeResend.addEventListener('click', sendCode);

  // --- email ---
  const emNote = el('caaci-em-notice');
  const emResend = el('caaci-em-resend');
  const emLabel = t('Resend confirmation email', '重新发送确认邮件');
  let newEmail = '';
  const emSave = el('caaci-em-save');
  emSave.addEventListener('click', async () => {
    const value = el('caaci-em-new').value.trim();
    if (!EMAIL_RE.test(value))
      return notice(emNote, t('Enter a valid email address.', '请填写有效邮箱。'), false);
    if (value.toLowerCase() === String(user.email || '').toLowerCase())
      return notice(
        emNote,
        t('That is already your email address.', '这已经是您当前的邮箱。'),
        false,
      );
    const done = busy(emSave, t('Saving…', '保存中…'));
    const { error } = await supa.auth.updateUser(
      { email: value },
      { emailRedirectTo: location.origin + '/account/' },
    );
    done();
    if (error) return notice(emNote, error.message, false);
    newEmail = value;
    notice(
      emNote,
      t(
        `Almost done — open the confirmation link we sent to ${value}. If ${user.email} gets a confirmation email too, open that link as well; the change finishes once both are confirmed.`,
        `即将完成——请打开我们发送到 ${value} 的确认链接。如果 ${user.email} 也收到确认邮件，请一并确认；全部确认后才会完成更改。`,
      ),
      true,
    );
    emResend.hidden = false;
    cooldown(emResend, {
      action: 'email_change',
      email: user.email,
      seconds: EMAIL_COOLDOWN_S,
      label: emLabel,
    });
  });
  emResend.addEventListener('click', () =>
    sendEmail(emResend, emNote, {
      action: 'email_change',
      email: user.email,
      label: emLabel,
      // GoTrue looks the member up by the CURRENT address and re-mails the
      // pending change; given the new address it finds no one and sends nothing.
      send: () =>
        supa.auth.resend({
          type: 'email_change',
          email: user.email,
          options: { emailRedirectTo: location.origin + '/account/' },
        }),
      sent: t(`Confirmation email sent to ${newEmail}.`, `确认邮件已发送至 ${newEmail}。`),
    }),
  );
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

// ---------- /account/ Family card ----------
// ?family_invite=<id> comes from the invitation email. It is only ever compared
// against ids the server returned, or URL-encoded into a link — never rendered.
function familyInviteParam() {
  return new URLSearchParams(location.search || '').get('family_invite') || '';
}

const FAMILY_ROLES = ['founder', 'member', 'none'];
const RELATIONSHIPS = ['head', 'spouse', 'child', 'parent', 'other'];
const relLabel = (r) =>
  ({
    head: t('Head of household', '户主'),
    spouse: t('Spouse', '配偶'),
    child: t('Child', '子女'),
    parent: t('Parent', '父母'),
    other: t('Other', '其他'),
  })[r] || '';

const STATUS_BADGE = {
  active: 'bg-success-lt',
  pending: 'bg-warning-lt',
  past_due: 'bg-orange-lt',
  expired: 'bg-secondary-lt',
  cancelled: 'bg-danger-lt',
};

// A date from the server, or a dash — never the raw string.
const fmtDate = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : '—';
};

const EVENT_LABEL = {
  invite_sent: ['sent an invitation', '发送了邀请'],
  invite_cancelled: ['cancelled an invitation', '取消了邀请'],
  invite_declined: ['declined the invitation', '拒绝了邀请'],
  joined: ['joined the family', '加入了家庭'],
  left: ['left the family', '退出了家庭'],
  removed: ['removed a member', '移除了成员'],
  person_added: ['added a person without an account', '添加了未关联账号的成员'],
  person_removed: ['removed a person without an account', '移除了未关联账号的成员'],
  dissolved: ['dissolved the family', '解散了家庭'],
};

// Seats as the server counts them; the plan holder is always one of them.
const seatCount = (seats) => ({
  used: Math.max(1, Number(seats?.used) || 0),
  limit: Number(seats?.limit) || 3,
});

const pendingInvites = (fam) =>
  (Array.isArray(fam.invites) ? fam.invites : []).filter(
    (i) => (i.status || 'pending') === 'pending',
  );

// Family name, plan status and expiry, plus any extra datagrid items.
function familySummary(fam, extra = '') {
  const plan = fam.plan || {};
  return `
    <h4 class="mb-2" data-fam-name>${esc(fam.household?.name || t('Your family', '你的家庭'))}</h4>
    <div class="datagrid mb-3">
      <div class="datagrid-item"><div class="datagrid-title">${t('Family plan', '家庭会员')}</div>
        <div class="datagrid-content"><span class="badge ${STATUS_BADGE[plan.status] || 'bg-secondary-lt'}" data-fam-plan-status>${esc(statusLabel(plan.status, lang) || '—')}</span></div></div>
      <div class="datagrid-item"><div class="datagrid-title">${plan.status === 'active' ? t('Valid through', '有效期至') : t('Expires', '到期日期')}</div>
        <div class="datagrid-content">${fmtDate(plan.expires_at)}</div></div>
      ${extra}
    </div>`;
}

// Rows point back at fam.people by index, so no server text reaches an attribute.
// `pending` are the pending invites; one whose person_id matches a name-only
// row is that person's invitation, so the row shows it instead of offering another.
function familyPeople(people, pending) {
  const others = people.filter((p) => !p.is_founder).length;
  return `
    <h4 class="mb-2">${t('People', '成员')}</h4>
    <div class="list-group mb-3">${people
      .map((p, i) => {
        const rel = relLabel(p.relationship);
        const last = !p.is_founder && others <= 1;
        const invited =
          !p.linked && p.id ? pending.find((inv) => inv.person_id && inv.person_id === p.id) : null;
        return `
      <div class="list-group-item" data-fam-person>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="fw-bold">${esc(p.full_name || '—')}</span>
          ${rel ? `<span class="text-secondary">${rel}</span>` : ''}
          ${p.is_founder ? `<span class="badge bg-primary-lt" data-fam-founder>${t('Founder', '创建人')}</span>` : ''}
          ${
            p.linked
              ? `<span class="badge bg-green-lt">${t('Linked account', '已关联账号')}</span>`
              : `<span class="badge bg-secondary-lt">${t('Not linked to an account', '未关联账号')}</span>`
          }
          ${p.is_founder ? '' : `<button type="button" class="btn btn-sm btn-outline-danger ms-auto" data-fam-remove="${i}"${last ? ' disabled' : ''}>${t('Remove', '移除')}</button>`}
        </div>
        ${last ? `<div class="text-secondary small mt-1">${t('The last person besides you can’t be removed. Dissolve the family instead.', '除你之外的最后一位成员无法移除，请改为解散家庭。')}</div>` : ''}
        ${
          p.linked
            ? ''
            : `<div class="small mt-2">${t(
                'Once they have an email address, you can invite them so they can sign in.',
                '等 TA 有了邮箱，你可以邀请 TA，这样 TA 就能登录。',
              )} <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-fam-link-invite="${i}"${invited ? ' disabled' : ''}>${t('Invite by email', '用邮箱邀请')}</button></div>
        ${
          invited
            ? `<div class="text-secondary small mt-1" data-fam-row-pending>${t(
                `Invitation pending to ${esc(invited.email)}`,
                `已向 ${esc(invited.email)} 发送邀请，等待接受`,
              )}</div>`
            : ''
        }
        <form class="mt-2" data-fam-row-invite novalidate hidden>
          <div class="input-group input-group-sm">
            <input class="form-control" type="email" name="email" required autocomplete="off" placeholder="${t('Email address', '邮箱地址')}" aria-label="${t('Email address', '邮箱地址')}">
            <button type="submit" class="btn btn-primary">${t('Send invitation', '发送邀请')}</button>
          </div>
        </form>`
        }
      </div>`;
      })
      .join('')}</div>`;
}

function familyPending(pending) {
  if (!pending.length) return '';
  return `
    <h4 class="mb-2">${t('Pending invitations', '待接受的邀请')}</h4>
    <div class="list-group mb-3">${pending
      .map((inv) => {
        const rel = relLabel(inv.relationship);
        return `
      <div class="list-group-item" data-fam-pending>
        <div><span class="fw-bold">${esc(inv.email)}</span>${inv.full_name ? ` · ${esc(inv.full_name)}` : ''}${rel ? ` · ${rel}` : ''}</div>
        <div class="text-secondary small">${t('Sent', '发送于')} ${fmtDate(inv.created_at)} · ${t('Expires', '过期时间')} ${fmtDate(inv.expires_at)}</div>
        <div class="btn-list mt-2">
          <button type="button" class="btn btn-sm" data-fam-resend>${t('Resend', '重新发送')}</button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-fam-cancel>${t('Cancel invitation', '取消邀请')}</button>
        </div>
      </div>`;
      })
      .join('')}</div>`;
}

function familyEvents(events) {
  if (!Array.isArray(events) || !events.length) return '';
  return `
    <h4 class="mt-3 mb-2">${t('Activity', '动态')}</h4>
    <ul class="list-unstyled small mb-0" data-fam-events>${events
      .map((e) => {
        const label = Object.hasOwn(EVENT_LABEL, e.type) ? EVENT_LABEL[e.type] : null;
        // Name-only people have no email; their events carry subject_name.
        const subject = e.subject_email || e.subject_name;
        return `<li class="mb-1"><span class="text-secondary">${fmtDate(e.created_at)}</span> · ${esc(e.actor_email || '')} ${label ? t(label[0], label[1]) : esc(e.type)}${subject ? ` · ${esc(subject)}` : ''}</li>`;
      })
      .join('')}</ul>`;
}

// Invitations addressed to the signed-in member. `focusId` (from the email
// link) is only compared with the server's ids to choose the row to highlight.
function familyInvitesForMe(list, focusId) {
  if (!list.length) return '';
  return `
    <h4 class="mb-2">${t('Invitations for you', '给你的邀请')}</h4>
    ${list
      .map((inv) => {
        const focused = !!focusId && inv.id === focusId;
        return `
    <div class="border rounded p-3 mb-3${focused ? ' border-primary bg-primary-lt' : ''}" data-fam-for-me${focused ? ' aria-current="true"' : ''}>
      <div><span class="fw-bold">${esc(inv.founder_email)}</span> ${t('invited you to join their CAACI family membership', '邀请你加入 TA 的 CAACI 家庭会员')}</div>
      ${inv.household_name ? `<div class="text-secondary">${esc(inv.household_name)}</div>` : ''}
      <div class="text-secondary small">${t('Expires', '过期时间')} ${fmtDate(inv.expires_at)}</div>
      <div class="btn-list mt-2">
        <button type="button" class="btn btn-primary btn-sm" data-fam-accept>${t('Accept', '接受')}</button>
        <button type="button" class="btn btn-sm" data-fam-decline>${t('Decline', '拒绝')}</button>
      </div>
    </div>`;
      })
      .join('')}`;
}

async function sessionBearer() {
  const { data: { session } = { session: null } } = (await supa.auth.getSession?.()) || {};
  return session ? { authorization: `Bearer ${session.access_token}` } : {};
}

// GET /api/family (no body) or POST { action, … }. Never throws: a network
// failure comes back as a normal error result, like api().
async function familyRequest(body) {
  try {
    const headers = await sessionBearer();
    const res = await fetch(
      '/api/family',
      body
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
          }
        : { headers },
    );
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data: data && typeof data === 'object' ? data : {} };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: t('Network error — please try again.', '网络错误，请重试。') },
    };
  }
}

// The invite-by-email and add-a-person forms. Values typed by the member are
// read back from the inputs, never interpolated here.
function familyForms(full) {
  const dis = full ? ' disabled' : '';
  const relSelect = `<select class="form-select" name="relationship" aria-label="${t('Relationship', '关系')}"${dis}>
      <option value="">${t('Relationship (optional)', '关系（可选）')}</option>
      ${RELATIONSHIPS.map((r) => `<option value="${r}">${relLabel(r)}</option>`).join('')}
    </select>`;
  return `
    ${
      full
        ? `<div class="alert alert-warning" data-fam-full>${t(
            'Family is full (3 people). Remove someone or cancel an invitation to add another person.',
            '家庭已满（3 人）。请先移除成员或取消邀请，再添加其他人。',
          )}</div>`
        : ''
    }
    <form data-fam-invite class="mb-3" novalidate>
      <h4 class="mb-2">${t('Invite by email', '通过邮箱邀请')}</h4>
      <div class="row g-2">
        <div class="col-12"><input class="form-control" type="email" name="email" required autocomplete="off" placeholder="${t('Email address', '邮箱地址')}" aria-label="${t('Email address', '邮箱地址')}"${dis}></div>
        <div class="col-md-6"><input class="form-control" name="full_name" autocomplete="off" placeholder="${t('Name (optional)', '姓名（可选）')}" aria-label="${t('Name (optional)', '姓名（可选）')}"${dis}></div>
        <div class="col-md-6">${relSelect}</div>
      </div>
      <button type="submit" class="btn btn-primary mt-2"${dis}>${t('Send invitation', '发送邀请')}</button>
    </form>
    <form data-fam-add novalidate>
      <h4 class="mb-1">${t('Add someone without an account', '添加没有账号的家人')}</h4>
      <p class="text-secondary small mb-2">${t(
        'For example a young child with no email. They count toward the 3 people.',
        '例如还没有邮箱的年幼孩子。同样计入 3 人名额。',
      )}</p>
      <div class="row g-2">
        <div class="col-md-6"><input class="form-control" name="full_name" required autocomplete="off" placeholder="${t('Name', '姓名')}" aria-label="${t('Name', '姓名')}"${dis}></div>
        <div class="col-md-6">${relSelect}</div>
      </div>
      <button type="submit" class="btn mt-2"${dis}>${t('Add person', '添加')}</button>
    </form>`;
}

// The Family card. GET /api/family once, then again after every successful
// change; any failure to load hides the card and leaves the page alone.
// What went out after an invite: an invitation, or (new address) a sign-in link.
const inviteSentText = (d, email) =>
  d.delivered === 'magic_link'
    ? t(
        `We emailed a sign-in link to ${email}. Once they sign in, they can accept your invitation on their account page.`,
        `已向 ${email} 发送登录链接。TA 登录后即可在账户页面接受你的邀请。`,
      )
    : t(`Invitation email sent to ${email}.`, `邀请邮件已发送至 ${email}。`);

async function wireFamily(host, { user, member, tiers, cardHost, ownCard }) {
  host.innerHTML = `
    <div class="card mb-3">
      <div class="card-header"><h3 class="card-title mb-0">${t('Family', '家庭')}</h3></div>
      <div class="card-body">
        <div data-fam-body></div>
        <p class="alert mt-3 mb-0" data-fam-notice hidden></p>
      </div>
    </div>`;
  const body = $('[data-fam-body]', host);
  const note = $('[data-fam-notice]', host);
  const ownFamilyTier = member.tier_id === 'family' && member.status === 'active';
  // The invitation the email link pointed at; cleared once it is answered.
  let focusId = familyInviteParam();
  let scrolled = false;

  // Without an active tier of their own, a founder or member of a family whose
  // plan is active gets the membership card through that plan.
  let planCard = false;
  const syncCard = (fam) => {
    if (ownCard || !cardHost) return;
    const eligible =
      (fam?.role === 'founder' || fam?.role === 'member') && fam.plan?.status === 'active';
    if (eligible && !planCard) {
      // plan.tier_id is authoritative; missing or unknown means the family tier.
      const tier =
        tiers.find((x) => x.id === fam.plan.tier_id) || tiers.find((x) => x.id === 'family');
      renderMemberCard(cardHost, {
        user,
        member: { ...member, expires_at: fam.plan.expires_at },
        tierName: tier ? tierText(tier, 'name') : t('Family Membership', '家庭会员'),
      });
    } else if (!eligible && planCard) cardHost.innerHTML = '';
    planCard = eligible;
  };

  const load = async () => {
    const { ok, data } = await familyRequest();
    render(ok && FAMILY_ROLES.includes(data.role) ? data : null);
  };

  // One change on `btn`: optional confirm, busy while in flight (a second
  // click or submit meanwhile does nothing), the server's error or `success`,
  // then a reload.
  const failNote = (res) =>
    notice(
      note,
      String(res.data.error || t('Something went wrong — please try again.', '出错了，请重试。')),
      false,
    );
  const run = async (btn, payload, { ask, success }) => {
    if (btn.getAttribute('aria-busy')) return null;
    if (ask && !window.confirm(ask)) return null;
    const done = busy(btn, t('Working…', '处理中…'));
    const res = await familyRequest(payload);
    if (!res.ok) {
      done();
      failNote(res);
      return res;
    }
    notice(note, success(res.data), true);
    await load();
    done();
    return res;
  };

  const wireForms = (full) => {
    const inv = $('form[data-fam-invite]', body);
    inv?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (full) return;
      const email = $('[name="email"]', inv).value.trim();
      const fullName = $('[name="full_name"]', inv).value.trim();
      const relationship = $('[name="relationship"]', inv).value;
      if (!email) return void notice(note, t('Enter an email address.', '请输入邮箱地址。'), false);
      const payload = { action: 'invite', email };
      if (fullName) payload.full_name = fullName;
      if (relationship) payload.relationship = relationship;
      run($('button[type="submit"]', inv), payload, {
        success: (d) => inviteSentText(d, email),
      });
    });
    const add = $('form[data-fam-add]', body);
    add?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (full) return;
      const fullName = $('[name="full_name"]', add).value.trim();
      const relationship = $('[name="relationship"]', add).value;
      if (!fullName) return void notice(note, t('Enter a name.', '请输入姓名。'), false);
      const payload = { action: 'add_person', full_name: fullName };
      if (relationship) payload.relationship = relationship;
      run($('button[type="submit"]', add), payload, {
        success: () => t(`${fullName} was added to your family.`, `已将 ${fullName} 添加到家庭。`),
      });
    });
  };

  const wireFounder = (fam) => {
    const people = Array.isArray(fam.people) ? fam.people : [];
    for (const btn of $$('[data-fam-remove]', body)) {
      const p = people[Number(btn.dataset.famRemove)];
      const name = p.full_name || '';
      btn.addEventListener('click', () =>
        run(
          btn,
          { action: 'remove_person', person_id: p.id },
          {
            ask: t(
              `Remove ${name} from your family? They will no longer be covered by your family plan.`,
              `确定将 ${name} 移出家庭？TA 将不再享有你的家庭会员权益。`,
            ),
            success: () => t(`${name} was removed from your family.`, `已将 ${name} 移出家庭。`),
          },
        ),
      );
    }
    // "Invite by email" next to someone without an account opens a form in that
    // row. The invite carries their person_id, so accepting links the existing
    // row instead of taking a seat — which is why it still works in a full family.
    for (const btn of $$('[data-fam-link-invite]', body)) {
      const p = people[Number(btn.dataset.famLinkInvite)];
      const form = $('form[data-fam-row-invite]', btn.closest('[data-fam-person]'));
      const email = $('[name="email"]', form);
      btn.addEventListener('click', () => {
        form.hidden = false;
        email.scrollIntoView?.({ block: 'center' });
        email.focus();
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const address = email.value.trim();
        if (!address)
          return void notice(note, t('Enter an email address.', '请输入邮箱地址。'), false);
        run(
          $('button[type="submit"]', form),
          { action: 'invite', email: address, person_id: p.id },
          { success: (d) => inviteSentText(d, address) },
        );
      });
    }
    const pending = pendingInvites(fam);
    $$('[data-fam-pending]', body).forEach((row, i) => {
      const inv = pending[i];
      const cancel = $('[data-fam-cancel]', row);
      cancel.addEventListener('click', () =>
        run(
          cancel,
          { action: 'cancel_invite', invite_id: inv.id },
          {
            ask: t(`Cancel the invitation to ${inv.email}?`, `确定取消发给 ${inv.email} 的邀请？`),
            success: () =>
              t(
                `The invitation to ${inv.email} was cancelled.`,
                `已取消发给 ${inv.email} 的邀请。`,
              ),
          },
        ),
      );
      // Resend shares the email cooldown: 60 s per invited address, kept across
      // reloads, and a 429 from the server starts it too.
      const resend = $('[data-fam-resend]', row);
      const cd = { action: 'family_invite', email: inv.email, label: resend.textContent };
      cooldown(resend, cd);
      resend.addEventListener('click', async () => {
        if (resend.getAttribute('aria-busy') || cooldownTimers.has(resend)) return;
        const done = busy(resend, t('Sending…', '发送中…'));
        const res = await familyRequest({ action: 'resend_invite', invite_id: inv.id });
        done();
        if (!res.ok) {
          failNote(res);
          if (res.status === 429) cooldown(resend, { ...cd, seconds: EMAIL_COOLDOWN_S });
          return;
        }
        cooldown(resend, { ...cd, seconds: EMAIL_COOLDOWN_S });
        notice(
          note,
          t(`Invitation sent again to ${inv.email}.`, `已再次向 ${inv.email} 发送邀请。`),
          true,
        );
        await load();
      });
    });
    const dissolve = $('[data-fam-dissolve]', body);
    dissolve.addEventListener('click', () =>
      run(
        dissolve,
        { action: 'dissolve' },
        {
          ask: t(
            'Dissolve your family? Everyone else loses the family plan benefits, including their digital membership card. Pending invitations are cancelled and people without an account are removed. This cannot be undone.',
            '确定解散家庭？其他所有成员都将失去家庭会员权益，包括电子会员卡；待接受的邀请会被取消，未关联账号的成员会被移除。此操作无法撤销。',
          ),
          success: () => t('Your family was dissolved.', '家庭已解散。'),
        },
      ),
    );
  };

  const render = (fam) => {
    // Old Resend buttons are about to be replaced; their countdowns resume on
    // the new ones from the stored end time.
    for (const b of $$('[data-fam-resend]', body)) stopCooldown(b);
    let html = '';
    let full = false;
    const forMe = Array.isArray(fam?.invitations_for_me) ? fam.invitations_for_me : [];
    if (fam) {
      html += familyInvitesForMe(forMe, focusId);
      if (focusId && !forMe.some((i) => i.id === focusId))
        html += `<div class="alert alert-warning" data-fam-invite-missing>${t(
          'That family invitation isn’t available. It may have expired or already been used, or it was sent to a different email address.',
          '该家庭邀请已不可用：可能已过期或已被使用，或者是发给另一个邮箱地址的。',
        )} ${t(`You are signed in as ${esc(user.email)}.`, `你当前登录的邮箱是 ${esc(user.email)}。`)} ${t(
          'If needed, ask the person who invited you to send a new invitation to this address.',
          '如有需要，请让邀请人向这个邮箱重新发送邀请。',
        )}</div>`;
    }
    if (fam?.role === 'founder') {
      const seats = seatCount(fam.seats);
      full = seats.used >= seats.limit;
      html += `
        ${familySummary(
          fam,
          `<div class="datagrid-item"><div class="datagrid-title">${t('People', '人数')}</div>
            <div class="datagrid-content"><strong data-fam-seats>${seats.used} / ${seats.limit}</strong></div></div>`,
        )}
        ${familyPeople(Array.isArray(fam.people) ? fam.people : [], pendingInvites(fam))}
        ${familyPending(pendingInvites(fam))}
        ${familyForms(full)}
        <div class="border-top pt-3 mt-3">
          <button type="button" class="btn btn-danger" data-fam-dissolve>${t('Dissolve family', '解散家庭')}</button>
          <p class="text-secondary small mt-2 mb-0">${t(
            'Ends the family. Everyone else loses the family plan benefits.',
            '解散后，其他所有成员都将失去家庭会员权益。',
          )}</p>
        </div>
        ${familyEvents(fam.events)}`;
    } else if (fam?.role === 'member') {
      html += `
        ${familySummary(
          fam,
          `<div class="datagrid-item"><div class="datagrid-title">${t('Founder', '创建人')}</div>
            <div class="datagrid-content">${esc(fam.founder?.email || '—')}</div></div>`,
        )}
        <p class="text-secondary small">${t(
          'While the family plan is active you share its benefits, including the digital membership card.',
          '家庭会员有效期间，你共享其会员权益，包括电子会员卡。',
        )}</p>
        <button type="button" class="btn btn-outline-danger" data-fam-leave>${t('Leave family', '退出家庭')}</button>`;
    } else if (
      fam?.role === 'none' &&
      // The server decides (can_start_family); a response without the field
      // falls back to the member's own active family tier.
      (typeof fam.can_start_family === 'boolean' ? fam.can_start_family : ownFamilyTier)
    ) {
      // Before a household exists the plan holder is the only person: 1 of 3.
      const seats = seatCount(fam.seats);
      full = seats.used >= seats.limit;
      html += `
        <h4 class="mb-1">${t('Invite your family', '邀请家人')}</h4>
        <p class="text-secondary">${t(
          'Your family plan covers up to 3 people, you included. Invite family members by email, or add someone who has no account.',
          '家庭会员最多包含 3 人（含你本人）。可以通过邮箱邀请家人，也可以添加没有账号的家人。',
        )}</p>
        <p>${t('People', '人数')}: <strong data-fam-seats>${seats.used} / ${seats.limit}</strong></p>
        ${familyForms(full)}`;
    }
    body.innerHTML = html;
    host.hidden = !html && note.hidden;
    wireForms(full);
    wireInvitesForMe(forMe);
    if (fam?.role === 'founder') wireFounder(fam);
    if (fam?.role === 'member') {
      const leave = $('[data-fam-leave]', body);
      leave.addEventListener('click', () =>
        run(
          leave,
          { action: 'leave' },
          {
            ask: t(
              'Leave this family? You will lose the family plan benefits, including your digital membership card.',
              '确定退出该家庭？你将失去家庭会员权益，包括电子会员卡。',
            ),
            success: () => t('You left the family.', '你已退出家庭。'),
          },
        ),
      );
    }
    syncCard(fam);
  };

  const wireInvitesForMe = (list) => {
    $$('[data-fam-for-me]', body).forEach((row, i) => {
      const inv = list[i];
      // An answered invitation is used up: the link's id must not read as "not found".
      const answered = (msg) => {
        if (inv.id === focusId) focusId = '';
        return msg;
      };
      const accept = $('[data-fam-accept]', row);
      accept.addEventListener('click', () =>
        run(
          accept,
          { action: 'accept_invite', invite_id: inv.id },
          {
            success: () =>
              answered(
                t(
                  'You joined the family. Its plan benefits now apply to you.',
                  '你已加入该家庭，现可享受家庭会员权益。',
                ),
              ),
          },
        ),
      );
      const decline = $('[data-fam-decline]', row);
      decline.addEventListener('click', () =>
        run(
          decline,
          { action: 'decline_invite', invite_id: inv.id },
          {
            ask: t(
              `Decline the invitation from ${inv.founder_email}?`,
              `确定拒绝 ${inv.founder_email} 的邀请？`,
            ),
            success: () => answered(t('Invitation declined.', '已拒绝邀请。')),
          },
        ),
      );
      if (!scrolled && row.getAttribute('aria-current')) {
        scrolled = true;
        row.scrollIntoView?.({ block: 'center' });
      }
    });
  };

  await load();
}

export async function wireAccountPage() {
  const host = $('#caaci-account-host');
  if (!supa) {
    host.innerHTML = `<div class="card card-body"><p class="mb-0">Supabase is not configured.</p></div>`;
    return;
  }

  // Password recovery (reset-email link lands on /account/?recovery=1). A link
  // that expired or was already used comes back with error_code /
  // error_description instead of a session, so it gets an explanation, not a
  // form that could only fail.
  const recoveryHost = $('#caaci-recovery-host');
  const recovery = /type=recovery/.test(location.hash) || /[?&]recovery=/.test(location.search);
  const failed = linkFailed();
  if (!failed && recovery) recoveryCard(recoveryHost);

  const { user } = await currentMember();
  // The next step for a dead link depends on whether they are signed in.
  if (failed) failedLinkCard(recoveryHost, { recovery, signedIn: !!user });
  if (!user) {
    host.innerHTML = `
      <div class="card">
        <div class="card-body text-center py-5">
          <h3>${t('You are not signed in', '您尚未登录')}</h3>
          <p class="text-secondary">${t('Sign in to see your membership, payments, and card.', '登录后即可查看会员资格、付款记录和会员卡。')}</p>
          <a href="/login-3/" class="btn btn-primary" data-signin>${t('Sign in', '登录')}</a>
          <a href="/membership/" class="btn ms-2">${t('Join a membership', '加入会员')}</a>
        </div>
      </div>`;
    // A family invitation link opened while signed out: come back to it after
    // signing in. The id only ever reaches the page URL-encoded, via setAttribute.
    const inviteId = familyInviteParam();
    if (inviteId)
      $('[data-signin]', host).setAttribute(
        'href',
        `/login-3/?next=${encodeURIComponent(`/account/?family_invite=${encodeURIComponent(inviteId)}`)}`,
      );
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
  const tierName = tier ? tierText(tier, 'name') : '';
  const stBadge = STATUS_BADGE;

  const subRows = tier
    ? `
      <div class="datagrid">
        <div class="datagrid-item"><div class="datagrid-title">${t('Plan', '方案')}</div><div class="datagrid-content">${esc(tierName)}</div></div>
        <div class="datagrid-item"><div class="datagrid-title">${t('Status', '状态')}</div>
          <div class="datagrid-content"><span class="badge ${stBadge[member.status] || 'bg-secondary-lt'}">${esc(statusLabel(member.status, lang) || '—')}</span></div></div>
        <div class="datagrid-item"><div class="datagrid-title">${t('Price', '价格')}</div><div class="datagrid-content">${
          isFreeTier(tier)
            ? t('Free', '免费')
            : `${usd(withFee(tier.price_cents))}/${t('yr', '年')} <span class="text-secondary">(${t('incl. 3.5% card fee', '含 3.5% 手续费')})</span>`
        }</div></div>
        ${
          isFreeTier(tier)
            ? ''
            : `<div class="datagrid-item"><div class="datagrid-title">${member.status === 'active' ? t('Renews', '续费日期') : t('Expires', '到期日期')}</div>
          <div class="datagrid-content">${member.expires_at ? new Date(member.expires_at).toLocaleDateString() : '—'}</div></div>`
        }
      </div>
      ${
        isFreeTier(tier)
          ? `<div class="text-secondary small mt-3">${t('Free membership never expires. Upgrade any time for the annual meeting and festival perks.', '免费会员永不过期。可随时升级，享受会员大会和节日福利。')}</div>`
          : ''
      }
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
        <div id="caaci-security-host"></div>
        <div class="card mb-3">
          <div class="card-header">
            <h3 class="card-title mb-0">${t('Subscription', '订阅')}</h3>
            ${
              tier
                ? `<div class="card-actions btn-list">
                    <a href="/membership/" class="btn btn-sm${isFreeTier(tier) ? ' btn-primary' : ''}">${isFreeTier(tier) ? t('Upgrade', '升级') : t('Change plan', '更改方案')}</a>
                    ${
                      // The Stripe portal needs a customer — a free member who
                      // has never paid has nothing to manage there.
                      member.stripe_customer_id
                        ? `<button type="button" class="btn btn-sm btn-primary" id="caaci-billing">${t('Manage billing', '管理账单')}</button>`
                        : ''
                    }
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
        <div id="caaci-mcard-host" class="mb-3"></div>
        <div id="caaci-family-host" hidden></div>
      </div>
    </div>`;

  securityCard($('#caaci-security-host', host), user);

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

  // Digital membership card — members whose own tier is active here; the
  // Family card adds it for anyone covered by an active family plan instead.
  const ownCard = !!(tier && member.status === 'active');
  if (ownCard) renderMemberCard($('#caaci-mcard-host', host), { user, member, tierName });

  await wireFamily($('#caaci-family-host', host), {
    user,
    member,
    tiers,
    ownCard,
    cardHost: $('#caaci-mcard-host', host),
  });
}

// ---------- /mid_autumn_festival_form/ (event registration) ----------
// A public form: registering needs no account. The page's own markup carries
// the flyer's date, place and contact, so it is complete before any request;
// GET /api/event-register then fills in the live details and the free-gift
// deadline, and tells a signed-in visitor whether they already registered.
// The mooncake also needs an account by that deadline, so the success state
// walks an anonymous registrant to signup with the address they used —
// handed over in sessionStorage, never in the URL.
const SIGNUP_EMAIL_KEY = 'caaci-signup-email';
// Events are stored in UTC and always shown in Champaign's time zone, whatever
// the visitor's phone is set to.
const EVENT_TZ = 'America/Chicago';

function inEventTz(iso, opts) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: EVENT_TZ,
    ...opts,
  }).format(d);
}
const DAY_FMT = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
const TIME_FMT = { hour: 'numeric', minute: '2-digit' };

// "Sunday, September 27, 2026 · 2:00 PM – 6:00 PM"; the end's date only when it differs.
function eventWhen({ starts_at: start, ends_at: end }) {
  const day = inEventTz(start, DAY_FMT);
  if (!day) return '';
  const from = `${day} · ${inEventTz(start, TIME_FMT)}`;
  const endDay = inEventTz(end, DAY_FMT);
  if (!endDay) return from;
  const to = inEventTz(end, TIME_FMT);
  return `${from} – ${endDay === day ? to : `${endDay} · ${to}`}`;
}
const deadlineText = (iso) =>
  inEventTz(iso, { month: 'long', day: 'numeric', ...TIME_FMT, timeZoneName: 'short' });
// The registration time, to the second: "Sep 13, 2026, 3:04:05 PM CDT".
const registeredText = (iso) => inEventTz(iso, { dateStyle: 'medium', timeStyle: 'long' });

// Live copy replacing a static bilingual element: drop data-en/data-zh so the
// language pass can never put the flyer's text back.
function setText(el, text) {
  el.removeAttribute('data-en');
  el.removeAttribute('data-zh');
  el.textContent = text;
}

async function eventSession() {
  if (!supa) return null;
  try {
    const { data } = await withTimeout(supa.auth.getSession(), 3500, { data: null });
    return data?.session || null;
  } catch {
    return null;
  }
}
const bearerFor = (session) =>
  session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};

// null on any failure (HTTP error, network, timeout): the page keeps its static copy.
function loadEventRegistration(slug, session) {
  const request = (async () => {
    const res = await fetch(`/api/event-register?event=${encodeURIComponent(slug)}`, {
      headers: bearerFor(session),
    });
    return res.ok ? res.json() : null;
  })().catch(() => null);
  return withTimeout(request, 6000, null);
}

// Which mooncake step a registration shows. The server decides who really gets
// one; this mirrors its rule (registered, and holding an account, by the
// deadline) only to pick the wording. A time we do not know never closes it.
function perkStep({ deadline, registeredAt, signedIn, accountCreatedAt }) {
  const end = deadline ? new Date(deadline).getTime() : NaN;
  const after = (time) => time > end; // false whenever either side is NaN
  if (after(new Date(registeredAt).getTime())) return 'closed';
  if (signedIn) return after(new Date(accountCreatedAt).getTime()) ? 'closed' : 'counted';
  return after(Date.now()) ? 'closed' : 'signup';
}

export async function wireEventFormPage() {
  const slug = document.body.dataset.event;
  const form = $('#caaci-ev-form');
  const formCard = $('#caaci-ev-form-card');
  const done = $('#caaci-ev-done');
  const note = $('#caaci-ev-notice');
  const btn = $('#caaci-ev-submit');
  const emailEl = $('#caaci-ev-email');
  const namesEl = $('#caaci-ev-names');
  const otherEl = $('#caaci-ev-heard-other-text');
  // Same-site links built from where the page is served, never a fixed host.
  const here = encodeURIComponent(location.pathname);
  let deadline = null; // the effective free-gift deadline, once the API has said
  let session = null;
  let registeredEmail = '';

  const choice = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || '';

  // Names are required only from someone who is coming.
  const namesLabel = $('label[for="caaci-ev-names"]');
  const syncNames = () => {
    const needed = choice('attending') !== 'no';
    namesEl.required = needed;
    namesLabel.classList.toggle('required', needed);
  };
  for (const radio of form.querySelectorAll('input[name="attending"]'))
    radio.addEventListener('change', syncNames);
  // Typing an "Other" answer picks Other, as the Google Form did.
  otherEl.addEventListener('input', () => {
    if (otherEl.value.trim()) $('#caaci-ev-heard-other').checked = true;
  });

  // The callout above the form: the deadline while it is open, "closed" after.
  const renderPerk = () => {
    const when = deadlineText(deadline);
    if (!when) return; // the static copy already says "before the festival starts"
    const open = Date.now() <= new Date(deadline).getTime();
    const box = $('#caaci-ev-perk');
    box.classList.toggle('alert-warning', open);
    box.classList.toggle('alert-secondary', !open);
    setText(
      $('#caaci-ev-perk-title'),
      open
        ? t('Free mooncake', '免费月饼')
        : t('Free mooncake sign-up has closed', '免费月饼登记已截止'),
    );
    setText(
      $('#caaci-ev-perk-text'),
      open
        ? t(
            `Register below and create a free CAACI website account by ${when}, and a free mooncake is waiting for you at the festival. The account is optional — anyone can register.`,
            `在 ${when} 前完成报名并免费注册 CAACI 网站账户，即可在活动现场领取免费月饼。注册账户并非必需——任何人都可以报名。`,
          )
        : t(
            `It closed on ${when}. You can still register for the festival below.`,
            `已于 ${when} 截止。您仍可在下方报名参加活动。`,
          ),
    );
  };

  // Signed in, but registered under a different address than the login one.
  let signOutFirst = false;

  const signupStepText = () => {
    const when = deadlineText(deadline);
    if (signOutFirst)
      return t(
        `The free mooncake goes with the email you registered with, not the account you are signed in to. Create a free CAACI account with that email${when ? ` by ${when}` : ''}, or log in to it — you will be signed out of this account first.`,
        `免费月饼与报名时填写的邮箱绑定，而不是您当前登录的账户。请${when ? `在 ${when} 前` : ''}用该邮箱免费注册 CAACI 账户或登录——系统会先为您退出当前账户。`,
      );
    return when
      ? t(
          `One more step for a free mooncake: create a free CAACI account with the email you registered with by ${when}.`,
          `领取免费月饼还差一步：请在 ${when} 前，用报名时填写的邮箱免费注册 CAACI 账户。`,
        )
      : t(
          'One more step for a free mooncake: create a free CAACI account with the email you registered with before the festival starts.',
          '领取免费月饼还差一步：在活动开始前，用报名时填写的邮箱免费注册 CAACI 账户。',
        );
  };

  // Swap the form for the success state; returns its heading for focus.
  // `linked`: the API tied the registration to the signed-in account, which it
  // does only when the registration email is the login email. A response
  // without the field comes from before that rule, when signed in meant linked.
  const showDone = ({ registeredAt, attending, already, signedIn, linked = signedIn }) => {
    formCard.hidden = true;
    done.hidden = false;
    const title = $('#caaci-ev-done-title');
    setText(
      title,
      attending ? t("You're registered", '报名成功') : t('Thanks for letting us know', '感谢告知'),
    );
    const stamp = registeredText(registeredAt);
    setText($('#caaci-ev-done-time'), stamp ? t(`Registered ${stamp}`, `报名时间：${stamp}`) : '');
    $('#caaci-ev-done-already').hidden = !already;
    // The mooncake goes with the registration email, so an unlinked signed-in
    // registrant gets the same account step as an anonymous one.
    signOutFirst = signedIn && !linked;
    // Someone who is not coming has no mooncake to collect.
    const step = attending
      ? perkStep({
          deadline,
          registeredAt,
          signedIn: signedIn && linked,
          accountCreatedAt: session?.user?.created_at,
        })
      : null;
    $('#caaci-ev-perk-counted').hidden = step !== 'counted';
    $('#caaci-ev-perk-cta').hidden = step !== 'signup';
    $('#caaci-ev-perk-closed').hidden = step !== 'closed';
    if (step === 'signup') setText($('#caaci-ev-perk-cta-text'), signupStepText());
    return title;
  };

  // supabase-js keeps the stored session when the logout request fails, and a
  // hung request is only abandoned by the timeout below; either way /login-3/
  // would still find it. So if a session is still there — or getSession does
  // not answer in time to say otherwise — delete it from storage ourselves.
  // Removing a key that is already gone is harmless.
  const dropStoredSession = async () => {
    const stillSignedIn = await withTimeout(
      Promise.resolve()
        .then(() => supa.auth.getSession())
        .then(({ data } = {}) => !!data?.session),
      1000,
      true,
    ).catch(() => true);
    if (!stillSignedIn) return;
    try {
      const key = supa.auth.storageKey;
      const keys = key
        ? [key]
        : [...Array(localStorage.length).keys()]
            .map((i) => localStorage.key(i))
            .filter((k) => /^sb-.+-auth-token$/.test(k || ''));
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* storage blocked — nothing more we can do */
    }
  };

  // The login page sends a signed-in visitor straight back to ?next=, so
  // someone who registered under another address is signed out on the way —
  // on this device only; the default scope would end their other sessions too.
  const goToLogin = async (path) => {
    if (signOutFirst && supa) {
      try {
        await withTimeout(supa.auth.signOut({ scope: 'local' }), 3500, null);
      } catch {
        /* checked below */
      }
      await dropStoredSession();
    }
    location.href = path;
  };
  const loginLink = $('#caaci-ev-login');
  loginLink.setAttribute('href', `/login-3/?next=${here}`);
  loginLink.addEventListener('click', (e) => {
    if (!signOutFirst) return; // otherwise a plain link
    e.preventDefault();
    goToLogin(loginLink.getAttribute('href'));
  });
  $('#caaci-ev-signup').addEventListener('click', () => {
    try {
      if (registeredEmail) sessionStorage.setItem(SIGNUP_EMAIL_KEY, registeredEmail);
    } catch {
      /* storage blocked — they type the address on the signup form */
    }
    goToLogin(`/login-3/?signup=1&next=${here}`);
  });
  $('#caaci-ev-edit').addEventListener('click', () => {
    done.hidden = true;
    formCard.hidden = false;
    note.hidden = true;
    emailEl.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return; // a second tap while the first is sending
    const heardFrom = choice('heard_from');
    const body = {
      event: slug,
      email: emailEl.value.trim(),
      attending: choice('attending'),
      names: namesEl.value.trim(),
      heard_from: heardFrom,
      heard_from_other: heardFrom === 'other' ? otherEl.value.trim() : '',
      wants_meal: choice('wants_meal'),
      _hp: $('#caaci_hp_field').value,
    };
    // The API checks all of this again; asking here saves a round trip on a phone.
    const stop = (msg, field) => {
      notice(note, msg, false);
      field.focus();
    };
    if (!EMAIL_RE.test(body.email))
      return stop(t('Enter a valid email address.', '请填写有效邮箱。'), emailEl);
    if (!body.attending)
      return stop(
        t('Tell us whether you can attend.', '请告诉我们您能否参加。'),
        $('#caaci-ev-attending-yes'),
      );
    if (body.attending === 'yes' && !body.names)
      return stop(t('List the names of the people attending.', '请填写参加者姓名。'), namesEl);

    note.hidden = true;
    const undo = busy(btn, t('Submitting…', '提交中…'));
    session = await eventSession();
    const { ok, data } = await api('/api/event-register', body, bearerFor(session));
    undo();
    if (!ok)
      return notice(
        note,
        data.error || t('Could not submit — please try again.', '提交失败，请重试。'),
        false,
      );
    // A saved registration always has a time. An ok without one saved nothing
    // (the honeypot answer, or a response we do not understand), so "You're
    // registered" would be a lie.
    if (!data.registered_at)
      return notice(
        note,
        t(
          'We could not confirm your registration. Please try again.',
          '未能确认您的报名，请重试。',
        ),
        false,
      );
    registeredEmail = body.email;
    if (data.deadline) {
      deadline = data.deadline;
      renderPerk();
    }
    showDone({
      registeredAt: data.registered_at,
      attending: body.attending === 'yes',
      already: !!data.already,
      signedIn: !!data.signed_in,
      linked: typeof data.linked === 'boolean' ? data.linked : !!data.signed_in,
    }).focus();
  });

  // Everything above works without the API; its answer only refines the page.
  session = await eventSession();
  const info = await loadEventRegistration(slug, session);
  if (!info?.event) return;
  const ev = info.event;
  // The heading stays the page's own bilingual title: event titles in the
  // database are English only, and a Chinese visitor would lose theirs.
  const when = eventWhen(ev);
  if (when) setText($('#caaci-ev-when'), when);
  if (ev.location) setText($('#caaci-ev-where'), ev.location);
  if (ev.description) {
    const desc = $('#caaci-ev-desc');
    desc.textContent = ev.description;
    desc.hidden = false;
  }
  deadline = ev.deadline || ev.perk_deadline || ev.starts_at || null;
  renderPerk();

  // Signed in: prefill the address (unless they already typed one), and skip
  // straight to the success state if they registered before. A submit that
  // finished while this request was out has already shown it.
  if (!info.signed_in || !done.hidden) return;
  if (info.email && !emailEl.value) emailEl.value = info.email;
  if (info.registration) {
    registeredEmail = info.email || '';
    showDone({
      registeredAt: info.registration.registered_at,
      attending: info.registration.attending !== false,
      already: false,
      signedIn: true,
    });
  }
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
    // Every member page now shares one nav partial, so wire it on all of them
    // — including login, where wireNav hides the redundant "Log In" button.
    await wireNav();
    if (page === 'login') await wireAuthPage();
    else if (page === 'membership') await wireMembershipPage();
    else if (page === 'account') await wireAccountPage();
    else if (page === 'event-form') await wireEventFormPage();
  } catch (e) {
    console.warn('caaci-member:', e);
  }
}

if (!window.__CAACI_TEST__) boot();
