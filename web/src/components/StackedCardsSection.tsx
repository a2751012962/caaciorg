import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight } from 'lucide-react';
import { getLenis } from '../utils/smoothScroll';
import type { CAACIContent } from '../data/content';
import { fill } from '../lib/text';

gsap.registerPlugin(ScrollTrigger);

// Scroll length (in timeline units; one panel slide = 1) that the first and last
// statements stay still while the section is pinned.
const PANEL_HOLD = 0.4;

interface StackedCardsSectionProps {
  content: CAACIContent;
  lang?: 'en' | 'zh';
  onNavigate?: (page: string) => void;
  onOpenModal?: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
}

export function StackedCardsSection({
  content,
  lang = 'en',
  onNavigate,
  onOpenModal,
}: StackedCardsSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const { statements } = content.stacked;

  // Layout effect so panels 2-4 are moved off-screen before the first paint; with
  // useEffect a full page load could show all four statements stacked for a frame.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const panels = panelsRef.current.filter(Boolean) as HTMLDivElement[];
    if (panels.length === 0) return;

    const ctx = gsap.context(() => {
      let scrollDirection = 1;

      // Master timeline pinning the section while panels scroll in from right
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: 'top top',
          end: '+=200%',
          pin: true,
          pinSpacing: true,
          scrub: 0.6,
          anticipatePin: 0,
          onUpdate: (self) => {
            // A panel is current once it has slid more than halfway in. The
            // timeline has holds at both ends, so read the step labels' times.
            const time = self.progress * tl.duration();
            let step = 0;
            for (let i = 1; i < panels.length; i++) {
              const at = tl.labels[`step-${i}`];
              if (at !== undefined && time >= at + 0.5) step = i;
            }
            setActiveIndex(step);
          },
        },
      });

      // Keep the first statement still for a while after the section pins, so
      // it isn't already fading the moment the visitor arrives.
      tl.to({}, { duration: PANEL_HOLD });

      // Panel 0 is in place.
      // Panels 1..3 all slide in from the RIGHT smoothly.
      panels.forEach((panel, i) => {
        const numLine = panel.querySelector('.panel-num-line');
        const headline = panel.querySelector('.panel-headline');
        const companionNum = panel.querySelector('.panel-companion-num');
        const body = panel.querySelector('.panel-body');

        if (i === 0) {
          gsap.set(panel, { xPercent: 0, opacity: 1, zIndex: 10, force3D: true });
          if (numLine) gsap.set(numLine, { opacity: 1, y: 0, force3D: true });
          if (headline)
            gsap.set(headline, {
              opacity: 1,
              y: 0,
              scale: 1,
              transformOrigin: 'top left',
              force3D: true,
            });
          if (companionNum)
            gsap.set(companionNum, { opacity: 0, scale: 0.8, marginRight: 0, force3D: true });
          if (body) gsap.set(body, { opacity: 1, y: 0, force3D: true });
        } else {
          gsap.set(panel, {
            xPercent: 110,
            opacity: 0,
            zIndex: 10 + i * 10,
            force3D: true,
          });
          if (numLine) gsap.set(numLine, { opacity: 1, y: 0, force3D: true });
          if (headline)
            gsap.set(headline, {
              opacity: 1,
              y: 0,
              scale: 1,
              transformOrigin: 'top left',
              force3D: true,
            });
          if (companionNum)
            gsap.set(companionNum, { opacity: 0, scale: 0.8, marginRight: 0, force3D: true });
          if (body) gsap.set(body, { opacity: 1, y: 0, force3D: true });

          // 新卡片从右侧平滑滑入
          tl.to(
            panel,
            {
              xPercent: 0,
              opacity: 1,
              ease: 'power1.inOut',
              duration: 1,
              force3D: true,
            },
            `step-${i}`,
          );

          // 被滚动的上一张卡片：大标题向上滚、变成小数字伴随标题，并且颜色略微变透明；正文和按钮淡出
          if (i > 0 && panels[i - 1]) {
            const prevPanel = panels[i - 1];
            const prevNumLine = prevPanel.querySelector('.panel-num-line');
            const prevHeadline = prevPanel.querySelector('.panel-headline');
            const prevCompanionNum = prevPanel.querySelector('.panel-companion-num');
            const prevBody = prevPanel.querySelector('.panel-body');

            if (prevBody) {
              tl.to(
                prevBody,
                {
                  opacity: 0,
                  y: -24,
                  ease: 'power1.inOut',
                  duration: 0.65,
                  force3D: true,
                },
                `step-${i}`,
              );
            }

            if (prevNumLine) {
              tl.to(
                prevNumLine,
                {
                  opacity: 0,
                  y: -16,
                  ease: 'power1.inOut',
                  duration: 0.6,
                  force3D: true,
                },
                `step-${i}`,
              );
            }

            if (prevCompanionNum) {
              tl.to(
                prevCompanionNum,
                {
                  opacity: 1,
                  scale: 1,
                  marginRight: 8,
                  ease: 'power1.inOut',
                  duration: 0.7,
                  force3D: true,
                },
                `step-${i}`,
              );
            }

            if (prevHeadline) {
              const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;
              const midY = isDesktop ? -80 : -50;
              const finalY = isDesktop ? -240 : -160;

              tl.to(
                prevHeadline,
                {
                  keyframes: [
                    {
                      y: midY,
                      scale: 0.55,
                      opacity: 0.4,
                      duration: 0.4,
                      ease: 'power1.out',
                      force3D: true,
                    },
                    {
                      y: finalY,
                      scale: 0.45,
                      opacity: 0,
                      duration: 0.6,
                      ease: 'power1.inOut',
                      force3D: true,
                    },
                  ],
                  transformOrigin: 'top left',
                  force3D: true,
                },
                `step-${i}`,
              );
            }
          }
        }
      });

      // …and the last one before the section unpins.
      tl.to({}, { duration: PANEL_HOLD });
    }, containerRef);

    // The web font (Poppins) can finish loading after ScrollTrigger measured the
    // page; re-measure so the pin starts and ends where the section really is.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) ScrollTrigger.refresh();
    });

    return () => {
      alive = false;
      ctx.revert();
    };
  }, [lang, statements.length]);

  const handleActionClick = (targetPage: string) => {
    if (targetPage === 'events') {
      onNavigate ? onNavigate('events') : onOpenModal?.('events');
    } else if (targetPage === 'membership') {
      onNavigate ? onNavigate('membership') : onOpenModal?.('membership');
    } else {
      onNavigate?.(targetPage);
    }
  };

  return (
    <section
      ref={containerRef}
      id="pillars"
      className="relative min-h-screen bg-surface-cream border-t border-b border-neutral-200/80 overflow-hidden flex flex-col justify-between py-10 sm:py-14"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex flex-col flex-1 justify-between relative z-10">
        {/* Top Minimalist Stepper Track */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-200/70 relative z-20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brick" />
            <span className="text-xs sm:text-sm font-mono font-bold text-brick">
              {fill(content.stacked.header, { year: new Date().getFullYear() })}
            </span>
          </div>

          {/* Stepper Dots */}
          <div className="flex items-center gap-2 sm:gap-3">
            {statements.map((s, i) => (
              <div key={s.number} className="flex items-center gap-1.5 font-mono text-xs">
                <span
                  className={`transition-colors duration-300 ${
                    activeIndex === i ? 'text-brick font-bold' : 'text-neutral-400 font-normal'
                  }`}
                >
                  {s.number}
                </span>
                <span
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    activeIndex === i ? 'w-8 bg-brick' : 'w-3 bg-neutral-300'
                  }`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Typographic Stage: The header "CAACI Core Pillars / 宗旨与核心使命" moves WITH the number and content */}
        <div className="relative w-full min-h-[480px] md:min-h-[520px] my-auto overflow-x-clip overflow-y-visible flex items-center will-change-transform">
          {statements.map((item, index) => {
            return (
              <div
                key={item.number}
                ref={(el) => {
                  panelsRef.current[index] = el;
                }}
                className="absolute inset-0 w-full h-full flex flex-col justify-center select-none will-change-transform"
                style={{
                  WebkitBackfaceVisibility: 'hidden',
                  backfaceVisibility: 'hidden',
                  transform: 'translate3d(0,0,0)',
                }}
              >
                {/* 1. Giant Numeral Line Accent */}
                <div className="panel-num-line flex items-baseline gap-4 mb-2 origin-top-left">
                  <span className="panel-num text-5xl sm:text-6xl md:text-7xl font-black text-brick/25 tracking-tighter">
                    {item.number}
                  </span>
                  <div className="h-[2px] flex-1 max-w-[140px] bg-brick/30" />
                </div>

                {/* 3. Typography Headline Block with Companion Small Number */}
                <div className="mb-6 origin-top-left will-change-transform">
                  <h3 className="panel-headline text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-maroon leading-[1.1] tracking-tight origin-top-left flex items-baseline flex-wrap">
                    {/* 小数字伴随标题：被滚上去时平滑展现 */}
                    <span className="panel-companion-num opacity-0 inline-block overflow-hidden font-mono font-bold text-xl sm:text-2xl md:text-3xl text-brick align-baseline whitespace-nowrap">
                      {item.number}
                    </span>
                    <span>{item.title}</span>
                  </h3>
                </div>

                {/* 4. Body Paragraph & Action Button */}
                <div className="panel-body origin-top-left">
                  <p className="font-sans text-neutral-600 text-base sm:text-lg md:text-xl leading-relaxed max-w-3xl mb-8">
                    {item.desc}
                  </p>

                  <div>
                    <button
                      type="button"
                      onClick={() => handleActionClick(item.targetPage)}
                      className="group inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-brick text-white hover:bg-brick-hover text-xs sm:text-sm font-medium uppercase tracking-wider transition-all cursor-pointer shadow-xs active:scale-98"
                    >
                      <span>{item.action}</span>
                      <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom subtle progress hint */}
        <div className="pt-4 border-t border-neutral-200/60 flex items-center justify-between text-xs text-neutral-400 font-mono">
          <span>
            {fill(content.stacked.progress, {
              current: String(activeIndex + 1).padStart(2, '0'),
              total: String(statements.length).padStart(2, '0'),
            })}
          </span>
          <span>{content.stacked.scrollHint}</span>
        </div>
      </div>
    </section>
  );
}
