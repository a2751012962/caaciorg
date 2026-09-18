// caaci-member.js — the standalone member-facing pages (Tabler UI, like /admin/):
//   /login-3/     sign in · create account · forgot password  (data-page="login")
// /membership/, /account/ and event registration are served by the React site (web/), not this module.
// These pages replace the old mirror-enhancement flow (caaci-app.js) on their
// routes; the behavioral contracts are identical — same API bodies, the same
// duplicate-email guard — only the markup is Tabler.
// The Supabase client comes from the self-hosted UMD bundle (assets/supabase.js).
import { LANG_KEY, normalizePhone, preferredLang } from './caaci-shared.js';

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
// The text-message code on the phone tab shares all of this (keyed by the
// number): Supabase's own SMS interval is shorter, but every text costs money.
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
  return ['over_email_send_rate_limit', 'over_sms_send_rate_limit'].includes(error.code) ||
    error.status === 429
    ? EMAIL_COOLDOWN_S
    : 0;
}

// One "send email" (or text message) request on `btn`: busy while in flight, a
// notice with the outcome, then the cooldown (Supabase's own wait when it
// rate-limited us).
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

// ---------- sign in with a mobile number ----------
// The phone tab: signInWithOtp texts a code to a number (Supabase → Twilio),
// verifyOtp signs in with it. Only a number already verified on an account
// under Account security gets one — shouldCreateUser:false — so a stray number
// never mints an email-less account that checkout, the member card and the
// family plan could not use. As with the email code, a number with no account
// reads exactly like a real send.
const sendSmsCode = (btn, note, { phone, label }) =>
  sendEmail(btn, note, {
    action: 'sms',
    email: phone,
    label,
    send: async () => {
      const result = await supa.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: false },
      });
      if (isNoAccountError(result?.error)) return { error: null };
      // Twilio's refusal comes back verbatim ("Error sending sms: …"); say
      // something a member can act on instead.
      if (result?.error?.code === 'sms_send_failed')
        return {
          error: {
            ...result.error,
            message: t(
              'We could not send a text to that number right now. Try again in a moment, or sign in with your email.',
              '暂时无法向该号码发送短信。请稍后重试，或改用邮箱登录。',
            ),
          },
        };
      return result;
    },
    sent: t(
      "If this number is on an account, we've texted it a sign-in code.",
      '如果该手机号已绑定账户，验证码已通过短信发送。',
    ),
  });

