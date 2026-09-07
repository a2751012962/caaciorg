// caaci-app.js — progressive enhancement layer for the mirrored WordPress pages.
// Injected before </body> on every mirrored page. It attaches behaviour to the
// existing Divi markup so the UI stays byte-identical while the backend becomes
// Cloudflare Functions. All wiring is feature-detected and wrapped in try/catch
// so a page without a given form is simply left untouched.
//
// Scope: the contact form, the donation checkout and accessibility repairs.
// Membership sign-up, login, plan choice and the account page are NOT handled
// here: build.mjs replaces /membership/, /account/ and /login-3/ with the
// standalone Tabler pages (member-src/ + caaci-member.js) and turns every other
// login / register / account route into a redirect stub, so no mirrored page can
// reach that flow any more. Nothing in this module needs Supabase.
import { usd } from './caaci-shared.js';

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

// ---------- Donation checkout (amount + frequency; card entry is on Stripe) ----------
export function openDonation() {
  document.querySelector('.caaci-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'caaci-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const lock = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  overlay.innerHTML = `
    <div class="caaci-checkout">
      <button type="button" class="caaci-checkout-close" aria-label="Close">&times;</button>
      <div class="caaci-checkout-main">
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
        <div class="caaci-field"><label for="caaci-email">Email · 邮箱 <small>(optional)</small></label><input id="caaci-email" type="email" autocomplete="email"></div>
      </div>
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
  const amtInput = overlay.querySelector('#caaci-amt');

  let freq = 'once';
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
    overlay.querySelectorAll('.caaci-chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    refresh();
  });
  refresh();

  payEl.addEventListener('click', async () => {
    const cents = Math.round(parseFloat(amtInput.value || '0') * 100);
    if (!cents || cents < 100) return notice(mainEl, 'Minimum donation is $1. · 最低 $1。', false);
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

// ---------- Donate page -> open the donation overlay ----------
export function wireDonate() {
  if (!/donate/.test(location.pathname)) return;
  const btn = [...document.querySelectorAll('a,button')].find((b) =>
    /donat|give/i.test(b.textContent),
  );
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    openDonation();
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

// ---------- Accessibility repairs on the mirrored markup ----------
// Divi builds "clickable modules" (the hero call-to-action tiles, the floating
// language switcher) as bare <div class="et_clickable"> wired up with jQuery.
// They are not focusable and expose no role, so keyboard and screen-reader
// users cannot reach them at all. Promote them to real buttons and make Enter
// and Space fire the same click Divi already listens for.
// WCAG relative luminance of an `rgb()` / `rgba()` string.
function relLuminance(color) {
  const n = String(color).match(/[\d.]+/g);
  if (!n || n.length < 3) return null;
  const chan = (v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(n[0]) + 0.7152 * chan(n[1]) + 0.0722 * chan(n[2]);
}

export function wireClickableModules() {
  const rows = new Set();
  for (const el of document.querySelectorAll('.et_clickable')) {
    // Pick white or near-black per tile from its own background luminance.
    // Divi's .et_pb_text_N indices are per-page, so a rule keyed on them lands
    // on different tiles from one page to the next; measuring is page-agnostic.
    // Compare both candidates' contrast ratios rather than testing luminance
    // against a threshold — mid-tone fills like the 0.85-alpha green sit right
    // where a single cutoff picks the worse of the two.
    const bg = getComputedStyle(el).backgroundColor;
    const L = relLuminance(bg);
    const opaque = !/rgba/.test(bg) || Number(bg.match(/[\d.]+/g)[3]) > 0.5;
    if (L !== null && opaque) {
      const vsWhite = 1.05 / (L + 0.05);
      const vsDark = (L + 0.05) / (relLuminance('rgb(26,26,26)') + 0.05);
      el.dataset.caaciContrast = vsDark > vsWhite ? 'dark' : 'light';
    }

    const row = el.closest('.et_pb_row');
    if (row) rows.add(row);

    if (el.closest('a, button') || el.hasAttribute('role')) continue;
    const label = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!label) continue;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault(); // Space would otherwise scroll the page
      el.click();
    });
  }
  // Only flex rows that hold more than one tile — a lone tile is fine as a
  // float and reflowing it could shift an unrelated layout.
  for (const row of rows) {
    if (row.querySelectorAll('.et_clickable').length > 1) row.classList.add('caaci-cta-row');
  }
}

// The /business-services/ section is headed "Click on the Tabs to Access
// Details", but its four tiles are text modules containing no link at all —
// Divi's clickable-module script finds no href, so nothing happens. (They are
// dead on the original WordPress site too, not just the mirror.) Wire up the
// two whose destination is unambiguous and already exists on this site; the
// Microloan and Mentorship tiles have no known target, so they are left alone
// rather than pointed somewhere invented.
const DEAD_TILE_TARGETS = [
  [/^Business Directory$/i, '/business-services/business-directory/'],
  [/^Membership Application$/i, '/membership/'],
];

export function wireBusinessServiceTiles() {
  if (!/\/business-services\/?$/.test(location.pathname.replace(/\/zh/, ''))) return;
  // Runs twice — once now and once on window load. Divi rebuilds the inner
  // HTML of its "video on hover" module (the Business Directory tile) during
  // its own ready handler, which throws away an anchor inserted before that.
  // Module-level attributes survive, so wireClickableModules needs no rerun.
  // Guarding on an existing anchor in the heading keeps the second pass a
  // no-op for tiles that were already wired.
  for (const mod of document.querySelectorAll('.et_pb_text')) {
    const h = mod.querySelector('h2');
    if (!h || h.querySelector('a')) continue;
    const label = h.textContent.trim().replace(/\s+/g, ' ');
    const hit = DEAD_TILE_TARGETS.find(([re]) => re.test(label));
    if (!hit) continue;
    // Wrap the heading text in a real anchor so it is clickable, focusable and
    // announced as a link, instead of faking it with a click handler.
    const a = document.createElement('a');
    a.href = hit[1];
    a.className = 'caaci-tile-link';
    while (h.firstChild) a.appendChild(h.firstChild);
    h.appendChild(a);
    mod.style.cursor = 'pointer';
  }
}

// The mirror ships no skip link, so keyboard users tab through the whole
// header on every page before reaching content. Add one as the first focusable
// element, pointing at Divi's main content wrapper.
export function wireSkipLink() {
  if (document.querySelector('.caaci-skip-link')) return;
  const main = document.querySelector('#main-content, #et-main-area, main');
  if (!main) return;
  if (!main.id) main.id = 'caaci-main';
  const a = document.createElement('a');
  a.className = 'caaci-skip-link';
  a.href = `#${main.id}`;
  a.textContent = document.documentElement.lang?.startsWith('zh')
    ? '跳到主要内容'
    : 'Skip to main content';
  document.body.prepend(a);
}

// ---------- Bootstrap ----------
// Runs every wiring fn. Each is feature-detected + isolated so a missing form
// just no-ops and one failing page never blocks the others.
export function init() {
  for (const fn of [
    wireSkipLink,
    wireClickableModules,
    wireBusinessServiceTiles,
    wireDonate,
    wireContact,
  ]) {
    try {
      fn();
    } catch (err) {
      console.warn('caaci-app:', err);
    }
  }

  // Second pass after Divi's own ready handlers have finished rebuilding
  // modules — see wireBusinessServiceTiles. Idempotent.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => {
      try {
        wireBusinessServiceTiles();
      } catch (err) {
        console.warn('caaci-app:', err);
      }
    });
  }
}

// Auto-run in the browser; skipped under test (window.__CAACI_TEST__) and in Node.
if (typeof window !== 'undefined' && !window.__CAACI_TEST__) init();
