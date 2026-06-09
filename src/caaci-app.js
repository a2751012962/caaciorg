// caaci-app.js — progressive enhancement layer.
// Injected before </body> on every mirrored page. It attaches behaviour to the
// existing WordPress/Divi markup so the UI stays byte-identical while the backend
// becomes Supabase + Cloudflare Functions. All wiring is feature-detected and
// wrapped in try/catch so a page without a given form is simply left untouched.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.CAACI_CONFIG || {};
const supa = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const $ = (s, r = document) => r.querySelector(s);
const api = (path, body, headers = {}) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

function notice(el, msg, good = true) {
  let n = el.querySelector('.caaci-notice');
  if (!n) { n = document.createElement('p'); n.className = 'caaci-notice'; el.appendChild(n); }
  n.textContent = msg;
  n.style.cssText = `margin-top:12px;font-weight:600;color:${good ? '#1a7f37' : '#b3261e'}`;
}

const TIER_BY_SLUG = {
  'student-membership': 'student', 'individual-membership': 'individual',
  'family-membership': 'family', 'business-membership': 'business',
};

// ---------- Login (MemberPress form: #mepr_loginform, fields log/pwd) ----------
function wireLogin() {
  const form = $('#mepr_loginform') || (location.pathname.match(/login/) && $('form'));
  if (!form || !supa) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (form.querySelector('[name=log]') || {}).value?.trim();
    const password = (form.querySelector('[name=pwd]') || {}).value;
    if (!email || !password) return notice(form, 'Enter your email and password.', false);
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) return notice(form, error.message, false);
    location.href = '/account/';
  });
}

// ---------- Account page: show member, sign out ----------
async function wireAccount() {
  if (!/account/.test(location.pathname) || !supa) return;
  const { data: { user } } = await supa.auth.getUser();
  const host = $('.et_pb_section') || $('main') || document.body;
  const box = document.createElement('div');
  box.style.cssText = 'max-width:620px;margin:40px auto;padding:0 24px;font-family:inherit';
  if (!user) {
    box.innerHTML = `<p>You are not logged in. <a href="/login/">Log in</a>.</p>`;
  } else {
    const { data: m } = await supa.from('members').select('*').eq('id', user.id).maybeSingle();
    box.innerHTML = `
      <h2 style="color:#300200">My Account</h2>
      <p><b>Email:</b> ${user.email}</p>
      <p><b>Membership:</b> ${m?.tier_id || '—'} (${m?.status || 'none'})</p>
      ${m?.expires_at ? `<p><b>Renews/expires:</b> ${new Date(m.expires_at).toLocaleDateString()}</p>` : ''}
      <p style="margin-top:20px"><a href="/membership/">Manage membership</a> &nbsp;·&nbsp;
      <a href="#" id="caaci-logout">Sign out</a></p>`;
  }
  host.prepend(box);
  $('#caaci-logout')?.addEventListener('click', async (e) => {
    e.preventDefault(); await supa.auth.signOut(); location.href = '/';
  });
}

// ---------- Register pages -> signup + Stripe checkout ----------
function wireRegister() {
  const tier = TIER_BY_SLUG[location.pathname.replace(/\/+$/, '').split('/').pop()];
  if (!tier || !supa) return;
  const form = $('form[id*=mepr], form.mepr-form, form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (form.querySelector('[type=email],[name*=email]') || {}).value?.trim();
    const password = (form.querySelector('[type=password]') || {}).value || crypto.randomUUID();
    const full_name = (form.querySelector('[name*=name],[name*=first]') || {}).value || '';
    if (!email) return notice(form, 'Email is required.', false);
    const { data, error } = await supa.auth.signUp({ email, password, options: { data: { full_name } } });
    if (error) return notice(form, error.message, false);
    const { data: r } = await api('/api/checkout',
      { type: 'membership', tier_id: tier, email, member_id: data.user?.id });
    if (r.url) location.href = r.url; else notice(form, r.error || 'Checkout failed.', false);
  });
}

// ---------- Donate page -> Stripe checkout ----------
function wireDonate() {
  if (!/donate/.test(location.pathname)) return;
  const btn = [...document.querySelectorAll('a,button')].find(b => /donat|give/i.test(b.textContent));
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const amt = prompt('Donation amount (USD):', '50');
    if (!amt) return;
    const { data: r } = await api('/api/checkout', { type: 'donation', amount_cents: Math.round(parseFloat(amt) * 100) });
    if (r.url) location.href = r.url; else alert(r.error || 'Could not start donation.');
  });
}

// ---------- Divi contact form -> /api/contact ----------
function wireContact() {
  const form = $('.et_pb_contact_form') || document.querySelector('form[class*=contact]');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (sel) => (form.querySelector(sel) || {}).value || '';
    const { ok, data } = await api('/api/contact', {
      name: v('[name*=name]'), email: v('[name*=email]'),
      phone: v('[name*=phone]'), message: v('[name*=message],textarea'),
    });
    notice(form, ok ? 'Thank you! Your message has been sent.' : (data.error || 'Could not send.'), ok);
    if (ok) form.reset();
  });
}

for (const fn of [wireLogin, wireAccount, wireRegister, wireDonate, wireContact]) {
  try { fn(); } catch (err) { console.warn('caaci-app:', err); }
}
