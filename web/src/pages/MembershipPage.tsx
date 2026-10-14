import { useState, useRef, useEffect, useMemo, type FormEvent, type MouseEvent } from 'react';
import { motion } from 'motion/react';
import {
  hoverLift,
  hoverScale,
  inView,
  mountIn,
  rise,
  riseFrom,
  slideFromLeft,
  slideFromRight,
  tap,
} from '../lib/motion';
import { ContactSection } from '../components/ContactSection';
import { PlanCard } from '../components/PlanCard';
import { TiltCard } from '../components/bencho/TiltCard';
import {
  QrCode,
  ShieldCheck,
  Star,
  Gift,
  Utensils,
  ChevronRight,
  ChevronLeft,
  Coins,
  type LucideIcon,
} from 'lucide-react';
import type { CAACIContent } from '../data/content';
import {
  membershipPageDataEN,
  membershipPageDataZH,
  type PrivilegeIcon,
} from '../data/pagesContent';
import { api } from '../lib/api';
import { loginUrl, useAuth } from '../lib/auth';
import { effectiveStatus, statusLabel, usd } from '../lib/shared';
import {
  checkoutMode,
  currentTierId,
  discountedTotal,
  isFree,
  money,
  purchasable,
  tierName,
  useTiers,
  type Discount,
  type Tier,
} from '../lib/tiers';
import { fill } from '../lib/text';
import { planTokens } from '../lib/tokens';
import { smoothScrollTo } from '../utils/smoothScroll';

interface MembershipPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal?: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// Which glyph a privilege card draws; the copy and its order come from the data.
const PRIVILEGE_ICONS: Record<PrivilegeIcon, LucideIcon> = {
  utensils: Utensils,
  gift: Gift,
  star: Star,
  shield: ShieldCheck,
};

// Scroll to the checkout panel, not its section: on phones the section stacks
// the member pass above the form, so the section top landed on the pass card.
const scrollToForm = () => smoothScrollTo('membership-checkout', { offset: -90, duration: 0.9 });

