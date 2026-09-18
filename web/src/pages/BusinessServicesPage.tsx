import { useState, useMemo, useEffect, useRef, type FormEvent, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  hoverLift,
  hoverScale,
  inView,
  listItem,
  mountIn,
  overlayIn,
  panelFrom,
  panelIn,
  panelShown,
  rise,
  riseFrom,
  riseFromSm,
  slideFromLeft,
  tap,
} from '../lib/motion';
import { ContactSection } from '../components/ContactSection';
import { smoothScrollTo } from '../utils/smoothScroll';
import {
  Search,
  Building2,
  Check,
  ExternalLink,
  Phone,
  MapPin,
  Calendar,
  Clock,
  Send,
  Mail,
  X,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Store,
  Coins,
  Users,
  Briefcase,
  Sparkles,
  ArrowUpRight,
  BadgePercent,
  FileCheck,
  Plus,
  Navigation,
} from 'lucide-react';
import type { CAACIContent } from '../data/content';
import {
  businessServicesDataEN,
  businessServicesDataZH,
  type BusinessMerchant,
  type BusinessSponsorTier,
} from '../data/pagesContent';
import { api } from '../lib/api';
import { TurnstileBox, useTurnstile } from '../components/Turnstile';
import { usd } from '../lib/shared';
import { cardTotal, money, useTiers } from '../lib/tiers';
import {
  DIRECTORY_CATEGORIES,
  LISTING_CATEGORIES,
  directionsUrl,
  directoryMerchants,
  loadApprovedListings,
  type DirectoryRow,
} from '../lib/directory';

interface BusinessServicesPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal?: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

type InquiryType = 'directory' | 'microloan' | 'sponsor' | 'general';

// Subject line staff see in the /api/contact email and form_submissions row.
const INQUIRY_LABEL: Record<Exclude<InquiryType, 'directory'>, string> = {
  microloan: 'Chamber Microloan inquiry',
  sponsor: 'Corporate partnership inquiry',
  general: 'General business inquiry',
};

