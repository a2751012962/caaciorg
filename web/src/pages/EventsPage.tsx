import { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Search,
  Check,
  Share2,
  Users,
  MessageSquare,
  Sparkles,
  History,
  ArrowUpDown,
  Tag,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { eventsDataEN, eventsDataZH } from '../data/pagesContent';

interface EventsPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// Current date boundary for upcoming vs past
const CURRENT_DATE_STR = '2026-09-14';

export function EventsPage({ content, lang, onOpenModal, onNavigate }: EventsPageProps) {
  const data = lang === 'en' ? eventsDataEN : eventsDataZH;
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'past'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [rsvpList, setRsvpList] = useState<Record<string, boolean>>({});
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [isNavVisible, setIsNavVisible] = useState<boolean>(true);
  const lastScrollY = useRef(0);

  // Sync with main navbar show/hide on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY <= 40) {
        setIsNavVisible(true);
      } else if (currentScrollY > lastScrollY.current + 8) {
        setIsNavVisible(false);
      } else if (currentScrollY < lastScrollY.current - 8) {
        setIsNavVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const categories =
    lang === 'en'
      ? [
          { id: 'all', label: 'All Categories' },
          { id: 'culture', label: 'Cultural Galas' },
          { id: 'job', label: 'Career & Professional' },
          { id: 'governance', label: 'Civic & Meetings' },
        ]
      : [
          { id: 'all', label: '全部分类' },
          { id: 'culture', label: '中华文化节庆' },
          { id: 'job', label: '求职与政务招聘' },
          { id: 'governance', label: '华协治理与大会' },
        ];

  const handleRsvp = (eventId: string) => {
    setRsvpList((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  const handleShare = (eventId: string) => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedEventId(eventId);
    setTimeout(() => setCopiedEventId(null), 2000);
  };

  const handleFeedback = (eventTitle: string) => {
    const el = document.getElementById('contact');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const textarea = el.querySelector('textarea') as HTMLTextAreaElement | null;
      if (textarea) {
        setTimeout(() => {
          textarea.focus();
          textarea.value =
            lang === 'en'
              ? `Feedback regarding past event: "${eventTitle}"\n\n`
              : `关于往期活动【${eventTitle}】的反馈与建议：\n\n`;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }, 500);
      }
    }
  };

  // Helper to parse dates reliably
  const parseDateParts = (isoDate: string) => {
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parts[2];
      const monthsEN = [
        'JAN',
        'FEB',
        'MAR',
        'APR',
        'MAY',
        'JUN',
        'JUL',
        'AUG',
        'SEP',
        'OCT',
        'NOV',
        'DEC',
      ];
      const monthsZH = [
        '1月',
        '2月',
        '3月',
        '4月',
        '5月',
        '6月',
        '7月',
        '8月',
        '9月',
        '10月',
        '11月',
        '12月',
      ];
      return {
        year,
        day,
        month:
          lang === 'en' ? monthsEN[monthIdx] || 'JAN' : monthsZH[monthIdx] || `${monthIdx + 1}月`,
      };
    }
    return { year: '2026', day: '01', month: 'JAN' };
  };

  const totalCount = data.items.length;
  const upcomingTotalCount = useMemo(
    () => data.items.filter((item) => item.isoDate >= CURRENT_DATE_STR).length,
    [data.items],
  );
  const pastTotalCount = useMemo(
    () => data.items.filter((item) => item.isoDate < CURRENT_DATE_STR).length,
    [data.items],
  );

  const scrollToSection = (id: string, e?: MouseEvent) => {
    if (e) e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      const yOffset = -140; // account for sticky nav + sticky filter bar
      const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // Filter and sort items
  const { upcomingEvents, pastEvents } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const matchesFilter = (item: (typeof data.items)[0]) => {
      const matchesSearch =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.desc.toLowerCase().includes(query) ||
        item.location.toLowerCase().includes(query) ||
        item.organizer.toLowerCase().includes(query);

      if (!matchesSearch) return false;

      if (selectedCategory !== 'all') {
        if (item.category !== selectedCategory) return false;
      }

      return true;
    };

    const filtered = data.items.filter(matchesFilter);

    // Split into upcoming and past by date
    const upcoming = filtered.filter((item) => item.isoDate >= CURRENT_DATE_STR);
    const past = filtered.filter((item) => item.isoDate < CURRENT_DATE_STR);

    // Sort upcoming: chronological by default (soonest upcoming first)
    upcoming.sort((a, b) => {
      const cmp = a.isoDate.localeCompare(b.isoDate);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Sort past: reverse-chronological by default (most recent past first)
    past.sort((a, b) => {
      const cmp = b.isoDate.localeCompare(a.isoDate);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return { upcomingEvents: upcoming, pastEvents: past };
  }, [data.items, searchQuery, selectedCategory, sortOrder]);

  // Closest upcoming marquee event for spotlight
  const spotlightEvent = upcomingEvents.length > 0 ? upcomingEvents[0] : null;

  return (
    <div className="bg-white min-h-screen text-[#1d1d1f] font-sans antialiased selection:bg-neutral-200 overflow-x-hidden">
      {/* 1. Subpage Parallax Header with Action Banners REMOVED */}
      <SubpageHero
        title={data.title}
        subtitle={data.subtitle}
        bgImage="/images/hero-bg.jpg"
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="events"
        showActionBanners={false}
      />

      {/* 2. Spotlight Banner for Next Upcoming Marquee Event */}
      {spotlightEvent && (
        <section className="py-10 sm:py-14 bg-[#fbfbfd] border-b border-neutral-200/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-[#1d1d1f] text-white rounded-3xl p-6 sm:p-10 lg:p-12 shadow-sm space-y-6">
              <div className="space-y-3 max-w-3xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-[#edbb5f] text-xs font-semibold uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 text-[#edbb5f]" />
                  <span>{lang === 'en' ? 'Upcoming Spotlight' : '近期重点活动推荐'}</span>
                </div>

                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white leading-snug">
                  {spotlightEvent.title}
                </h2>

                <p className="text-sm sm:text-base text-neutral-300 leading-relaxed max-w-2xl">
                  {spotlightEvent.desc}
                </p>

                <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5 text-[#edbb5f]" />
                    <span>
                      {spotlightEvent.date} • {spotlightEvent.time}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#edbb5f]" />
                    <span>{spotlightEvent.location}</span>
                  </span>
                </div>
              </div>

              {/* RSVP, Volunteer, Share Buttons on Left */}
              <div className="flex flex-wrap items-center justify-start gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleRsvp(spotlightEvent.id)}
                  className="min-h-[42px] px-6 py-2.5 rounded-full bg-white text-[#1d1d1f] hover:bg-neutral-200 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-sm active:scale-98"
                >
                  <Check
                    className={`w-4 h-4 ${
                      rsvpList[spotlightEvent.id] ? 'text-emerald-600' : 'text-neutral-400'
                    }`}
                  />
                  <span>
                    {rsvpList[spotlightEvent.id]
                      ? lang === 'en'
                        ? 'RSVP Confirmed'
                        : '已预约报名'
                      : lang === 'en'
                        ? 'RSVP for Admission'
                        : '立即预约报名'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenModal('volunteer')}
                  className="min-h-[42px] px-5 py-2.5 rounded-full border border-white/20 text-white hover:bg-white/10 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-98"
                >
                  <Users className="w-4 h-4 text-white/80" />
                  <span>{lang === 'en' ? 'Volunteer' : '报名义工'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleShare(spotlightEvent.id)}
                  className="min-h-[42px] px-5 py-2.5 rounded-full border border-white/20 text-white hover:bg-white/10 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-98"
                >
                  {copiedEventId === spotlightEvent.id ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-300">
                        {lang === 'en' ? 'Link Copied' : '链接已复制'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-4 h-4 text-white/80" />
                      <span>{lang === 'en' ? 'Share' : '分享'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 3. Interactive Schedule & Archive Container - Responsive Toolbar (not sticky on mobile) */}
      <div className="relative">
        {/* Filter & Search Control Bar - relative on mobile, sticky on desktop */}
        <section
          className={`relative lg:sticky z-30 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 shadow-xs transition-all duration-300 py-3 sm:py-4.5 ${
            isNavVisible ? 'top-0 lg:top-[72px]' : 'top-0'
          }`}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3">
              {/* Top Row: Title + Filter Tabs and Search Bar/Button on the SAME LINE */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] sm:text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block">
                    {lang === 'en' ? 'Schedule & Archive' : '活动日程与档案'}
                  </span>
                  <h2 className="text-base sm:text-2xl font-bold tracking-tight text-[#1d1d1f]">
                    {lang === 'en' ? 'Explore CAACI Events' : '浏览华协社区活动'}
                  </h2>
                </div>

                {/* Filter Tabs + Search Button on the Same Row - Perfectly Unified Heights, Equal Capsule Sizing & Never Overflows Mobile */}
                <div className="flex items-center gap-1.5 sm:gap-2.5 w-full lg:w-auto max-w-full">
                  {/* Segmented Time Filter Tabs with clean badges and identical h-10 container */}
                  <div className="h-10 p-1 rounded-full bg-neutral-100 border border-neutral-200/80 flex-1 sm:flex-initial flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setActiveTab('all')}
                      className={`h-8 flex-1 sm:flex-initial px-2 sm:px-4 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-1 sm:gap-1.5 ${
                        activeTab === 'all'
                          ? 'bg-white text-[#1d1d1f] shadow-xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <SlidersHorizontal className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-neutral-500" />
                      <span>{lang === 'en' ? 'All' : '全部'}</span>
                      <span
                        className={`min-w-[16px] sm:min-w-[18px] px-1 sm:px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold text-center leading-none ${
                          activeTab === 'all'
                            ? 'bg-neutral-100 text-neutral-900'
                            : 'bg-neutral-200/80 text-neutral-600'
                        }`}
                      >
                        {totalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('upcoming')}
                      className={`h-8 flex-1 sm:flex-initial px-2 sm:px-4 rounded-full text-xs font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap ${
                        activeTab === 'upcoming'
                          ? 'bg-white text-[#8e2e11] shadow-xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <CalendarIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-[#8e2e11]" />
                      <span>{lang === 'en' ? 'Upcoming' : '近期'}</span>
                      <span
                        className={`min-w-[16px] sm:min-w-[18px] px-1 sm:px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold text-center leading-none ${
                          activeTab === 'upcoming'
                            ? 'bg-[#8e2e11]/10 text-[#8e2e11]'
                            : 'bg-neutral-200/80 text-neutral-600'
                        }`}
                      >
                        {upcomingTotalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('past')}
                      className={`h-8 flex-1 sm:flex-initial px-2 sm:px-4 rounded-full text-xs font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap ${
                        activeTab === 'past'
                          ? 'bg-white text-[#1d1d1f] shadow-xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <History className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-neutral-500" />
                      <span>{lang === 'en' ? 'Past' : '往期'}</span>
                      <span
                        className={`min-w-[16px] sm:min-w-[18px] px-1 sm:px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold text-center leading-none ${
                          activeTab === 'past'
                            ? 'bg-neutral-100 text-neutral-900'
                            : 'bg-neutral-200/80 text-neutral-600'
                        }`}
                      >
                        {pastTotalCount}
                      </span>
                    </button>
                  </div>

                  {/* Desktop Inline Search Bar (Exactly matching h-10 height & pill contour) */}
                  <div className="hidden md:flex items-center relative w-60 lg:w-72 shrink-0 h-10">
                    <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={data.searchPlaceholder}
                      className="w-full h-10 pl-9 pr-8 text-xs bg-neutral-100/90 hover:bg-neutral-100 focus:bg-white border border-neutral-200/80 rounded-full focus:outline-none focus:ring-2 focus:ring-[#8e2e11]/20 focus:border-[#8e2e11] transition-all placeholder:text-neutral-400 shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Mobile Search Toggle Button (Matching h-10 / w-10 dimension) */}
                  <div className="md:hidden shrink-0">
                    <button
                      type="button"
                      onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                      className={`w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors shadow-2xs active:scale-95 ${
                        mobileSearchOpen || searchQuery
                          ? 'bg-[#8e2e11] text-white border-[#8e2e11]'
                          : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600 border-neutral-200/80'
                      }`}
                      title={data.searchPlaceholder}
                      aria-label="Search"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Expanded Search Bar (Only shown on mobile when opened or active query) */}
              {(mobileSearchOpen || searchQuery) && (
                <div className="md:hidden flex items-center gap-2 w-full animate-fadeIn pt-1">
                  <div className="relative flex-1 h-10 flex items-center">
                    <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={data.searchPlaceholder}
                      className="w-full h-10 pl-9 pr-8 text-xs bg-neutral-100/90 hover:bg-neutral-100 focus:bg-white border border-neutral-200/80 rounded-full focus:outline-none focus:ring-2 focus:ring-[#8e2e11]/20 focus:border-[#8e2e11] transition-all placeholder:text-neutral-400 shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileSearchOpen(false);
                      setSearchQuery('');
                    }}
                    className="w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 flex items-center justify-center shrink-0 cursor-pointer border border-neutral-200/80 active:scale-95 transition-colors"
                    title={lang === 'en' ? 'Close Search' : '关闭搜索'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Bottom Row: Categories + Sort Order */}
              <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pt-2 border-t border-neutral-100">
                <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar py-0.5">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`min-h-[34px] px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                        selectedCategory === cat.id
                          ? 'bg-[#8e2e11] text-white shadow-xs'
                          : 'bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-300'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Date Sort Toggle */}
                <button
                  type="button"
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 text-xs font-medium transition-colors cursor-pointer shrink-0 shadow-xs active:scale-98"
                  title={lang === 'en' ? 'Toggle date sort order' : '切换日期排序'}
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-neutral-500" />
                  <span className="whitespace-nowrap hidden sm:inline">
                    {sortOrder === 'asc'
                      ? lang === 'en'
                        ? 'Date: Ascending'
                        : '日期升序'
                      : lang === 'en'
                        ? 'Date: Descending'
                        : '日期降序'}
                  </span>
                  <span className="whitespace-nowrap sm:hidden">
                    {sortOrder === 'asc'
                      ? lang === 'en'
                        ? 'Asc'
                        : '升序'
                      : lang === 'en'
                        ? 'Desc'
                        : '降序'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Events Display Sections */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-20 space-y-12 sm:space-y-16 min-h-[520px]">
          {/* SECTION A: UPCOMING EVENTS */}
          {(activeTab === 'all' || activeTab === 'upcoming') && (
            <motion.section
              id="upcoming-events"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="space-y-5 sm:space-y-6"
            >
              {/* Header: Upcoming Events & Gatherings (Hidden on Mobile) */}
              <div className="hidden sm:flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-[#1d1d1f]">
                    {data.upcomingTitle}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-0.5 break-words">
                    {data.upcomingSubtitle}
                  </p>
                </div>

                {activeTab === 'all' && pastEvents.length > 0 && (
                  <div className="flex items-center shrink-0 self-start sm:self-auto">
                    <a
                      href="#past-events"
                      onClick={(e) => scrollToSection('past-events', e)}
                      className="text-xs text-[#8e2e11] hover:text-[#6a220c] font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200/80 transition-colors cursor-pointer shadow-xs shrink-0 whitespace-nowrap"
                    >
                      <span>{lang === 'en' ? 'Jump to Past Archive' : '直达往期回顾'}</span>
                      <span className="text-sm font-semibold">↓</span>
                    </a>
                  </div>
                )}
              </div>

              {upcomingEvents.length === 0 ? (
                <div className="text-center py-12 bg-[#fbfbfd] rounded-2xl border border-neutral-200/80">
                  <CalendarIcon className="w-9 h-9 text-neutral-300 mx-auto mb-2.5" />
                  <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                    {lang === 'en'
                      ? 'No upcoming events found matching your criteria.'
                      : '暂无符合筛选条件的近期活动。'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('all');
                    }}
                    className="mt-2.5 text-xs font-semibold text-[#8e2e11] hover:underline cursor-pointer"
                  >
                    {lang === 'en' ? 'Reset search filters' : '重置筛选条件'}
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-neutral-200/80 divide-y divide-neutral-200/80 overflow-hidden shadow-xs relative z-0">
                  <AnimatePresence mode="popLayout">
                    {upcomingEvents.map((event, idx) => {
                      const isRsvpDone = !!rsvpList[event.id];
                      const { year, day, month } = parseDateParts(event.isoDate);
                      const isCopied = copiedEventId === event.id;

                      return (
                        <motion.div
                          key={event.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.2) }}
                          className="p-3.5 sm:p-6 lg:p-7 hover:bg-[#fafafc] transition-colors relative z-0"
                        >
                          {/* Responsive Layout: Date box on the left, Content in middle, Actions on right for Desktop */}
                          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center justify-between">
                            {/* Left: Calendar Date Box */}
                            <div className="flex sm:block items-center gap-3 w-full sm:w-auto shrink-0">
                              <div className="w-16 sm:w-20 lg:w-24 rounded-2xl bg-[#f5f5f7] border border-neutral-200/80 p-2 sm:p-3 text-center shrink-0 shadow-xs transition-transform duration-200 group-hover:scale-105">
                                <span className="text-[9px] sm:text-[11px] font-bold tracking-wider uppercase text-[#8e2e11] block">
                                  {month}
                                </span>
                                <span className="text-xl sm:text-3xl font-bold text-[#1d1d1f] tracking-tight block my-0.5 sm:my-1 leading-none">
                                  {day}
                                </span>
                                <span className="text-[8px] sm:text-[10px] text-neutral-400 font-mono block">
                                  {year}
                                </span>
                              </div>

                              {/* Mobile Header Title in the Top Row */}
                              <div className="sm:hidden flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {event.isFeatured && (
                                    <span className="text-[10px] font-semibold text-[#8e2e11] px-2 py-0.5 rounded-full bg-[#8e2e11]/10">
                                      {lang === 'en' ? 'Featured' : '重点推荐'}
                                    </span>
                                  )}
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                                    {event.organizer}
                                  </span>
                                </div>
                                <h4 className="text-sm font-semibold text-[#1d1d1f] tracking-tight leading-snug line-clamp-2">
                                  {event.title}
                                </h4>
                              </div>
                            </div>

                            {/* Center Column: Event Header, Tags, Title & Metadata */}
                            <div className="space-y-2 flex-1 min-w-0 w-full">
                              {/* Desktop Badges & Category */}
                              <div className="hidden sm:flex flex-wrap items-center gap-1.5">
                                {event.isFeatured && (
                                  <span className="text-[10px] sm:text-[11px] font-semibold text-[#8e2e11] px-2 py-0.5 rounded-full bg-[#8e2e11]/10">
                                    {lang === 'en' ? 'Featured' : '重点推荐'}
                                  </span>
                                )}
                                <span className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                                  {event.organizer}
                                </span>
                              </div>

                              {/* Desktop Title */}
                              <h4 className="hidden sm:block text-base sm:text-lg lg:text-xl font-semibold text-[#1d1d1f] tracking-tight leading-snug">
                                {event.title}
                              </h4>

                              {/* Time & Location inline */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-neutral-500 pt-0.5">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                  <span>{event.time}</span>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                  <span className="truncate max-w-[200px] sm:max-w-none">
                                    {event.location}
                                  </span>
                                </span>
                              </div>

                              {/* Description */}
                              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed pt-0.5">
                                {event.desc}
                              </p>

                              {/* Mobile Action Buttons - Strict single line (flex-nowrap): RSVP & Volunteer text always visible, Share collapses to icon on tight screens */}
                              <div className="sm:hidden pt-2.5 flex items-center justify-start gap-1.5 flex-nowrap border-t border-neutral-100 overflow-hidden">
                                {/* Mobile RSVP (Primary action - text is NEVER hidden) */}
                                <button
                                  type="button"
                                  onClick={() => handleRsvp(event.id)}
                                  className={`h-8 px-3 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap shadow-xs active:scale-95 ${
                                    isRsvpDone
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-[#1d1d1f] text-white hover:bg-neutral-800'
                                  }`}
                                >
                                  <Check
                                    className={`w-3.5 h-3.5 ${isRsvpDone ? 'scale-110' : 'text-neutral-400'}`}
                                  />
                                  <span>
                                    {isRsvpDone
                                      ? lang === 'en'
                                        ? 'Confirmed'
                                        : '已预约'
                                      : lang === 'en'
                                        ? 'RSVP'
                                        : '预约报名'}
                                  </span>
                                </button>

                                {/* Mobile Volunteer (Text is NOT hidden) */}
                                <button
                                  type="button"
                                  onClick={() => onOpenModal('volunteer')}
                                  className="h-8 px-3 text-xs font-medium rounded-full border border-neutral-200 text-neutral-700 hover:border-neutral-400 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 bg-white shrink-0 active:scale-95 shadow-xs whitespace-nowrap"
                                  title={lang === 'en' ? 'Volunteer' : '报名义工'}
                                >
                                  <Users className="w-3.5 h-3.5 text-neutral-500" />
                                  <span>{lang === 'en' ? 'Volunteer' : '义工'}</span>
                                </button>

                                {/* Mobile Share (Icon always shown, text collapses on tight mobile screens) */}
                                <button
                                  type="button"
                                  onClick={() => handleShare(event.id)}
                                  className={`h-8 px-2.5 min-[420px]:px-3 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 whitespace-nowrap ${
                                    isCopied
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                                      : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                                  }`}
                                  title={lang === 'en' ? 'Share' : '分享'}
                                >
                                  {isCopied ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      <span className="hidden min-[420px]:inline font-semibold text-emerald-700">
                                        {lang === 'en' ? 'Copied' : '已复制'}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Share2 className="w-3.5 h-3.5 text-neutral-500" />
                                      <span className="hidden min-[420px]:inline">
                                        {lang === 'en' ? 'Share' : '分享'}
                                      </span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Right Column: Desktop Action Buttons (RSVP, Volunteer, Share on the Right, vertically centered) */}
                            <div className="hidden sm:flex flex-col items-center justify-center gap-2 shrink-0 sm:w-36 lg:w-40 self-center">
                              {/* RSVP Button */}
                              <button
                                type="button"
                                onClick={() => handleRsvp(event.id)}
                                className={`w-full min-h-[36px] text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 ${
                                  isRsvpDone
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-[#1d1d1f] text-white hover:bg-neutral-800 active:scale-95'
                                }`}
                              >
                                <Check
                                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isRsvpDone ? 'scale-110' : 'scale-90 text-neutral-400'}`}
                                />
                                <span className="truncate">
                                  {isRsvpDone
                                    ? lang === 'en'
                                      ? 'Confirmed'
                                      : '已预约'
                                    : lang === 'en'
                                      ? 'RSVP'
                                      : '预约报名'}
                                </span>
                              </button>

                              {/* Volunteer Button */}
                              <button
                                type="button"
                                onClick={() => onOpenModal('volunteer')}
                                className="w-full min-h-[34px] px-3 text-xs font-medium rounded-full border border-neutral-200 text-neutral-700 hover:border-neutral-400 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 bg-white shrink-0 active:scale-95"
                              >
                                <Users className="w-3.5 h-3.5 text-neutral-400" />
                                <span>{lang === 'en' ? 'Volunteer' : '报名义工'}</span>
                              </button>

                              {/* Share Button */}
                              <button
                                type="button"
                                onClick={() => handleShare(event.id)}
                                className={`w-full min-h-[32px] text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 ${
                                  isCopied
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 ring-1 ring-emerald-300/50'
                                    : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 hover:border-neutral-400'
                                }`}
                                title={lang === 'en' ? 'Share event' : '分享活动'}
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span className="font-semibold text-emerald-700">
                                      {lang === 'en' ? 'Copied' : '已复制'}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Share2 className="w-3.5 h-3.5 text-neutral-400" />
                                    <span>{lang === 'en' ? 'Share' : '分享'}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </motion.section>
          )}

          {/* SECTION B: PAST EVENTS */}
          {(activeTab === 'all' || activeTab === 'past') && (
            <motion.section
              id="past-events"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="space-y-5 sm:space-y-6 pt-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-neutral-200/80 pt-8 sm:pt-10">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-neutral-800">
                    {data.pastTitle}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-0.5 break-words">
                    {data.pastSubtitle}
                  </p>
                </div>

                {/* Symmetrical Jump Back to Upcoming Link without Archived Community History text */}
                {activeTab === 'all' && upcomingEvents.length > 0 && (
                  <div className="flex items-center shrink-0 self-start sm:self-auto">
                    <a
                      href="#upcoming-events"
                      onClick={(e) => scrollToSection('upcoming-events', e)}
                      className="text-xs text-[#8e2e11] hover:text-[#6a220c] font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors cursor-pointer shadow-xs shrink-0 whitespace-nowrap"
                    >
                      <span className="text-sm font-semibold">↑</span>
                      <span>{lang === 'en' ? 'Jump back to upcoming' : '返回近期活动'}</span>
                    </a>
                  </div>
                )}
              </div>

              {pastEvents.length === 0 ? (
                <div className="text-center py-12 bg-[#fbfbfd] rounded-2xl border border-neutral-200/80">
                  <History className="w-9 h-9 text-neutral-300 mx-auto mb-2.5" />
                  <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                    {lang === 'en'
                      ? 'No past events found matching your criteria.'
                      : '暂无符合筛选条件的往期活动。'}
                  </p>
                </div>
              ) : (
                <div className="bg-[#fafafc] rounded-2xl border border-neutral-200/90 divide-y divide-neutral-200/80 overflow-hidden shadow-xs relative z-0">
                  <AnimatePresence mode="popLayout">
                    {pastEvents.map((event, idx) => {
                      const { year, day, month } = parseDateParts(event.isoDate);
                      const isCopied = copiedEventId === event.id;

                      return (
                        <motion.div
                          key={event.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.2) }}
                          className="p-3.5 sm:p-6 lg:p-7 hover:bg-white transition-colors opacity-95 relative z-0"
                        >
                          {/* Responsive 3-Column Layout: Date on Left, Details in Center, Actions on Right (Desktop) */}
                          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center justify-between">
                            {/* Left Column: Minimalist Past Date Box matching Upcoming size */}
                            <div className="flex sm:block items-center gap-3 w-full sm:w-auto shrink-0">
                              {/* Date Box */}
                              <div className="w-16 sm:w-20 lg:w-24 rounded-2xl bg-white border border-neutral-200/90 p-2 sm:p-3 text-center shrink-0 shadow-xs">
                                <span className="text-[9px] sm:text-[11px] font-semibold tracking-wider uppercase text-neutral-500 block">
                                  {month}
                                </span>
                                <span className="text-xl sm:text-3xl font-semibold text-neutral-700 tracking-tight block my-0.5 sm:my-1 leading-none">
                                  {day}
                                </span>
                                <span className="text-[8px] sm:text-[10px] text-neutral-400 font-mono block">
                                  {year}
                                </span>
                              </div>

                              {/* Mobile Header Title in Top Row */}
                              <div className="sm:hidden flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white border border-neutral-200 text-neutral-600">
                                    {event.organizer}
                                  </span>
                                  {event.category && (
                                    <span className="text-[10px] text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                                      {event.category === 'culture'
                                        ? lang === 'en'
                                          ? 'Culture'
                                          : '文化节庆'
                                        : event.category === 'job'
                                          ? lang === 'en'
                                            ? 'Career'
                                            : '职业政务'
                                          : lang === 'en'
                                            ? 'Civic'
                                            : '协会治理'}
                                    </span>
                                  )}
                                </div>
                                <h4 className="text-sm font-semibold text-neutral-800 tracking-tight leading-snug line-clamp-2">
                                  {event.title}
                                </h4>
                              </div>
                            </div>

                            {/* Middle Column: Past Event Details */}
                            <div className="space-y-2 flex-1 min-w-0 w-full">
                              <div className="hidden sm:flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-white border border-neutral-200 text-neutral-600">
                                  {event.organizer}
                                </span>
                                {event.category && (
                                  <span className="text-[10px] text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                                    {event.category === 'culture'
                                      ? lang === 'en'
                                        ? 'Culture'
                                        : '文化节庆'
                                      : event.category === 'job'
                                        ? lang === 'en'
                                          ? 'Career'
                                          : '职业政务'
                                        : lang === 'en'
                                          ? 'Civic'
                                          : '协会治理'}
                                  </span>
                                )}
                              </div>

                              <h4 className="hidden sm:block text-base sm:text-lg font-semibold text-neutral-800 tracking-tight leading-snug">
                                {event.title}
                              </h4>

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-neutral-400 pt-0.5">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                  <span>{event.time}</span>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                  <span className="truncate max-w-[200px] sm:max-w-none">
                                    {event.location}
                                  </span>
                                </span>
                              </div>

                              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed pt-0.5">
                                {event.desc}
                              </p>

                              {/* Past Recap Highlight Badge */}
                              {event.recapSummary && (
                                <div className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-neutral-200/80 text-[11px] text-neutral-700">
                                  <Tag className="w-3 h-3 text-[#8e2e11] shrink-0" />
                                  <span className="font-medium text-neutral-800">
                                    {lang === 'en' ? 'Highlight Recap:' : '精彩回顾：'}
                                  </span>
                                  <span className="line-clamp-1">{event.recapSummary}</span>
                                </div>
                              )}

                              {/* Mobile Action Buttons on Bottom - Strict single line (flex-nowrap): Feedback first & Volunteer text visible, Share last with icon */}
                              <div className="sm:hidden pt-2.5 flex items-center justify-start gap-1.5 flex-nowrap border-t border-neutral-100 overflow-hidden">
                                {/* Mobile Feedback (Placed First, Text NOT hidden) */}
                                <button
                                  type="button"
                                  onClick={() => handleFeedback(event.title)}
                                  className="h-8 px-3 text-xs font-medium rounded-full bg-white border border-neutral-200 text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs shrink-0 active:scale-95 whitespace-nowrap"
                                  title={lang === 'en' ? 'Feedback' : '活动反馈'}
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-neutral-500" />
                                  <span>{lang === 'en' ? 'Feedback' : '活动反馈'}</span>
                                </button>

                                {/* Mobile Volunteer Archive (Collapsed to Icon on tight mobile screens) */}
                                <button
                                  type="button"
                                  onClick={() => onOpenModal('volunteer')}
                                  className="h-8 px-2.5 min-[420px]:px-3 text-xs font-medium rounded-full bg-white border border-neutral-200 text-neutral-700 hover:text-neutral-900 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs shrink-0 active:scale-95 whitespace-nowrap"
                                  title={lang === 'en' ? 'Volunteer Archive' : '致敬义工'}
                                >
                                  <Users className="w-3.5 h-3.5 text-neutral-500" />
                                  <span className="hidden min-[420px]:inline">
                                    {lang === 'en' ? 'Volunteer' : '致敬义工'}
                                  </span>
                                </button>

                                {/* Mobile Share (Placed Last, Icon always shown, text collapses on tight screens) */}
                                <button
                                  type="button"
                                  onClick={() => handleShare(event.id)}
                                  className={`h-8 px-2.5 min-[420px]:px-3.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 whitespace-nowrap ${
                                    isCopied
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                                      : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                                  }`}
                                  title={lang === 'en' ? 'Share' : '分享'}
                                >
                                  {isCopied ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      <span className="hidden min-[420px]:inline font-semibold text-emerald-700">
                                        {lang === 'en' ? 'Copied' : '已复制'}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Share2 className="w-3.5 h-3.5 text-neutral-500" />
                                      <span className="hidden min-[420px]:inline">
                                        {lang === 'en' ? 'Share' : '分享'}
                                      </span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Right Column: Desktop Action Buttons (Feedback First, Volunteer Archive & Share vertically centered on Right) */}
                            <div className="hidden sm:flex flex-col items-center justify-center gap-2 shrink-0 sm:w-36 lg:w-40 self-center">
                              {/* Feedback Button (First) */}
                              <button
                                type="button"
                                onClick={() => handleFeedback(event.title)}
                                className="w-full min-h-[34px] px-3 text-xs font-medium rounded-full bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-300 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs shrink-0 active:scale-95"
                                title={lang === 'en' ? 'Provide event feedback' : '提交活动反馈'}
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
                                <span>{lang === 'en' ? 'Feedback' : '活动反馈'}</span>
                              </button>

                              {/* Volunteer Archive Button */}
                              <button
                                type="button"
                                onClick={() => onOpenModal('volunteer')}
                                className="w-full min-h-[34px] px-3 text-xs font-medium rounded-full bg-white border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:border-neutral-300 transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs shrink-0 active:scale-95"
                              >
                                <Users className="w-3.5 h-3.5 text-neutral-400" />
                                <span>{lang === 'en' ? 'Volunteer Archive' : '致敬义工'}</span>
                              </button>

                              {/* Share Button */}
                              <button
                                type="button"
                                onClick={() => handleShare(event.id)}
                                className={`w-full min-h-[34px] text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 ${
                                  isCopied
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 ring-1 ring-emerald-300/50'
                                    : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 hover:border-neutral-300'
                                }`}
                                title={lang === 'en' ? 'Share archive' : '分享此活动档案'}
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span className="font-semibold text-emerald-700">
                                      {lang === 'en' ? 'Copied' : '已复制'}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Share2 className="w-3.5 h-3.5 text-neutral-400" />
                                    <span>{lang === 'en' ? 'Share' : '分享'}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </motion.section>
          )}
        </div>
      </div>

      <ContactSection content={content} />
    </div>
  );
}
