import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Left Column enters from Left
      if (leftColRef.current) {
        gsap.fromTo(
          leftColRef.current,
          { x: -50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power3.out',
            delay: 0.1,
          },
        );
      }

      // Right Column enters from Right
      if (rightColRef.current) {
        gsap.fromTo(
          rightColRef.current,
          { x: 50, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power3.out',
            delay: 0.2,
          },
        );

        // Stagger inner items
        gsap.fromTo(
          rightColRef.current.querySelectorAll('.welcome-stagger-item'),
          { y: 20, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            stagger: 0.1,
            ease: 'power2.out',
            delay: 0.35,
          },
        );
      }

      // 3 Action banners enter with staggered cascade
      if (bannersRef.current) {
        gsap.fromTo(
          bannersRef.current.children,
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            stagger: 0.1,
            ease: 'power3.out',
            delay: 0.5,
          },
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, [content]);

  return (
    <section ref={sectionRef} id="welcome" className="relative w-full bg-white overflow-hidden">
      {/* Primary Welcome Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-10 sm:pt-14 sm:pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-start">
          {/* Left Column: Heading + Group Photograph */}
          <div
            ref={leftColRef}
            className="lg:col-span-6 space-y-4 sm:space-y-6 will-change-transform"
          >
            <h1
              className="text-xl sm:text-3xl md:text-[34px] font-bold text-[#300200] leading-[1.3] tracking-tight font-serif-caaci"
              style={{ fontFamily: 'var(--font-caaci-serif)' }}
            >
              {content.welcome.heading}
            </h1>

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

          {/* Right Column: Accent Divider + Authentic Description + Focus Details */}
          <div ref={rightColRef} className="lg:col-span-6 lg:pt-4 will-change-transform">
            {/* Signature terracotta accent divider */}
            <div className="welcome-stagger-item w-[40px] sm:w-[50px] h-[3px] bg-[#8e2e11] mb-4 sm:mb-6 rounded-full" />

            <div className="welcome-stagger-item max-w-[580px]">
              <p className="font-poppins text-neutral-700 text-xs sm:text-sm md:text-base lg:text-[17px] leading-relaxed sm:leading-[1.8] lg:leading-[1.9] tracking-normal sm:tracking-[0.3px]">
                {content.welcome.description}
              </p>
            </div>

            <div className="welcome-stagger-item mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-neutral-100 grid grid-cols-2 gap-4 sm:gap-6 text-xs sm:text-sm text-neutral-600 font-poppins">
              <div>
                <span className="block text-[10px] sm:text-xs uppercase font-bold text-[#8e2e11] tracking-wider mb-1">
                  {isZh ? '社区宗旨' : 'Community Focus'}
                </span>
                <span className="font-medium text-[#1d1d1f]">
                  {isZh ? '文化、教育与社交交流' : 'Cultural, Educational & Social Exchange'}
                </span>
              </div>
              <div>
                <span className="block text-[10px] sm:text-xs uppercase font-bold text-[#8e2e11] tracking-wider mb-1">
                  {isZh ? '服务地区' : 'Region'}
                </span>
                <span className="font-medium text-[#1d1d1f]">
                  {isZh ? '香槟-厄巴纳及伊利诺伊中部' : 'Champaign-Urbana & Central Illinois'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Restrained Action Banners (Make A Donation, Check Out Events, Become A Member) */}
      <div className="relative w-full z-20">
        <div
          ref={bannersRef}
          className="grid grid-cols-1 md:grid-cols-3 w-full border-t border-b border-black/10"
        >
          {/* Banner 1: Make A Donation - Signature Terracotta */}
          <button
            onClick={() => onOpenModal('donate')}
            type="button"
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none"
            style={{ backgroundColor: '#8e2e11' }}
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
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none"
            style={{ backgroundColor: '#73250e' }}
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
            className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none"
            style={{ backgroundColor: '#300200' }}
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