export function BusinessServicesPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
}: BusinessServicesPageProps) {
  const data = lang === 'en' ? businessServicesDataEN : businessServicesDataZH;
  const t = (en: string, zh: string) => (lang === 'en' ? en : zh);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Approved business_directory rows (public read), managed in the admin panel.
  // undefined = still loading: no cards yet, so a merchant staff removed never
  // flashes up from the built-in list, which is only used if the read fails.
  const [listings, setListings] = useState<DirectoryRow[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadApprovedListings().then((rows) => alive && setListings(rows));
    return () => {
      alive = false;
    };
  }, []);
  const loadingListings = listings === undefined;
  const merchants = useMemo(
    () => (listings === undefined ? [] : directoryMerchants(data.merchants, listings, lang)),
    [data.merchants, listings, lang],
  );

  // The directory fee is the Business Membership tier: price from the live tiers.
  const tiers = useTiers();
  const businessTier = tiers.find((x) => x.id === 'business');
  const directoryPrice = businessTier ? money(businessTier.price_cents) : '';
  const directoryCard = businessTier ? usd(cardTotal(businessTier)) : '';
  const fill = (s: string) =>
    s
      .replaceAll('{count}', loadingListings ? '–' : String(merchants.length))
      .replaceAll('{price}', directoryPrice)
      .replaceAll('{card}', directoryCard);
  // Full page load: the membership page reads ?tier= on arrival.
  const goToBusinessMembership = () =>
    window.location.assign(`${lang === 'zh' ? '/zh' : ''}/membership/?tier=business`);

  // Business Inquiry Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [inquiryType, setInquiryType] = useState<InquiryType>('directory');
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [listingCategory, setListingCategory] = useState(LISTING_CATEGORIES[0].id);
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const isListing = inquiryType === 'directory';
  // One form, two endpoints: the widget re-mounts when the inquiry type changes
  // so the token always carries the action the server will compare it against.
  const turnstile = useTurnstile(isListing ? 'business_listing' : 'contact');

  // One pill per category that has at least one listed merchant, so every pill returns results.
  const categories = useMemo(() => {
    const used = new Set(merchants.map((m) => m.category));
    return [
      { id: 'all', label: lang === 'en' ? 'All Categories' : '全部类别' },
      ...DIRECTORY_CATEGORIES.filter((c) => used.has(c.id)).map((c) => ({
        id: c.id,
        label: lang === 'en' ? c.en : c.zh,
      })),
    ];
  }, [merchants, lang]);

  // Filter merchants based on category & search query
  const filteredMerchants = useMemo(() => {
    return merchants.filter((m: BusinessMerchant) => {
      const matchCategory = selectedCategory === 'all' || m.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchCategory;
      const matchSearch =
        m.name.toLowerCase().includes(q) ||
        (m.nameEn && m.nameEn.toLowerCase().includes(q)) ||
        m.desc.toLowerCase().includes(q) ||
        m.categoryLabel.toLowerCase().includes(q) ||
        (m.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
        (m.discount ? m.discount.toLowerCase().includes(q) : false) ||
        m.address.toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [merchants, selectedCategory, searchQuery]);

  const handleOpenInquiry = (type: InquiryType) => {
    setInquiryType(type);
    setFormSubmitted(false);
    setFormError('');
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setBusinessName('');
    setContactName('');
    setContactEmail('');
    setContactPhone('');
    setNotes('');
    setListingCategory(LISTING_CATEGORIES[0].id);
    setAddress('');
    setWebsite('');
  };

  // Directory applications create a pending business_directory row (staff
  // approve it in the admin panel); every other inquiry goes through the
  // contact form endpoint, which stores it and emails staff.
  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    // A Turnstile token is spent by the request that carries it: read it, send
    // it, reset the widget whatever the answer was.
    const problem = turnstile.problem(lang === 'zh');
    if (problem) return setFormError(problem);
    const token = turnstile.token();
    setFormError('');
    setSending(true);
    const res = isListing
      ? await api('/api/business-listing', {
          name: businessName.trim(),
          email: contactEmail.trim(),
          category: listingCategory,
          description: notes.trim(),
          address: address.trim(),
          phone: contactPhone.trim(),
          website: website.trim(),
          _hp: '',
          'cf-turnstile-response': token,
        })
      : await api('/api/contact', {
          name: contactName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
          message: [
            `[Business Services: ${INQUIRY_LABEL[inquiryType as Exclude<InquiryType, 'directory'>]}]`,
            `Business: ${businessName.trim()}`,
            notes.trim(),
          ]
            .filter(Boolean)
            .join('\n\n'),
          _hp: '',
          'cf-turnstile-response': token,
        });
    turnstile.reset();
    setSending(false);
    if (!res.ok) {
      setFormError(
        res.data.error === 'network'
          ? t('Network error — please try again.', '网络错误，请重试。')
          : res.data.error || t('Could not send. Please try again.', '发送失败，请重试。'),
      );
      return;
    }
    setFormSubmitted(true);
    resetForm();
  };

  const sponsorLabel = (tier: BusinessSponsorTier) =>
    tier.action === 'membership'
      ? t('Get Business Membership', '办理商业会员')
      : tier.action === 'microloan'
        ? t('Ask About Microloans', '咨询小额贷款')
        : t('Apply for Tier', '选择此赞助方案');
  const sponsorClick = (tier: BusinessSponsorTier) =>
    tier.action === 'membership'
      ? goToBusinessMembership()
      : handleOpenInquiry(tier.action === 'microloan' ? 'microloan' : 'sponsor');

  const containerRef = useRef<HTMLDivElement>(null);

  // Business Directory Mobile Carousel Scroll & Page State
  const merchantScrollRef = useRef<HTMLDivElement>(null);
  const [currentMerchantIndex, setCurrentMerchantIndex] = useState(1);
  const isMerchantDraggingRef = useRef(false);
  const merchantStartXRef = useRef(0);
  const merchantScrollLeftRef = useRef(0);

  // Reset page count when category or search changes
  useEffect(() => {
    setCurrentMerchantIndex(1);
    if (merchantScrollRef.current) {
      merchantScrollRef.current.scrollLeft = 0;
    }
  }, [selectedCategory, searchQuery]);

  const handleMerchantScroll = () => {
    if (!merchantScrollRef.current || filteredMerchants.length === 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = merchantScrollRef.current;
    const maxScroll = scrollWidth - clientWidth;
    if (maxScroll <= 0) {
      setCurrentMerchantIndex(1);
      return;
    }
    const approx = Math.min(
      filteredMerchants.length,
      Math.max(1, Math.round((scrollLeft / maxScroll) * (filteredMerchants.length - 1)) + 1),
    );
    setCurrentMerchantIndex(approx);
  };

  const handleMerchantMouseDown = (e: MouseEvent) => {
    if (!merchantScrollRef.current) return;
    isMerchantDraggingRef.current = true;
    merchantStartXRef.current = e.pageX - merchantScrollRef.current.offsetLeft;
    merchantScrollLeftRef.current = merchantScrollRef.current.scrollLeft;
  };

  const handleMerchantMouseLeave = () => {
    isMerchantDraggingRef.current = false;
  };

  const handleMerchantMouseUp = () => {
    isMerchantDraggingRef.current = false;
  };

  const handleMerchantMouseMove = (e: MouseEvent) => {
    if (!isMerchantDraggingRef.current || !merchantScrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - merchantScrollRef.current.offsetLeft;
    const walk = (x - merchantStartXRef.current) * 1.5;
    merchantScrollRef.current.scrollLeft = merchantScrollLeftRef.current - walk;
  };

  const scrollMerchants = (direction: 'left' | 'right') => {
    if (!merchantScrollRef.current) return;
    const step = 310;
    merchantScrollRef.current.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth',
    });
  };

  const scrollToSection = (id: string, _sectionKey?: string) => {
    smoothScrollTo(id, { offset: -30, duration: 0.9 });
  };

  // Synchronize sticky header position with the main Navbar scroll state
  const [navbarVisible, setNavbarVisible] = useState(true);

  useEffect(() => {
    let lastY = window.scrollY;
    const handleScroll = () => {
      const y = window.scrollY;
      if (y <= 60) {
        setNavbarVisible(true);
      } else if (y > lastY + 8) {
        setNavbarVisible(false);
      } else if (y < lastY - 8) {
        setNavbarVisible(true);
      }
      lastY = y;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div
      ref={containerRef}
      className="bg-white min-h-screen text-ink font-sans antialiased selection:bg-neutral-200"
    >
      {/* 1. Top Return / Breadcrumb & Status Bar (Sticky to Top) */}
      <div
        className={`sticky z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/90 shadow-xs transition-all duration-300 ease-in-out ${
          navbarVisible ? 'top-[72px]' : 'top-0'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-3 flex-nowrap">
          {/* Breadcrumb Path */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1 sm:gap-1.5 md:gap-2 text-[11px] sm:text-xs md:text-sm text-neutral-500 font-sans min-w-0"
          >
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-0.5 sm:gap-1 font-medium text-neutral-700 hover:text-brick transition-colors cursor-pointer group shrink-0"
              title={lang === 'en' ? 'Back to Menu' : '返回菜单'}
            >
              <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform group-hover:-translate-x-0.5 text-neutral-400 group-hover:text-brick shrink-0" />
              <span className="hidden sm:inline">
                {lang === 'en' ? 'Back to Menu' : '返回菜单'}
              </span>
              <span className="sm:hidden">{lang === 'en' ? 'Back' : '返回'}</span>
            </button>
            <span className="text-neutral-300 shrink-0 hidden md:inline">/</span>
            <button
              onClick={() => {
                onNavigate('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-brick transition-colors cursor-pointer text-neutral-500 shrink-0 hidden md:inline"
            >
              {content.nav.welcome}
            </button>
            <span className="text-neutral-300 shrink-0">/</span>
            <span className="text-brick font-semibold truncate max-w-[120px] xs:max-w-[170px] sm:max-w-none">
              {content.nav.businessServices}
            </span>
          </nav>

          {/* Quick Hub Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-1 sm:ml-2">
            <button
              type="button"
              onClick={() => handleOpenInquiry('directory')}
              className="inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 text-[11px] sm:text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
            >
              <span className="hidden sm:inline">
                {lang === 'en' ? '+ Join Directory' : '+ 商户入驻'}
              </span>
              <span className="sm:hidden">{lang === 'en' ? '+ Join' : '+ 入驻'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenInquiry('general')}
              className="inline-flex items-center gap-1 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full border border-neutral-300 hover:border-neutral-800 text-neutral-800 hover:bg-neutral-100 text-[11px] sm:text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span className="hidden sm:inline">{lang === 'en' ? 'Inquiry' : '咨询对接'}</span>
              <span className="sm:hidden">{lang === 'en' ? 'Inquiry' : '咨询'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Information Hub Header & 4-Pillar Services Overview */}
      <section className="py-12 sm:py-16 border-b border-neutral-200/80 bg-gradient-to-b from-surface-2 via-white to-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Main Title & Value Proposition */}
          <motion.div
            initial={riseFrom}
            animate={{ opacity: 1, y: 0 }}
            transition={rise()}
            className="max-w-3xl mb-10"
          >
            <motion.div
              initial={riseFromSm}
              animate={{ opacity: 1, y: 0 }}
              transition={mountIn}
              className="text-xs font-semibold text-brick mb-3"
            >
              {lang === 'en'
                ? 'CAACI Business Directory & Regional Resources'
                : 'CAACI 华人商业名录与社区资源'}
            </motion.div>
            <motion.h1
              initial={riseFrom}
              animate={{ opacity: 1, y: 0 }}
              transition={rise(0.1)}
              className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-ink leading-[1.15]"
            >
              {lang === 'en'
                ? 'Commerce, Capital & Community Directory.'
                : '商业服务、商会资源与华商名录'}
            </motion.h1>
            <motion.p
              initial={riseFrom}
              animate={{ opacity: 1, y: 0 }}
              transition={rise(0.18)}
              className="mt-4 text-base sm:text-lg text-neutral-600 leading-relaxed"
            >
              {lang === 'en'
                ? 'CAACI connects local Chinese-owned businesses and community members with regional business listings, the Champaign County Chamber of Commerce Microloan program ($7,500–$15,000), and events including the All-State Agencies Job Fair.'
                : 'CAACI 致力于促进本地华商与社区成员的交流与发展，提供经核实的地方商业名录、香槟县商会小额扶持贷款通道（$7,500–$15,000）、以及与伊利诺伊州公共卫生部合办的全州政府机构招聘会等真实资讯。'}
            </motion.p>

            {/* Quick Action Buttons */}
            <motion.div
              initial={riseFromSm}
              animate={{ opacity: 1, y: 0 }}
              transition={rise(0.26)}
              className="mt-6 flex flex-wrap items-center gap-3"
            >
              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => scrollToSection('section-directory', 'directory')}
                className="px-5 py-2.5 rounded-full bg-ink text-white text-xs sm:text-sm font-medium hover:bg-neutral-800 transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Store className="w-4 h-4" />
                <span>{lang === 'en' ? 'Explore Directory' : '浏览本地名录商户'}</span>
              </motion.button>
              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => scrollToSection('section-microloan', 'microloan')}
                className="px-5 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-800 hover:border-neutral-800 text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <Coins className="w-4 h-4 text-brick" />
                <span>{lang === 'en' ? 'Chamber Microloan Info' : '查看商会小额贷款'}</span>
              </motion.button>
              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => handleOpenInquiry('directory')}
                className="px-5 py-2.5 rounded-full bg-brick/10 text-brick hover:bg-brick/15 text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <FileCheck className="w-4 h-4" />
                <span>
                  {lang === 'en'
                    ? `Join Directory (${directoryPrice}/yr)`
                    : `商户入驻登记 (${directoryPrice}/年)`}
                </span>
              </motion.button>
            </motion.div>
          </motion.div>

          {/* 4 Pillars Information Grid (Executive Clean Cards with Motion Stagger) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-6">
            {/* Pillar 1: Directory */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.05)}
              whileHover={hoverLift}
              className="bg-white rounded-2xl p-6 border border-neutral-200/80 shadow-xs hover:shadow-md hover:border-neutral-300 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center text-brick group-hover:scale-105 transition-transform">
                  <Store className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-ink">
                    {lang === 'en' ? 'Merchant Directory' : '认证华人商户名录'}
                  </h3>
                  <span className="text-[11px] font-semibold text-brick px-2 py-0.5 rounded-full bg-brick/10">
                    {loadingListings ? '–' : merchants.length}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {lang === 'en'
                    ? 'Verified dining, dental clinics, banking, insurance, and media services in Champaign, Urbana, and Savoy.'
                    : '涵盖香槟、厄巴纳及萨沃伊的地道中餐茶饮、牙科诊所、银行金融与房产服务真实商户。'}
                </p>
              </div>
              <div className="pt-4 mt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => scrollToSection('section-directory', 'directory')}
                  className="text-xs font-medium text-neutral-900 hover:text-brick inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>{lang === 'en' ? 'View Directory' : '查看名录'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>

            {/* Pillar 2: Microloans */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.14)}
              whileHover={hoverLift}
              className="bg-white rounded-2xl p-6 border border-neutral-200/80 shadow-xs hover:shadow-md hover:border-neutral-300 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-800 group-hover:scale-105 transition-transform">
                  <Coins className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-ink">
                    {lang === 'en' ? 'Chamber Microloans' : '商会小额扶持贷款'}
                  </h3>
                  <span className="text-[11px] font-semibold text-amber-800 px-2 py-0.5 rounded-full bg-amber-100">
                    $7.5K-$15K
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {lang === 'en'
                    ? 'Champaign County Chamber program offering 2.5%–3.0% interest rates and 5-year repayment terms for small businesses.'
                    : '香槟县商会小微企业低息贷款计划，年化利率 2.5%–3.0%，还款周期最长 5 年。'}
                </p>
              </div>
              <div className="pt-4 mt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => scrollToSection('section-microloan', 'microloan')}
                  className="text-xs font-medium text-neutral-900 hover:text-brick inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>{lang === 'en' ? 'Loan Details' : '了解贷款政策'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>

            {/* Pillar 3: Mentorship & Events */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.22)}
              whileHover={hoverLift}
              className="bg-white rounded-2xl p-6 border border-neutral-200/80 shadow-xs hover:shadow-md hover:border-neutral-300 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-800 group-hover:scale-105 transition-transform">
                  <Users className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-ink">
                    {lang === 'en' ? 'Job Fair & Events' : '全州招聘会与活动'}
                  </h3>
                  <span className="text-[11px] font-semibold text-blue-800 px-2 py-0.5 rounded-full bg-blue-100">
                    Siebel Center
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {lang === 'en'
                    ? 'All-State Agencies Job Fair co-hosted with Illinois Department of Public Health (IDPH) at UIUC Siebel Center for Design.'
                    : '携手伊利诺伊州公共卫生部（IDPH），在 UIUC 设计中心举办全州政府机构现场招聘对接会。'}
                </p>
              </div>
              <div className="pt-4 mt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => scrollToSection('section-mentorship', 'mentorship')}
                  className="text-xs font-medium text-neutral-900 hover:text-brick inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>{lang === 'en' ? 'View Events' : '查看招聘会详情'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>

            {/* Pillar 4: Corporate Sponsorship */}
            <motion.div
              initial={riseFrom}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={inView}
              transition={rise(0.3)}
              whileHover={hoverLift}
              className="bg-white rounded-2xl p-6 border border-neutral-200/80 shadow-xs hover:shadow-md hover:border-neutral-300 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-800 group-hover:scale-105 transition-transform">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-ink">
                    {lang === 'en' ? 'Directory Membership' : '名录入驻与会费'}
                  </h3>
                  <span className="text-[11px] font-semibold text-purple-800 px-2 py-0.5 rounded-full bg-purple-100">
                    {directoryPrice}/yr
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {lang === 'en'
                    ? `A Business Directory listing comes with Business Membership: ${directoryPrice}/yr (${directoryCard} by card online, incl. 3.5% fee). Check, Zelle or cash also accepted — email us.`
                    : `商户名录收录包含在商业会员中：${directoryPrice}/年（在线刷卡合计 ${directoryCard}，含 3.5% 手续费）。也接受支票、Zelle、现金，请来信联系。`}
                </p>
              </div>
              <div className="pt-4 mt-4 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => scrollToSection('section-sponsorship', 'sponsorship')}
                  className="text-xs font-medium text-neutral-900 hover:text-brick inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>{lang === 'en' ? 'Membership Info' : '查看入驻说明'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          </div>

          {/* Key Metrics / Highlights Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pt-10 mt-10 border-t border-neutral-200/80">
            {data.stats.map((stat, idx) => (
              <motion.div
                key={idx}
                initial={riseFrom}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={inView}
                transition={rise(0.1 + idx * 0.08)}
                className="space-y-1"
              >
                <div className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
                  {fill(stat.value)}
                </div>
                <div className="text-xs sm:text-sm text-neutral-500 font-medium">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Section: Chinese Business Directory (Apple-Style List & Search) */}
      <section
        id="section-directory"
        className="py-10 sm:py-16 lg:py-20 bg-surface-2 border-b border-neutral-200/80"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header & Filter Controls */}
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise()}
            className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 sm:pb-8 lg:pb-10 border-b border-neutral-200/80"
          >
            <div>
              <span className="text-xs font-semibold text-brick block mb-1.5 p-0">
                {lang === 'en' ? 'Verified Directory' : '官方认证商业名录'}
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
                {lang === 'en'
                  ? 'Central Illinois Chinese Business Directory'
                  : '伊利诺伊中部华人商业名录'}
              </h2>
              <p className="mt-2 text-sm text-neutral-500">
                {lang === 'en'
                  ? 'Present your CAACI Electronic Member Card at checkout to redeem special discounts.'
                  : '在以下合作商户消费时出示 CAACI 电子会员卡，即可尊享签约专属折扣。'}
              </p>
            </div>

            <div className="flex items-center gap-2.5 w-full lg:w-auto">
              {/* Apple-style search pill */}
              <div className="relative flex-1 sm:w-72 sm:flex-initial">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={lang === 'en' ? 'Search merchants...' : '搜索商户、服务...'}
                  className="w-full pl-9 pr-3.5 py-2 text-xs sm:text-sm bg-white border border-neutral-200 rounded-full focus:outline-none focus:ring-1 focus:ring-neutral-800 transition-all placeholder:text-neutral-400"
                />
              </div>

              <motion.button
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => handleOpenInquiry('directory')}
                className="px-3 sm:px-4 py-2 text-xs font-medium rounded-full bg-brick text-white hover:bg-brick-pressed transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {lang === 'en' ? 'Join Directory' : '商户入驻申请'}
                </span>
                <span className="sm:hidden">{lang === 'en' ? 'Join' : '入驻'}</span>
              </motion.button>
            </div>
          </motion.div>

          {/* Category Filter Pills (Apple Style with Motion & Hidden Scrollbar) */}
          <motion.div
            initial={riseFromSm}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={mountIn}
            className="py-4 sm:py-5 lg:py-6 flex items-center gap-2 overflow-x-auto no-scrollbar"
          >
            {categories.map((cat) => (
              <motion.button
                key={cat.id}
                whileHover={hoverScale}
                whileTap={tap}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  selectedCategory === cat.id
                    ? 'bg-ink text-white'
                    : 'bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-950 hover:border-neutral-300'
                }`}
              >
                {cat.label}
              </motion.button>
            ))}
          </motion.div>

          {/* Merchant Directory Content */}
          {loadingListings ? (
            <div className="py-16" aria-busy="true" />
          ) : filteredMerchants.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-16 text-center bg-white rounded-2xl border border-neutral-200"
            >
              <p className="text-sm text-neutral-500">
                {lang === 'en'
                  ? 'No matching businesses found. Try adjusting your search query.'
                  : '未找到符合条件的商户，请尝试其他关键词。'}
              </p>
            </motion.div>
          ) : (
            <>
              {/* Mobile View: Smooth Horizontal Scrolling Carousel with Hidden Scrollbar, Drag Support & Page Navigation */}
              <div className="md:hidden">
                <div
                  ref={merchantScrollRef}
                  onScroll={handleMerchantScroll}
                  onMouseDown={handleMerchantMouseDown}
                  onMouseLeave={handleMerchantMouseLeave}
                  onMouseUp={handleMerchantMouseUp}
                  onMouseMove={handleMerchantMouseMove}
                  className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory gap-3.5 pt-2 pb-4 -mx-4 px-6 sm:-mx-6 sm:px-8 overscroll-x-contain cursor-grab active:cursor-grabbing select-none"
                >
                  {filteredMerchants.map((merchant: BusinessMerchant, idx: number) => (
                    <motion.div
                      key={merchant.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={inView}
                      transition={listItem(idx)}
                      className="w-[82vw] max-w-[320px] shrink-0 snap-center bg-white rounded-2xl p-5 border border-neutral-200/90 shadow-sm flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                            {merchant.categoryLabel}
                          </span>
                          {merchant.featured && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-900 text-white flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 text-gold" />
                              <span>Verified</span>
                            </span>
                          )}
                          {merchant.discount &&
                            !merchant.discount.toLowerCase().includes('official directory') &&
                            !merchant.discount.includes('名录') && (
                              <span className="text-[10px] font-semibold text-brick px-2 py-0.5 rounded-full bg-brick/10">
                                {merchant.discount}
                              </span>
                            )}
                          {merchant.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>

                        <div>
                          <h3 className="text-base font-semibold text-ink tracking-tight line-clamp-1">
                            {merchant.name}
                          </h3>
                          <p className="text-xs text-neutral-600 leading-relaxed mt-1.5 line-clamp-3">
                            {merchant.desc}
                          </p>
                        </div>

                        <div className="space-y-1.5 text-[11px] text-neutral-500 pt-2.5 border-t border-neutral-100">
                          {merchant.address && (
                            <div className="flex items-start gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-1">{merchant.address}</span>
                            </div>
                          )}
                          {merchant.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                              <span>{merchant.phone}</span>
                            </div>
                          )}
                          {merchant.hours && (
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                              <span className="line-clamp-1">{merchant.hours}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-4 mt-4 border-t border-neutral-100">
                        {merchant.website && (
                          <a
                            href={merchant.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-2 text-center text-xs font-medium rounded-full border border-neutral-200 text-neutral-800 hover:border-neutral-400 transition-colors inline-flex items-center justify-center gap-1"
                          >
                            <span>{lang === 'en' ? 'Website' : '网站'}</span>
                            <ExternalLink className="w-3 h-3 text-neutral-400" />
                          </a>
                        )}
                        {merchant.address && (
                          <a
                            href={directionsUrl(merchant)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-2 text-center text-xs font-medium rounded-full bg-neutral-900 text-white hover:bg-neutral-800 transition-colors inline-flex items-center justify-center gap-1 shadow-xs"
                          >
                            <Navigation className="w-3 h-3 text-gold" />
                            <span>{lang === 'en' ? 'Directions' : '导航'}</span>
                          </a>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Mobile Navigation Arrows & Direct Page Counter */}
                <div className="flex items-center justify-center gap-3 mt-3 text-xs text-neutral-500 select-none">
                  <button
                    type="button"
                    onClick={() => scrollMerchants('left')}
                    className="p-1 rounded-full hover:bg-neutral-200 text-neutral-500 transition-colors"
                    aria-label="Previous merchant"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-neutral-600 font-medium tracking-wide text-xs">
                    {currentMerchantIndex} / {filteredMerchants.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => scrollMerchants('right')}
                    className="p-1 rounded-full hover:bg-neutral-200 text-neutral-500 transition-colors"
                    aria-label="Next merchant"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Desktop View: Full Editorial Rows Layout */}
              <div className="hidden md:block bg-white rounded-2xl border border-neutral-200/80 divide-y divide-neutral-200/80 overflow-hidden shadow-sm">
                {filteredMerchants.map((merchant: BusinessMerchant, idx: number) => (
                  <motion.div
                    key={merchant.id}
                    initial={riseFrom}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={inView}
                    transition={listItem(idx)}
                    className="p-6 sm:p-8 hover:bg-surface-hover transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6"
                  >
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                          {merchant.categoryLabel}
                        </span>
                        {merchant.featured && (
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-neutral-900 text-white flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-gold" />
                            <span>CAACI Verified</span>
                          </span>
                        )}
                        {merchant.discount &&
                          !merchant.discount.toLowerCase().includes('official directory') &&
                          !merchant.discount.includes('名录') && (
                            <span className="text-[11px] font-semibold text-brick px-2.5 py-0.5 rounded-full bg-brick/10">
                              {merchant.discount}
                            </span>
                          )}
                        {merchant.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-neutral-200 text-neutral-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <h3 className="text-lg sm:text-xl font-semibold text-ink tracking-tight">
                        {merchant.name}
                      </h3>

                      <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                        {merchant.desc}
                      </p>

                      <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-neutral-500 pt-1">
                        {merchant.address && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span>{merchant.address}</span>
                          </span>
                        )}
                        {merchant.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span>{merchant.phone}</span>
                          </span>
                        )}
                        {merchant.hours && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span>{merchant.hours}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 pt-2 md:pt-0">
                      {merchant.website && (
                        <a
                          href={merchant.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 text-xs font-medium rounded-full border border-neutral-200 text-neutral-800 hover:border-neutral-400 transition-colors inline-flex items-center gap-1.5"
                        >
                          <span>{lang === 'en' ? 'Visit Website' : '访问商户'}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-neutral-400" />
                        </a>
                      )}
                      {merchant.address && (
                        <a
                          href={directionsUrl(merchant)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 text-xs font-medium rounded-full bg-neutral-100 text-neutral-800 hover:bg-neutral-200 transition-colors inline-flex items-center gap-1.5"
                        >
                          <Navigation className="w-3.5 h-3.5 text-brick" />
                          <span>{lang === 'en' ? 'Directions' : '导航路线'}</span>
                        </a>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 5. Section: Chamber Microloan Assistance */}
      <section
        id="section-microloan"
        className="py-16 sm:py-24 bg-white border-b border-neutral-200/80 overflow-hidden"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise()}
            className="space-y-6"
          >
            <span className="text-xs font-semibold text-brick block">
              {lang === 'en' ? 'Financing Assistance' : '小微金融扶持'}
            </span>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink leading-snug">
              {lang === 'en'
                ? 'Champaign County Chamber Microloan Assistance'
                : '香槟县商会小额贷款扶持计划'}
            </h2>

            <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
              {lang === 'en' ? (
                <>
                  <strong className="text-neutral-900 font-medium">Capital Amount & Term:</strong>{' '}
                  $7,500 to $15,000 for equipment, inventory, or lease improvements with up to
                  5-year repayment terms.{' '}
                  <strong className="text-neutral-900 font-medium">Low Interest Rates:</strong>{' '}
                  Rates not exceeding 3.0% (2.5% rate with automatic monthly bank ACH repayments).
                </>
              ) : (
                <>
                  <strong className="text-neutral-900 font-medium">额度与周期：</strong>$7,500 至
                  $15,000 专项扶持周转金，适用于购置设备、进货备料或店面租约改造，还款期最长 5 年。{' '}
                  <strong className="text-neutral-900 font-medium">优惠利率：</strong>年化利率不超过
                  3.0%（绑定每月银行自动转账扣款享 2.5% 优惠利率）。
                </>
              )}
            </p>

            {/* Step 1-3 Official Application Process with Progressive Slide In */}
            <div className="pt-4 border-t border-neutral-200/80 space-y-4 text-xs sm:text-sm text-neutral-700">
              <motion.div
                initial={slideFromLeft}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={inView}
                transition={rise(0.1)}
                className="flex items-start gap-3.5"
              >
                <span className="w-6 h-6 rounded-full bg-brick/10 text-brick font-semibold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <h4 className="font-semibold text-ink text-sm">
                    {lang === 'en' ? 'Step 1: Prepare Required Materials' : '第一步：准备申请材料'}
                  </h4>
                  <p className="text-neutral-600 mt-0.5 leading-relaxed">
                    {lang === 'en'
                      ? 'Prepare a concise 1-page business plan, federal Employer Identification Number (EIN), and Certificate of Good Standing from the Illinois Secretary of State.'
                      : '准备 1 页纸精炼商业计划书（Business Plan）、联邦雇主识别号（EIN）以及伊利诺伊州州务卿注册良好存续证明。'}
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={slideFromLeft}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={inView}
                transition={rise(0.2)}
                className="flex items-start gap-3.5"
              >
                <span className="w-6 h-6 rounded-full bg-brick/10 text-brick font-semibold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <h4 className="font-semibold text-ink text-sm">
                    {lang === 'en'
                      ? 'Step 2: Direct Submission to Chamber'
                      : '第二步：直接联系商会申请'}
                  </h4>
                  <p className="text-neutral-600 mt-0.5 leading-relaxed">
                    {lang === 'en'
                      ? 'Contact Laura Weis, President & CEO of the Champaign County Chamber of Commerce directly via email or phone to submit your application materials.'
                      : '直接通过电子邮件或电话联系香槟县商会总裁兼 CEO Laura Weis 提交申请初审。'}
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={slideFromLeft}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={inView}
                transition={rise(0.3)}
                className="flex items-start gap-3.5"
              >
                <span className="w-6 h-6 rounded-full bg-brick/10 text-brick font-semibold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <div>
                  <h4 className="font-semibold text-ink text-sm">
                    {lang === 'en'
                      ? 'Step 3: Review & Disbursement'
                      : '第三步：评审委员会评估与放款'}
                  </h4>
                  <p className="text-neutral-600 mt-0.5 leading-relaxed">
                    {lang === 'en'
                      ? 'The Chamber Loan Committee evaluates character and business viability over strict collateral requirements. Upon approval, funds are disbursed directly.'
                      : '商会贷款评审委员会主要依据经营者信誉与还款能力进行综合评估（不硬性要求重资产抵押），核准后直接放款。'}
                  </p>
                </div>
              </motion.div>
            </div>

            <div className="pt-4 flex flex-wrap items-center gap-3">
              <motion.a
                whileHover={hoverScale}
                whileTap={tap}
                href="mailto:lauraw@champaigncounty.org?subject=Champaign%20County%20Chamber%20Microloan%20Inquiry"
                className="px-6 py-3 rounded-full bg-ink text-white text-xs sm:text-sm font-medium hover:bg-neutral-800 transition-colors cursor-pointer inline-flex items-center gap-2"
              >
                <Mail className="w-4 h-4" />
                <span>lauraw@champaigncounty.org</span>
              </motion.a>
              <motion.a
                whileHover={hoverScale}
                whileTap={tap}
                href="tel:2173591791"
                className="px-6 py-3 rounded-full border border-neutral-300 text-neutral-800 hover:border-neutral-800 text-xs sm:text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2"
              >
                <Phone className="w-4 h-4" />
                <span>(217) 359-1791</span>
              </motion.a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* 6. Section: Commercial Events & Mentorship (Apple Editorial Rows with Motion) */}
      <section
        id="section-mentorship"
        className="py-16 sm:py-24 bg-surface-2 border-b border-neutral-200/80"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise()}
            className="max-w-3xl mb-12"
          >
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Programs & Networking' : '经贸活动与导师计划'}
            </span>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-ink">
              {lang === 'en'
                ? 'Commercial Events & Entrepreneur Mentorship'
                : '商业经贸活动与青年创业导师'}
            </h2>
            <p className="mt-2 text-sm text-neutral-600">
              {lang === 'en'
                ? 'Connecting aspiring founders and small business owners with seasoned executives, venture leaders, and state agencies.'
                : '汇聚美中地区资深华裔企业家、跨国高管与伊利诺伊大学商学院学者，定期举办实战研讨与政商招聘会。'}
            </p>
          </motion.div>

          {/* Event Rows (Apple Editorial Schedule with Staggered Entrance) */}
          <div className="bg-white rounded-2xl border border-neutral-200/80 divide-y divide-neutral-200/80 overflow-hidden shadow-sm">
            {data.events.map((evt, idx) => (
              <motion.div
                key={evt.id}
                initial={riseFrom}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={inView}
                transition={rise(idx * 0.1)}
                className="p-6 sm:p-8 hover:bg-surface-hover transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-6"
              >
                <div className="space-y-2 max-w-2xl">
                  <h3 className="text-lg sm:text-xl font-semibold text-ink tracking-tight">
                    {evt.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">{evt.desc}</p>

                  <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-neutral-500 pt-1">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{evt.date}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{evt.time}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{evt.location}</span>
                    </span>
                  </div>
                </div>

                <div className="shrink-0 pt-2 lg:pt-0">
                  <motion.button
                    whileHover={hoverScale}
                    whileTap={tap}
                    type="button"
                    onClick={() => onNavigate('events')}
                    className="px-5 py-2.5 text-xs font-medium rounded-full bg-ink text-white hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'View Event / RSVP' : '查看详情与预约'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Section: Corporate Partnerships & Sponsorship (Apple Clean Columns with Motion) */}
      <section
        id="section-sponsorship"
        className="py-16 sm:py-24 bg-white border-b border-neutral-200/80"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={riseFrom}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={inView}
            transition={rise()}
            className="text-center max-w-2xl mx-auto mb-14"
          >
            <span className="text-xs font-semibold text-brick block mb-2">
              {lang === 'en' ? 'Official Membership & Financing' : '官方入驻与扶持通道'}
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {lang === 'en'
                ? 'Directory Listing & Chamber Financing'
                : '商户名录入驻与商会扶持说明'}
            </h2>
            <p className="mt-3 text-sm text-neutral-600">
              {lang === 'en'
                ? `The CAACI Business Directory listing is part of Business Membership: ${directoryPrice}/year (${directoryCard} with the 3.5% card fee when paying online by card). We also accept check, Zelle and cash — email caaci.org@gmail.com to arrange payment or ask questions.`
                : `华协商业名录收录包含在商业会员中：${directoryPrice}/年（在线刷卡合计 ${directoryCard}，含 3.5% 手续费）。也可使用支票、Zelle、现金等方式付款，请致信 caaci.org@gmail.com 安排付款或咨询。`}
            </p>
          </motion.div>

          <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
            {data.sponsorTiers.map((tier, idx) => (
              <motion.div
                key={idx}
                initial={riseFrom}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={inView}
                transition={rise(idx * 0.15)}
                whileHover={hoverLift}
                className={`rounded-2xl p-8 flex flex-col justify-between transition-all relative ${
                  tier.recommended
                    ? 'bg-surface-3 border-2 border-ink shadow-md'
                    : 'bg-white border border-neutral-200/90'
                }`}
              >
                {tier.recommended && (
                  <div className="absolute -top-3 left-8 bg-ink text-white text-[11px] font-medium px-3 py-0.5 rounded-full">
                    {lang === 'en' ? 'Recommended' : '推荐方案'}
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className="text-xl font-semibold text-ink tracking-tight">
                    {fill(tier.name)}
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed">{fill(tier.subtitle)}</p>

                  <div className="pt-2 pb-4 border-b border-neutral-200/80 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight text-ink">
                      {fill(tier.price)}
                    </span>
                    <span className="text-xs text-neutral-500 font-medium">/ {tier.period}</span>
                  </div>

                  <ul className="space-y-3 pt-2">
                    {tier.features.map((feat, fIdx) => (
                      <li key={fIdx} className="flex items-start gap-2.5 text-xs text-neutral-700">
                        <Check className="w-4 h-4 text-brick shrink-0 mt-0.5" />
                        <span>{fill(feat)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-8 mt-8 border-t border-neutral-200/80">
                  <motion.button
                    whileHover={hoverScale}
                    whileTap={tap}
                    type="button"
                    onClick={() => sponsorClick(tier)}
                    className={`w-full py-3 rounded-full text-xs font-medium tracking-wide uppercase transition-all cursor-pointer ${
                      tier.recommended
                        ? 'bg-brick text-white hover:bg-brick-pressed'
                        : 'border border-neutral-300 text-neutral-800 hover:border-neutral-800 hover:text-ink'
                    }`}
                  >
                    {sponsorLabel(tier)}
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Apple-Style Business Inquiry / Intake Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={overlayIn}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={panelFrom}
              animate={panelShown}
              exit={panelFrom}
              transition={panelIn}
              className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              {formSubmitted ? (
                <div className="py-12 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-semibold text-ink">
                    {isListing
                      ? t('Listing Submitted', '商户信息已提交')
                      : t('Message Sent', '信息已成功发送')}
                  </h3>
                  <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                    {isListing
                      ? t(
                          'Thank you! CAACI staff will review your listing before it appears in the directory. Directory listings are included with Business Membership.',
                          '感谢您的支持！CAACI 工作人员审核通过后，您的商户将显示在名录中。名录收录包含在商业会员中。',
                        )
                      : t(
                          'Thank you! Your inquiry has been sent to CAACI.',
                          '感谢您的支持！您的咨询已发送至 CAACI。',
                        )}
                  </p>
                  <div className="pt-3 flex flex-wrap items-center justify-center gap-2">
                    {isListing && (
                      <button
                        type="button"
                        onClick={goToBusinessMembership}
                        className="px-5 py-2.5 rounded-full bg-brick text-white text-xs font-medium hover:bg-brick-pressed transition-colors cursor-pointer"
                      >
                        {t(
                          `Get Business Membership (${directoryPrice}/yr)`,
                          `办理商业会员 (${directoryPrice}/年)`,
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="px-5 py-2.5 rounded-full border border-neutral-300 text-neutral-800 hover:border-neutral-800 text-xs font-medium transition-colors cursor-pointer"
                    >
                      {t('Close', '关闭')}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-6">
                    <span className="text-[11px] font-semibold text-brick block mb-1">
                      {lang === 'en' ? 'Direct Application' : '在线咨询与入驻申请'}
                    </span>
                    <h3 className="text-2xl font-semibold tracking-tight text-ink">
                      {inquiryType === 'directory'
                        ? lang === 'en'
                          ? 'Join the Business Directory'
                          : '加入认证华人商业名录'
                        : inquiryType === 'microloan'
                          ? lang === 'en'
                            ? 'Chamber Microloan Consultation'
                            : '商会小额贷款咨询申请'
                          : inquiryType === 'sponsor'
                            ? lang === 'en'
                              ? 'Corporate Partnership Inquiry'
                              : '企业会员与赞助合作申请'
                            : lang === 'en'
                              ? 'General Business Inquiry'
                              : '商业合作与经贸咨询'}
                    </h3>
                  </div>

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        {lang === 'en' ? 'Business / Company Name' : '企业或商户名称'} *
                      </label>
                      <input
                        type="text"
                        required
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="e.g. Mandarin Wok / 香槟中餐"
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                      />
                    </div>

                    {isListing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {t('Category', '商户类别')} *
                          </label>
                          <select
                            required
                            value={listingCategory}
                            onChange={(e) => setListingCategory(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800 bg-white"
                          >
                            {LISTING_CATEGORIES.map((c) => (
                              <option key={c.id} value={c.id}>
                                {lang === 'en' ? c.en : c.zh}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {t('Business Phone', '商户电话')}
                          </label>
                          <input
                            type="tel"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder="(217) 000-0000"
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {lang === 'en' ? 'Contact Person' : '联系人姓名'} *
                          </label>
                          <input
                            type="text"
                            required
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            placeholder="e.g. Ying Man Tang"
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {lang === 'en' ? 'Phone Number' : '联系电话'} *
                          </label>
                          <input
                            type="tel"
                            required
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder="(217) 000-0000"
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        {isListing
                          ? t('Contact Email', '联系邮箱')
                          : t('Email Address', '电子邮箱')}{' '}
                        *
                      </label>
                      <input
                        type="email"
                        required
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="contact@company.com"
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                      />
                    </div>

                    {isListing && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {t('Address', '商户地址')}
                          </label>
                          <input
                            type="text"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="123 Main St, Champaign, IL"
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {t('Website', '网站')}
                          </label>
                          <input
                            type="text"
                            inputMode="url"
                            value={website}
                            onChange={(e) => setWebsite(e.target.value)}
                            placeholder="example.com"
                            className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        {isListing
                          ? t('Business Description', '商户简介')
                          : lang === 'en'
                            ? 'Inquiry Details / Proposed Perk'
                            : '需求简述 / 会员特惠方案'}
                      </label>
                      <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={
                          isListing
                            ? t(
                                'What your business offers, and any discount for CAACI members...',
                                '简述您的主营业务，以及向华协会员提供的优惠...',
                              )
                            : lang === 'en'
                              ? 'Describe your services, proposed member discount, or financing requirements...'
                              : '简述您的主营业务、向华协会员提供的优惠折扣，或贷款意向金额...'
                        }
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-800"
                      />
                    </div>

                    {isListing && (
                      <p className="text-[11px] text-neutral-500 leading-relaxed">
                        {t(
                          'The business phone, address, website and description are shown publicly once CAACI staff approve the listing.',
                          '工作人员审核通过后，商户电话、地址、网站与简介将公开显示在名录中。',
                        )}
                      </p>
                    )}

                    {formError && (
                      <p className="text-xs text-red-600" role="alert">
                        {formError}
                      </p>
                    )}

                    <TurnstileBox handle={turnstile} />

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={sending}
                        aria-busy={sending}
                        className="w-full py-3 rounded-full bg-ink text-white text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-default"
                      >
                        <Send className="w-4 h-4" />
                        <span>
                          {sending
                            ? t('Sending…', '提交中…')
                            : isListing
                              ? t('Submit Listing', '确认提交申请')
                              : t('Submit Inquiry', '确认提交申请')}
                        </span>
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 9. Contact Section */}
      <ContactSection content={content} />
    </div>
  );
}
