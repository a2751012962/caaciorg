// caaci-shared.js — pure, DOM-free helpers shared by the mirror enhancement
// layer (caaci-app.js) and the standalone member pages (caaci-member.js).
// Keep this file free of `document`/`location`/Supabase so both sides can
// import it without side effects.

// Escape user/DB-sourced text before it lands in innerHTML.
export const esc = (s) =>
  String(s ?? '').replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );

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
    id: 'free',
    name: 'Free Membership',
    name_zh: '免费会员',
    price_cents: 0,
    description:
      'Community updates and event announcements — no payment needed. Upgrade any time for festival perks.',
    description_zh: '社区动态与活动通知——无需付款。随时可升级以享受节日福利。',
    highlight: 'Free',
    highlight_zh: '免费',
  },
  {
    id: 'student',
    name: 'Student Membership',
    name_zh: '学生会员',
    price_cents: 1000,
    description: 'For currently enrolled college students.',
    description_zh: '面向年满 18 岁的在校大学生。',
    highlight: 'Best for students',
    highlight_zh: '学生首选',
  },
  {
    id: 'individual',
    name: 'Individual Membership',
    name_zh: '个人会员',
    price_cents: 3000,
    description: 'Full membership for one person.',
    description_zh: '适用于个人的完整会员资格。',
    highlight: 'Most popular',
    highlight_zh: '最受欢迎',
    featured: true,
  },
  {
    id: 'family',
    name: 'Family Membership',
    name_zh: '家庭会员',
    price_cents: 6000,
    description: 'Covers your whole household.',
    description_zh: '适用于一个家庭，全家共享。',
    highlight: 'Best value',
    highlight_zh: '最超值',
  },
  {
    id: 'business',
    name: 'Business Membership',
    name_zh: '商业会员',
    price_cents: 10000,
    description: 'Includes a listing in the business directory.',
    description_zh: '包含商家名录收录。',
    highlight: 'For businesses',
    highlight_zh: '商家之选',
  },
  {
    id: 'honorary',
    name: 'Honorable Membership',
    name_zh: '荣誉会员',
    price_cents: 0,
    description: 'Free membership for major contributions to the community.',
    description_zh: '授予为社区做出重大贡献者的免费会员资格。',
    highlight: 'Invitation only',
    highlight_zh: '仅限邀请',
    invite_only: true, // granted by the Board from the admin panel; never sold
  },
];
// membership_tiers has no name_zh/highlight columns, so those always come from
// this catalogue; description_zh and the benefit lines come from the row when
// staff set them (migration 0023, admin Plans tab).

// The self-serve $0 tier: anyone can join it, nothing goes through Stripe, and
// it never expires. (Honorable is also $0 but invite_only — that one is granted
// by the Board, so it is deliberately NOT a "free tier" here.)
export const isFreeTier = (tier) => !!tier && !tier.invite_only && !(tier.price_cents > 0);

export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
export const withFee = (cents) => Math.round(cents * (1 + CARD_SURCHARGE)); // total charged on card

// Member status → [English, 中文] label. Shared by the plan view and account page.
export const STATUS_LABEL = {
  active: ['Active', '有效'],
  pending: ['Pending payment', '待付款'],
  past_due: ['Payment past due', '付款逾期'],
  expired: ['Expired', '已过期'],
  cancelled: ['Cancelled', '已取消'],
};
export const statusLabel = (status, lang) =>
  STATUS_LABEL[status]?.[lang === 'zh' ? 1 : 0] || status;

// ---------- Site language (EN / 中文) ----------
// The one Google Fonts request for the whole site: Poppins, the single family
// for body, UI, buttons and headings (src/caaci-fonts.css). build.mjs writes
// googleFontLinks() into the Tabler pages' <head> and web/vite.config.ts into
// the React site's, both at the <!--CAACI_FONTS--> marker, so no page carries
// its own copy of the URL (test/fonts.test.js).
export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap';

