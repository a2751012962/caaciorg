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
const api = (path, body, headers = {}) =>
  fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

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

// ---------- OAuth (Google / Microsoft) ----------
export async function oauth(provider) {
  if (!supa) return;
  const { error } = await supa.auth.signInWithOAuth({
    provider, // 'google' | 'azure' (Microsoft)
    options: { redirectTo: location.origin + '/account/' },
  });
  if (error) alert(error.message);
}

export function oauthButtons() {
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
    .forEach((b) => b.addEventListener('click', () => oauth(b.dataset.p)));
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
}

// ---------- Account page: show member, sign out ----------
export async function wireAccount() {
  if (!/account/.test(location.pathname) || !supa) return;
  const {
    data: { user },
  } = await supa.auth.getUser();
  const host = $('.et_pb_section') || $('main') || document.body;
  const box = document.createElement('div');
  box.className = 'caaci-card';
  if (!user) {
    box.innerHTML = `<p>You are not logged in. <a href="/login-3/">Log in</a>.</p>`;
  } else {
    const { data: m } = await supa.from('members').select('*').eq('id', user.id).maybeSingle();
    box.innerHTML = `
      <span class="caaci-eyebrow">Membership</span>
      <h2>My Account</h2>
      <p><b>Email:</b> ${user.email}</p>
      <p><b>Membership:</b> ${m?.tier_id || '—'} (${m?.status || 'none'})</p>
      ${m?.expires_at ? `<p><b>Renews/expires:</b> ${new Date(m.expires_at).toLocaleDateString()}</p>` : ''}
      <p style="margin-top:20px"><a href="/membership/">Manage membership</a> &nbsp;·&nbsp;
      <a href="#" id="caaci-logout">Sign out</a></p>`;
  }
  host.prepend(box);
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

// ---------- Register pages -> signup + Stripe checkout ----------
export function wireRegister() {
  const tier = tierFromSlug(location.pathname);
  if (!tier || !supa) return;
  const form = $('form[id*=mepr], form.mepr-form, form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (form.querySelector('[type=email],[name*=email]') || {}).value?.trim();
    const password = (form.querySelector('[type=password]') || {}).value || crypto.randomUUID();
    const full_name = (form.querySelector('[name*=name],[name*=first]') || {}).value || '';
    if (!email) return notice(form, 'Email is required.', false);
    const { data, error } = await supa.auth.signUp({
      email,
      password,
      options: { data: { full_name } },
    });
    if (error) return notice(form, error.message, false);
    const { data: r } = await api('/api/checkout', {
      type: 'membership',
      tier_id: tier,
      email,
      member_id: data.user?.id,
    });
    if (r.url) location.href = r.url;
    else notice(form, r.error || 'Checkout failed.', false);
  });
}

// ---------- Donate page -> Stripe checkout ----------
export function wireDonate() {
  if (!/donate/.test(location.pathname)) return;
  const btn = [...document.querySelectorAll('a,button')].find((b) =>
    /donat|give/i.test(b.textContent),
  );
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const amt = prompt('Donation amount (USD):', '50');
    if (!amt) return;
    const { data: r } = await api('/api/checkout', {
      type: 'donation',
      amount_cents: Math.round(parseFloat(amt) * 100),
    });
    if (r.url) location.href = r.url;
    else alert(r.error || 'Could not start donation.');
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
  for (const fn of [wireLogin, wireAccount, wireRegister, wireDonate, wireContact]) {
    try {
      fn();
    } catch (err) {
      console.warn('caaci-app:', err);
    }
  }
}

// Auto-run in the browser; skipped under test (window.__CAACI_TEST__) and in Node.
if (typeof window !== 'undefined' && !window.__CAACI_TEST__) init();
