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
// reach that flow any more. Nothing in this module needs the Supabase client;
// wireAuthNav only reads the session supabase-js already stored.
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
// `cents` / `freq` pre-select the amount and frequency (an amount button on the
// donate page passes its own); the donor still sees and confirms them.
export function openDonation({ cents = 5000, freq = 'once' } = {}) {
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
          <button type="button" data-freq="once" aria-pressed="${freq === 'once'}">One-time · 一次</button>
          <button type="button" data-freq="month" aria-pressed="${freq === 'month'}">Monthly · 每月</button>
        </div>
        <div class="caaci-chips">
          ${[2500, 5000, 10000, 25000]
            .map(
              (c) =>
                `<button type="button" class="caaci-chip" data-amt="${c}" aria-pressed="${c === cents}">${usd(c)}</button>`,
            )
            .join('')}
        </div>
        <div class="caaci-field">
          <label for="caaci-amt">Amount (USD) · 金额</label>
          <input id="caaci-amt" type="number" min="1" step="1" value="${cents / 100}" inputmode="decimal">
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

// The donate page's amount buttons ("$250 Dollars" · Support Once / Support
// Monthly) were each a hand-made Stripe Payment Link, and the links drifted:
// both $250 buttons opened "$100 Monthly". Read the amount from the column's
// own heading and the frequency from the button label instead, so the checkout
// charges what the donor clicked. Returns null when no amount can be read.
const STRIPE_LINK = 'a[href*="buy.stripe.com"]';
export function donationPreset(button) {
  const heading = button.closest('.et_pb_column')?.querySelector('h1, h2, h3');
  const m = heading?.textContent.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  const cents = m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : 0;
  if (!cents) return null;
  return { cents, freq: /monthly|每月/i.test(button.textContent) ? 'month' : 'once' };
}

// ---------- Donate page -> open the donation overlay ----------
export function wireDonate() {
  if (!/donate/.test(location.pathname)) return;
  const btn = [...document.querySelectorAll('a,button')].find(
    (b) => !b.matches(STRIPE_LINK) && /donat|give/i.test(b.textContent),
  );
  btn?.addEventListener('click', (e) => {
    e.preventDefault();
    openDonation();
  });
  for (const a of document.querySelectorAll(STRIPE_LINK)) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openDonation(donationPreset(a) ?? undefined);
    });
  }
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

// ---------- Signed-in state in the Divi menu ----------
// The mirrored menu ends in a hard-coded "Log In" -> /login-3/, and this layer
// loads no Supabase client, so a signed-in member saw "Log In" on every
// mirrored page and took it to mean they had been signed out. supabase-js keeps
// the session in this origin's localStorage under sb-<project-ref>-auth-token;
// that entry is enough to relabel the link. It only picks a label — /account/
// still has Supabase verify the session before showing anything.
export function hasStoredSession(storage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!/^sb-.+-auth-token$/.test(key)) continue;
      if (JSON.parse(storage.getItem(key))?.refresh_token) return true;
    }
  } catch {
    // Storage blocked (private mode, sandboxed frame) or an unreadable entry.
  }
  return false;
}

export function wireAuthNav() {
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  if (!storage || !hasStoredSession(storage)) return;
  const zh = /^\/zh(\/|$)/.test(location.pathname);
  // Match the href, not the text: build.mjs translates the label on /zh/ pages.
  for (const a of document.querySelectorAll('.menu-item > a[href]')) {
    if (!/^\/(zh\/)?login-3\/?$/.test(a.getAttribute('href'))) continue;
    // The /zh/ pages run TranslatePress's DOM-change translator, which blanks
    // any text it sees change and restores it from wp-admin AJAX — a 404 on
    // this static host, so the mobile-menu copy was left with no label.
    a.setAttribute('data-no-dynamic-translation', '');
    a.setAttribute('href', zh ? '/zh/account/' : '/account/');
    a.textContent = zh ? '我的账户' : 'Account';
  }
}

