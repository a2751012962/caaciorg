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
import { QrCode, ShieldCheck, Star, Gift, Utensils, ChevronRight, ChevronLeft } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { membershipPageDataEN, membershipPageDataZH } from '../data/pagesContent';
import { api } from '../lib/api';
import { loginUrl, useAuth } from '../lib/auth';
import { statusLabel, usd } from '../lib/shared';
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
import { smoothScrollTo } from '../utils/smoothScroll';

interface MembershipPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal?: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// Scroll to the checkout panel, not its section: on phones the section stacks
// the member pass above the form, so the section top landed on the pass card.
const scrollToForm = () => smoothScrollTo('membership-checkout', { offset: -90, duration: 0.9 });

export function MembershipPage({ content, lang, onNavigate }: MembershipPageProps) {
  const data = lang === 'en' ? membershipPageDataEN : membershipPageDataZH;
  const t = (en: string, zh: string) => (lang === 'en' ? en : zh);
  const { ready, user, member, refreshMember } = useAuth();
  const tiers = useTiers();
  const plans = useMemo(() => purchasable(tiers), [tiers]);
  const hasInviteTier = tiers.some((x) => x.invite_only);

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
    msg === 'network'
      ? t('Network error — please try again.', '网络错误，请重试。')
      : msg || fallback;

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
      setCodeMsg(serverError(res.error, t('Invalid discount code.', '折扣码无效。')));
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
      const { ok, data: res } = await api<{ url?: string }>('/api/change-plan', {
        member_id: user.id,
        tier_id: selected.id,
      });
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      if (!ok) {
        setBusy(false);
        setError(serverError(res.error, t('Could not change the plan.', '无法更改方案。')));
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
    const { ok, data: res } = await api<{ url?: string; activated?: boolean }>(
      '/api/checkout',
      body,
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
    setError(
      serverError(res.error, t('Checkout failed — please try again.', '结账失败，请重试。')),
    );
  };

  const submitLabel = (() => {
    if (busy) return t('Please wait…', '请稍候…');
    switch (mode) {
      case null:
        return t('Loading…', '加载中…');
      case 'signin':
        return t('Log in or sign up to continue', '登录或注册后继续');
      case 'current':
        return t('Go to my account', '前往我的账户');
      case 'fix-billing':
      case 'cancel-first':
        return t('Manage billing in my account', '在我的账户中管理账单');
      case 'free':
        return t('Join for free', '免费加入');
      case 'switch':
        return t('Confirm plan change', '确认更改方案');
      default:
        return data.formSubmit;
    }
  })();

  const modeNote = (() => {
    switch (mode) {
      case 'signin':
        return t(
          'You will log in or create an account first, then come straight back here to finish.',
          '需先登录或注册账户，完成后会自动返回本页继续。',
        );
      case 'current':
        return t('You are already on this plan.', '您已是该方案的会员。');
      case 'fix-billing':
        return t(
          'Your last payment failed. Update your card from Manage billing in your account before changing plans.',
          '上次扣款失败。请先在账户的“管理账单”中更新银行卡，再更改方案。',
        );
      case 'cancel-first':
        return t(
          'To move to the free membership, cancel your paid plan from Manage billing in your account first.',
          '如需改为免费会员，请先在账户的“管理账单”中取消付费方案。',
        );
      case 'switch':
        return t(
          'Your subscription is updated in place — Stripe prorates the difference.',
          '订阅将原地更新——Stripe 会按比例结算差价。',
        );
      default:
        return '';
    }
  })();

  const showCodeEntry = !!selected && !free && (mode === 'checkout' || mode === 'signin');
  const expiresLabel = (() => {
    if (!selected) return '';
    if (free) return t('NEVER', '永不过期');
    if (member?.status === 'active' && member.tier_id === selected.id && member.expires_at)
      return new Date(member.expires_at)
        .toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
        .toUpperCase();
    return t('12 MONTHS', '12 个月');
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
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 font-sans"
          >
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 font-medium text-neutral-700 hover:text-brick transition-colors cursor-pointer group"
              title={lang === 'en' ? 'Back to Menu' : '返回菜单'}
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 text-neutral-400 group-hover:text-brick" />
              <span>{lang === 'en' ? 'Back to Menu' : '返回菜单'}</span>
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
              {lang === 'en' ? 'Choose Your Plan' : '入会方案'}
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
              {lang === 'en' ? 'Membership Tiers & Annual Dues' : '会员类别与年度会费'}
            </h2>
            <p className="mt-2 text-sm text-neutral-500">
              {lang === 'en'
                ? 'Every contribution directly supports our community cultural events and civic programs.'
                : '所有会费直接投入到华协举办的重大文化庆典、社区互助与青少年公益项目中。'}
            </p>
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
                isMyPlan={member?.status === 'active' && member.tier_id === tier.id}
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
              aria-label="Previous plan"
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
              aria-label="Next plan"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

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
                {lang === 'en' ? 'Digital Pass' : '电子会员凭证'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
                {lang === 'en' ? 'Apple Wallet Pass' : '电子会员卡实时预览'}
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-neutral-500">
                {lang === 'en'
                  ? 'Your digital badge can be added to Apple Wallet or accessed anytime via your Member Account.'
                  : '入会后将自动生成专属实名电子卡，可出示享受合作商户立减与活动快速签到。'}
              </p>
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
                        src="/images/logo.png"
                        alt="CAACI"
                        className="h-7 w-auto flex-shrink-0 bg-white/10 rounded p-0.5"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold tracking-tight text-white truncate">
                          CAACI Member Pass
                        </div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          Central Illinois • 501(c)(3)
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/15 text-neutral-200 flex-shrink-0">
                      {selected ? shortLabel(selected) : ''}
                    </span>
                  </div>

                  <div className="py-5 sm:py-6 space-y-4">
                    <div>
                      <div className="text-[10px] text-neutral-400">
                        {lang === 'en' ? 'Cardholder Name' : '持卡人姓名'}
                      </div>
                      <div className="text-lg sm:text-xl font-medium tracking-tight text-white mt-0.5 truncate">
                        {member?.full_name || (lang === 'en' ? 'Guest Member' : '华协新会员')}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs">
                      <div>
                        <div className="text-[10px] text-neutral-400">Member ID</div>
                        <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                          CAACI-••••
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-400">Expires</div>
                        <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                          {expiresLabel}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
                    <span className="text-[10px]">Tap or scan for merchant discounts</span>
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
                <div className="text-xs font-semibold text-ink">
                  {lang === 'en' ? 'Already a member?' : '已经是华协会员？'}
                </div>
                <div className="text-[11px] text-neutral-500 leading-snug">
                  {lang === 'en'
                    ? 'Access your digital pass and partner perks'
                    : '登录会员中心查看折扣券与续费状态'}
                </div>
              </div>
              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => onNavigate('account')}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white border border-neutral-200 text-xs font-medium text-ink hover:bg-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                {lang === 'en' ? 'Member Portal' : '进入会员专区'}
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
              {lang === 'en'
                ? `Choose a plan and pay securely by card on Stripe; your membership is activated automatically once payment completes. We accept other payment methods too (check, Zelle, cash) — email ${content.contact.email} and we'll arrange it.`
                : `选择方案后通过 Stripe 安全刷卡支付，付款完成后会员资格自动生效。我们也接受支票、Zelle、现金等其他付款方式，请发邮件至 ${content.contact.email} 与我们联系安排。`}
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
                      {shortLabel(tier)} •{' '}
                      {isFree(tier) ? t('Free', '免费') : money(tier.price_cents)}
                    </motion.button>
                  ))}
                </div>
              </div>

              {ready && user && (
                <p className="text-xs text-neutral-600">
                  {t('Signed in as', '当前登录')}{' '}
                  <span className="font-semibold text-ink">{user.email}</span>
                  {myTier && member?.status
                    ? ` — ${tierName(myTier, lang)} · ${statusLabel(member.status, lang)}`
                    : ''}
                </p>
              )}

              {/* Order summary */}
              {selected && summary && (
                <div className="p-4 rounded-xl bg-surface-3 border border-black/[0.04] text-xs text-neutral-600 space-y-1.5">
                  <div className="font-semibold text-ink">
                    {t('Order Summary', '费用明细')} · {tierName(selected, lang)}
                  </div>
                  {free ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>{t('Membership', '会费')}</span>
                        <span>{t('Free', '免费')}</span>
                      </div>
                      <p className="pt-1 text-neutral-500">
                        {t(
                          'No payment needed and nothing expires. Upgrade to a paid plan any time for the annual meeting and festival perks.',
                          '无需付款，永不过期。可随时升级为付费会员，享受会员大会和节日福利。',
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>{t('Annual membership', '年度会费')}</span>
                        <span className="tabular-nums">{usd(selected.price_cents)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>{t('Card processing fee (3.5%)', '银行卡手续费（3.5%）')}</span>
                        <span className="tabular-nums">{usd(summary.fee)}</span>
                      </div>
                      {mode !== 'switch' && applied && (
                        <div className="flex justify-between gap-3 text-emerald-700">
                          <span>
                            {applied.code} −{applied.percent_off}%
                          </span>
                          <span className="tabular-nums">−{usd(summary.off)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 pt-1.5 border-t border-black/[0.06] font-semibold text-ink">
                        <span>
                          {mode === 'switch'
                            ? t('New annual rate', '新年费')
                            : t('Total today', '今日合计')}
                        </span>
                        <span className="tabular-nums">{usd(summary.due)}</span>
                      </div>
                      <p className="pt-1 text-neutral-500">
                        {mode !== 'switch' && applied
                          ? t(
                              `Discount applies to your first year only; renews at ${usd(summary.total)}/yr.`,
                              `折扣仅限首年；续费价为 ${usd(summary.total)}/年。`,
                            )
                          : t('Renews yearly; cancel anytime.', '按年续费，可随时取消。')}
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
                    {t('Discount Code (Optional)', '折扣码（选填）')}
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
                      placeholder={t('Enter code', '输入折扣码')}
                      className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-ink focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void applyCode(codeInput)}
                      disabled={codeBusy}
                      className="shrink-0 px-4 py-2.5 rounded-xl border border-neutral-200 text-xs font-medium text-neutral-700 hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      {codeBusy ? t('Checking…', '验证中…') : t('Apply', '应用')}
                    </button>
                  </div>
                  {applied && (
                    <p className="mt-1.5 text-[11px] text-emerald-700">
                      {applied.code} — {applied.percent_off}% {t('off your first year', '首年折扣')}
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
                  {t('Secure payment via Stripe', '通过 Stripe 安全支付')}
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
            {lang === 'en' ? 'Community Privileges' : '会员专享礼遇'}
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
            {data.benefitsTitle}
          </h2>
          <p className="mt-3 text-base text-neutral-600 leading-relaxed">
            {lang === 'en'
              ? 'Join over 800+ members and families strengthening the Chinese American community across Central Illinois.'
              : '加入香槟及中部伊利诺伊 800+ 位华人学者、留学生与家庭的互助大家庭，享有全年度社区礼遇。'}
          </p>
        </motion.div>

        <div className="flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none -mx-4 px-6 sm:-mx-6 sm:px-8 md:mx-0 md:px-0 pt-2 pb-4 md:pt-0 md:pb-0 overscroll-x-contain">
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise(0.05)}
            whileHover={hoverLift}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Utensils className="w-5 h-5 text-brick" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-ink tracking-tight">
                {lang === 'en' ? 'Annual Meeting Free Luncheon' : '年度大会免费午宴'}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {lang === 'en'
                  ? 'Enjoy complimentary gourmet Chinese lunch buffets and executive reports at the CAACI Annual Membership Conference.'
                  : '受邀参加每年一度的 CAACI 全体会员大会，全程免费享用丰盛传统中华午宴。'}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise(0.15)}
            whileHover={hoverLift}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Gift className="w-5 h-5 text-brick" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-ink tracking-tight">
                {lang === 'en' ? 'Festival Ticket Discounts' : '节日盛典门票特惠'}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {lang === 'en'
                  ? 'Special discounted admission and priority seating at Spring Festival Gala, Mid-Autumn celebrations, and Dragon Boat picnics.'
                  : '享有新春晚会、中秋游园灯会、端午聚会等重大节日庆典的会员专属门票折扣与优先席位。'}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise(0.25)}
            whileHover={hoverLift}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Star className="w-5 h-5 text-brick" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-ink tracking-tight">
                {lang === 'en' ? 'Partner Business Discounts' : '本地商户专属立减'}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {lang === 'en'
                  ? 'Show your digital CAACI Membership Card at participating restaurants, grocery stores, and professional service providers.'
                  : '在香槟-厄巴纳合作中餐厅、亚洲超市及专业服务机构出示电子会员卡，享受专属立减折扣。'}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise(0.35)}
            whileHover={hoverLift}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <ShieldCheck className="w-5 h-5 text-brick" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-ink tracking-tight">
                {lang === 'en' ? 'Verified WeChat Network' : '实名认证微信互助社群'}
              </h3>
              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {lang === 'en'
                  ? 'Connect with scholars, alumni, and families in spam-free, verified local mutual-help community groups.'
                  : '加入实名认证的香槟伊大校友、学者及本地华人家庭专属微信交流群，第一时间获取安居与求学资讯。'}
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      <ContactSection content={content} />
    </div>
  );
}
