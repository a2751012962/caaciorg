import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import { ExternalLink, CalendarDays } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { calendarDataEN, calendarDataZH } from '../data/pagesContent';
import { Reveal } from '../components/Reveal';

interface CommunityCalendarPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function CommunityCalendarPage({
  content,
  lang,
  onOpenModal,
  onNavigate,
}: CommunityCalendarPageProps) {
  const data = lang === 'en' ? calendarDataEN : calendarDataZH;

  return (
    <div className="bg-white">
      <SubpageHero
        title={data.title}
        subtitle={
          lang === 'en'
            ? 'Connect with public events, academic conferences, arts, and festivals across Central Illinois.'
            : '一站式获取伊利诺伊中部大学校园、艺术中心与双城市政官方活动日程。'
        }
        bgImage="/images/central-il.jpg"
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="community-calendar"
      />

      {/* Instruction Banner */}
      <section className="py-12 bg-surface-warm border-b border-neutral-200 text-center">
        <Reveal className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brick/10 text-brick text-xs font-bold mb-3">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Community Portals</span>
          </div>
          <h2
            className="text-xl sm:text-2xl md:text-3xl font-bold text-maroon font-serif-caaci"
            style={{ fontFamily: 'var(--font-caaci-serif)' }}
          >
            {data.instruction}
          </h2>
          <div className="w-16 h-1 bg-brick mx-auto mt-4 rounded-full" />
        </Reveal>
      </section>

      {/* Institutional Calendar Grid */}
      <section className="py-16 md:py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {data.calendars.map((cal, idx) => (
            <Reveal key={cal.id} index={idx} className="h-full">
              <a
                href={cal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group h-full bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm hover:shadow-2xl hover:border-brick/50 transition-all flex flex-col justify-between text-center"
              >
                <div>
                  {/* Institutional Logo Frame */}
                  <div className="w-full h-36 flex items-center justify-center p-4 mb-6 bg-neutral-50 rounded-xl group-hover:bg-white border border-neutral-100 transition-colors">
                    <img
                      src={cal.logo}
                      alt={cal.name}
                      className="max-h-24 max-w-[85%] object-contain transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>

                  <h3
                    className="text-lg font-bold text-maroon font-serif-caaci mb-3 group-hover:text-brick transition-colors"
                    style={{ fontFamily: 'var(--font-caaci-serif)' }}
                  >
                    {cal.name}
                  </h3>

                  <p className="text-xs text-neutral-600 font-poppins leading-relaxed">
                    {cal.desc}
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-neutral-100 flex items-center justify-center gap-1 text-xs font-bold text-brick font-poppins group-hover:underline">
                  <span>{lang === 'en' ? 'Open Calendar' : '进入日历'}</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </section>

      <ContactSection content={content} />
    </div>
  );
}
