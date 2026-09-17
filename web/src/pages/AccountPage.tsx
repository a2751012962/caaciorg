import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { mountIn, riseFromSm } from '../lib/motion';
import { FluidTabs } from '../components/FluidTabs';
import {
  User,
  CreditCard,
  History,
  Lock,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Calendar,
  MapPin,
  Clock,
  Ticket,
  ChevronRight,
  LogOut,
  RefreshCw,
  Info,
  Users,
  Layers,
  Award,
  Maximize2,
  X,
} from 'lucide-react';
import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import { DigitalMemberCard } from '../components/DigitalMemberCard';
import { FamilySection } from '../components/FamilySection';
import { SecurityCard } from './account/SecurityCard';
import { TokenWallet } from '../components/tokens/TokenWallet';
import { RecoveryNotice } from './account/RecoveryNotice';
import { ProfileEdit } from './account/ProfileEditModal';
import { EventFeedback } from './account/EventFeedback';
import { CancelRsvp } from './account/CancelRsvp';
import { FEATURES } from '../lib/features';
import { loginUrl, useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { isFreeTier, statusLabel, usd, withFee } from '../lib/shared';
import {
  dropParams,
  eventDay,
  eventOver,
  eventTime,
  fallbackTiers,
  fetchFamily,
  fmtDate,
  loadPayments,
  loadRegisteredEvents,
  loadTiers,
  readLanding,
  tierName,
  tr,
} from '../lib/account';
import type { FamilyData, PaymentRow, RegisteredEvent, Tier } from '../types/account';
import type { CAACIContent } from '../data/content';

interface AccountPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
  // Passed by App.tsx; the page reads the session from useAuth() itself.
  isLoggedIn?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
}

type MobileTab = 'pass' | 'events' | 'family' | 'billing' | 'profile' | 'all';
type CheckoutState = 'none' | 'waiting' | 'active' | 'slow';

const CHECKOUT_POLL_MS = 3000;
const CHECKOUT_WAIT_MS = 15000;

