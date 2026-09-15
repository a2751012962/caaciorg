// caaci-member.js — the standalone member-facing pages (Tabler UI, like /admin/):
//   /login-3/     sign in · create account · forgot password  (data-page="login")
//   /mid_autumn_festival_form/  public event registration  (data-page="event-form")
// /membership/ and /account/ are served by the React site (web/), not this module.
// These pages replace the old mirror-enhancement flow (caaci-app.js) on their
// routes; the behavioral contracts are identical — same API bodies, the same
// duplicate-email guard — only the markup is Tabler.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js).
import { esc, LANG_KEY, preferredLang } from './caaci-shared.js';

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
// ?lang=zh (used by the /zh/ redirect stubs) is stored as the visitor's choice;
// then the stored choice wins, and without one the browser's language.
// Resolved lazily in boot() so the module imports cleanly outside a browser.
let lang = 'en';
function initLang() {
  const urlLang = new URLSearchParams(location.search || '').get('lang');
  if (urlLang === 'zh' || urlLang === 'en') localStorage.setItem(LANG_KEY, urlLang);
  lang = preferredLang(localStorage.getItem(LANG_KEY), window.navigator?.languages);
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
  // The language pill names the language it switches to, as the React header does.
  const tgl = $('#caaci-lang');
  if (tgl) tgl.textContent = lang === 'en' ? '中' : 'En';
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
  // The button is gone (its markup was replaced mid-request): the stored end
  // time lets a later button for the same address resume, but no timer should
  // tick for nobody.
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

// ---------- one-time sign-in code ----------
// Members moved over from the old WordPress site have an account but no
// password. So every failed password sign-in offers them, and everyone else,
// the reset email above or a one-time code: signInWithOtp emails it (the
// magic_link template carries both the link and {{ .Token }}), verifyOtp signs
// in with it.
const legacyHintText = () =>
  t(
    'Moved over from the old caaciorg.com site, or forgot your password? Set a new password, or sign in with a one-time code.',
    '从老网站转过来的会员或忘记密码？请重新设置密码，或用临时验证码登录。',
  );

// With shouldCreateUser:false GoTrue refuses a code for an address that has no
// account ("Signups not allowed for otp", otp_disabled). Showing that would tell
// anyone which addresses are members, so it reads exactly like a real send —
// the same notice and the same cooldown. A rate limit still says how long to wait.
const isNoAccountError = (error) =>
  !!error &&
  !emailRetryAfter(error) &&
  (['otp_disabled', 'user_not_found', 'signup_disabled'].includes(error.code) ||
    /signups? not allowed|user not found/i.test(error.message || ''));

const sendSignInCode = (btn, note, { email, label, redirectTo }) =>
  sendEmail(btn, note, {
    action: 'otp',
    email,
    label,
    send: async () => {
      const result = await supa.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      return isNoAccountError(result?.error) ? { error: null } : result;
    },
    sent: t(
      "If this email has an account, we've sent a sign-in code.",
      '如果该邮箱已注册，验证码已发送。',
    ),
  });

// Signs in with the emailed code. Resolves to the user — leaving `btn` busy,
// since the caller moves on — or to null after saying why, with `btn` free again.
async function verifySignInCode(btn, note, email, input) {
  if (btn.getAttribute('aria-busy')) return null; // Enter pressed mid-request
  const token = input.value.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) {
    notice(note, t('Enter the code from the email.', '请输入邮件中的验证码。'), false);
    return null;
  }
  const done = busy(btn, t('Signing in…', '登录中…'));
  let result;
  try {
    result = await supa.auth.verifyOtp({ email, token, type: 'email' });
  } catch {
    done();
    notice(note, t('Network error — please try again.', '网络错误，请重试。'), false);
    return null;
  }
  const user = !result?.error && result?.data?.user;
  if (!user) {
    done();
    notice(
      note,
      t(
        'That code is wrong or has expired — request a new one.',
        '验证码错误或已过期，请重新获取。',
      ),
      false,
    );
    return null;
  }
  return user;
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
  // Submenu items count too: a matching dropdown entry highlights its parent
  // alongside it.
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

  // Any other failed sign-in. GoTrue says "Invalid login credentials" alike for
  // a wrong password and an unknown address, so the page never guesses which:
  // everyone gets both ways in for the address typed — a reset link (on the
  // same cooldown as the forgot-password form) or a one-time code.
  const legacy = $('#caaci-li-legacy');
  const legacyReset = $('#caaci-li-legacy-reset');
  const codeSend = $('#caaci-li-code-send');
  const codeForm = $('#caaci-li-code-form');
  const codeInput = $('#caaci-li-code');
  const resendResetLabel = t('Resend reset email', '重新发送重置邮件');
  const resendCodeLabel = t('Resend sign-in code', '重新发送验证码');
  let legacyEmail = '';
  const offerLegacy = (email) => {
    legacyEmail = email;
    $('#caaci-li-legacy-hint').textContent = legacyHintText();
    legacy.hidden = false;
    followCooldown(legacyReset, {
      action: 'recovery',
      email,
      label: resendResetLabel,
      idleLabel: t('Email me a reset link', '发送重置密码邮件'),
    });
    followCooldown(codeSend, {
      action: 'otp',
      email,
      label: resendCodeLabel,
      idleLabel: t('Email me a sign-in code', '发送临时验证码'),
    });
    // A code sent to this address moments ago (even before a reload) still works.
    if (storedCooldownEnd('otp', email)) codeForm.hidden = false;
  };
  const hideLegacy = () => {
    legacy.hidden = true;
    codeForm.hidden = true;
    codeInput.value = '';
    stopCooldown(legacyReset);
    stopCooldown(codeSend);
  };
  $('#caaci-li-email').addEventListener('input', hideLegacy);
  // True, after saying so, when the address typed cannot be sent anything.
  const invalidLegacyEmail = () => {
    if (EMAIL_RE.test(legacyEmail)) return false;
    notice(notb, t('Enter a valid email address.', '请填写有效邮箱。'), false);
    return true;
  };
  legacyReset.addEventListener('click', () => {
    if (legacyReset.disabled || invalidLegacyEmail()) return;
    return sendResetLink(legacyReset, notb, legacyEmail, resendResetLabel);
  });
  codeSend.addEventListener('click', async () => {
    if (codeSend.disabled || invalidLegacyEmail()) return;
    const email = legacyEmail;
    const sent = await sendSignInCode(codeSend, notb, {
      email,
      label: resendCodeLabel,
      redirectTo: location.origin + (next || '/account/'),
    });
    // Unless the address was changed while the code was on its way.
    if (sent && !legacy.hidden && legacyEmail === email) {
      codeForm.hidden = false;
      codeInput.focus({ preventScroll: true });
    }
  });
  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await verifySignInCode($('#caaci-li-code-verify'), notb, legacyEmail, codeInput);
    // Leave the button busy — the navigation below replaces the page.
    if (user) location.href = await destinationAfterSignIn(user.id, next);
  });

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
        hideLegacy();
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
      notice(notb, error.message, false);
      return offerLegacy(email);
    }
    hideLegacy();
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

  // Google/Microsoft return here rather than straight to /account/: the
  // signed-in check at the bottom of this function then routes them through
  // destinationAfterSignIn like the password form, so admins land in /admin/ and
  // `next` still wins for everyone else. The allow list's /** glob covers it.
  const oauthReturn =
    location.origin + location.pathname + (next ? `?next=${encodeURIComponent(next)}` : '');
  oauthButtons($('#caaci-oauth-host'), oauthReturn);

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

