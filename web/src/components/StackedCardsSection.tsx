import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight } from 'lucide-react';
import { getLenis } from '../utils/smoothScroll';
import type { CAACIContent } from '../data/content';

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

interface GiantStatement {
  number: string;
  giantZh: string;
  giantEn: string;
  descZh: string;
  descEn: string;
  actionZh: string;
  actionEn: string;
  targetPage: string;
}

const statements: GiantStatement[] = [
  {
    number: '01',
    giantZh: '文化传承 · 华夏精粹',
    giantEn: 'Culture & Heritage',
    descZh:
      '开展丰富多彩的传统节庆与文化交流活动，培养对中华文化的理解与欣赏，让华夏文化在伊利诺伊中部生生不息。',
    descEn:
      'Cultivate understanding and appreciation of Chinese culture through signature festivals and heritage programs in Central Illinois.',
    actionZh: '查看近期活动',
    actionEn: 'See upcoming events',
    targetPage: 'events',
  },
  {
    number: '02',
    giantZh: '同胞福祉 · 社区发声',
    giantEn: 'Community Wellbeing',
    descZh:
      '促进伊利诺伊中部华人及华侨同胞的福祉，帮助会员在社区中发挥更积极的作用，让主流社会听见华人的声音。',
    descEn:
      'Promote the wellbeing of Chinese and Chinese Americans across Champaign-Urbana, empowering members to play an active role.',
    actionZh: '了解宗旨与使命',
    actionEn: 'Our mission',
    targetPage: 'about',
  },
  {
    number: '03',
    giantZh: '族群友谊 · 交流共融',
    giantEn: 'Friendship & Dialogue',
    descZh:
      '积极搭建跨文化沟通桥梁，促进华人与其他族群之间的深入交流与真挚友谊，构筑多元包容的和谐社区。',
    descEn:
      'Encourage meaningful communication, mutual respect, and lasting friendship between the Chinese community and diverse regional groups.',
    actionZh: '浏览社区资源',
    actionEn: 'Browse community resources',
    targetPage: 'resources',
  },
  {
    number: '04',
    giantZh: '互助网络 · 携手前行',
    giantEn: 'Network & Growth',
    descZh:
      '为香槟-厄巴纳及周边地区的居民、学者与留学生提供结识良友、交流经验与支持本地商户的平台，携手共创繁荣。',
    descEn:
      'Provide local residents, scholars, and students with valuable opportunities to connect, share experiences, and grow together.',
    actionZh: '成为协会会员',
    actionEn: 'Become a member',
    targetPage: 'membership',
  },
];

export function StackedCardsSection({
  content: _content,
  lang = 'en',
  onNavigate,
  onOpenModal,
}: StackedCardsSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const isZh = lang === 'zh';

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

    // Web fonts (Noto Serif SC) can finish after ScrollTrigger measured the
    // page; re-measure so the pin starts and ends where the section really is.
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) ScrollTrigger.refresh();
    });

    return () => {
      alive = false;
      ctx.revert();
    };
  }, [lang]);

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
              CAACI · 2000 — {new Date().getFullYear()}
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
                  <span
                    className="panel-num text-5xl sm:text-6xl md:text-7xl font-mono font-black text-brick/25 tracking-tighter"
                    style={{ fontFamily: 'var(--font-caaci-serif)' }}
                  >
                    {item.number}
                  </span>
                  <div className="h-[2px] flex-1 max-w-[140px] bg-brick/30" />
                </div>

                {/* 3. Typography Headline Block with Companion Small Number */}
                <div className="mb-6 origin-top-left will-change-transform">
                  <h3
                    className="panel-headline text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-maroon leading-[1.1] tracking-tight font-serif-caaci origin-top-left flex items-baseline flex-wrap"
                    style={{
                      fontFamily: isZh ? 'var(--font-caaci-serif-zh)' : 'var(--font-caaci-serif)',
                    }}
                  >
                    {/* 小数字伴随标题：被滚上去时平滑展现 */}
                    <span className="panel-companion-num opacity-0 inline-block overflow-hidden font-mono font-bold text-xl sm:text-2xl md:text-3xl text-brick align-baseline whitespace-nowrap">
                      {item.number}
                    </span>
                    <span>{isZh ? item.giantZh : item.giantEn}</span>
                  </h3>
                </div>

                {/* 4. Body Paragraph & Action Button */}
                <div className="panel-body origin-top-left">
                  <p className="font-poppins text-neutral-600 text-base sm:text-lg md:text-xl leading-relaxed max-w-3xl mb-8">
                    {isZh ? item.descZh : item.descEn}
                  </p>

                  <div>
                    <button
                      type="button"
                      onClick={() => handleActionClick(item.targetPage)}
                      className="group inline-flex items-center gap-2.5 px-6 py-2.5 rounded-full bg-brick text-white hover:bg-brick-hover text-xs sm:text-sm font-medium uppercase tracking-wider transition-all cursor-pointer shadow-xs active:scale-98"
                    >
                      <span>{isZh ? item.actionZh : item.actionEn}</span>
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
          <span>SECTION 0{activeIndex + 1} OF 04</span>
          <span>{isZh ? '向下滚动 · 如瀑布流般连贯切换' : 'Scroll down like waterfall'}</span>
        </div>
      </div>
    </section>
  );
}
