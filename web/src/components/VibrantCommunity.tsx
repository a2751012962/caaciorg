import { useEffect, useRef } from 'react';
import { ArrowRight, HandHeart } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CAACIContent } from '../data/content';
import { MOTION, reveal } from '../lib/motion';

gsap.registerPlugin(ScrollTrigger);

interface VibrantCommunityProps {
  content: CAACIContent;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
}

export function VibrantCommunity({ content, onOpenModal }: VibrantCommunityProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Authentic Divi-style Parallax scrolling layer for Central-IL-3.jpg
      if (bgRef.current && sectionRef.current) {
        gsap.fromTo(
          bgRef.current,
          { yPercent: -18 },
          {
            yPercent: 18,
            ease: 'none',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.3,
            },
          },
        );
      }

      // The card rises over the parallax background.
      if (cardRef.current && sectionRef.current) {
        reveal(cardRef.current, { trigger: sectionRef.current, duration: MOTION.duration.slow });
      }
    }, sectionRef);

    return () => ctx.revert();
  }, [content]);

  return (
    <section
      ref={sectionRef}
      id="join-now"
      className="relative w-full min-h-[580px] sm:min-h-[640px] md:min-h-[700px] flex items-center py-20 sm:py-28 md:py-36 overflow-hidden"
    >
      {/* 
        Authentic Parallax Layer (caaciorg.com et_pb_section_parallax)
        High-res photographic backdrop of Central Illinois agricultural landscape
      */}
      <div
        ref={bgRef}
        className="absolute -top-[25%] -bottom-[25%] left-0 right-0 w-full h-[150%] bg-cover bg-center pointer-events-none will-change-transform"
        style={{
          backgroundImage: `url('/images/central-il.jpg')`,
        }}
      />

      {/* Subtle atmospheric vignette to enhance depth and focus */}
      <div className="absolute inset-0 bg-black/15 pointer-events-none" />

      {/* Container with the classic floating translucent content layer */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* 
            The Authentic Divi Floating Card Layer (et_pb_column_12)
            rgba(255, 255, 255, 0.88) backdrop gliding across the parallax scenery
          */}
          <div
            ref={cardRef}
            className="lg:col-span-7 xl:col-span-6 bg-white/90 sm:bg-white/92 backdrop-blur-md p-8 sm:p-12 md:p-14 rounded-2xl shadow-2xl border border-white/80"
          >
            {/* Tagline / Subtitle */}
            <div className="mb-3">
              <span className="font-sans font-bold text-xs sm:text-[13px] tracking-[2px] text-brick">
                {content.community.tag}
              </span>
            </div>

            {/* Main Title */}
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-maroon leading-[1.2] tracking-tight font-display mb-5">
              {content.community.heading}
            </h2>

            {/* Characteristic 60px Terracotta Divider Line */}
            <div className="w-16 h-[2.5px] bg-brick mb-6" />

            {/* Body Description Text */}
            <p className="font-sans text-neutral-700 text-base sm:text-lg leading-relaxed mb-8">
              {content.community.description}
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 pt-2">
              <button
                type="button"
                onClick={() => onOpenModal('membership')}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-full font-sans font-semibold uppercase text-xs sm:text-[13px] tracking-wider text-white transition-all hover:bg-brick-hover active:scale-98 cursor-pointer bg-brick shadow-xs"
              >
                <span>{content.hero.btnMembership}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onOpenModal('volunteer')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-sans font-semibold uppercase text-xs sm:text-[13px] tracking-wider text-brick border-2 border-brick hover:bg-brick hover:text-white transition-all cursor-pointer active:scale-98"
              >
                <HandHeart className="w-4 h-4" />
                <span>{content.nav.volunteer}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
