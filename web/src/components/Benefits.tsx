import { useEffect, useRef } from 'react';
import { Users, Award, ShoppingBag, TrendingUp } from 'lucide-react';
import { gsap } from 'gsap';
import type { CAACIContent } from '../data/content';
import { MOTION, reveal } from '../lib/motion';

interface BenefitsProps {
  content: CAACIContent;
}

export function Benefits({ content }: BenefitsProps) {
  const icons = [Users, Award, ShoppingBag, TrendingUp];
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      reveal('.benefits-header', { trigger: sectionRef.current });
      // Cards rise as each one scrolls in; the right-hand card of a row waits one
      // stagger step so the row reads left to right.
      cardsRef.current.forEach((card, index) => {
        if (card) reveal(card, { delay: (index % 2) * MOTION.stagger });
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
          <span className="text-xs font-semibold text-brick block mb-2">
            Why Join CAACI · 为什么加入华协
          </span>
          <h2
            className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-ink"
            style={{ fontFamily: 'var(--font-caaci-serif)' }}
          >
            {content.whyJoin.heading}
          </h2>
          <div className="w-12 h-0.5 bg-brick mt-3 rounded-full" />
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
                className="bg-surface-2 p-8 sm:p-9 rounded-2xl border border-neutral-200/80 space-y-4 hover:border-neutral-300 transition-colors will-change-transform shadow-xs"
              >
                {/* Clean Circular Icon Badge identical to /membership/ */}
                <div className="benefit-icon-wrap w-10 h-10 rounded-full bg-white border border-neutral-200/70 flex items-center justify-center text-ink shadow-2xs">
                  <Icon className="w-5 h-5 text-brick" />
                </div>

                {/* Blurb Header */}
                <h3 className="text-lg sm:text-xl font-semibold text-ink tracking-tight">
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
