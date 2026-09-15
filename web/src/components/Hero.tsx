import { useLayoutEffect, useRef } from 'react';
import { Heart, Calendar, UserPlus } from 'lucide-react';
import { gsap } from 'gsap';
import type { CAACIContent } from '../data/content';

interface HeroProps {
  content: CAACIContent;
  lang?: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate?: (page: string) => void;
}

export function Hero({ content, lang = 'en', onOpenModal, onNavigate }: HeroProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const bannersRef = useRef<HTMLDivElement>(null);
  const isZh = lang === 'zh';

  useLayoutEffect(() => {
    const left = leftColRef.current;
    const right = rightColRef.current;
    const items = right?.querySelectorAll('.welcome-stagger-item');
    const banners = bannersRef.current?.children;

    // Start states in a layout effect, not useEffect: on a full page load React
    // paints before running passive effects, so the hero was shown in its final
    // state for a frame (often the ~100ms first-layout frame) and then hidden.
    const ctx = gsap.context(() => {
      // 0.01, not 0: Chrome skips rasterizing a layer at opacity 0, so the photo and
      // heading were all drawn in the slide's first frame (a ~40ms GPU flush that
      // showed as an 8px jump). At 0.01 they're drawn while still invisible.
      if (left) gsap.set(left, { x: -50, opacity: 0.01 });
      if (right) gsap.set(right, { x: 50, opacity: 0.01 });
      if (items) gsap.set(items, { y: 20, opacity: 0 });
      if (banners) {
        // The buttons' transition-all would turn this jump into a ~150ms sink and
        // fade before the rise; take the start state with transitions off, flush
        // style, then hand the transition back for the damped rise itself.
        const els = Array.from(banners) as HTMLElement[];
        els.forEach((el) => (el.style.transition = 'none'));
        gsap.set(els, { y: 30, opacity: 0 });
        if (els[0]) void getComputedStyle(els[0]).opacity;
        els.forEach((el) => (el.style.transition = ''));
      }
    }, sectionRef);

    // The motion starts once the first frame has been drawn. On a full load that
    // frame carries the page's first layout (~120ms), and a tween already running
    // would jump ahead by that much when it ends.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        ctx.add(() => {
          // Left column enters from the left, right column from the right
          if (left)
            gsap.to(left, { x: 0, opacity: 1, duration: 0.9, ease: 'power3.out', delay: 0.1 });
          if (right)
            gsap.to(right, { x: 0, opacity: 1, duration: 0.9, ease: 'power3.out', delay: 0.2 });
          if (items)
            gsap.to(items, {
              y: 0,
              opacity: 1,
              duration: 0.7,
              stagger: 0.1,
              ease: 'power2.out',
              delay: 0.35,
            });
          // The 3 action banners rise in a staggered cascade
          if (banners)
            gsap.to(banners, {
              y: 0,
              opacity: 1,
              duration: 0.8,
              stagger: 0.1,
              ease: 'power3.out',
              delay: 0.5,
            });
        });
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      ctx.revert();
    };
  }, [content]);

  return (
    <section ref={sectionRef} id="welcome" className="relative w-full bg-white overflow-hidden">
      {/* Primary Welcome Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-10 sm:pt-14 sm:pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_1fr] gap-8 lg:gap-x-14 lg:gap-y-0 items-start lg:items-stretch">
          {/* Left Column: Heading + Group Photograph */}
          <div
            ref={leftColRef}
            className="lg:col-span-6 lg:row-span-2 lg:grid lg:grid-rows-subgrid space-y-4 sm:space-y-6 lg:space-y-0 will-change-transform"
          >
            <h1
              className="text-xl sm:text-3xl md:text-[34px] font-bold text-maroon leading-[1.3] tracking-tight font-serif-caaci"
              style={{ fontFamily: 'var(--font-caaci-serif)' }}
            >
              {content.welcome.heading}
            </h1>

            {/* Photo + caption share row 2 with the right column, so the text block's top
                edge lines up with the photo's top edge and its bottom with the caption. */}
            <div className="space-y-4 sm:space-y-6 lg:mt-6">
              <div className="relative overflow-hidden rounded-2xl shadow-sm border border-neutral-200/80 group">
                {/* width/height reserve the photo's box before it loads, so the page
                  below (and the pinned pillars section's scroll positions) don't move. */}
                <img
                  src="/images/about-group.jpg"
                  alt="CAACI Members Group Gathering"
                  width={1600}
                  height={1064}
                  decoding="async"
                  fetchPriority="high"
                  className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-[1.01]"
                />
                <div className="absolute inset-0 ring-1 ring-inset ring-black/5 rounded-2xl pointer-events-none" />
              </div>
              <p className="text-[11px] sm:text-xs text-neutral-500 font-poppins italic">
                CAACI Members Group Gathering · 伊利诺伊中部华人协会会员齐聚一堂
              </p>
            </div>
          </div>

          {/* Right Column: Accent Divider + Authentic Description + Focus Details */}
          <div
            ref={rightColRef}
            className="lg:col-span-6 lg:col-start-7 lg:row-start-2 lg:mt-6 lg:flex lg:flex-col will-change-transform"
          >
            {/* Accent divider + description start level with the photo's top edge */}
            <div className="max-w-[580px] lg:pt-1">
              {/* Signature terracotta accent divider */}
              <div className="welcome-stagger-item w-[40px] sm:w-[50px] h-[3px] bg-brick mb-4 sm:mb-6 rounded-full" />
              <p className="welcome-stagger-item font-poppins text-neutral-700 text-xs sm:text-sm md:text-base lg:text-[17px] leading-relaxed sm:leading-[1.8] lg:leading-[1.9] tracking-normal sm:tracking-[0.3px]">
                {content.welcome.description}
              </p>
            </div>

            <div className="welcome-stagger-item mt-6 sm:mt-8 lg:mt-auto pt-4 sm:pt-6 border-t border-neutral-100 grid grid-cols-2 gap-4 sm:gap-6 text-xs sm:text-sm text-neutral-600 font-poppins">
              <div>
                <span className="block text-[10px] sm:text-xs font-bold text-brick mb-1">
                  {isZh ? '社区宗旨' : 'Community Focus'}
                </span>
                <span className="font-medium text-ink">
                  {isZh ? '文化、教育与社交交流' : 'Cultural, Educational & Social Exchange'}
                </span>
              </div>
              <div>
                <span className="block text-[10px] sm:text-xs font-bold text-brick mb-1">
                  {isZh ? '服务地区' : 'Region'}
                </span>
                <span className="font-medium text-ink">
                  {isZh ? '香槟-厄巴纳及伊利诺伊中部' : 'Champaign-Urbana & Central Illinois'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Restrained Action Banners (Make A Donation, Check Out Events, Become A Member) */}
      {/* transition-all on the buttons is deliberate: its 150ms CSS transition trails the
          GSAP rise and gives it the damped feel the owner wants. Don't narrow it. */}
      <div className="relative w-full z-20">
        <div
          ref={bannersRef}
          className="grid grid-cols-1 md:grid-cols-3 w-full border-t border-b border-black/10"
        >
          {/* Banner 1: Make A Donation - Signature Terracotta */}
          <button
            onClick={() => onOpenModal('donate')}
            type="button"
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none bg-brick"
          >
            <Heart className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
            <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
              {content.hero.btnDonation}
            </span>
          </button>

          {/* Banner 2: Check Out Events - Deep Warm Terracotta */}
          <button
            onClick={() => (onNavigate ? onNavigate('events') : onOpenModal('events'))}
            type="button"
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none bg-brick-deep"
          >
            <Calendar className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
            <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
              {content.hero.btnEvents}
            </span>
          </button>

          {/* Banner 3: Become A Member - Deep Lacquer Espresso */}
          <button
            onClick={() => (onNavigate ? onNavigate('membership') : onOpenModal('membership'))}
            type="button"
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none bg-maroon"
          >
            <UserPlus className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
            <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
              {content.hero.btnMembership}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
