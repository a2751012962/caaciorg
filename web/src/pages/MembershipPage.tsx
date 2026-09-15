import { useState, useRef, type FormEvent, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ContactSection } from '../components/ContactSection';
import {
  Check,
  QrCode,
  ShieldCheck,
  Star,
  Gift,
  Utensils,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Smartphone,
  ArrowRight,
} from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { membershipPageDataEN, membershipPageDataZH } from '../data/pagesContent';

interface MembershipPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal?: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function MembershipPage({ content, lang, onNavigate }: MembershipPageProps) {
  const data = lang === 'en' ? membershipPageDataEN : membershipPageDataZH;
  const [selectedTier, setSelectedTier] = useState<
    'student' | 'individual' | 'family' | 'lifetime'
  >('family');
  const [submitted, setSubmitted] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [wechat, setWechat] = useState('');

  const tierScrollRef = useRef<HTMLDivElement>(null);
  const [currentTierIndex, setCurrentTierIndex] = useState(1);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const handleTierScroll = () => {
    if (!tierScrollRef.current || data.tiers.length === 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = tierScrollRef.current;
    const maxScroll = scrollWidth - clientWidth;
    if (maxScroll <= 0) {
      setCurrentTierIndex(1);
      return;
    }
    const approx = Math.min(
      data.tiers.length,
      Math.max(1, Math.round((scrollLeft / maxScroll) * (data.tiers.length - 1)) + 1),
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const getTierPrice = (tier: string) => {
    if (tier === 'student') return '$10';
    if (tier === 'individual') return '$20';
    if (tier === 'family') return '$35';
    return '$200';
  };

  return (
    <div className="bg-white min-h-screen text-[#1d1d1f] font-sans antialiased selection:bg-neutral-200">
      {/* Top-Left Return / Breadcrumb Path */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="border-b border-neutral-200/80 bg-[#fbfbfd]/80 backdrop-blur-xs"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 font-poppins"
          >
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 font-medium text-neutral-700 hover:text-[#8e2e11] transition-colors cursor-pointer group"
              title={lang === 'en' ? 'Back to Menu' : '返回菜单'}
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5 text-neutral-400 group-hover:text-[#8e2e11]" />
              <span>{lang === 'en' ? 'Back to Menu' : '返回菜单'}</span>
            </button>
            <span className="text-neutral-300">/</span>
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-[#8e2e11] transition-colors cursor-pointer text-neutral-500"
            >
              {content.nav.welcome}
            </button>
            <span className="text-neutral-300">/</span>
            <span className="text-[#8e2e11] font-semibold">{content.nav.membership}</span>
          </nav>
        </div>
      </motion.div>

      {/* 1. Apple-Style Pricing Tiers (Clean Apple One / iCloud+ Style Layout) */}
      <section className="py-10 sm:py-16 lg:py-20 bg-[#fbfbfd] border-b border-neutral-200/80 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-center max-w-2xl mx-auto mb-8 sm:mb-12"
          >
            <span className="text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block mb-2">
              {lang === 'en' ? 'Choose Your Plan' : '入会方案'}
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
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
            className="flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none -mx-4 px-6 sm:-mx-6 sm:px-8 md:mx-0 md:px-0 pt-5 pb-4 md:pt-0 md:pb-0 overscroll-x-contain cursor-grab active:cursor-grabbing select-none"
          >
            {data.tiers.map((tier, idx) => {
              const tierId =
                idx === 0
                  ? 'student'
                  : idx === 1
                    ? 'individual'
                    : idx === 2
                      ? 'family'
                      : 'lifetime';
              const isPopular = tier.isPopular || tierId === 'family';
              const isCurrentSelected = selectedTier === tierId;

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-30px' }}
                  transition={{ duration: 0.55, delay: idx * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -6, transition: { duration: 0.2 } }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-[82vw] max-w-[310px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-white rounded-2xl p-6 sm:p-7 border transition-all duration-300 flex flex-col justify-between relative ${
                    isCurrentSelected
                      ? 'border-[#1d1d1f] shadow-lg ring-1 ring-[#1d1d1f]'
                      : 'border-neutral-200/80 shadow-xs hover:border-neutral-300'
                  }`}
                >
                  {isPopular && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute -top-3 left-6 z-20 bg-[#1d1d1f] text-white text-[10px] font-semibold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-md whitespace-nowrap"
                    >
                      {lang === 'en' ? 'Recommended' : '推荐首选'}
                    </motion.div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-[#1d1d1f] tracking-tight">
                        {tier.name}
                      </h3>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
                          {tier.price}
                        </span>
                        <span className="text-xs text-neutral-400">/ {tier.period}</span>
                      </div>
                    </div>

                    <ul className="space-y-2.5 pt-4 border-t border-neutral-100">
                      {tier.features.map((feat, fIdx) => (
                        <li
                          key={fIdx}
                          className="flex items-start gap-2.5 text-xs text-neutral-600 leading-normal"
                        >
                          <Check className="w-3.5 h-3.5 text-[#1d1d1f] shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6 mt-6 border-t border-neutral-100">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      type="button"
                      onClick={() => {
                        setSelectedTier(tierId as any);
                        const formElem = document.getElementById('membership-form');
                        formElem?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className={`w-full py-2.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 cursor-pointer ${
                        isCurrentSelected
                          ? 'bg-[#1d1d1f] text-white shadow-sm'
                          : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-neutral-200'
                      }`}
                    >
                      {isCurrentSelected
                        ? lang === 'en'
                          ? 'Selected ✓'
                          : '已选择 ✓'
                        : lang === 'en'
                          ? 'Select Plan'
                          : '选择此方案'}
                    </motion.button>
                  </div>
                </motion.div>
              );
            })}
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
              {currentTierIndex} / {data.tiers.length}
            </span>
            <button
              type="button"
              onClick={() => scrollTiers('right')}
              disabled={currentTierIndex >= data.tiers.length}
              className="p-1 rounded-full hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none text-neutral-500 transition-colors cursor-pointer"
              aria-label="Next plan"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* 3. Apple Wallet Style Digital Pass & Minimalist Form */}
      <section
        id="membership-form"
        className="py-16 sm:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-b border-neutral-200/80 overflow-hidden"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-10 xl:gap-12 items-start">
          {/* Left: Apple Wallet Passbook UI */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-5 w-full max-w-lg md:max-w-none mx-auto md:mx-0 space-y-6"
          >
            <div>
              <span className="text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block mb-1">
                {lang === 'en' ? 'Digital Pass' : '电子会员凭证'}
              </span>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1d1d1f]">
                {lang === 'en' ? 'Apple Wallet Pass' : '电子会员卡实时预览'}
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-neutral-500">
                {lang === 'en'
                  ? 'Your digital badge can be added to Apple Wallet or accessed anytime via your Member Account.'
                  : '入会后将自动生成专属实名电子卡，可出示享受合作商户立减与活动快速签到。'}
              </p>
            </div>

            {/* Apple Wallet Sleek Pass Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -5, scale: 1.01, transition: { duration: 0.25 } }}
              className="bg-[#1d1d1f] text-white rounded-2xl p-5 sm:p-6 lg:p-7 shadow-xl border border-white/10 relative overflow-hidden group"
            >
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

                <span className="text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-white/15 text-neutral-200 flex-shrink-0">
                  {selectedTier}
                </span>
              </div>

              <div className="py-5 sm:py-6 space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                    {lang === 'en' ? 'Cardholder Name' : '持卡人姓名'}
                  </div>
                  <div className="text-lg sm:text-xl font-medium tracking-tight text-white mt-0.5 truncate">
                    {fullName || (lang === 'en' ? 'Guest Member' : '华协新会员')}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                      Member ID
                    </div>
                    <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                      CAACI-2025-8821
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-400">
                      Expires
                    </div>
                    <div className="font-mono text-neutral-200 mt-0.5 text-xs whitespace-nowrap">
                      DEC 31, 2026
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
                <span className="text-[10px]">Tap or scan for merchant discounts</span>
                <QrCode className="w-5 h-5 text-neutral-300 flex-shrink-0 group-hover:text-white transition-colors" />
              </div>
            </motion.div>

            {/* Quick Member Portal Link */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2 }}
              className="p-3.5 sm:p-4 rounded-xl bg-[#f5f5f7] border border-black/[0.04] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#1d1d1f]">
                  {lang === 'en' ? 'Already a member?' : '已经是华协会员？'}
                </div>
                <div className="text-[11px] text-neutral-500 leading-snug">
                  {lang === 'en'
                    ? 'Access your digital pass and partner perks'
                    : '登录会员中心查看折扣券与续费状态'}
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => onNavigate('account')}
                className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white border border-neutral-200 text-xs font-medium text-[#1d1d1f] hover:bg-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
              >
                {lang === 'en' ? 'Member Portal' : '进入会员专区'}
              </motion.button>
            </motion.div>
          </motion.div>

          {/* Right: Registration & Renewal Form */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.65, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="md:col-span-7 bg-white p-6 sm:p-8 lg:p-10 rounded-2xl border border-neutral-200/80 shadow-sm"
          >
            <h3 className="text-2xl font-semibold tracking-tight text-[#1d1d1f] mb-1">
              {data.formTitle}
            </h3>
            <p className="text-xs sm:text-sm text-neutral-500 mb-8">
              {lang === 'en'
                ? 'Fill out the details below. We accept Zelle, Check, or Cash payments.'
                : '请在下方填写您的基本资料。支持 Zelle、支票或现金方式缴费。'}
            </p>

            {submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                className="py-12 text-center space-y-4"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 380, delay: 0.1 }}
                  className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center"
                >
                  <Check className="w-6 h-6" />
                </motion.div>
                <h4 className="text-xl font-semibold text-[#1d1d1f]">
                  {lang === 'en' ? 'Registration Received!' : '入会申请已成功提交！'}
                </h4>
                <p className="text-xs sm:text-sm text-neutral-600 max-w-md mx-auto leading-relaxed">
                  {lang === 'en'
                    ? `Thank you, ${fullName || 'Member'}. Your ${selectedTier.toUpperCase()} membership (${getTierPrice(selectedTier)}) is registered. A confirmation has been sent to ${email || 'your email'}.`
                    : `感谢您，${fullName || '尊敬的会员'}。您选择的【${selectedTier.toUpperCase()}】会员（${getTierPrice(selectedTier)}）申请已收到。我们的财务与会员组将在 24 小时内向 ${email || '您的邮箱'} 发送缴费确认与电子卡开通指引。`}
                </p>
                <div className="pt-4">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={() => {
                      setSubmitted(false);
                      onNavigate('account');
                    }}
                    className="px-5 py-2.5 rounded-full bg-[#1d1d1f] text-white text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    {lang === 'en' ? 'Go to Member Account' : '前往会员中心'}
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-2">
                    {lang === 'en' ? 'Select Membership Tier' : '选择入会类别'}
                  </label>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-2.5">
                    {(['student', 'individual', 'family', 'lifetime'] as const).map((tier) => (
                      <motion.button
                        key={tier}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => setSelectedTier(tier)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer whitespace-nowrap ${
                          selectedTier === tier
                            ? 'bg-[#1d1d1f] text-white border-[#1d1d1f]'
                            : 'border-neutral-200 text-neutral-700 hover:bg-[#f5f5f7]'
                        }`}
                      >
                        {tier.slice(0, 1).toUpperCase() + tier.slice(1)} • {getTierPrice(tier)}
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      {data.formName} *
                    </label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Ying Man Tang / 唐英民"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-[#1d1d1f] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      {data.formEmail} *
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. member@caaciorg.com"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-[#1d1d1f] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      {data.formPhone}
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(217) 000-0000"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-[#1d1d1f] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      {lang === 'en' ? 'WeChat ID (Optional)' : '微信号（选填）'}
                    </label>
                    <input
                      type="text"
                      value={wechat}
                      onChange={(e) => setWechat(e.target.value)}
                      placeholder="WeChat ID / 微信号"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs sm:text-sm focus:ring-1 focus:ring-[#1d1d1f] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Clean Apple-style payment guidance box */}
                <div className="p-4 rounded-xl bg-[#f5f5f7] border border-black/[0.04] text-xs text-neutral-600 space-y-1">
                  <div className="font-semibold text-[#1d1d1f]">
                    {lang === 'en' ? 'Payment Information' : '缴费方式说明'}
                  </div>
                  <p>
                    {lang === 'en'
                      ? '• Zelle: caaci2000@gmail.com (memo: Name + Membership Tier)'
                      : '• Zelle 转账：caaci2000@gmail.com（附言请注明姓名与入会类别）'}
                  </p>
                  <p>
                    {lang === 'en'
                      ? '• Check payable to: CAACI, P.O. Box 7141, Champaign, IL 61826'
                      : '• 支票邮寄至：CAACI, P.O. Box 7141, Champaign, IL 61826'}
                  </p>
                </div>

                <motion.button
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  type="submit"
                  className="w-full py-3.5 px-6 rounded-full bg-[#1d1d1f] hover:bg-neutral-800 text-white text-xs sm:text-sm font-medium tracking-wide transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap shadow-sm"
                >
                  <span>{data.formSubmit}</span>
                  <span>({getTierPrice(selectedTier)})</span>
                </motion.button>
              </form>
            )}
          </motion.div>
        </div>
      </section>

      {/* 4. Community Privileges (Clean 3-Column Grid) */}
      <section
        id="community-privileges"
        className="py-16 sm:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-hidden"
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl mb-14"
        >
          <span className="text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block mb-2">
            {lang === 'en' ? 'Community Privileges' : '会员专享礼遇'}
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
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
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-[#fbfbfd] p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-[#1d1d1f] shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Utensils className="w-5 h-5 text-[#8e2e11]" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-[#1d1d1f] tracking-tight">
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
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-[#fbfbfd] p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-[#1d1d1f] shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Gift className="w-5 h-5 text-[#8e2e11]" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-[#1d1d1f] tracking-tight">
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
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.55, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-[#fbfbfd] p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-[#1d1d1f] shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <Star className="w-5 h-5 text-[#8e2e11]" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-[#1d1d1f] tracking-tight">
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
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.55, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="w-[80vw] max-w-[290px] shrink-0 md:w-auto md:shrink md:max-w-none snap-center md:snap-align-none bg-[#fbfbfd] p-6 sm:p-7 rounded-2xl border border-neutral-200/80 space-y-4 flex flex-col justify-between group hover:shadow-sm hover:border-neutral-300 transition-all"
          >
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-[#1d1d1f] shadow-2xs group-hover:scale-110 transition-transform duration-300">
                <ShieldCheck className="w-5 h-5 text-[#8e2e11]" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-[#1d1d1f] tracking-tight">
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