// ---------- /events/<slug>/register/ (event registration) ----------
// A public form: registering needs no account. One page serves every event
// (member-src/event-register.html). GET /api/event-register answers with the
// event's details, its free gift (the "perk") and its own questions, which are
// drawn here, and tells a signed-in visitor whether they already registered.
// A gift also needs an account by its deadline, so the success state walks an
// anonymous registrant to signup with the address they used — handed over in
// sessionStorage, never in the URL.
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
// Deadlines and registration times name the zone in words. Intl's short zone
// name reads "CDT" in English but "GMT-5" in Chinese, which people misread, so
// these two are assembled from the Chicago clock parts instead.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function eventClock(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get('hour'));
  return {
    year: get('year'),
    month: Number(get('month')),
    day: get('day'),
    hour12: hour % 12 || 12,
    minute: get('minute'),
    second: get('second'),
    pm: hour >= 12,
    // 下午2点, 晚上7点, 中午12点 — how the time of day is said in Chinese.
    period:
      hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour === 12 ? '中午' : hour < 18 ? '下午' : '晚上',
  };
}
// "September 27, 2:00 PM Central Time" · "9月27日下午2点（美国中部时间）".
function deadlineText(iso) {
  const c = eventClock(iso);
  if (!c) return '';
  return t(
    `${MONTHS[c.month - 1]} ${c.day}, ${c.hour12}:${c.minute} ${c.pm ? 'PM' : 'AM'} Central Time`,
    `${c.month}月${c.day}日${c.period}${c.hour12}点${c.minute === '00' ? '' : `${c.minute}分`}（美国中部时间）`,
  );
}
// The registration time, to the second: "Sep 13, 2026, 3:04:05 PM Central Time"
// · "2026年9月13日 下午3:04:05（美国中部时间）".
function registeredText(iso) {
  const c = eventClock(iso);
  if (!c) return '';
  const clock = `${c.hour12}:${c.minute}:${c.second}`;
  return t(
    `${MONTHS[c.month - 1].slice(0, 3)} ${c.day}, ${c.year}, ${clock} ${c.pm ? 'PM' : 'AM'} Central Time`,
    `${c.year}年${c.month}月${c.day}日 ${c.period}${clock}（美国中部时间）`,
  );
}

