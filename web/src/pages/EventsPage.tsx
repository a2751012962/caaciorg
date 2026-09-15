import { useState, useMemo, useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
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
  ArrowUpRight,
  Gift,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { MorphIcon } from 'morphicons/react';
import { Check as CheckData, LoaderCircle as LoaderData } from 'lucide'; // icon data for morphing, not components
import type { CAACIContent } from '../data/content';
import { eventsDataEN, eventsDataZH } from '../data/pagesContent';
import { api } from '../lib/api';
import { loginUrl, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useUpcomingEvents } from '../lib/useEvents';
import {
  eventAnchor,
  eventCategory,
  eventDateBox,
  eventDateText,
  eventDescription,
  eventImage,
  eventPerkText,
  eventShareUrl,
  eventTimeText,
  eventTitle,
  eventsPath,
  registrationPath,
  takesRegistration,
  type EventRow,
} from '../lib/events';

interface EventsPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// One upcoming event (a published public.events row) as the page shows it.
interface UpcomingItem {
  ev: EventRow;
  anchor: string;
  title: string;
  desc: string;
  location: string;
  date: string;
  time: string;
  box: { month: string; day: string; year: string };
  category?: 'job' | 'culture' | 'governance' | 'community';
  register: boolean;
  perk: string | null;
}

// An RSVP button's state. `note`: 'new' just saved, 'already' the API said it
// existed, 'loaded' read from the member's own rsvps rows on page load.
type RsvpState =
  | { phase: 'busy' }
  | { phase: 'done'; note: 'new' | 'already' | 'loaded' }
  | { phase: 'error'; message: string };

// Events carry no organizer column; they are all CAACI's own.
const ORGANIZER = 'CAACI';

export function EventsPage({ content, lang, onOpenModal, onNavigate }: EventsPageProps) {
  const data = lang === 'en' ? eventsDataEN : eventsDataZH;
  const en = lang === 'en';
  const auth = useAuth();
  const { status: loadStatus, events, reload } = useUpcomingEvents();
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'past'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [rsvp, setRsvp] = useState<Record<string, RsvpState>>({});
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; key: number }>();
  const [isNavVisible, setIsNavVisible] = useState<boolean>(true);
  const lastScrollY = useRef(0);
  const hashHandled = useRef(false);

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

  // The signed-in member's own RSVPs (rsvps_self_read), so those buttons start confirmed.
  const userId = auth.user?.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase
      .from('rsvps')
      .select('event_id')
      .eq('member_id', userId)
      .then(
        ({ data: rows }) => {
          if (!alive || !rows) return;
          setRsvp((prev) => {
            const next = { ...prev };
            for (const { event_id } of rows as { event_id: string }[]) {
              if (!next[event_id] || next[event_id].phase === 'error')
                next[event_id] = { phase: 'done', note: 'loaded' };
            }
            return next;
          });
        },
        () => {
          // Unknown RSVPs just start as "RSVP"; the API answers "already" if so.
        },
      );
    return () => {
      alive = false;
    };
  }, [userId]);

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

  // RSVP through /api/rsvp (member only). Signed out, or a session the API no
  // longer accepts: to the login page, which returns here.
  const handleRsvp = async (ev: EventRow) => {
    const current = rsvp[ev.id];
    if (current?.phase === 'busy' || current?.phase === 'done') return;
    const toLogin = () => window.location.assign(loginUrl(eventsPath(lang)));
    const session = auth.ready ? auth.session : (await supabase.auth.getSession()).data.session;
    if (!session) return toLogin();

    setRsvp((prev) => ({ ...prev, [ev.id]: { phase: 'busy' } }));
    const { ok, status, data } = await api<{ ok?: boolean; already?: boolean }>(
      '/api/rsvp',
      { event_id: ev.id, guests: 0 },
      { auth: true },
    );
    if (ok && data.ok) {
      setRsvp((prev) => ({
        ...prev,
        [ev.id]: { phase: 'done', note: data.already ? 'already' : 'new' },
      }));
      return;
    }
    if (status === 401) return toLogin();
    const message =
      status === 0
        ? en
          ? 'Network error. Please check your connection and try again.'
          : '网络错误，请检查网络连接后重试。'
        : status === 404
          ? en
            ? 'This event is no longer taking RSVPs.'
            : '该活动已不再接受预约。'
          : en
            ? 'Your RSVP could not be saved. Please try again.'
            : '预约未能保存，请重试。';
    setRsvp((prev) => ({ ...prev, [ev.id]: { phase: 'error', message } }));
  };

  const copyLink = async (id: string, url: string) => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopiedEventId(id);
      window.setTimeout(() => setCopiedEventId((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      window.prompt(en ? 'Copy this link:' : '复制此链接：', url);
    }
  };

  // Upcoming: the event's registration page, else its row here (/events/#<slug>).
  const shareUpcoming = (item: UpcomingItem) =>
    void copyLink(item.ev.id, eventShareUrl(item.ev, lang, window.location.origin));
  const sharePast = (id: string) =>
    void copyLink(id, `${window.location.origin}${eventsPath(lang)}#${encodeURIComponent(id)}`);

  const handleFeedback = (title: string) => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFeedback((prev) => ({
      key: (prev?.key ?? 0) + 1,
      message: en
        ? `Feedback regarding past event: "${title}"\n\n`
        : `关于往期活动【${title}】的反馈与建议：\n\n`,
    }));
  };

  // Helper to parse the static archive's dates
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
    return { year: '', day: '', month: '' };
  };

  const upcomingItems = useMemo<UpcomingItem[]>(
    () =>
      events.map((ev) => ({
        ev,
        anchor: eventAnchor(ev),
        title: eventTitle(ev, lang),
        desc: eventDescription(ev, lang),
        location: ev.location || '',
        date: eventDateText(ev, lang),
        time: eventTimeText(ev, lang),
        box: eventDateBox(ev, lang),
        category: eventCategory(ev),
        register: takesRegistration(ev),
        perk: eventPerkText(ev, lang),
      })),
    [events, lang],
  );

  const loading = loadStatus === 'loading';
  const upcomingTotalCount = upcomingItems.length;
  const pastTotalCount = data.past.length;
  const totalCount = upcomingTotalCount + pastTotalCount;

  const scrollToSection = (id: string, e?: MouseEvent) => {
    if (e) e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      const yOffset = -140; // account for sticky nav + sticky filter bar
      const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // A link to #past (/past-events/ redirects there), #<slug> or #<archive id>:
  // scroll once the target exists — upcoming rows only after the events load.
  useEffect(() => {
    if (hashHandled.current) return;
    let target = '';
    try {
      target = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      target = '';
    }
    const isStatic = target === 'past' || data.past.some((p) => p.id === target);
    if (target && !isStatic && loadStatus === 'loading') return;
    hashHandled.current = true;
    if (!target) return;
    window.setTimeout(() => scrollToSection(target), 80);
  }, [loadStatus]);

  // Filter and sort items
  const { upcomingEvents, pastEvents } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matches = (texts: (string | null | undefined)[], category?: string) =>
      (!query || texts.some((t) => (t || '').toLowerCase().includes(query))) &&
      (selectedCategory === 'all' || category === selectedCategory);

    // Upcoming: soonest first by default (the events arrive in that order)
    const upcoming = upcomingItems.filter((item) =>
      matches(
        [item.title, item.ev.title, item.ev.title_zh, item.desc, item.location, ORGANIZER],
        item.category,
      ),
    );
    if (sortOrder === 'desc') upcoming.reverse();

    // Past: most recent first by default
    const past = data.past.filter((item) =>
      matches([item.title, item.desc, item.location, item.organizer], item.category),
    );
    past.sort((a, b) => {
      const cmp = b.isoDate.localeCompare(a.isoDate);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return { upcomingEvents: upcoming, pastEvents: past };
  }, [upcomingItems, data.past, searchQuery, selectedCategory, sortOrder]);

  // The soonest upcoming event, whatever the filters, for the spotlight
  const spotlightEvent = upcomingItems.length > 0 ? upcomingItems[0] : null;
  const spotlightImage = spotlightEvent ? eventImage(spotlightEvent.ev) : null;

  // The primary button: "Register" opens the event's registration page (a full
  // page load); otherwise RSVP. Three sizes: spotlight, phone row, desktop row.
  const primaryAction = (item: UpcomingItem, variant: 'spotlight' | 'mobile' | 'desktop') => {
    const state = item.register ? undefined : rsvp[item.ev.id];
    const done = state?.phase === 'done';
    const busy = state?.phase === 'busy';
    const className =
      variant === 'spotlight'
        ? 'min-h-[42px] px-6 py-2.5 rounded-full bg-white text-ink hover:bg-neutral-200 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 shadow-sm active:scale-98 disabled:cursor-default'
        : variant === 'mobile'
          ? `h-8 px-3 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap shadow-xs active:scale-95 disabled:cursor-default ${
              done ? 'bg-emerald-600 text-white' : 'bg-ink text-white hover:bg-neutral-800'
            }`
          : `w-full min-h-[36px] text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 disabled:cursor-default ${
              done
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-ink text-white hover:bg-neutral-800 active:scale-95'
            }`;
    const iconClass =
      variant === 'spotlight'
        ? `w-4 h-4 ${done ? 'text-emerald-600' : 'text-neutral-400'}`
        : variant === 'mobile'
          ? `w-3.5 h-3.5 ${done ? 'scale-110' : 'text-neutral-400'}`
          : `w-3.5 h-3.5 transition-transform duration-200 ${done ? 'scale-110' : 'scale-90 text-neutral-400'}`;
    const labelClass = variant === 'desktop' ? 'truncate' : undefined;

    if (item.register) {
      return (
        <a href={registrationPath(item.ev, lang)} className={className}>
          <ArrowUpRight className={iconClass} />
          <span className={labelClass}>
            {variant === 'spotlight'
              ? en
                ? 'Register Now'
                : '立即报名'
              : en
                ? 'Register'
                : '报名'}
          </span>
        </a>
      );
    }

    const short = variant !== 'spotlight';
    const label = busy
      ? en
        ? 'Saving…'
        : '提交中…'
      : done
        ? short
          ? en
            ? 'Confirmed'
            : '已预约'
          : en
            ? 'RSVP Confirmed'
            : '已预约报名'
        : short
          ? en
            ? 'RSVP'
            : '预约报名'
          : en
            ? 'RSVP for Admission'
            : '立即预约报名';
    return (
      <button
        type="button"
        onClick={() => void handleRsvp(item.ev)}
        disabled={busy || done}
        aria-busy={busy}
        className={className}
      >
        <MorphIcon
          icon={busy ? LoaderData : CheckData}
          spring="snappy"
          className={busy ? `${iconClass} animate-spin` : iconClass}
        />
        <span className={labelClass}>{label}</span>
      </button>
    );
  };

  // What the RSVP call said, under the event.
  const rsvpNote = (item: UpcomingItem, dark = false) => {
    const state = item.register ? undefined : rsvp[item.ev.id];
    if (state?.phase === 'error')
      return (
        <p
          role="alert"
          className={`text-[11px] sm:text-xs font-medium ${dark ? 'text-red-300' : 'text-red-600'}`}
        >
          {state.message}
        </p>
      );
    if (state?.phase === 'done' && state.note !== 'loaded')
      return (
        <p
          role="status"
          className={`text-[11px] sm:text-xs font-medium ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}
        >
          {state.note === 'already'
            ? en
              ? 'You had already RSVPed for this event.'
              : '您之前已预约过此活动。'
            : en
              ? 'RSVP confirmed. See you there!'
              : '预约成功，期待与您相见！'}
        </p>
      );
    return null;
  };

  const perkLine = (item: UpcomingItem, dark = false) =>
    item.perk ? (
      <p
        className={`flex items-start gap-1.5 text-[11px] sm:text-xs leading-relaxed ${dark ? 'text-gold' : 'text-brick'}`}
      >
        <Gift className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>{item.perk}</span>
      </p>
    ) : null;

  const statusBox = (children: ReactNode, role: 'status' | 'alert' = 'status') => (
    <div
      role={role}
      className="text-center py-12 bg-surface-2 rounded-2xl border border-neutral-200/80"
    >
      {children}
    </div>
  );

  return (
    <div className="bg-white min-h-screen text-ink font-sans antialiased selection:bg-neutral-200 overflow-x-hidden">
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
        <section className="py-10 sm:py-14 bg-surface-2 border-b border-neutral-200/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div
              className="bg-ink bg-cover bg-center text-white rounded-3xl p-6 sm:p-10 lg:p-12 shadow-sm space-y-6"
              style={
                spotlightImage
                  ? {
                      backgroundImage: `linear-gradient(90deg, rgba(29,29,31,0.96) 0%, rgba(29,29,31,0.88) 60%, rgba(29,29,31,0.6) 100%), url(${JSON.stringify(spotlightImage)})`,
                    }
                  : undefined
              }
            >
              <div className="space-y-3 max-w-3xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-gold text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-gold" />
                  <span>{lang === 'en' ? 'Upcoming Spotlight' : '近期重点活动推荐'}</span>
                </div>

                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white leading-snug">
                  {spotlightEvent.title}
                </h2>

                {spotlightEvent.desc && (
                  <p className="text-sm sm:text-base text-neutral-300 leading-relaxed max-w-2xl whitespace-pre-line">
                    {spotlightEvent.desc}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="w-3.5 h-3.5 text-gold" />
                    <span>
                      {spotlightEvent.date} • {spotlightEvent.time}
                    </span>
                  </span>
                  {spotlightEvent.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-gold" />
                      <span>{spotlightEvent.location}</span>
                    </span>
                  )}
                </div>

                {perkLine(spotlightEvent, true)}
              </div>

              {/* Register / RSVP, Volunteer, Share Buttons on Left */}
              <div className="space-y-2 pt-2">
                <div className="flex flex-wrap items-center justify-start gap-3">
                  {primaryAction(spotlightEvent, 'spotlight')}

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
                    onClick={() => shareUpcoming(spotlightEvent)}
                    className="min-h-[42px] px-5 py-2.5 rounded-full border border-white/20 text-white hover:bg-white/10 text-xs font-semibold tracking-wide transition-all cursor-pointer inline-flex items-center justify-center gap-2 active:scale-98"
                  >
                    {copiedEventId === spotlightEvent.ev.id ? (
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
                {rsvpNote(spotlightEvent, true)}
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
                  <span className="text-[10px] sm:text-xs font-semibold text-brick block">
                    {lang === 'en' ? 'Schedule & Archive' : '活动日程与档案'}
                  </span>
                  <h2 className="text-base sm:text-2xl font-bold tracking-tight text-ink">
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
                          ? 'bg-white text-ink shadow-xs'
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
                        {loading ? '–' : totalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('upcoming')}
                      className={`h-8 flex-1 sm:flex-initial px-2 sm:px-4 rounded-full text-xs font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap ${
                        activeTab === 'upcoming'
                          ? 'bg-white text-brick shadow-xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      <CalendarIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-brick" />
                      <span>{lang === 'en' ? 'Upcoming' : '近期'}</span>
                      <span
                        className={`min-w-[16px] sm:min-w-[18px] px-1 sm:px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold text-center leading-none ${
                          activeTab === 'upcoming'
                            ? 'bg-brick/10 text-brick'
                            : 'bg-neutral-200/80 text-neutral-600'
                        }`}
                      >
                        {loading ? '–' : upcomingTotalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('past')}
                      className={`h-8 flex-1 sm:flex-initial px-2 sm:px-4 rounded-full text-xs font-semibold transition-all cursor-pointer inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap ${
                        activeTab === 'past'
                          ? 'bg-white text-ink shadow-xs'
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
                      aria-label={data.searchPlaceholder}
                      className="w-full h-10 pl-9 pr-8 text-xs bg-neutral-100/90 hover:bg-neutral-100 focus:bg-white border border-neutral-200/80 rounded-full focus:outline-none focus:ring-2 focus:ring-brick/20 focus:border-brick transition-all placeholder:text-neutral-400 shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label={lang === 'en' ? 'Clear search' : '清除搜索'}
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
                          ? 'bg-brick text-white border-brick'
                          : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600 border-neutral-200/80'
                      }`}
                      title={data.searchPlaceholder}
                      aria-label={lang === 'en' ? 'Search' : '搜索'}
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
                      aria-label={data.searchPlaceholder}
                      className="w-full h-10 pl-9 pr-8 text-xs bg-neutral-100/90 hover:bg-neutral-100 focus:bg-white border border-neutral-200/80 rounded-full focus:outline-none focus:ring-2 focus:ring-brick/20 focus:border-brick transition-all placeholder:text-neutral-400 shadow-2xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label={lang === 'en' ? 'Clear search' : '清除搜索'}
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
                    aria-label={lang === 'en' ? 'Close Search' : '关闭搜索'}
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
                          ? 'bg-brick text-white shadow-xs'
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
                  <h3 className="text-lg sm:text-2xl font-bold tracking-tight text-ink">
                    {data.upcomingTitle}
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-500 mt-0.5 break-words">
                    {data.upcomingSubtitle}
                  </p>
                </div>

                {activeTab === 'all' && pastEvents.length > 0 && (
                  <div className="flex items-center shrink-0 self-start sm:self-auto">
                    <a
                      href="#past"
                      onClick={(e) => scrollToSection('past', e)}
                      className="text-xs text-brick hover:text-brick-700 font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200/80 transition-colors cursor-pointer shadow-xs shrink-0 whitespace-nowrap"
                    >
                      <span>{lang === 'en' ? 'Jump to Past Archive' : '直达往期回顾'}</span>
                      <span className="text-sm font-semibold">↓</span>
                    </a>
                  </div>
                )}
              </div>

              {loading && upcomingItems.length === 0 ? (
                statusBox(
                  <>
                    <Loader2 className="w-9 h-9 text-neutral-300 mx-auto mb-2.5 animate-spin" />
                    <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                      {lang === 'en' ? 'Loading upcoming events…' : '正在加载近期活动…'}
                    </p>
                  </>,
                )
              ) : loadStatus === 'error' ? (
                statusBox(
                  <>
                    <AlertCircle className="w-9 h-9 text-neutral-300 mx-auto mb-2.5" />
                    <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                      {lang === 'en' ? 'We couldn’t load upcoming events.' : '近期活动加载失败。'}
                    </p>
                    <button
                      type="button"
                      onClick={reload}
                      className="mt-2.5 text-xs font-semibold text-brick hover:underline cursor-pointer"
                    >
                      {lang === 'en' ? 'Try again' : '重试'}
                    </button>
                  </>,
                  'alert',
                )
              ) : upcomingEvents.length === 0 ? (
                upcomingItems.length === 0 ? (
                  statusBox(
                    <>
                      <CalendarIcon className="w-9 h-9 text-neutral-300 mx-auto mb-2.5" />
                      <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                        {lang === 'en'
                          ? 'No upcoming events are scheduled right now. Please check back soon.'
                          : '目前暂无已安排的近期活动，敬请关注。'}
                      </p>
                    </>,
                  )
                ) : (
                  statusBox(
                    <>
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
                        className="mt-2.5 text-xs font-semibold text-brick hover:underline cursor-pointer"
                      >
                        {lang === 'en' ? 'Reset search filters' : '重置筛选条件'}
                      </button>
                    </>,
                  )
                )
              ) : (
                <div className="bg-white rounded-2xl border border-neutral-200/80 divide-y divide-neutral-200/80 overflow-hidden shadow-xs relative z-0">
                  <AnimatePresence mode="popLayout">
                    {upcomingEvents.map((event, idx) => {
                      const { year, day, month } = event.box;
                      const isCopied = copiedEventId === event.ev.id;

                      return (
                        <motion.div
                          key={event.ev.id}
                          id={event.anchor}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.2) }}
                          className="p-3.5 sm:p-6 lg:p-7 hover:bg-surface-hover transition-colors relative z-0"
                        >
                          {/* Responsive Layout: Date box on the left, Content in middle, Actions on right for Desktop */}
                          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center justify-between">
                            {/* Left: Calendar Date Box */}
                            <div className="flex sm:block items-center gap-3 w-full sm:w-auto shrink-0">
                              <div className="w-16 sm:w-20 lg:w-24 rounded-2xl bg-surface-3 border border-neutral-200/80 p-2 sm:p-3 text-center shrink-0 shadow-xs transition-transform duration-200 group-hover:scale-105">
                                <span className="text-[9px] sm:text-[11px] font-bold text-brick block">
                                  {month}
                                </span>
                                <span className="text-xl sm:text-3xl font-bold text-ink tracking-tight block my-0.5 sm:my-1 leading-none">
                                  {day}
                                </span>
                                <span className="text-[8px] sm:text-[10px] text-neutral-400 font-mono block">
                                  {year}
                                </span>
                              </div>

                              {/* Mobile Header Title in the Top Row */}
                              <div className="sm:hidden flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                                    {ORGANIZER}
                                  </span>
                                </div>
                                <h4 className="text-sm font-semibold text-ink tracking-tight leading-snug line-clamp-2">
                                  {event.title}
                                </h4>
                              </div>
                            </div>

                            {/* Center Column: Event Header, Tags, Title & Metadata */}
                            <div className="space-y-2 flex-1 min-w-0 w-full">
                              {/* Desktop Badges & Category */}
                              <div className="hidden sm:flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                                  {ORGANIZER}
                                </span>
                              </div>

                              {/* Desktop Title */}
                              <h4 className="hidden sm:block text-base sm:text-lg lg:text-xl font-semibold text-ink tracking-tight leading-snug">
                                {event.title}
                              </h4>

                              {/* Time & Location inline */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-neutral-500 pt-0.5">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                  <span>
                                    <span className="sr-only">{event.date} · </span>
                                    {event.time}
                                  </span>
                                </span>
                                {event.location && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-neutral-400 shrink-0" />
                                    <span className="truncate max-w-[200px] sm:max-w-none">
                                      {event.location}
                                    </span>
                                  </span>
                                )}
                              </div>

                              {/* Description */}
                              {event.desc && (
                                <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed pt-0.5 whitespace-pre-line">
                                  {event.desc}
                                </p>
                              )}

                              {perkLine(event)}
                              {rsvpNote(event)}

                              {/* Mobile Action Buttons - Strict single line (flex-nowrap): Register/RSVP & Volunteer text always visible, Share collapses to icon on tight screens */}
                              <div className="sm:hidden pt-2.5 flex items-center justify-start gap-1.5 flex-nowrap border-t border-neutral-100 overflow-hidden">
                                {primaryAction(event, 'mobile')}

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
                                  onClick={() => shareUpcoming(event)}
                                  className={`h-8 px-2.5 min-[420px]:px-3 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 whitespace-nowrap ${
                                    isCopied
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                                      : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                                  }`}
                                  title={lang === 'en' ? 'Share' : '分享'}
                                  aria-label={lang === 'en' ? 'Share' : '分享'}
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

                            {/* Right Column: Desktop Action Buttons (Register/RSVP, Volunteer, Share on the Right, vertically centered) */}
                            <div className="hidden sm:flex flex-col items-center justify-center gap-2 shrink-0 sm:w-36 lg:w-40 self-center">
                              {primaryAction(event, 'desktop')}

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
                                onClick={() => shareUpcoming(event)}
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

          {/* SECTION B: PAST EVENTS (#past — /past-events/ redirects here) */}
          {(activeTab === 'all' || activeTab === 'past') && (
            <motion.section
              id="past"
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
                      className="text-xs text-brick hover:text-brick-700 font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-neutral-200 hover:bg-neutral-50 transition-colors cursor-pointer shadow-xs shrink-0 whitespace-nowrap"
                    >
                      <span className="text-sm font-semibold">↑</span>
                      <span>{lang === 'en' ? 'Jump back to upcoming' : '返回近期活动'}</span>
                    </a>
                  </div>
                )}
              </div>

              {pastEvents.length === 0 ? (
                <div className="text-center py-12 bg-surface-2 rounded-2xl border border-neutral-200/80">
                  <History className="w-9 h-9 text-neutral-300 mx-auto mb-2.5" />
                  <p className="text-neutral-600 text-xs sm:text-sm font-medium">
                    {lang === 'en'
                      ? 'No past events found matching your criteria.'
                      : '暂无符合筛选条件的往期活动。'}
                  </p>
                </div>
              ) : (
                <div className="bg-surface-hover rounded-2xl border border-neutral-200/90 divide-y divide-neutral-200/80 overflow-hidden shadow-xs relative z-0">
                  <AnimatePresence mode="popLayout">
                    {pastEvents.map((event, idx) => {
                      const { year, day, month } = parseDateParts(event.isoDate);
                      const isCopied = copiedEventId === event.id;

                      return (
                        <motion.div
                          key={event.id}
                          id={event.id}
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
                                <span className="text-[9px] sm:text-[11px] font-semibold text-neutral-500 block">
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
                                  <Tag className="w-3 h-3 text-brick shrink-0" />
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
                                  aria-label={lang === 'en' ? 'Volunteer' : '致敬义工'}
                                >
                                  <Users className="w-3.5 h-3.5 text-neutral-500" />
                                  <span className="hidden min-[420px]:inline">
                                    {lang === 'en' ? 'Volunteer' : '致敬义工'}
                                  </span>
                                </button>

                                {/* Mobile Share (Placed Last, Icon always shown, text collapses on tight screens) */}
                                <button
                                  type="button"
                                  onClick={() => sharePast(event.id)}
                                  className={`h-8 px-2.5 min-[420px]:px-3.5 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 whitespace-nowrap ${
                                    isCopied
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                                      : 'border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                                  }`}
                                  title={lang === 'en' ? 'Share' : '分享'}
                                  aria-label={lang === 'en' ? 'Share' : '分享'}
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
                                onClick={() => sharePast(event.id)}
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

      <ContactSection content={content} prefill={feedback} />
    </div>
  );
}