// ---------- Festival registration promo (homepage + events page) ----------
// The mirrored homepage and events calendar predate the Mid-Autumn Festival
// registration form, so both link to it: a section right after the homepage
// hero, and on the events page an "Upcoming Events" entry above "Latest Past
// Events", in place of the calendar's "There are no upcoming events". Both
// stop appearing once the festival is over, so nothing has to be removed by
// hand.
const FESTIVAL_PROMO = {
  path: '/mid_autumn_festival_form/',
  until: Date.parse('2026-09-27T23:00:00Z'), // 6:00 PM in Champaign, when the festival ends
  date: '2026-09-27',
  venue: 'Siebel Center for Design',
  en: {
    eyebrow: 'Sun, Sept 27 · 2–6 PM · Siebel Center for Design',
    title: 'Mid-Autumn Festival registration is open',
    text: 'Register for the festival, and create a free CAACI account by 2:00 PM Central Time on September 27 to pick up a free mooncake.',
    cta: 'Register now',
    upcoming: 'Upcoming Events',
    event: 'Mid-Autumn Festival',
    month: 'Sep',
    when: 'September 27, 2026 @ 2:00 pm - 6:00 pm',
  },
  zh: {
    eyebrow: '9月27日（周日）下午2点–6点 · Siebel Center for Design',
    title: '中秋节活动报名中',
    text: '欢迎报名参加中秋节活动。9月27日下午2点（美国中部时间）前报名并注册 CAACI 网站账户，现场免费领一份月饼。',
    cta: '立即报名',
    upcoming: '即将举行的活动',
    event: '中秋节活动',
    month: '9 月',
    // The same date format the calendar uses for the past events below.
    when: '9 月 27, 2026 @ 2:00 下午 - 6:00 下午',
  },
};

function promoNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  // TranslatePress on the /zh/ pages blanks text it sees appear (see
  // wireAuthNav); mark every node that carries copy, not just the outer one.
  node.setAttribute('data-no-dynamic-translation', '');
  return node;
}

// Built from the homepage's own Divi section / row / column / text-module
// markup (two half columns, like the "Welcome" section below it), so Divi lays
// it out and stacks it on phones. The numbered classes (et_pb_section_1,
// et_pb_row_2, et_pb_text_4…) are left out: they carry one-off rules for those
// modules, such as a -65px row margin.
function festivalSection(copy, href) {
  const textModule = (...children) => {
    const inner = promoNode('div', 'et_pb_text_inner');
    inner.append(...children);
    const module = promoNode(
      'div',
      'et_pb_module et_pb_text et_pb_text_align_left et_pb_bg_layout_light',
    );
    module.append(inner);
    return module;
  };
  const cta = promoNode('a', 'caaci-btn', `${copy.cta} →`);
  cta.href = href;

  const left = promoNode('div', 'et_pb_column et_pb_column_1_2');
  left.append(
    textModule(
      promoNode('div', 'caaci-promo-eyebrow', copy.eyebrow),
      promoNode('h2', '', copy.title),
    ),
  );
  const right = promoNode('div', 'et_pb_column et_pb_column_1_2 et-last-child');
  right.append(textModule(promoNode('p', '', copy.text), cta));
  // The "Welcome" row's wider gutter, so the columns line up with it too.
  const row = promoNode('div', 'et_pb_row et_pb_gutters4');
  row.append(left, right);
  const section = promoNode('div', 'caaci-promo et_pb_section et_section_regular');
  section.append(row);
  return section;
}