// Live copy replacing a static bilingual element: drop data-en/data-zh so the
// language pass can never put the placeholder text back.
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

// Which event the page is for: its own data-event (build.mjs sets it on the
// festival's printed QR route), else the slug in /events/<slug>/register/ (the
// _redirects rewrite keeps that path in the address bar), else ?event=.
function eventSlug() {
  if (document.body.dataset.event) return document.body.dataset.event;
  const m = /^\/events\/([^/]+)\/register\/?$/.exec(location.pathname || '');
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return ''; // a malformed escape names no event
    }
  }
  return (new URLSearchParams(location.search || '').get('event') || '').trim();
}

// { info } once the API has answered; { missing: true } when it says the event
// is not open for registration (404); { failed: true } for anything else — an
// HTTP error, a network failure or a timeout — which the page offers to retry.
function loadEventRegistration(slug, session) {
  const request = (async () => {
    const res = await fetch(`/api/event-register?event=${encodeURIComponent(slug)}`, {
      headers: bearerFor(session),
    });
    if (res.status === 404) return { missing: true };
    const info = res.ok ? await res.json() : null;
    return info?.event ? { info } : { failed: true };
  })().catch(() => ({ failed: true }));
  return withTimeout(request, 6000, { failed: true });
}

// Which free-gift step a registration shows. The server decides who really
// gets one; this mirrors its rule (registered, and holding an account, by the
// deadline) only to pick the wording. A time we do not know never closes it.
function perkStep({ deadline, registeredAt, signedIn, accountCreatedAt }) {
  const end = deadline ? new Date(deadline).getTime() : NaN;
  const after = (time) => time > end; // false whenever either side is NaN
  if (after(new Date(registeredAt).getTime())) return 'closed';
  if (signedIn) return after(new Date(accountCreatedAt).getTime()) ? 'closed' : 'counted';
  return after(Date.now()) ? 'closed' : 'signup';
}

