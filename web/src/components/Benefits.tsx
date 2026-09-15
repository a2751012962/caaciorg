import { useEffect, useRef } from 'react';
import { Users, Award, ShoppingBag, TrendingUp } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CAACIContent } from '../data/content';

gsap.registerPlugin(ScrollTrigger);

interface BenefitsProps {
  content: CAACIContent;
}

export function Benefits({ content }: BenefitsProps) {
  const icons = [Users, Award, ShoppingBag, TrendingUp];
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Header entrance
      gsap.fromTo(
        '.benefits-header',
        { y: 35, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          },
        },
      );

      // 左右侧入场 (Alternating left and right entry for the 4 cards) + 错峰入场
      cardsRef.current.forEach((card, index) => {
        if (!card) return;
        const fromX = index % 2 === 0 ? -70 : 70; // Even from Left, Odd from Right

        gsap.fromTo(
          card,
          { x: fromX, opacity: 0, y: 20 },
          {
            x: 0,
            y: 0,
            opacity: 1,
            duration: 0.85,
            delay: (index % 2) * 0.15, // Staggered offset
            ease: 'power3.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 85%',
              toggleActions: 'play none none reverse',
            },
          },
        );

        // Icon bounce in
        const iconWrap = card.querySelector('.benefit-icon-wrap');
        if (iconWrap) {
          gsap.fromTo(
            iconWrap,
            { scale: 0.5, opacity: 0 },
            {
              scale: 1,
              opacity: 1,
              duration: 0.6,
              ease: 'back.out(1.7)',
              scrollTrigger: {
                trigger: card,
                start: 'top 80%',
                toggleActions: 'play none none reverse',
              },
            },
          );
        }
      });
    }, sectionRef);

    return () => ctx.revert();
  }, [content]);

  return (
    <section
      ref={sectionRef}
      id="why-join"
      className="relative py-20 md:py-28 bg-white border-t border-b border-neutral-200/80 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Title Header */}
        <div className="benefits-header max-w-3xl mb-14">
          <span className="text-xs font-semibold tracking-widest text-[#8e2e11] uppercase block mb-2">
            Why Join CAACI · 为什么加入华协
          </span>
          <h2
            className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-[#1d1d1f]"
            style={{ fontFamily: "'Playfair Display', 'Noto Serif SC', Georgia, serif" }}
          >
            {content.whyJoin.heading}
          </h2>
          <div className="w-12 h-0.5 bg-[#8e2e11] mt-3 rounded-full" />
        </div>

        {/* 4 Card Blurbs - styled identically to Community Privileges in /membership/ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
          {content.whyJoin.blurbs.map((blurb, index) => {
            const Icon = icons[index % icons.length];
            return (
              <div
                key={index}
                ref={(el) => {
                  cardsRef.current[index] = el;
                }}
                className="bg-[#fbfbfd] p-8 sm:p-9 rounded-2xl border border-neutral-200/80 space-y-4 hover:border-neutral-300 transition-all will-change-transform shadow-xs"
              >
                {/* Clean Circular Icon Badge identical to /membership/ */}
                <div className="benefit-icon-wrap w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-[#1d1d1f] shadow-2xs">
                  <Icon className="w-5 h-5 text-[#8e2e11]" />
                </div>

                {/* Blurb Header */}
                <h3 className="text-lg sm:text-xl font-semibold text-[#1d1d1f] tracking-tight">
                  {blurb.title}
                </h3>

                {/* Blurb Description */}
                <p className="font-poppins text-neutral-600 text-xs sm:text-sm leading-relaxed">
                  {blurb.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