// Built from the same markup and classes as the calendar's past-event rows,
// so the calendar's own CSS gives it their look.
function festivalUpcomingEvent(copy, href) {
  const p = 'tribe-events-calendar-latest-past';
  const section = promoNode('div', `caaci-promo-upcoming ${p}`);
  const row = promoNode('div', `tribe-common-g-row ${p}__event-row`);

  const tag = promoNode('div', `${p}__event-date-tag tribe-common-g-col`);
  const tagTime = promoNode('time', `${p}__event-date-tag-datetime`);
  tagTime.setAttribute('datetime', FESTIVAL_PROMO.date);
  tagTime.setAttribute('aria-hidden', 'true');
  tagTime.append(
    promoNode('span', `${p}__event-date-tag-month`, copy.month),
    promoNode(
      'span',
      `${p}__event-date-tag-daynum tribe-common-h5 tribe-common-h4--min-medium`,
      '27',
    ),
    promoNode('span', `${p}__event-date-tag-year`, '2026'),
  );
  tag.append(tagTime);

  const when = promoNode('time', `${p}__event-datetime`, copy.when);
  when.setAttribute('datetime', FESTIVAL_PROMO.date);
  const whenWrapper = promoNode('div', `${p}__event-datetime-wrapper tribe-common-b2`);
  whenWrapper.append(when);
  const titleLink = promoNode('a', `${p}__event-title-link tribe-common-anchor-thin`, copy.event);
  titleLink.href = href;
  const title = promoNode('h3', `${p}__event-title tribe-common-h6 tribe-common-h4--min-medium`);
  title.append(titleLink);
  const header = promoNode('header', `${p}__event-header`);
  header.append(
    whenWrapper,
    title,
    promoNode('div', 'tribe-common-b2 tribe-common-b2--bold', FESTIVAL_PROMO.venue),
  );

  // Unlike the past rows, no tribe-common-a11y-hidden: the calendar hides
  // those descriptions on phones, and the mooncake rule has to stay readable.
  const description = promoNode('div', `${p}__event-description tribe-common-b2`);
  description.append(promoNode('p', '', copy.text));
  const cta = promoNode('a', 'tribe-common-c-btn caaci-promo-upcoming-cta', `${copy.cta} →`);
  cta.href = href;

  const details = promoNode('div', `${p}__event-details tribe-common-g-col`);
  details.append(header, description, cta);
  const event = promoNode('article', `${p}__event tribe-common-g-row tribe-common-g-row--gutters`);
  event.append(details);
  const wrapper = promoNode('div', `${p}__event-wrapper tribe-common-g-col`);
  wrapper.append(event);
  row.append(tag, wrapper);

  section.append(
    promoNode('h2', `${p}__heading tribe-common-h5 tribe-common-h3--min-medium`, copy.upcoming),
    row,
  );
  return section;
}

export function wireFestivalPromo(now = Date.now()) {
  if (now > FESTIVAL_PROMO.until || document.querySelector('.caaci-promo, .caaci-promo-upcoming'))
    return;
  const path = location.pathname;
  const zh = /^\/zh(\/|$)/.test(path);
  const copy = FESTIVAL_PROMO[zh ? 'zh' : 'en'];
  // Open the form in the language of the page the visitor is reading.
  const href = `${FESTIVAL_PROMO.path}?lang=${zh ? 'zh' : 'en'}`;

  if (/^\/(zh\/?)?$/.test(path)) {
    const hero = document.querySelector('.et_pb_section_0');
    if (hero) hero.after(festivalSection(copy, href));
  } else if (/^\/(zh\/)?events\/?$/.test(path)) {
    const past = document.querySelector('.tribe-events-calendar-latest-past');
    if (!past) return;
    past.before(festivalUpcomingEvent(copy, href));
    // With an upcoming event listed, "There are no upcoming events" (the
    // desktop and the mobile copy) would contradict it.
    for (const notice of document.querySelectorAll('.tribe-events-header__messages'))
      notice.style.display = 'none';
  }
}

// ---------- Bootstrap ----------
// Runs every wiring fn. Each is feature-detected + isolated so a missing form
// just no-ops and one failing page never blocks the others.
export function init() {
  for (const fn of [
    wireSkipLink,
    wireAuthNav,
    wireClickableModules,
    wireBusinessServiceTiles,
    wireFestivalPromo,
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
  // modules — see wireBusinessServiceTiles — and cloning #top-menu into the
  // mobile menu, which wireAuthNav must relabel too. Both are idempotent.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('load', () => {
      for (const fn of [wireBusinessServiceTiles, wireAuthNav]) {
        try {
          fn();
        } catch (err) {
          console.warn('caaci-app:', err);
        }
      }
    });
  }
}

// Auto-run in the browser; skipped under test (window.__CAACI_TEST__) and in Node.
if (typeof window !== 'undefined' && !window.__CAACI_TEST__) init();