// A question's (or an option's) label in the current language.
const questionLabel = (item) => t(item.label_en, item.label_zh || item.label_en);

// One event question as form markup. A choice question is a fieldset whose
// legend is the question, with "Other" as one more radio or checkbox that has
// its own text box; a text question is a labelled field. Ids come from the
// question and option ids (the API allows only [a-z0-9_]); labels are escaped.
function questionHtml(q) {
  const base = `caaci-ev-q-${q.id}`;
  const requiredMark = q.required ? ' required' : ''; // Tabler's "*" after the label
  if (q.type === 'text' || q.type === 'textarea') {
    const attrs = `id="${base}" class="form-control" autocomplete="off"${q.required ? ' required' : ''}`;
    return `<div class="mb-4">
      <label class="form-label${requiredMark}" for="${base}">${esc(questionLabel(q))}</label>
      ${
        q.type === 'text'
          ? `<input type="text" ${attrs} maxlength="500" />`
          : `<textarea ${attrs} rows="3" maxlength="2000"></textarea>`
      }
    </div>`;
  }
  if (q.type !== 'single' && q.type !== 'multi') return '';
  const type = q.type === 'single' ? 'radio' : 'checkbox';
  // A radio group can be required; on checkboxes `required` would demand every box.
  const required = q.required && type === 'radio' ? ' required' : '';
  const choice = (id, value, label) => `<div class="form-check">
      <input class="form-check-input" type="${type}" name="${base}" id="${id}" value="${esc(value)}"${required} />
      <label class="form-check-label" for="${id}">${esc(label)}</label>
    </div>`;
  const options = (q.options || []).map((o) => choice(`${base}-o-${o.id}`, o.id, questionLabel(o)));
  const other = q.other
    ? `${choice(`${base}-other`, '', t('Other:', '其他：'))}
    <label class="visually-hidden" for="${base}-other-text">${esc(t(`Other — ${q.label_en}`, `其他——${questionLabel(q)}`))}</label>
    <input type="text" id="${base}-other-text" class="form-control" maxlength="200" autocomplete="off" placeholder="${esc(t('Please specify', '请注明'))}" />`
    : '';
  return `<fieldset class="mb-4">
    <legend class="form-label${requiredMark}">${esc(questionLabel(q))}</legend>
    ${options.join('')}${other}
  </fieldset>`;
}

// The answers in the API's shape — a text answer as a string, a single choice
// as { option } or { other }, a multiple choice as { options, other? }, and an
// unanswered question left out — or the first problem as { error, field }.
// The API checks all of it again; asking here saves a round trip on a phone.
function readEventAnswers(form, questions) {
  const answers = {};
  for (const q of questions) {
    const base = `caaci-ev-q-${q.id}`;
    const unanswered = (field) => ({
      error: t(`Answer the question: ${q.label_en}`, `请回答：${questionLabel(q)}`),
      field,
    });
    if (q.type === 'text' || q.type === 'textarea') {
      const field = $(`#${base}`, form);
      const value = field.value.trim();
      if (value) answers[q.id] = value;
      else if (q.required) return unanswered(field);
      continue;
    }
    if (q.type !== 'single' && q.type !== 'multi') continue;
    const boxes = $$(`input[name="${base}"]`, form);
    const otherBox = $(`#${base}-other`, form);
    const picked = boxes.filter((b) => b.checked && b !== otherBox).map((b) => b.value);
    let other = null;
    if (otherBox?.checked) {
      const otherText = $(`#${base}-other-text`, form);
      other = otherText.value.trim();
      if (!other)
        return {
          error: t(`Fill in “Other” for: ${q.label_en}`, `请填写“其他”的内容：${questionLabel(q)}`),
          field: otherText,
        };
    }
    if (q.type === 'single') {
      if (other !== null) answers[q.id] = { other };
      else if (picked.length) answers[q.id] = { option: picked[0] };
    } else if (picked.length || other !== null) {
      answers[q.id] = other === null ? { options: picked } : { options: picked, other };
    }
    if (q.required && !answers[q.id]) return unanswered(boxes[0]);
  }
  return { answers };
}