export function MembershipPage({ content, lang, onNavigate }: MembershipPageProps) {
  const data = lang === 'en' ? membershipPageDataEN : membershipPageDataZH;
  const { ready, user, member, refreshMember } = useAuth();
  // What the membership is worth today — a stored 'active' outlives its expiry
  // for anyone without a Stripe subscription (effectiveStatus).
  const myStatus = effectiveStatus(member?.status ?? null, member?.expires_at ?? null);
  const tiers = useTiers();
  const plans = useMemo(() => purchasable(tiers), [tiers]);
  const hasInviteTier = tiers.some((x) => x.invite_only);

  // How many 华协币 each plan grants for the year. token_settings is
  // service-role only, so this is a small public endpoint rather than a
  // Supabase read; it stays {} while the feature is dark, and then no card,
  // note or order line mentions tokens at all.
  const [grants, setGrants] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    void planTokens().then(({ ok, data }) => {
      if (alive && ok && data.enabled) setGrants(data.grants || {});
    });
    return () => {
      alive = false;
    };
  }, []);
  const grantFor = (tierId: string | undefined) => (tierId && grants[tierId]) || 0;
  const anyGrant = plans.some((x) => grantFor(x.id) > 0);

  // ?tier=<id> (login round-trip, /register/<tier>/ stubs, Business page CTA)
  // and ?code=<discount> (flyers / QR codes) are read once on arrival.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [selectedTier, setSelectedTier] = useState<string>(() => params.get('tier') || 'family');
  const selected: Tier | undefined =
    plans.find((x) => x.id === selectedTier) ?? plans.find((x) => x.id === 'family') ?? plans[0];

  const [codeInput, setCodeInput] = useState(() => params.get('code') || '');
  const [applied, setApplied] = useState<Discount | null>(null);
  const [codeMsg, setCodeMsg] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tierScrollRef = useRef<HTMLDivElement>(null);
  const [currentTierIndex, setCurrentTierIndex] = useState(1);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const shortLabel = (tier: Tier) =>
    lang === 'zh'
      ? tier.name_zh || tier.name
      : tier.id.slice(0, 1).toUpperCase() + tier.id.slice(1);
  const serverError = (msg: string | undefined, fallback: string) =>
    msg === 'network' ? data.errors.network : msg || fallback;

  const applyCode = async (raw: string) => {
    const code = raw.trim();
    setCodeMsg('');
    if (!code) {
      setApplied(null);
      return;
    }
    setCodeBusy(true);
    const { ok, data: res } = await api<{ code?: string; percent_off?: number }>('/api/discount', {
      code,
    });
    setCodeBusy(false);
    if (ok && res.code && typeof res.percent_off === 'number') {
      setApplied({ code: res.code, percent_off: res.percent_off });
      setCodeInput(res.code);
    } else {
      setApplied(null);
      setCodeMsg(serverError(res.error, data.errors.invalidCode));
    }
  };

  useEffect(() => {
    const code = params.get('code');
    if (code) void applyCode(code);
    if (params.get('tier')) {
      const timer = setTimeout(scrollToForm, 350);
      return () => clearTimeout(timer);
    }
    // Runs once, for the address the page was opened with.
  }, []);

  // Coming back from Stripe with the browser's Back button restores this page
  // from the back-forward cache with the button still disabled.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const handleTierScroll = () => {
    if (!tierScrollRef.current || plans.length === 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = tierScrollRef.current;
    const maxScroll = scrollWidth - clientWidth;
    if (maxScroll <= 0) {
      setCurrentTierIndex(1);
      return;
    }
    const approx = Math.min(
      plans.length,
      Math.max(1, Math.round((scrollLeft / maxScroll) * (plans.length - 1)) + 1),
    );
    setCurrentTierIndex(approx);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!tierScrollRef.current) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - tierScrollRef.current.offsetLeft;
    scrollLeftRef.current = tierScrollRef.current.scrollLeft;
  };

  const handleMouseLeave = () => {
    isDraggingRef.current = false;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current || !tierScrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - tierScrollRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    tierScrollRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const scrollTiers = (direction: 'left' | 'right') => {
    if (!tierScrollRef.current) return;
    const offset = direction === 'left' ? -290 : 290;
    tierScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const selectTier = (id: string) => {
    setSelectedTier(id);
    setError('');
  };

  const mode = ready && selected ? checkoutMode(selected, tiers, !!user, member) : null;
  const free = isFree(selected);
  const summary = selected ? discountedTotal(selected, mode === 'switch' ? null : applied) : null;
  const myTierId = currentTierId(member);
  const myTier = tiers.find((x) => x.id === myTierId);

  // Where /login-3/ sends the visitor back to: this page, same language, same
  // plan and code, so they land on the checkout again.
  const returnPath = (tierId: string) => {
    const q = new URLSearchParams({ tier: tierId });
    const code = applied?.code || codeInput.trim();
    if (code) q.set('code', code);
    return `${lang === 'zh' ? '/zh' : ''}/membership/?${q.toString()}`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !mode || !selected) return;
    setError('');
    if (mode === 'signin') {
      window.location.assign(loginUrl(returnPath(selected.id)));
      return;
    }
    if (mode === 'current' || mode === 'fix-billing' || mode === 'cancel-first') {
      onNavigate('account');
      return;
    }
    if (!user) return;
    setBusy(true);

    // Active paid subscriber: re-price the subscription in place (prorated).
    if (mode === 'switch') {
      const { ok, data: res } = await api<{ url?: string }>(
        '/api/change-plan',
        { member_id: user.id, tier_id: selected.id },
        { auth: true },
      );
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      if (!ok) {
        setBusy(false);
        setError(serverError(res.error, data.errors.changePlan));
        return;
      }
      await refreshMember();
      setBusy(false);
      onNavigate('account');
      return;
    }

    const body: Record<string, unknown> = {
      tier_id: selected.id,
      member_id: user.id,
      email: user.email,
    };
    if (mode === 'checkout' && applied) body.discount_code = applied.code;
    // Membership checkout acts on the account, so it goes out signed in (the
    // donation modal keeps calling /api/checkout without a token, as before).
    const { ok, data: res } = await api<{ url?: string; activated?: boolean }>(
      '/api/checkout',
      body,
      { auth: true },
    );
    if (ok && res.url) {
      window.location.assign(res.url);
      return;
    }
    // The free tier is activated server-side, no Stripe hop.
    if (ok && res.activated) {
      await refreshMember();
      setBusy(false);
      onNavigate('account');
      return;
    }
    setBusy(false);
    setError(serverError(res.error, data.errors.checkout));
  };

  const submitLabel = (() => {
    if (busy) return data.submit.wait;
    switch (mode) {
      case null:
        return data.submit.loading;
      case 'signin':
        return data.submit.signin;
      case 'current':
        return data.submit.current;
      case 'fix-billing':
      case 'cancel-first':
        return data.submit.billing;
      case 'free':
        return data.submit.free;
      case 'switch':
        return data.submit.switchPlan;
      default:
        return data.formSubmit;
    }
  })();

  const modeNote = (() => {
    switch (mode) {
      case 'signin':
        return data.notes.signin;
      case 'current':
        return data.notes.current;
      case 'fix-billing':
        return data.notes.fixBilling;
      case 'cancel-first':
        return data.notes.cancelFirst;
      case 'switch':
        return data.notes.switchPlan;
      default:
        return '';
    }
  })();

  const showCodeEntry = !!selected && !free && (mode === 'checkout' || mode === 'signin');
  const expiresLabel = (() => {
    if (!selected) return '';
    if (free) return data.pass.never;
    if (myStatus === 'active' && member?.tier_id === selected.id && member.expires_at)
      return new Date(member.expires_at)
        .toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        .toUpperCase();
    return data.pass.twelveMonths;
  })();

  return (
    <div className="bg-white min-h-screen text-ink font-sans antialiased selection:bg-neutral-200">
      {/* Top-Left Return / Breadcrumb Path */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={mountIn}
        className="border-b border-neutral-200/80 bg-surface-2/80 backdrop-blur-xs"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <nav
            aria-label={data.breadcrumb.label}
            className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 font-sans"
          >
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 font-medium text-neutral-700 hover:text-brick transition-colors cursor-pointer group"
              title={data.breadcrumb.backToMenu}
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 text-neutral-400 group-hover:text-brick" />
              <span>{data.breadcrumb.backToMenu}</span>
            </button>
            <span className="text-neutral-300">/</span>
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-brick transition-colors cursor-pointer text-neutral-500"
            >
              {content.nav.welcome}
            </button>
            <span className="text-neutral-300">/</span>
            <span className="text-brick font-semibold">{content.nav.membership}</span>
          </nav>
        </div>
      </motion.div>

      {/* 1. Apple-Style Pricing Tiers (Clean Apple One / iCloud+ Style Layout) */}
      <section className="py-10 sm:py-16 lg:py-20 bg-surface-2 border-b border-neutral-200/80 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise()}
            className="text-center max-w-2xl mx-auto mb-8 sm:mb-12"
          >
            <span className="text-xs font-semibold text-brick block mb-2">
              {data.plans.eyebrow}
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
              {data.plans.title}
            </h2>
            <p className="mt-2 text-sm text-neutral-500">{data.plans.text}</p>
          </motion.div>

          {/* Responsive Layout: Smooth Horizontal Scrolling Carousel on Mobile with Hidden Scrollbar, Grid on Desktop */}
          <div
            ref={tierScrollRef}
            onScroll={handleTierScroll}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeave}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            className="flex md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none -mx-4 px-6 sm:-mx-6 sm:px-8 md:mx-0 md:px-0 pt-5 pb-4 md:pt-0 md:pb-0 overscroll-x-contain cursor-grab active:cursor-grabbing select-none"
          >
            {plans.map((tier, idx) => (
              <PlanCard
                key={tier.id}
                tier={tier}
                lang={lang}
                index={idx}
                selected={selected?.id === tier.id}
                isMyPlan={myStatus === 'active' && member?.tier_id === tier.id}
                tokens={grantFor(tier.id)}
                onSelect={() => {
                  selectTier(tier.id);
                  scrollToForm();
                }}
              />
            ))}
          </div>

          {/* Mobile Swipe Indicator with Clickable Navigation Arrows & Direct Page Progress */}
          <div className="md:hidden flex items-center justify-center gap-3 mt-3 text-xs text-neutral-500 select-none">
            <button
              type="button"
              onClick={() => scrollTiers('left')}
              disabled={currentTierIndex <= 1}
              className="p-1 rounded-full hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none text-neutral-500 transition-colors cursor-pointer"
              aria-label={data.plans.previousLabel}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-neutral-600 font-medium tracking-wide text-xs">
              {currentTierIndex} / {plans.length}
            </span>
            <button
              type="button"
              onClick={() => scrollTiers('right')}
              disabled={currentTierIndex >= plans.length}
              className="p-1 rounded-full hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none text-neutral-500 transition-colors cursor-pointer"
              aria-label={data.plans.nextLabel}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* One line saying what the number on the cards is, once, instead of
              repeating it on each of them. */}
          {anyGrant && (
            <div className="mt-6 sm:mt-8 max-w-3xl mx-auto flex items-start justify-center gap-2 text-xs sm:text-sm text-neutral-600 leading-relaxed">
              <Coins className="w-4 h-4 shrink-0 mt-0.5 text-brick" />
              <p>{data.plans.tokensNote}</p>
            </div>
          )}

          <div className="mt-6 sm:mt-8 max-w-3xl mx-auto text-center text-[11px] sm:text-xs text-neutral-400 space-y-1">
            <p>{data.note}</p>
            {hasInviteTier && <p>{data.inviteNote}</p>}
          </div>
        </div>
      </section>

      {/* 3. Apple Wallet Style Digital Pass & Checkout */}
      <section
        id="membership-form"
        className="py-16 sm:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-b border-neutral-200/80 overflow-hidden"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-10 xl:gap-12 items-start">
          {/* Left: Apple Wallet Passbook UI */}
          <motion.div
            initial={slideFromLeft}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={inView}
            transition={rise()}
            className="md:col-span-5 w-full max-w-lg md:max-w-none mx-auto md:mx-0 space-y-6"
          >
            <div>
              <span className="text-xs font-semibold text-brick block mb-1">
                {data.pass.eyebrow}
              </span>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
                {data.pass.title}
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-neutral-500">{data.pass.text}</p>
            </div>

            {/* Apple Wallet Sleek Pass Card. It gives under the pointer
                (TiltCard) rather than lifting: the same press as the member's
                real card on the account page, and the tilt draws the shadow. */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.1)}
            >
              <TiltCard gloss>
                <div className="bg-ink text-white rounded-2xl p-5 sm:p-6 lg:p-7 border border-white/10 relative overflow-hidden group">
                  <div className="flex justify-between items-center pb-5 sm:pb-6 border-b border-white/10 gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={data.pass.logoImage}
                        alt={data.pass.logoAlt}
                        className="h-7 w-auto flex-shrink-0 bg-white/10 rounded p-0.5"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold tracking-tight text-white truncate">
                          {data.pass.name}
                        </div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          {data.pass.location}
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 text-neutral-200 flex-shrink-0">
                      {selected ? shortLabel(selected) : ''}
                    </span>
                  </div>

                  <div className="py-5 sm:py-6 space-y-4">
                    <div>
                      <div className="text-[10px] text-neutral-400">{data.pass.cardholder}</div>
                      <div className="text-lg sm:text-xl font-medium tracking-tight text-white mt-0.5 truncate">
                        {member?.full_name || data.pass.guestName}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs">
                      <div>
                        <div className="text-[10px] text-neutral-400">
                          {data.pass.memberIdLabel}
                        </div>
                        <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                          {data.pass.memberIdValue}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-400">{data.pass.expiresLabel}</div>
                        <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                          {expiresLabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
                    <span className="text-[10px]">{data.pass.scanHint}</span>
                    <QrCode className="w-5 h-5 text-neutral-300 flex-shrink-0 group-hover:text-white transition-colors" />
                  </div>
                </div>
              </TiltCard>
            </motion.div>

            {/* Quick Member Portal Link */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.2)}
              whileHover={hoverLift}
              className="p-3.5 sm:p-4 rounded-xl bg-surface-3 border border-black/[0.04] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink">{data.portal.title}</div>
                <div className="text-[11px] text-neutral-500 leading-snug">{data.portal.text}</div>
              </div>
              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => onNavigate('account')}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white border border-neutral-200 text-xs font-medium text-ink hover:bg-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                {data.portal.button}
              </motion.button>
            </motion.div>
          </motion.div>

          {/* Right: Join / Renew / Change plan */}
          <motion.div
            id="membership-checkout"
            initial={slideFromRight}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={inView}
            transition={rise(0.15)}
            className="md:col-span-7 bg-white p-6 sm:p-8 lg:p-10 rounded-2xl border border-neutral-200/80 shadow-sm"
          >
            <h3 className="text-2xl font-semibold tracking-tight text-ink mb-1">
              {data.formTitle}
            </h3>
            <p className="text-xs sm:text-sm text-neutral-500 mb-8">
              {fill(data.form.intro, { email: content.contact.email })}
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-2">
                  {data.formTier}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
                  {plans.map((tier) => (
                    <motion.button
                      key={tier.id}
                      whileHover={hoverScale}
                      whileTap={tap}
                      type="button"
                      onClick={() => selectTier(tier.id)}
                      aria-pressed={selected?.id === tier.id}
                      className={`py-2.5 px-3 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer whitespace-nowrap ${
                        selected?.id === tier.id
                          ? 'bg-ink text-white border-ink'
                          : 'border-neutral-200 text-neutral-700 hover:bg-surface-3'
                      }`}
                    >
                      {shortLabel(tier)} • {isFree(tier) ? data.freeLabel : money(tier.price_cents)}
                    </motion.button>
                  ))}
                </div>
              </div>

              {ready && user && (
                <p className="text-xs text-neutral-600">
                  {data.form.signedInAs}{' '}
                  <span className="font-semibold text-ink">{user.email}</span>
                  {myTier && member?.status
                    ? ` — ${tierName(myTier, lang)} · ${statusLabel(effectiveStatus(member.status, member.expires_at), lang)}`
                    : ''}
                </p>
              )}

              {/* Order summary */}
              {selected && summary && (
                <div className="p-4 rounded-xl bg-surface-3 border border-black/[0.04] text-xs text-neutral-600 space-y-1.5">
                  <div className="font-semibold text-ink">
                    {fill(data.form.summaryTitle, { plan: tierName(selected, lang) })}
                  </div>
                  {free ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>{data.form.membership}</span>
                        <span>{data.freeLabel}</span>
                      </div>
                      <p className="pt-1 text-neutral-500">{data.form.freeNote}</p>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>{data.form.annual}</span>
                        <span className="tabular-nums">{usd(selected.price_cents)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>{data.form.cardFee}</span>
                        <span className="tabular-nums">{usd(summary.fee)}</span>
                      </div>
                      {mode !== 'switch' && applied && (
                        <div className="flex justify-between gap-3 text-emerald-700">
                          <span>
                            {fill(data.form.discountLine, {
                              code: applied.code,
                              percent: applied.percent_off,
                            })}
                          </span>
                          <span className="tabular-nums">−{usd(summary.off)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 pt-1.5 border-t border-black/[0.06] font-semibold text-ink">
                        <span>{mode === 'switch' ? data.form.newRate : data.form.totalToday}</span>
                        <span className="tabular-nums">{usd(summary.due)}</span>
                      </div>
                      {grantFor(selected.id) > 0 && (
                        <div className="flex justify-between gap-3 pt-1 text-brick">
                          <span>{data.form.tokensIncluded}</span>
                          <span className="tabular-nums">
                            {grantFor(selected.id).toLocaleString('en-US')}
                          </span>
                        </div>
                      )}
                      <p className="pt-1 text-neutral-500">
                        {mode !== 'switch' && applied
                          ? fill(data.form.discountFirstYear, { total: usd(summary.total) })
                          : data.form.renewsYearly}
                      </p>
                    </>
                  )}
                </div>
              )}

              {showCodeEntry && (
                <div>
                  <label
                    htmlFor="membership-discount"
                    className="block text-xs font-medium text-neutral-700 mb-1"
                  >
                    {data.form.codeLabel}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="membership-discount"
                      type="text"
                      value={codeInput}
                      onChange={(e) => {
                        setCodeInput(e.target.value);
                        setCodeMsg('');
                      }}
                      onKeyDown={(e) => {
                        // Enter applies the code instead of submitting the checkout.
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void applyCode(codeInput);
                        }
                      }}
                      autoComplete="off"
                      placeholder={data.form.codePlaceholder}
                      className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-ink focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void applyCode(codeInput)}
                      disabled={codeBusy}
                      className="shrink-0 px-4 py-2.5 rounded-xl border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      {codeBusy ? data.form.codeChecking : data.form.codeApply}
                    </button>
                  </div>
                  {applied && (
                    <p className="mt-1.5 text-[11px] text-emerald-700">
                      {fill(data.form.codeApplied, {
                        code: applied.code,
                        percent: applied.percent_off,
                      })}
                    </p>
                  )}
                  {codeMsg && (
                    <p className="mt-1.5 text-[11px] text-red-600" role="alert">
                      {codeMsg}
                    </p>
                  )}
                </div>
              )}

              {modeNote && <p className="text-xs text-neutral-600 leading-relaxed">{modeNote}</p>}

              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="submit"
                disabled={busy || !mode}
                aria-busy={busy}
                className="w-full py-3.5 px-6 rounded-full bg-ink hover:bg-neutral-800 text-white text-xs sm:text-sm font-medium tracking-wide transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap shadow-sm disabled:opacity-60 disabled:cursor-default"
              >
                <span>{submitLabel}</span>
                {!busy && mode === 'checkout' && summary && <span>({usd(summary.due)})</span>}
              </motion.button>

              {error && (
                <p className="text-xs text-red-600 text-center" role="alert">
                  {error}
                </p>
              )}

              {!free && (mode === 'checkout' || mode === 'switch') && (
                <p className="text-[11px] text-neutral-400 text-center">
                  {data.form.securePayment}
                </p>
              )}
            </form>
          </motion.div>
        </div>
      </section>

      {/* 4. Community Privileges (Clean 3-Column Grid) */}
      <section
        id="community-privileges"
        className="py-16 sm:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-hidden"
      >
        <motion.div
          initial={riseFrom}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inView}
          transition={rise()}
          className="max-w-3xl mb-14"
        >
          <span className="text-xs font-semibold text-brick block mb-2">
            {data.privileges.eyebrow}
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
            {data.benefitsTitle}
          </h2>
          <p className="mt-3 text-base text-neutral-600 leading-relaxed">{data.privileges.text}</p>
        </motion.div>

        <div className="flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none -mx-4 px-6 sm:-mx-6 sm:px-8 md:mx-0 md:px-0 pt-2 pb-4 md:pt-0 md:pb-0 overscroll-x-contain">
          {data.privileges.items.map((item, idx) => {
            const Icon = PRIVILEGE_ICONS[item.icon] ?? Star;
            return (
              <motion.div
                key={idx}
                initial={riseFrom}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={inView}
                transition={rise(0.05 + idx * 0.1)}
                whileHover={hoverLift}
                className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
              >
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs group-hover:scale-110 transition-transform duration-300">
                    <Icon className="w-5 h-5 text-brick" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-ink tracking-tight">
                    {item.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">{item.text}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      <ContactSection content={content} />
    </div>
  );
}
