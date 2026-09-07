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
    highlight: 'Free',
  },
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
  {
    id: 'honorary',
    name: 'Honorable Membership',
    name_zh: '荣誉会员',
    price_cents: 0,
    description: 'Free membership for major contributions to the community.',
    highlight: 'Invitation only',
    invite_only: true, // granted by the Board from the admin panel; never sold
  },
];

// The self-serve $0 tier: anyone can join it, nothing goes through Stripe, and
// it never expires. (Honorable is also $0 but invite_only — that one is granted
// by the Board, so it is deliberately NOT a "free tier" here.)
export const isFreeTier = (tier) => !!tier && !tier.invite_only && !(tier.price_cents > 0);

export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
export const withFee = (cents) => Math.round(cents * (1 + CARD_SURCHARGE)); // total charged on card

// Member status → bilingual label. Shared by the plan view and account page.
export const STATUS_LABEL = {
  active: 'Active · 有效',
  pending: 'Pending payment · 待付款',
  past_due: 'Payment past due · 付款逾期',
  expired: 'Expired · 已过期',
  cancelled: 'Cancelled · 已取消',
};

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
          invite_only: row.invite_only ?? t.invite_only ?? false,
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