export async function wireEventFormPage() {
  const slug = eventSlug();
  const form = $('#caaci-ev-form');
  const formCard = $('#caaci-ev-form-card');
  const done = $('#caaci-ev-done');
  const note = $('#caaci-ev-notice');
  const btn = $('#caaci-ev-submit');
  const emailEl = $('#caaci-ev-email');
  const questionsHost = $('#caaci-ev-questions');
  // "I'd also like to volunteer": the name and phone stay out of the way until
  // the box is ticked, so the form is no longer for everyone else.
  const volBox = $('#caaci-ev-vol');
  const volFields = $('#caaci-ev-vol-fields');
  const volName = $('#caaci-ev-vol-name');
  const volPhone = $('#caaci-ev-vol-phone');
  // Set when the signed-in GET pre-ticked the box: only then does an un-ticked
  // box mean "take me off the list" rather than "I never asked".
  let volunteerPrefilled = false;
  volBox.addEventListener('change', () => {
    volFields.hidden = !volBox.checked;
    if (volBox.checked) volName.focus();
  });
  // Same-site links back to the page as it was reached (with the query, which
  // names the event on /event-register/?event=), never a fixed host.
  const here = encodeURIComponent(location.pathname + (location.search || ''));
  let ev = null; // the event, once the API has answered
  let perk = null; // its free gift { item_en, item_zh, deadline }; null for none
  let questions = [];
  let session = null;
  let registeredEmail = '';

  // Until the event is known, one of these stands in for the form.
  const STATES = ['#caaci-ev-loading', '#caaci-ev-missing', '#caaci-ev-error', '#caaci-ev-closed'];
  const showState = (shown) => {
    for (const sel of STATES) $(sel).hidden = sel !== shown;
  };

  // Typing an "Other" answer picks Other, as the Google Form did.
  questionsHost.addEventListener('input', (e) => {
    const m = /^(caaci-ev-q-[a-z0-9_]+)-other-text$/.exec(e.target.id || '');
    const box = m && $(`#${m[1]}-other`);
    if (box && e.target.value.trim()) box.checked = true;
  });

  // The callout above the form: the deadline while it is open, "closed" after.
  const renderPerk = () => {
    const box = $('#caaci-ev-perk');
    box.hidden = !perk || ev?.open === false;
    if (!perk) return;
    const { item_en: en, item_zh: zh } = perk;
    const when = deadlineText(perk.deadline);
    const open = !when || Date.now() <= new Date(perk.deadline).getTime();
    box.classList.toggle('alert-warning', open);
    box.classList.toggle('alert-secondary', !open);
    setText(
      $('#caaci-ev-perk-title'),
      open
        ? t(`Free ${en}`, `免费领${zh}`)
        : t(`Free ${en} sign-up has closed`, `免费${zh}登记已截止`),
    );
    setText(
      $('#caaci-ev-perk-text'),
      open
        ? t(
            `Register and create a free CAACI website account${when ? ` by ${when}` : ''}, and pick up your free ${en} at the event.`,
            `${when ? `${when}前` : ''}报名，并免费注册一个 CAACI 网站账户，活动当天就能在现场免费领一份${zh}。`,
          )
        : t(
            `It closed on ${when}. You can still register below.`,
            `已于${when}截止。您仍可在下方报名参加活动。`,
          ),
    );
    // "No account still lets you register, just without the gift" — moot once closed.
    const perkNote = $('#caaci-ev-perk-note');
    setText(
      perkNote,
      t(
        `You can register without an account — you just won't get the free ${en}.`,
        `不注册账户也可以报名参加活动，只是领不到${zh}。`,
      ),
    );
    perkNote.hidden = !open;
  };

  // Signed in, but registered under a different address than the login one.
  let signOutFirst = false;

  const signupStepText = () => {
    const { item_en: en, item_zh: zh } = perk;
    const when = deadlineText(perk.deadline);
    if (signOutFirst)
      return t(
        `The free ${en} goes with the email you registered with, not the account you are signed in to. Create a free CAACI account with that email${when ? ` by ${when}` : ''}, or log in to it — you will be signed out of this account first.`,
        `免费${zh}与报名时填写的邮箱绑定，而不是您当前登录的账户。请${when ? `在${when}前` : ''}用该邮箱免费注册 CAACI 账户或登录——系统会先为您退出当前账户。`,
      );
    return when
      ? t(
          `One more step for a free ${en}: create a free CAACI account with the email you registered with by ${when}.`,
          `领取免费${zh}还差一步：请在${when}前，用报名时填写的邮箱免费注册 CAACI 账户。`,
        )
      : t(
          `One more step for a free ${en}: create a free CAACI account with the email you registered with before the event starts.`,
          `领取免费${zh}还差一步：在活动开始前，用报名时填写的邮箱免费注册 CAACI 账户。`,
        );
  };

  // Swap the form for the success state; returns its heading for focus.
  // `linked`: the API tied the registration to the signed-in account, which it
  // does only when the registration email is the login email. A response
  // without the field comes from before that rule, when signed in meant linked.
  const showDone = ({ registeredAt, already, signedIn, linked = signedIn, volunteer = false }) => {
    formCard.hidden = true;
    done.hidden = false;
    const title = $('#caaci-ev-done-title');
    setText(title, t("You're registered", '报名成功'));
    const stamp = registeredText(registeredAt);
    setText($('#caaci-ev-done-time'), stamp ? t(`Registered ${stamp}`, `报名时间：${stamp}`) : '');
    $('#caaci-ev-done-already').hidden = !already;
    $('#caaci-ev-done-volunteer').hidden = !volunteer;
    // The gift goes with the registration email, so an unlinked signed-in
    // registrant gets the same account step as an anonymous one.
    signOutFirst = signedIn && !linked;
    // An event without a gift has no gift step.
    const step = perk
      ? perkStep({
          deadline: perk.deadline,
          registeredAt,
          signedIn: signedIn && linked,
          accountCreatedAt: session?.user?.created_at,
        })
      : null;
    $('#caaci-ev-perk-counted').hidden = step !== 'counted';
    $('#caaci-ev-perk-cta').hidden = step !== 'signup';
    $('#caaci-ev-perk-closed').hidden = step !== 'closed';
    if (step === 'counted')
      setText(
        $('#caaci-ev-perk-counted'),
        t(`✓ Counted for a free ${perk.item_en}`, `✓ 已计入免费${perk.item_zh}名单`),
      );
    if (step === 'signup') setText($('#caaci-ev-perk-cta-text'), signupStepText());
    if (step === 'closed')
      setText(
        $('#caaci-ev-perk-closed'),
        t(`Free ${perk.item_en} sign-up has closed.`, `免费${perk.item_zh}登记已截止。`),
      );
    // A closed event takes no more answers, so there is nothing to change.
    $('#caaci-ev-edit-row').hidden = ev?.open === false;
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
    for (const field of $$('[aria-invalid]', form)) field.removeAttribute('aria-invalid');
    const stop = (msg, field) => {
      notice(note, msg, false);
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    };
    const email = emailEl.value.trim();
    if (!EMAIL_RE.test(email))
      return stop(t('Enter a valid email address.', '请填写有效邮箱。'), emailEl);
    const read = readEventAnswers(form, questions);
    if (read.error) return stop(read.error, read.field);
    const body = { event: slug, email, answers: read.answers, _hp: $('#caaci_hp_field').value };
    if (volBox.checked) {
      const volunteerName = volName.value.trim();
      if (!volunteerName)
        return stop(t('Enter your name to volunteer.', '请填写志愿者姓名。'), volName);
      body.volunteer = { name: volunteerName, phone: volPhone.value.trim() };
    } else if (volunteerPrefilled) {
      // The box came back ticked from the API and was un-ticked here, so this
      // resubmission is how someone withdraws. Left out otherwise, so a plain
      // registration never touches the volunteer list.
      body.volunteer = false;
    }

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
    if ('perk' in data) {
      perk = data.perk || null;
      renderPerk();
    }
    showDone({
      registeredAt: data.registered_at,
      already: !!data.already,
      signedIn: !!data.signed_in,
      linked: typeof data.linked === 'boolean' ? data.linked : !!data.signed_in,
      volunteer: !!data.volunteer,
    }).focus();
  });

  // Draw the event from the API's answer.
  const render = (info) => {
    ev = info.event;
    perk = ev.perk || null;
    questions = Array.isArray(ev.questions) ? ev.questions : [];
    const title = t(ev.title, ev.title_zh || ev.title);
    if (title) {
      setText($('#caaci-ev-title'), title);
      document.title = `${title} | Chinese American Association of Central Illinois`;
    }
    const when = eventWhen(ev);
    $('#caaci-ev-when').textContent = when;
    $('#caaci-ev-when-row').hidden = !when;
    $('#caaci-ev-where').textContent = ev.location || '';
    $('#caaci-ev-where-row').hidden = !ev.location;
    $('#caaci-ev-details').hidden = !when && !ev.location;
    const description = t(ev.description, ev.description_zh || ev.description);
    if (description) {
      const desc = $('#caaci-ev-desc');
      desc.textContent = description;
      desc.hidden = false;
    }
    renderPerk();
    // Closed: the API would refuse an answer, so there is no form to fill in.
    if (ev.open === false) showState('#caaci-ev-closed');
    else {
      showState(null);
      questionsHost.innerHTML = questions.map(questionHtml).join('');
      formCard.hidden = false;
    }

    // Signed in: prefill the address, and skip straight to the success state
    // if they registered before.
    if (!info.signed_in) return;
    if (info.email && !emailEl.value) emailEl.value = info.email;
    // Signed up to volunteer before: show it as it stands, so a resubmission
    // does not silently drop it.
    if (info.volunteer) {
      volunteerPrefilled = true;
      volBox.checked = true;
      volFields.hidden = false;
      volName.value = info.volunteer.name || '';
      volPhone.value = info.volunteer.phone || '';
    }
    if (info.registration) {
      registeredEmail = info.email || '';
      showDone({
        registeredAt: info.registration.registered_at,
        already: false,
        signedIn: true,
        volunteer: !!info.volunteer,
      });
    }
  };

  const load = async () => {
    if (!slug) return showState('#caaci-ev-missing');
    showState('#caaci-ev-loading');
    session = await eventSession();
    const { info, missing } = await loadEventRegistration(slug, session);
    if (info) render(info);
    else showState(missing ? '#caaci-ev-missing' : '#caaci-ev-error');
  };
  $('#caaci-ev-retry').addEventListener('click', load);
  await load();
}

// ---------- boot ----------
export async function boot() {
  initLang();
  applyLang();
  const tgl = $('#caaci-lang');
  if (tgl)
    tgl.addEventListener('click', () => {
      lang = lang === 'en' ? 'zh' : 'en';
      localStorage.setItem(LANG_KEY, lang);
      location.reload(); // dynamic content re-renders in the new language
    });
  const page = document.body.dataset.page;
  try {
    // Every member page now shares one nav partial, so wire it on all of them
    // — including login, where wireNav hides the redundant "Log In" button.
    await wireNav();
    if (page === 'login') await wireAuthPage();
    else if (page === 'event-form') await wireEventFormPage();
  } catch (e) {
    console.warn('caaci-member:', e);
  }
}

if (!window.__CAACI_TEST__) boot();
