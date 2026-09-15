import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { mergeTiers, isFreeTier, usd, withFee } from './shared';
import type { MemberRow } from './auth';

// One membership plan: a live membership_tiers row merged over TIERS_FALLBACK
// (which supplies the Chinese name/description the table has no columns for).
export interface Tier {
  id: string;
  name: string;
  name_zh?: string;
  price_cents: number;
  description?: string;
  description_zh?: string;
  highlight?: string;
  highlight_zh?: string;
  featured?: boolean;
  invite_only?: boolean;
}

export interface Discount {
  code: string;
  percent_off: number;
}

const FALLBACK = mergeTiers(null) as Tier[];

// Active tiers from Supabase (tiers_read RLS: anyone reads active rows), merged
// the way the Tabler plan page does it. A slow or failed read keeps the
// catalogue, so the page always renders plans.
export async function loadTiers(timeoutMs = 3500): Promise<Tier[]> {
  const query = supabase
    .from('membership_tiers')
    .select('*')
    .eq('active', true)
    .then(({ data }) => data);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    const rows = await Promise.race([query, timeout]);
    return mergeTiers(rows) as Tier[];
  } catch {
    return FALLBACK;
  }
}

export function useTiers(): Tier[] {
  const [tiers, setTiers] = useState<Tier[]>(FALLBACK);
  useEffect(() => {
    let alive = true;
    void loadTiers().then((t) => alive && setTiers(t));
    return () => {
      alive = false;
    };
  }, []);
  return tiers;
}

export const isFree = (tier: Tier | undefined | null): boolean => isFreeTier(tier);

/** Self-serve plans: everything except invitation-only (Honorable). */
export const purchasable = (tiers: Tier[]) => tiers.filter((t) => !t.invite_only);

export const tierName = (tier: Tier, lang: 'en' | 'zh') =>
  lang === 'zh' ? tier.name_zh || tier.name : tier.name;

/** "$30" for whole dollars, "$31.05" otherwise. */
export const money = (cents: number) =>
  cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : usd(cents);

/** What Stripe charges for a year: base + 3.5% card fee. */
export const cardTotal = (tier: Tier) => withFee(tier.price_cents);

/**
 * First-year charge with a discount code. Stripe applies the coupon to the
 * fee-inclusive price (same arithmetic as the Tabler checkout summary);
 * renewals bill the full card total.
 */
export function discountedTotal(tier: Tier, discount: Discount | null) {
  const total = cardTotal(tier);
  const off = discount ? Math.round((total * discount.percent_off) / 100) : 0;
  return { total, fee: total - tier.price_cents, off, due: total - off };
}

/**
 * The member's current plan in the sense of the plan page: any status except
 * cancelled keeps the tier (mirrors wireMembershipPage in caaci-member.js).
 */
export const currentTierId = (member: MemberRow | null) =>
  member?.status && member.status !== 'cancelled' ? member.tier_id : null;

export type CheckoutMode =
  | 'signin' // signed out: go through /login-3/ first
  | 'current' // already active on this plan
  | 'fix-billing' // live subscription is past due: fix the card before changing plans
  | 'cancel-first' // paid plan live, picked the free tier: cancel in the billing portal
  | 'free' // join the free tier (no Stripe)
  | 'switch' // active paid subscriber: re-price the subscription in place
  | 'checkout'; // fresh Stripe Checkout

// Which action the button takes for `tier`. Mirrors openCheckout/wireMembershipPage
// in caaci-member.js plus the server guards in functions/api/{checkout,change-plan}.js
// and activateFreeTier (a live subscription blocks the free tier).
export function checkoutMode(
  tier: Tier,
  tiers: Tier[],
  signedIn: boolean,
  member: MemberRow | null,
): CheckoutMode {
  if (!signedIn) return 'signin';
  const current = tiers.find((t) => t.id === member?.tier_id);
  const status = member?.status;
  const liveSub =
    !!member?.stripe_subscription_id && (status === 'active' || status === 'past_due');
  if (status === 'active' && member?.tier_id === tier.id) return 'current';
  if (status === 'past_due' && liveSub) return 'fix-billing';
  if (isFree(tier)) {
    const onPaidPlan = status === 'active' && !!current && !isFree(current);
    return onPaidPlan || liveSub ? 'cancel-first' : 'free';
  }
  if (status === 'active' && current && !isFree(current) && member?.stripe_subscription_id)
    return 'switch';
  return 'checkout';
}