export function AccountPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
  onLogout,
}: AccountPageProps) {
  const t = tr(lang);
  const { ready, user, member, refreshMember, signOut } = useAuth();
  const userId = user?.id ?? null;
  const [landing] = useState(readLanding);

  // Mobile segmented navigation tab state
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>(() =>
    landing.familyInvite ? 'family' : 'pass',
  );
  const [showQrZoomModal, setShowQrZoomModal] = useState(false);

  // ---- membership tiers (live rows merged over the built-in catalogue) ----
  const [tiers, setTiers] = useState<Tier[]>(fallbackTiers);
  useEffect(() => {
    let alive = true;
    void loadTiers().then((rows) => alive && setTiers(rows));
    return () => {
      alive = false;
    };
  }, []);

  // ---- payment history (undefined = loading, null = failed) ----
  const [payments, setPayments] = useState<PaymentRow[] | null | undefined>(undefined);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadPayments(userId).then((rows) => alive && setPayments(rows));
    return () => {
      alive = false;
    };
  }, [userId, member?.status, member?.expires_at]);

  // ---- registered events (undefined = loading, null = failed) ----
  const [events, setEvents] = useState<RegisteredEvent[] | null | undefined>(undefined);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void loadRegisteredEvents(userId).then((rows) => alive && setEvents(rows));
    return () => {
      alive = false;
    };
  }, [userId]);

  // ---- family: GET once, again after each change (FamilySection calls reload) ----
  const [family, setFamily] = useState<FamilyData | null>(null);
  const [familyLoading, setFamilyLoading] = useState(true);
  const [familyRefreshFailed, setFamilyRefreshFailed] = useState(false);
  const familyRef = useRef<FamilyData | null>(null);
  const reloadFamily = useCallback(async () => {
    const data = await fetchFamily();
    if (data) {
      familyRef.current = data;
      setFamily(data);
      setFamilyRefreshFailed(false);
    } else if (familyRef.current) {
      // Keep the last view that rendered, with a note, instead of hiding it.
      setFamilyRefreshFailed(true);
    }
    setFamilyLoading(false);
  }, []);
  useEffect(() => {
    if (!userId) {
      familyRef.current = null;
      setFamily(null);
      setFamilyLoading(true);
      return;
    }
    void reloadFamily();
  }, [userId, member?.status, reloadFamily]);

  // ---- ?checkout=success: wait for the Stripe webhook to activate the row ----
  const [checkout, setCheckout] = useState<CheckoutState>(
    landing.checkoutSuccess ? 'waiting' : 'none',
  );
  const refreshRef = useRef(refreshMember);
  useEffect(() => {
    refreshRef.current = refreshMember;
  });
  useEffect(() => {
    if (checkout !== 'waiting' || !ready || !userId || member?.status !== 'active') return;
    setCheckout('active');
    dropParams(['checkout']);
  }, [checkout, ready, userId, member?.status]);
  useEffect(() => {
    if (checkout !== 'waiting' || !ready || !userId) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started >= CHECKOUT_WAIT_MS - 500) {
        clearInterval(id);
        setCheckout((c) => (c === 'waiting' ? 'slow' : c));
        dropParams(['checkout']);
        return;
      }
      void refreshRef.current();
    }, CHECKOUT_POLL_MS);
    return () => clearInterval(id);
  }, [checkout, ready, userId]);

  // ---- billing portal ----
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const openBilling = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingError(null);
    const res = await api<{ url?: string }>('/api/portal', {}, { auth: true });
    if (res.ok && res.data.url) {
      window.location.assign(res.data.url);
      return; // stays busy while the browser leaves for Stripe
    }
    setBillingBusy(false);
    setBillingError(
      res.status === 0
        ? t('Network error — please try again.', '网络错误，请重试。')
        : String(res.data.error || t('Could not open the billing portal.', '无法打开账单管理。')),
    );
  };

  // ---- which membership the page shows ----
  // Own tier when it is active; otherwise an active family plan the member is in
  // (founder or member) — the same rule the card and /api/verify use; otherwise
  // the member's own (inactive) tier, if any.
  const ownTier = member?.tier_id ? (tiers.find((x) => x.id === member.tier_id) ?? null) : null;
  const ownActive = !!ownTier && member?.status === 'active';
  const familyPlanActive =
    !!family &&
    (family.role === 'founder' || family.role === 'member') &&
    family.plan?.status === 'active';
  const viaFamily = !ownActive && familyPlanActive;
  const familyTier = viaFamily
    ? (tiers.find((x) => x.id === family?.plan?.tier_id) ??
      tiers.find((x) => x.id === 'family') ??
      null)
    : null;
  const cardActive = ownActive || familyPlanActive;
  const shownTier = viaFamily ? familyTier : ownTier;
  const shownStatus = ownActive || viaFamily ? 'active' : (member?.status ?? null);
  const shownExpires = viaFamily
    ? (family?.plan?.expires_at ?? null)
    : (member?.expires_at ?? null);
  const shownTierName = shownTier
    ? tierName(shownTier, lang)
    : viaFamily
      ? t('Family Membership', '家庭会员')
      : '';
  const pastDue = member?.status === 'past_due';
  const hasBilling = !!member?.stripe_customer_id;
  const displayName = member?.full_name || user?.email || '';
  const validThrough = shownExpires ? fmtDate(shownExpires, lang) : t('No expiry', '长期有效');

  const familyTierRow = tiers.find((x) => x.id === 'family');
  const familyPriceLabel =
    familyTierRow && familyTierRow.price_cents > 0
      ? `${usd(withFee(familyTierRow.price_cents))}/${t('yr', '年')}`
      : null;

  const priceLabel = (tier: Tier) =>
    tier.price_cents > 0
      ? `${usd(withFee(tier.price_cents))} / ${t('year', '年')}`
      : isFreeTier(tier)
        ? t('Free', '免费')
        : t('Invitation only', '仅限邀请');

  const expiryTitle =
    shownStatus === 'active'
      ? member?.stripe_subscription_id && !viaFamily
        ? t('Renews On', '续费日期')
        : t('Valid Through', '有效期至')
      : t('Expires', '到期日期');
  const expiryValue = shownExpires
    ? fmtDate(shownExpires, lang)
    : shownTier && isFreeTier(shownTier)
      ? t('Never expires', '永不过期')
      : '—';

  const planButtonLabel = !shownTier
    ? t('Join Membership', '加入会员')
    : viaFamily
      ? t('View Membership Plans', '查看会员方案')
      : isFreeTier(shownTier)
        ? t('Upgrade Membership', '升级会员')
        : shownStatus === 'expired' || shownStatus === 'cancelled'
          ? t('Renew Membership', '续费会员')
          : t('Change Membership Plan', '更改方案');

  // Smooth scroll and jump to specific section
  const handleJumpToSection = (tab: Exclude<MobileTab, 'all'>, targetId?: string) => {
    setActiveMobileTab(tab);
    if (targetId) {
      setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('ring-2', 'ring-brick', 'ring-offset-2');
          setTimeout(() => el.classList.remove('ring-2', 'ring-brick', 'ring-offset-2'), 1800);
        }
      }, 80);
    }
  };
  const goToSecurity = () => handleJumpToSection('profile', 'account-security');

  const handleSignOut = () => {
    if (onLogout) onLogout();
    else void signOut().then(() => onNavigate('home'));
  };

  // /login-3/ returns to ?next= after signing in, so ?family_invite survives.
  const here = () => window.location.pathname + window.location.search;

  // Signed out, this page has nothing of its own to show: the sign-in page is
  // /login-3/, which comes straight back here (?next=) with any ?family_invite
  // intact. replace(), so Back does not bounce through this page again.
  //   * A dead email link (expired or already-used reset link) stays here: the
  //     notice below is the only place that explains it.
  //   * Someone who signs OUT while on this page is not sent to sign in again;
  //     App.tsx takes them home. Only arriving signed out redirects.
  const staysSignedOut = landing.recovery || landing.linkFailed;
  const hadSession = useRef(false);
  if (user) hadSession.current = true;
  useEffect(() => {
    if (!ready || user || hadSession.current || staysSignedOut) return;
    window.location.replace(loginUrl(here()));
  }, [ready, user, staysSignedOut]);

  const shownOn = (tab: MobileTab) =>
    activeMobileTab === tab || activeMobileTab === 'all' ? 'block' : 'hidden';

  const familySeatsBadge =
    family && (family.role === 'founder' || (family.role === 'none' && family.can_start_family))
      ? `${Math.max(1, family.seats.used)}/${family.seats.limit || 3}`
      : null;
  const familyVisible = familyLoading || !!family;

  const lockedCard = (compact: boolean) => (
    <div className={`${compact ? 'py-6' : 'py-8'} text-center space-y-3`}>
      <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
        <Lock className="w-6 h-6" />
      </div>
      <h4 className="text-sm font-bold text-neutral-900">
        {lang === 'en' ? 'Digital Member Card Locked' : '电子会员卡未激活'}
      </h4>
      <p className="text-xs text-neutral-500 leading-relaxed max-w-xs mx-auto">
        {lang === 'en'
          ? 'Your digital card with its live verification QR appears here while your membership is active.'
          : '会员资格有效期间，这里会显示带实时验证二维码的电子会员卡。'}
      </p>
      <button
        type="button"
        onClick={() => onNavigate('membership')}
        className="min-h-[44px] px-6 py-2.5 rounded-full bg-brick text-white text-xs font-semibold cursor-pointer active:scale-98"
      >
        {shownTier
          ? t('Renew or Change Plan', '续费或更改方案')
          : t('Activate Membership', '激活会员资格')}
      </button>
    </div>
  );

  const card = (mobile: boolean) => (
    <DigitalMemberCard
      lang={lang}
      memberId={member?.id || userId || ''}
      name={displayName}
      tierName={shownTierName}
      validThrough={validThrough}
      viaFamily={viaFamily}
      {...(mobile ? { zoomOpen: showQrZoomModal, onZoomChange: setShowQrZoomModal } : {})}
    />
  );

  return (
    <div className="min-h-screen bg-white pb-24 overflow-x-hidden">
      {/* Editorial Header - Desktop Only to keep Mobile clean & focused */}
      <div className="hidden sm:block">
        <SubpageHero
          title={lang === 'en' ? 'Member Portal' : '会员中心'}
          subtitle={
            lang === 'en'
              ? 'Account credentials, digital member passes, and household privileges.'
              : 'CAACI 个人中心、电子会员卡、家庭方案及活动凭证管理'
          }
          content={content}
          onOpenModal={onOpenModal}
          onNavigate={onNavigate}
          currentPage="account"
          showActionBanners={false}
        />
      </div>

      {!ready ? (
        /* ===================================================================== */
        /* 0. LOADING */
        /* ===================================================================== */
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-0 sm:-mt-8 relative z-20">
          <div
            role="status"
            className="py-16 flex items-center justify-center gap-2 text-sm text-neutral-500"
          >
            <RefreshCw className="w-4 h-4 animate-spin text-brick" />
            <span>{t('Loading your account…', '正在加载您的账户…')}</span>
          </div>
        </section>
      ) : !user ? (
        /* ===================================================================== */
        /* 1. NOT LOGGED IN: the sign-in page is /login-3/ (see the effect above). */
        /* Only a dead email link is explained here, since the login page cannot.   */
        /* ===================================================================== */
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-0 sm:-mt-8 relative z-20 space-y-4">
          {staysSignedOut ? (
            <RecoveryNotice
              lang={lang}
              recovery={landing.recovery}
              linkFailed={landing.linkFailed}
              signedIn={false}
              onGoToSecurity={goToSecurity}
            />
          ) : (
            <div
              role="status"
              className="py-16 flex items-center justify-center gap-2 text-sm text-neutral-500"
            >
              <RefreshCw className="w-4 h-4 animate-spin text-brick" />
              <span>{t('Taking you to sign in…', '正在前往登录页面…')}</span>
            </div>
          )}
        </section>
      ) : (
        /* ===================================================================== */
        /* 2. LOGGED IN STATE (登录后) */
        /* ===================================================================== */
        <div className="max-w-7xl mx-auto px-3.5 sm:px-6 pt-4 sm:pt-0 sm:-mt-8 relative z-20 space-y-5 sm:space-y-8">
          {/* PERSONAL PROFILE SUMMARY */}
          <div className="py-2 px-1 transition-all">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Left: Avatar & User Identity */}
              <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-brick to-brick-800 text-white flex items-center justify-center font-bold text-lg sm:text-xl shadow-xs">
                    {displayName.slice(0, 1).toUpperCase() || '?'}
                  </div>
                  <span
                    className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-2xs ${
                      cardActive ? 'bg-emerald-500' : pastDue ? 'bg-rose-500' : 'bg-neutral-300'
                    }`}
                    title={
                      cardActive
                        ? t('Active membership', '会员有效')
                        : t('No active membership', '暂无有效会员')
                    }
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-base sm:text-xl font-bold text-ink tracking-tight break-words">
                      {displayName}
                    </h2>
                    <span className="text-xs sm:text-sm font-medium text-brick">
                      {shownTierName || t('No membership yet', '尚未加入会员')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                    <span className="truncate">{user.email}</span>
                    {(member?.member_since || member?.created_at) && (
                      <>
                        <span className="text-neutral-300 hidden sm:inline">•</span>
                        <span className="text-[11px] text-neutral-400 shrink-0">
                          {t('Member since', '入会于')}{' '}
                          {fmtDate(member?.member_since || member?.created_at, lang)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Quick Jump Shortcuts */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0 pt-1 lg:pt-0">
                <button
                  type="button"
                  onClick={() => handleJumpToSection('events', 'registered-events')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 shadow-2xs active:scale-95 ${
                    activeMobileTab === 'events'
                      ? 'bg-brick text-white'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-200/90'
                  }`}
                  title={lang === 'en' ? 'Jump to Registered Events' : '直接跳转至活动日程'}
                >
                  <Ticket className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Events: ' : '活动: '}</span>
                  <span className="font-bold">{events ? events.length : '—'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleJumpToSection('pass')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 shadow-2xs active:scale-95 ${
                    activeMobileTab === 'pass'
                      ? 'bg-brick text-white'
                      : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-200/90'
                  }`}
                  title={lang === 'en' ? 'Digital Member Pass Status' : '会员通行证状态'}
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'Pass: ' : '会员卡: '}</span>
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        cardActive
                          ? activeMobileTab === 'pass'
                            ? 'bg-emerald-300'
                            : 'bg-emerald-500'
                          : 'bg-neutral-400'
                      }`}
                    />
                    <span>{cardActive ? t('Active', '有效') : t('Inactive', '未激活')}</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 shadow-2xs active:scale-95 bg-white hover:bg-neutral-50 text-neutral-600 border border-neutral-200/90"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t('Sign Out', '退出登录')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 华协币钱包, first on the page. Renders nothing until the server says
              tokens are on. On a phone it is one row (the balance) until opened,
              so the member card's QR below stays close. */}
          <TokenWallet lang={lang} />

          {/* TOP ALERTS & MOBILE QUICK TABS */}
          <div className="space-y-4">
            <RecoveryNotice
              lang={lang}
              recovery={landing.recovery}
              linkFailed={landing.linkFailed}
              signedIn
              onGoToSecurity={goToSecurity}
            />

            {checkout !== 'none' && (
              <div
                role="status"
                className={`p-4 rounded-2xl border flex items-start gap-3 ${
                  checkout === 'slow'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-emerald-50 border-emerald-200'
                }`}
              >
                {checkout === 'waiting' ? (
                  <RefreshCw className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5 animate-spin" />
                ) : checkout === 'active' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 text-xs">
                  <span
                    className={`font-bold block sm:inline mr-2 ${checkout === 'slow' ? 'text-amber-950' : 'text-emerald-950'}`}
                  >
                    {t('Payment received — thank you!', '付款成功，感谢支持！')}
                  </span>
                  <span className={checkout === 'slow' ? 'text-amber-800' : 'text-emerald-800'}>
                    {checkout === 'waiting'
                      ? t('Activating your membership…', '正在激活您的会员资格…')
                      : checkout === 'active'
                        ? t('Your membership is active.', '您的会员资格已生效。')
                        : t(
                            'Your membership is still being activated. This can take a minute — refresh this page shortly. You will not be charged again.',
                            '会员资格仍在激活中，可能需要一分钟，请稍后刷新本页面。不会重复扣款。',
                          )}
                  </span>
                </div>
                {checkout !== 'waiting' && (
                  <button
                    type="button"
                    onClick={() => setCheckout('none')}
                    className={`p-1 cursor-pointer ${checkout === 'slow' ? 'text-amber-700' : 'text-emerald-700'}`}
                    aria-label={t('Dismiss', '关闭')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}

            {/* Mobile Sticky Segmented Quick Tabs */}
            <div className="lg:hidden sticky top-16 z-30 bg-white/95 backdrop-blur-md py-1.5 -mx-3.5 px-3.5 border-y border-neutral-200/70 shadow-xs">
              <FluidTabs<MobileTab>
                id="account-sections"
                tone="brand"
                ariaLabel={lang === 'en' ? 'Account sections' : '账户分区'}
                value={activeMobileTab}
                onChange={setActiveMobileTab}
                className="flex items-center gap-1 overflow-x-auto no-scrollbar"
                itemClassName="shrink-0 px-3.5"
                items={[
                  {
                    value: 'pass',
                    label: (
                      <>
                        <Award className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'Digital Pass' : '会员卡'}</span>
                      </>
                    ),
                  },
                  {
                    value: 'events',
                    label: (
                      <>
                        <Ticket className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'My Events' : '我的活动'}</span>
                        {!!events?.length && (
                          <span className="font-bold text-xs">{events.length}</span>
                        )}
                      </>
                    ),
                  },
                  ...(familyVisible
                    ? [
                        {
                          value: 'family' as const,
                          label: (active: boolean) => (
                            <>
                              <Users className="w-3.5 h-3.5" />
                              <span>{lang === 'en' ? 'Family' : '家庭成员'}</span>
                              {familySeatsBadge && (
                                <span
                                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                                    active
                                      ? 'bg-white/20 text-white'
                                      : 'bg-neutral-100 text-neutral-600'
                                  }`}
                                >
                                  {familySeatsBadge}
                                </span>
                              )}
                            </>
                          ),
                        },
                      ]
                    : []),
                  {
                    value: 'billing',
                    label: (
                      <>
                        <History className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'Billing' : '订阅账单'}</span>
                        {pastDue && (
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                        )}
                      </>
                    ),
                  },
                  {
                    value: 'profile',
                    label: (
                      <>
                        <User className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'Profile & Security' : '资料与安全'}</span>
                      </>
                    ),
                  },
                  {
                    value: 'all',
                    label: (
                      <>
                        <Layers className="w-3.5 h-3.5" />
                        <span>{lang === 'en' ? 'All' : '全部'}</span>
                      </>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {/* DIGITAL MEMBER CARD (MOBILE PASS TAB) */}
          <div className={`${shownOn('pass')} lg:hidden space-y-4`}>
            {cardActive ? (
              <motion.div
                initial={riseFromSm}
                animate={{ opacity: 1, y: 0 }}
                transition={mountIn}
                className="space-y-4"
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-brick" />
                    <span className="text-xs font-bold text-neutral-800">
                      {lang === 'en' ? 'Official Member Pass' : 'CAACI 官方会员通行证'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQrZoomModal(true)}
                    className="min-h-[34px] px-3 py-1 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs active:scale-98"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-gold" />
                    <span>{lang === 'en' ? 'Enlarge QR' : '放大二维码'}</span>
                  </button>
                </div>
                {card(true)}
              </motion.div>
            ) : (
              lockedCard(true)
            )}
          </div>

          {/* MY REGISTERED EVENTS */}
          <div
            id="registered-events"
            className={`${shownOn('events')} lg:block space-y-3 sm:space-y-4 scroll-mt-24 lg:pt-6 lg:border-t lg:border-neutral-200/80`}
          >
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Ticket className="w-5 h-5 text-brick" />
                <h3 className="text-base sm:text-lg font-bold text-ink">
                  {lang === 'en' ? 'My Registered Events' : '我报名的活动'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('events')}
                className="min-h-[36px] text-xs text-brick hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer py-1"
              >
                <span>{lang === 'en' ? 'Browse All Events' : '浏览更多社区活动'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {events === undefined ? (
              <div className="text-center py-8 text-xs text-neutral-500">
                {t('Loading your events…', '正在加载活动…')}
              </div>
            ) : !events || events.length === 0 ? (
              <div className="text-center py-8 px-4 text-xs text-neutral-500">
                <Ticket className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                <p>
                  {events === null
                    ? t(
                        'Your event registrations could not be loaded right now.',
                        '暂时无法加载您的活动报名。',
                      )
                    : t(
                        'You have not registered for any events yet.',
                        '您目前暂未报名任何社区活动。',
                      )}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('events')}
                  className="mt-3 min-h-[36px] text-xs font-semibold text-brick hover:underline cursor-pointer"
                >
                  {lang === 'en' ? 'Explore CAACI Events' : '立即浏览活动日程'}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
                {events.map((r) => {
                  const over = eventOver(r.event);
                  const canOpenForm = r.source === 'registration' && !!r.event.slug && !over;
                  // Flagged actions (lib/features.ts). With both flags off the footer
                  // renders just `signedUp`, as before the flags existed.
                  const canFeedback = FEATURES.eventFeedback && over;
                  const canCancel = FEATURES.rsvpCancel && r.source === 'rsvp' && !over;
                  const signedUp = r.registered_at && (
                    <span className="text-[11px] text-neutral-400">
                      {t('Signed up', '报名于')}{' '}
                      {fmtDate(r.registered_at, lang, { month: 'short', day: 'numeric' })}
                    </span>
                  );
                  return (
                    <div
                      key={r.key}
                      className="py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                    >
                      <div className="space-y-2 min-w-0">
                        <div className="flex items-center gap-3">
                          {!over ? (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                              <span>
                                {r.source === 'registration'
                                  ? t('Registered', '已报名')
                                  : t('RSVP Confirmed', '报名已确认')}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
                              <span className="w-2 h-2 rounded-full bg-neutral-400 shrink-0" />
                              <span>{lang === 'en' ? 'Concluded' : '已结束'}</span>
                            </div>
                          )}
                          {!!r.guests && (
                            <span className="text-[11px] text-neutral-400">
                              {t(
                                `+${r.guests} guest${r.guests > 1 ? 's' : ''}`,
                                `同行 ${r.guests} 人`,
                              )}
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-neutral-900 leading-snug line-clamp-2">
                          {(lang === 'zh' && r.event.title_zh) || r.event.title}
                        </h4>

                        <div className="space-y-1 text-xs text-neutral-500 pt-1">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span>{eventDay(r.event, lang)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span>
                              {eventTime(r.event, lang)} {t('(Central Time)', '（美国中部时间）')}
                            </span>
                          </div>
                          {r.event.location && (
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                              <span className="truncate">{r.event.location}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                        {canOpenForm ? (
                          <button
                            type="button"
                            onClick={() =>
                              window.location.assign(
                                `/events/${encodeURIComponent(r.event.slug as string)}/register/`,
                              )
                            }
                            className="min-h-[36px] text-xs text-brick hover:underline font-semibold cursor-pointer inline-flex items-center"
                          >
                            {t('View Registration', '查看报名')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onNavigate(over ? 'events#past' : 'events')}
                            className="min-h-[36px] text-xs text-brick hover:underline font-semibold cursor-pointer inline-flex items-center"
                          >
                            {lang === 'en' ? 'View Details' : '查看详情'}
                          </button>
                        )}
                        {canFeedback || canCancel ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {signedUp}
                            {canFeedback && <EventFeedback lang={lang} registration={r} />}
                            {canCancel && (
                              <CancelRsvp
                                lang={lang}
                                eventId={r.event.id}
                                onCancelled={() =>
                                  setEvents((prev) => prev && prev.filter((x) => x.key !== r.key))
                                }
                              />
                            )}
                          </div>
                        ) : (
                          signedUp
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* TWO-COLUMN LAYOUT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
            {/* LEFT COLUMN: Profile Info, Security, Subscription, History */}
            <div className="lg:col-span-7 space-y-6">
              {/* 1. 个人信息 (只能看，不能改) */}
              <div
                id="edit-information"
                className={`${shownOn('profile')} lg:block space-y-5 scroll-mt-24 pt-6 border-t border-neutral-200/80`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-brick" />
                    <h3 className="text-base sm:text-lg font-bold text-ink">
                      {lang === 'en' ? 'Personal Information' : '个人信息'}
                    </h3>
                  </div>
                  {FEATURES.profileEdit ? (
                    <ProfileEdit lang={lang} member={member} onSaved={refreshMember} />
                  ) : (
                    <span className="text-[11px] font-semibold text-neutral-400 flex items-center gap-1">
                      <Lock className="w-3 h-3 text-neutral-400" />
                      <span>{lang === 'en' ? 'Read-only' : '仅供查看'}</span>
                    </span>
                  )}
                </div>

                <div className="border-l-2 border-neutral-300 pl-3 text-xs text-neutral-600 flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                  <p>
                    {FEATURES.profileEdit
                      ? t(
                          `Your name comes from your membership record and can't be edited online. To correct it, email ${content.contact.email}. Use Edit to update your phone and contact details. Your sign-in email can be changed under Account Security.`,
                          `姓名来自您的会员档案，无法在线修改。如需更正，请发邮件至 ${content.contact.email}。点击“编辑”可更新电话与联系方式。登录邮箱可在“账户安全”中修改。`,
                        )
                      : t(
                          `Your name and phone come from your membership record and can't be edited online. To correct them, email ${content.contact.email}. Your sign-in email can be changed under Account Security.`,
                          `姓名和电话来自您的会员档案，无法在线修改。如需更正，请发邮件至 ${content.contact.email}。登录邮箱可在“账户安全”中修改。`,
                        )}
                  </p>
                </div>

                <dl className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
                  {[
                    { label: t('Full Name', '姓名'), value: member?.full_name || '—', mono: false },
                    { label: t('Sign-in Email', '登录邮箱'), value: user.email || '—', mono: true },
                    {
                      label: t('Contact Phone', '联系电话'),
                      value: member?.phone || '—',
                      mono: true,
                    },
                    {
                      label: t('Member Since', '入会日期'),
                      value: fmtDate(member?.member_since || member?.created_at, lang),
                      mono: false,
                    },
                  ].map((row) => (
                    <div key={row.label} className="py-3 flex items-start justify-between gap-4">
                      <dt className="text-xs text-neutral-500 shrink-0">{row.label}</dt>
                      <dd className="text-xs font-medium text-neutral-900 text-right min-w-0">
                        <span className={`${row.mono ? 'font-mono' : ''} break-all`}>
                          {row.value}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* 2. 账户安全 (修改密码 / 设置密码、修改邮箱) */}
              <SecurityCard
                lang={lang}
                user={user}
                className={`${shownOn('profile')} lg:block pt-6 border-t border-neutral-200/80`}
              />

              {/* 3. 订阅 (方案、状态、价格含3.5%手续费、到期日期、更改方案、管理账单、扣款失败提醒) */}
              <div
                className={`${shownOn('billing')} lg:block space-y-5 pt-6 border-t border-neutral-200/80`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-brick" />
                    <h3 className="text-base sm:text-lg font-bold text-ink">
                      {lang === 'en' ? 'Membership Subscription' : '会员订阅与会费方案'}
                    </h3>
                  </div>

                  <div className="flex items-center">
                    {pastDue ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        <span>{statusLabel('past_due', lang)}</span>
                      </span>
                    ) : shownStatus === 'active' ? (
                      <span
                        className="relative flex h-2.5 w-2.5"
                        title={lang === 'en' ? 'Active' : '有效'}
                      >
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full bg-neutral-300"
                        title={lang === 'en' ? 'Not Active' : '未生效'}
                      />
                    )}
                  </div>
                </div>

                {/* Past due: the last renewal charge failed */}
                {pastDue && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-xs text-rose-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-rose-950">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      <span>{lang === 'en' ? 'Payment Failed' : '会费扣款失败提醒'}</span>
                    </div>
                    <p className="leading-relaxed">
                      {t(
                        'Your last payment failed — update your card in Manage billing or your membership will expire.',
                        '上次扣款失败——请在“管理账单”中更新银行卡，否则会员将过期。',
                      )}
                    </p>
                    {hasBilling && (
                      <button
                        type="button"
                        onClick={openBilling}
                        disabled={billingBusy}
                        className="min-h-[40px] px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs cursor-pointer inline-flex items-center gap-1 shadow-xs active:scale-98 disabled:opacity-60"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>
                          {billingBusy
                            ? t('Opening…', '正在打开…')
                            : t('Manage Billing (Stripe)', '管理账单 (Stripe)')}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {shownTier || viaFamily ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs">
                    <div>
                      <span className="text-neutral-400 block text-[10px]">
                        {lang === 'en' ? 'Plan Tier' : '当前方案'}
                      </span>
                      <span className="font-bold text-neutral-900 text-sm mt-0.5 block">
                        {shownTierName}
                      </span>
                      {viaFamily && (
                        <span className="text-[11px] text-neutral-500 block mt-0.5">
                          {family?.role === 'founder'
                            ? t('Your family plan', '您的家庭会员')
                            : t(
                                `Shared through ${family?.founder?.email || 'a family plan'}`,
                                `由 ${family?.founder?.email || '家庭会员'} 共享`,
                              )}
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-neutral-400 block text-[10px]">
                        {shownTier && shownTier.price_cents > 0 && !viaFamily
                          ? t('Annual Dues (incl. 3.5% card fee)', '年度会费（含 3.5% 手续费）')
                          : t('Price', '价格')}
                      </span>
                      <span className="font-bold text-brick text-sm mt-0.5 block">
                        {viaFamily
                          ? t('Covered by the family plan', '由家庭会员共享')
                          : shownTier
                            ? priceLabel(shownTier)
                            : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-neutral-400 block text-[10px]">{expiryTitle}</span>
                      <span className="font-semibold text-neutral-800 text-xs mt-0.5 block">
                        {expiryValue}
                      </span>
                    </div>

                    <div>
                      <span className="text-neutral-400 block text-[10px]">
                        {lang === 'en' ? 'Status' : '状态'}
                      </span>
                      <span className="font-semibold text-neutral-800 text-xs mt-0.5 block">
                        {statusLabel(shownStatus, lang) || '—'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    {t('No membership yet.', '尚未加入会员。')}
                  </p>
                )}

                {shownTier && !viaFamily && isFreeTier(shownTier) && (
                  <p className="text-[11px] text-neutral-500">
                    {t(
                      'Free membership never expires. Upgrade any time for the annual meeting and festival perks.',
                      '免费会员永不过期。可随时升级，享受会员大会和节日福利。',
                    )}
                  </p>
                )}

                {billingError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{billingError}</span>
                  </div>
                )}

                {/* Subscription Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigate('membership')}
                    className={
                      !shownTier
                        ? 'min-h-[44px] px-6 py-2.5 rounded-full bg-brick hover:brightness-110 text-white font-semibold text-xs cursor-pointer shadow-xs active:scale-98'
                        : 'min-h-[42px] px-5 py-2.5 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 active:scale-98'
                    }
                  >
                    {shownTier && <RefreshCw className="w-3.5 h-3.5" />}
                    <span>{planButtonLabel}</span>
                  </button>

                  {/* The Stripe portal needs a customer: a member who never paid has nothing there. */}
                  {hasBilling && !pastDue && (
                    <button
                      type="button"
                      onClick={openBilling}
                      disabled={billingBusy}
                      className="min-h-[42px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 active:scale-98 disabled:opacity-60"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-brick" />
                      <span>
                        {billingBusy
                          ? t('Opening…', '正在打开…')
                          : t('Manage Billing (Stripe)', '管理账单 (Stripe)')}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {/* 4. 付款记录 (最近 10 笔) */}
              <div
                className={`${shownOn('billing')} lg:block space-y-4 pt-6 border-t border-neutral-200/80`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-5 h-5 text-brick" />
                    <h3 className="text-base sm:text-lg font-bold text-ink">
                      {lang === 'en' ? 'Payment History' : '付款记录'}
                    </h3>
                  </div>
                  <span className="text-[11px] text-neutral-500">
                    {lang === 'en' ? 'Last 10 membership payments' : '最近 10 笔会费记录'}
                  </span>
                </div>

                {payments === undefined ? (
                  <p className="text-xs text-neutral-500">{t('Loading…', '加载中…')}</p>
                ) : payments === null ? (
                  <p className="text-xs text-neutral-500">
                    {t(
                      'Your payment history could not be loaded right now.',
                      '暂时无法加载付款记录。',
                    )}
                  </p>
                ) : payments.length === 0 ? (
                  <p className="text-xs text-neutral-500">
                    {t('No payments yet.', '暂无付款记录。')}
                  </p>
                ) : (
                  <div className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
                    {payments.map((p) => {
                      const amount = p.amount_cents ?? 0;
                      const refunded = p.refunded_cents ?? 0;
                      const tier = p.tier_id ? tiers.find((x) => x.id === p.tier_id) : undefined;
                      const kind =
                        p.kind === 'renewal'
                          ? t('Membership Renewal', '会员续费')
                          : p.kind === 'membership'
                            ? t('New Membership', '新会员入会')
                            : p.kind || '—';
                      return (
                        <div
                          key={p.id}
                          className="py-3 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-neutral-900">{kind}</span>
                              {refunded > 0 ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current">
                                  {refunded >= amount
                                    ? t('Refunded', '已退款')
                                    : t('Partially refunded', '部分退款')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current">
                                  {lang === 'en' ? 'Paid' : '已支付'}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-neutral-400 block">
                              {fmtDate(p.paid_at, lang)}
                              {tier ? ` • ${tierName(tier, lang)}` : ''}
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-neutral-900 font-mono text-sm block">
                              {usd(amount)}
                            </span>
                            {refunded > 0 && (
                              <span className="text-[10px] text-rose-600 block">
                                {t('Refunded', '已退')} {usd(refunded)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Digital Card (Desktop) & Family Section */}
            <div className="lg:col-span-5 space-y-6">
              {/* 1. 电子会员卡 (Desktop View - on mobile handled above) */}
              <div className="hidden lg:block space-y-3">
                {cardActive ? (
                  <div className="space-y-3">
                    {card(false)}
                    <p className="text-xs text-neutral-500 font-poppins text-center leading-relaxed px-2">
                      {lang === 'en'
                        ? 'Show this card at partner businesses — scanning the QR verifies your membership live.'
                        : '在合作商家出示会员卡，扫码即可实时验证会员资格。'}
                    </p>
                  </div>
                ) : (
                  lockedCard(false)
                )}
              </div>

              {/* 2. 家庭系统 (按身份显示不同内容) */}
              <div
                id="family-section"
                className={`${shownOn('family')} lg:block scroll-mt-24 pt-6 border-t border-neutral-200/80`}
              >
                <FamilySection
                  lang={lang}
                  family={family}
                  loading={familyLoading}
                  refreshFailed={familyRefreshFailed}
                  signedInEmail={user.email || ''}
                  focusInviteId={landing.familyInvite}
                  ownFamilyTier={member?.tier_id === 'family' && member?.status === 'active'}
                  familyPriceLabel={familyPriceLabel}
                  onReload={reloadFamily}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <ContactSection content={content} />
    </div>
  );
}
