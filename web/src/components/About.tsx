import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { CAACIContent } from '../data/content';

gsap.registerPlugin(ScrollTrigger);

interface AboutProps {
  content: CAACIContent;
  onNavigate?: (page: string) => void;
}

export function About({ content, onNavigate }: AboutProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // 左右侧入场: Left Column enters from Left (x: -70)
      if (leftColRef.current) {
        gsap.fromTo(
          leftColRef.current,
          { x: -70, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 80%',
              toggleActions: 'play none none reverse',
            },
          },
        );
      }

      // 左右侧入场: Right Column enters from Right (x: 70)
      if (rightColRef.current) {
        gsap.fromTo(
          rightColRef.current,
          { x: 70, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.9,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 80%',
              toggleActions: 'play none none reverse',
            },
          },
        );

        // 错峰入场: Inner elements of right column stagger in
        gsap.fromTo(
          rightColRef.current.querySelectorAll('.about-stagger-item'),
          { y: 25, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.7,
            stagger: 0.1,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: sectionRef.current,
              start: 'top 75%',
              toggleActions: 'play none none reverse',
            },
          },
        );
      }
    }, sectionRef);

    return () => ctx.revert();
  }, [content]);

  return (
    <section
      ref={sectionRef}
      id="about"
      className="py-16 md:py-24 bg-white border-b border-neutral-100 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          {/* Left Column (左右侧入场 - Enters from Left): Heading + Group Photograph */}
          <div ref={leftColRef} className="lg:col-span-6 space-y-8 will-change-transform">
            <h2
              className="text-2xl sm:text-3xl md:text-[36px] font-bold text-maroon leading-[1.35] tracking-wide font-serif-caaci"
              style={{ fontFamily: 'var(--font-caaci-serif)' }}
            >
              {content.welcome.heading}
            </h2>

            <div className="relative overflow-hidden rounded-2xl shadow-sm border border-neutral-200/80 group">
              <img
                src="/images/about-group.jpg"
                alt="CAACI Members Group Gathering"
                className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-[1.01]"
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-black/5 rounded-2xl pointer-events-none" />
            </div>
          </div>

          {/* Right Column (左右侧入场 - Enters from Right): Accent Divider + Authentic Description */}
          <div ref={rightColRef} className="lg:col-span-6 lg:pt-16 will-change-transform">
            {/* The signature 60px terracotta accent divider from caaciorg.com */}
            <div className="about-stagger-item w-[40px] sm:w-[60px] h-[3px] bg-brick mb-4 sm:mb-8 rounded-full" />

            <div className="about-stagger-item max-w-[580px]">
              <p className="font-poppins text-neutral-700 text-xs sm:text-sm md:text-base lg:text-lg leading-relaxed sm:leading-[1.9] lg:leading-[2] tracking-normal sm:tracking-[0.5px]">
                {content.welcome.description}
              </p>
            </div>

            <div className="about-stagger-item mt-6 sm:mt-8 pt-4 sm:pt-8 border-t border-neutral-100 grid grid-cols-2 gap-4 sm:gap-6 text-xs sm:text-sm text-neutral-600 font-poppins">
              <div>
                <span className="block text-xs font-bold text-brick mb-1">Community Focus</span>
                <span className="font-medium text-ink">
                  Cultural, Educational & Social Exchange
                </span>
              </div>
              <div>
                <span className="block text-xs font-bold text-brick mb-1">Region</span>
                <span className="font-medium text-ink">Champaign-Urbana & Central Illinois</span>
              </div>
            </div>

            {onNavigate && (
              <div className="about-stagger-item mt-8">
                <button
                  type="button"
                  onClick={() => onNavigate('about')}
                  className="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-brick text-white hover:bg-brick-hover font-poppins font-medium text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xs active:scale-98"
                >
                  <span>{content.nav.aboutUs} • 我们的使命与宗旨</span>
                  <span>→</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