export const googleFontLinks = () =>
  `<link rel="preconnect" href="https://fonts.googleapis.com">\n` +
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n` +
  `<link href="${GOOGLE_FONTS_URL}" rel="stylesheet">`;

// A visitor sees the language they last chose — the member-page toggle, a
// ?lang= link and the mirror's language switcher all store it under LANG_KEY —
// and, until they choose one, the language their browser asks for.
export const LANG_KEY = 'caaci-lang';

// 'zh' when the first Chinese or English entry in the browser's language list is
// Chinese, else 'en'. Self-contained: mirrorLangScript inlines its source.
export function browserLang(languages) {
  for (const l of languages || []) {
    const tag = String(l).toLowerCase();
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export const preferredLang = (stored, languages) =>
  stored === 'zh' || stored === 'en' ? stored : browserLang(languages);

// Every mirrored page exists twice, /about/ and /zh/about/. This runs inline at
// the top of <head>, before anything renders, and touches the page only through
// its arguments (build.mjs serialises it). `alt` is this page in the other
// language. It records a click on a link into the other copy (TranslatePress's
// floating switcher) as the visitor's choice, and moves the visitor to `alt`
// when the language they want is the other one. Without a stored choice it
// never leaves a /zh/ page, which someone opened on purpose, and never
// redirects a crawler, so both copies stay indexable.
export function mirrorLangBoot(w, alt, browserLang) {
  const KEY = 'caaci-lang'; // LANG_KEY — the serialised copy cannot reach it
  const isZh = (path) => /^\/zh(\/|$)/.test(path);
  const zhPage = isZh(w.location.pathname);
  w.document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || a.origin !== w.location.origin || isZh(a.pathname) === zhPage) return;
      try {
        w.localStorage.setItem(KEY, zhPage ? 'en' : 'zh');
      } catch {
        // Storage blocked: the link still works, the choice is just not kept.
      }
    },
    true,
  );
  let stored = null;
  try {
    stored = w.localStorage.getItem(KEY);
  } catch {
    // Storage blocked (sandboxed frame, cookies off): fall back to the browser.
  }
  let want = stored;
  if (want !== 'zh' && want !== 'en') {
    if (zhPage || /bot|crawl|spider|slurp/i.test(w.navigator.userAgent || '')) return;
    want = browserLang(w.navigator.languages || [w.navigator.language]);
  }
  if (alt && (want === 'zh') !== zhPage)
    w.location.replace(alt + w.location.search + w.location.hash);
}

// The inline <script> build.mjs puts at the top of a mirrored page's <head>.
export const mirrorLangScript = (alt) =>
  `<script>(${mirrorLangBoot})(window,${JSON.stringify(alt).replace(/</g, '\\u003c')},${browserLang});</script>\n`;

// ---------- Mobile numbers (sign-in by text message) ----------
// Supabase Auth wants E.164 (+12175550123). Members type all sorts —
// "(217) 555-0123", "217.555.0123", "+86 138 0013 8000" — so this reads what
// they meant. Exactly ten digits without a country code is a US/Canada number
// (+1), where nearly every member is; anything else has to start with + and
// its country code. Eleven bare digits starting with 1 are refused on purpose:
// 13800138000 is both a Chinese mobile and 1 + a Columbus, Ohio number, and a
// code texted to the wrong reading goes to a stranger.
// Returns the E.164 string, or null when the input cannot be a phone number.
export function normalizePhone(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /[a-z]/i.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  return /^[2-9]\d{9}$/.test(digits) ? `+1${digits}` : null;
}

// ---------- "send again" cooldowns ----------
// Every button that sends an email or a text counts down for the resend
// interval, and the end time is kept per action + recipient in localStorage so
// a reload does not restart the clock. Both the Tabler pages and the React
// account page read the same keys, which is why the builder lives here.
//
// The recipient goes in as a digest rather than as itself. These keys outlive
// the visit — nothing sweeps them until a countdown that is still on screen
// runs out — so on a shared or library machine `caaci-cooldown:sms:+1217…`
// left a member's mobile number where the next person could read it, and
// `…:sms_change:<uuid>` their account id, which is what the membership QR
// carries. The digest only has to tell two recipients apart; a collision costs
// at most a countdown shown for the wrong one. It is deliberately a small
// synchronous hash and not crypto.subtle, which is async and would turn every
// key lookup into a promise.
export const COOLDOWN_PREFIX = 'caaci-cooldown:';

const digest = (value) => {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  let h = 0x811c9dc5; // FNV-1a, 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

export const cooldownKey = (action, recipient) =>
  `${COOLDOWN_PREFIX}${action}:${digest(recipient)}`;

// Drop every stored countdown. Called on sign-out, so a shared machine keeps
// nothing about who was just signed in — including the plaintext keys written
// before the digest, which is why this matches on the prefix.
export function clearCooldowns(storage) {
  try {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    if (!store) return;
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key && key.startsWith(COOLDOWN_PREFIX)) store.removeItem(key);
    }
  } catch {
    // Storage blocked: there is nothing kept to clear.
  }
}

// Merge live membership_tiers rows (from any Supabase client) over the fallback.
export function mergeTiers(rows) {
  const base = TIERS_FALLBACK.map((t) => ({ ...t }));
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const t = base.find((b) => b.id === row.id);
      if (t)
        Object.assign(t, {
          name: row.name || t.name,
          price_cents: row.price_cents ?? t.price_cents,
          description: row.description || t.description,
          description_zh: row.description_zh || t.description_zh,
          invite_only: row.invite_only ?? t.invite_only ?? false,
          // Card benefit lines edited in the admin Plans tab (0023); empty = built-in copy.
          features: row.features || [],
          features_zh: row.features_zh || [],
        });
      else base.push({ ...row, highlight: '' });
    }
  }
  // Cheapest first (so the self-serve free tier leads as the entry plan), with
  // invitation-only tiers after everything else, so the free Honorable tier
  // doesn't read as a plan you can pick.
  return base.sort(
    (a, b) => Number(!!a.invite_only) - Number(!!b.invite_only) || a.price_cents - b.price_cents,
  );
}