// Signs in with the emailed or texted code. `target` is { email } or { phone }
// (E.164), which picks the OTP type. Resolves to the user — leaving `btn`
// busy, since the caller moves on — or to null after saying why, with `btn`
// free again.
async function verifySignInCode(btn, note, target, input) {
  if (btn.getAttribute('aria-busy')) return null; // Enter pressed mid-request
  const viaSms = !!target.phone;
  const token = input.value.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) {
    notice(
      note,
      viaSms
        ? t('Enter the code from the text message.', '请输入短信中的验证码。')
        : t('Enter the code from the email.', '请输入邮件中的验证码。'),
      false,
    );
    return null;
  }
  const done = busy(btn, t('Signing in…', '登录中…'));
  let result;
  try {
    result = await supa.auth.verifyOtp(
      viaSms
        ? { phone: target.phone, token, type: 'sms' }
        : { email: target.email, token, type: 'email' },
    );
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
// Which sign-in tab (email | phone) the visitor used last.
const LOGIN_METHOD_KEY = 'caaci-login-method';
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
    const user = await verifySignInCode(
      $('#caaci-li-code-verify'),
      notb,
      { email: legacyEmail },
      codeInput,
    );
    // Leave the button busy — the navigation below replaces the page.
    if (user) location.href = await destinationAfterSignIn(user.id, next);
  });

  // ---- Email | Mobile number tabs ----
  // The choice is remembered, so someone who signs in by phone lands on that
  // tab next time; ?method=phone (a link from the account page) wins over it.
  const methodTabs = $$('#caaci-li-methods [data-method]');
  const panels = { email: $('#caaci-li-panel-email'), phone: $('#caaci-li-panel-phone') };
  const phoneInput = $('#caaci-ph-number');
  const showMethod = (wanted, { focus = false } = {}) => {
    // Own keys only: `panels[wanted]` also finds Object.prototype, so
    // ?method=toString (or __proto__, valueOf, constructor…) was truthy, matched
    // neither panel below, and left the page with both sign-in forms hidden —
    // and then stored that word, so every later visit repeated it.
    const method = Object.prototype.hasOwnProperty.call(panels, wanted) ? wanted : 'email';
    for (const tab of methodTabs) {
      const on = tab.dataset.method === method;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== method;
    // A message or the reset/code offer from the other way in would only confuse.
    notb.hidden = true;
    if (method === 'phone') hideLegacy();
    try {
      localStorage.setItem(LOGIN_METHOD_KEY, method);
    } catch {
      /* storage blocked — the tab still switches */
    }
    if (focus)
      (method === 'phone' ? phoneInput : $('#caaci-li-email')).focus({ preventScroll: true });
  };
  for (const tab of methodTabs)
    tab.addEventListener('click', () => showMethod(tab.dataset.method, { focus: true }));

  // ---- the phone panel: text a code, then sign in with it ----
  const phoneSend = $('#caaci-ph-send');
  const phoneCodeForm = $('#caaci-ph-code-form');
  const phoneCodeInput = $('#caaci-ph-code');
  const smsLabel = t('Text me a sign-in code', '发送短信验证码');
  const smsResendLabel = t('Text me another code', '重新发送短信验证码');
  let codePhone = ''; // the E.164 number the last code went to
  const typedPhone = () => normalizePhone(phoneInput.value);
  // The button follows the number typed: a countdown a text to that number
  // started (even before a reload) resumes, and its code entry comes back.
  phoneInput.addEventListener('input', () => {
    const phone = typedPhone();
    if (phone !== codePhone) {
      phoneCodeForm.hidden = true;
      phoneCodeInput.value = '';
    }
    followCooldown(phoneSend, {
      action: 'sms',
      email: phone || '',
      label: smsResendLabel,
      idleLabel: smsLabel,
    });
    if (phone && storedCooldownEnd('sms', phone)) {
      codePhone = phone;
      phoneCodeForm.hidden = false;
    }
  });
  $('#caaci-phone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (phoneSend.disabled) return; // Enter pressed mid-request or mid-countdown
    const phone = typedPhone();
    if (!phone)
      return notice(
        notb,
        t(
          'Enter a valid mobile number. Outside the US and Canada, start with + and the country code.',
          '请输入有效的手机号。美国/加拿大以外的号码请以 + 和国家代码开头。',
        ),
        false,
      );
    const sent = await sendSmsCode(phoneSend, notb, { phone, label: smsResendLabel });
    // Unless the number was changed while the text was on its way.
    if (sent && typedPhone() === phone) {
      codePhone = phone;
      phoneCodeForm.hidden = false;
      phoneCodeInput.focus({ preventScroll: true });
    }
  });
  phoneCodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = await verifySignInCode(
      $('#caaci-ph-verify'),
      notb,
      { phone: codePhone },
      phoneCodeInput,
    );
    // Leave the button busy — the navigation below replaces the page.
    if (user) location.href = await destinationAfterSignIn(user.id, next);
  });

  let rememberedMethod = null;
  try {
    rememberedMethod = localStorage.getItem(LOGIN_METHOD_KEY);
  } catch {
    /* storage blocked */
  }
  showMethod(new URLSearchParams(location.search || '').get('method') || rememberedMethod);

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
  } catch (e) {
    console.warn('caaci-member:', e);
  }
}

if (!window.__CAACI_TEST__) boot();
