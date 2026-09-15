import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import { ExternalLink, Compass, Building, GraduationCap, Globe } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { resourcesDataEN, resourcesDataZH } from '../data/pagesContent';

interface ResourcesPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function ResourcesPage({ content, lang, onOpenModal, onNavigate }: ResourcesPageProps) {
  const data = lang === 'en' ? resourcesDataEN : resourcesDataZH;

  return (
    <div className="bg-white">
      <SubpageHero
        title={data.title}
        subtitle={data.subtitle}
        bgImage="/images/volunteer-contact.jpg"
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="resources"
      />

      {/* Intro statement */}
      <section className="py-14 bg-[#fbf9f8] border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <span className="text-xs font-bold uppercase tracking-[2px] text-[#8e2e11] font-poppins">
              {lang === 'en' ? 'Welcome to Central Illinois' : '欢迎来到伊利诺伊州中部'}
            </span>
            <p className="mt-3 text-base sm:text-lg text-neutral-800 font-poppins leading-relaxed">
              {data.intro}
            </p>
          </div>
        </div>
      </section>

      {/* Resource Grid */}
      <section className="py-16 md:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
          {data.items.map((item, idx) => (
            <a
              key={idx}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-8 rounded-2xl bg-white border border-neutral-200 shadow-sm hover:shadow-xl hover:border-[#8e2e11]/40 transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#8e2e11] font-poppins">
                    {item.category}
                  </span>
                  <ExternalLink className="w-4 h-4 text-neutral-400 group-hover:text-[#8e2e11] transition-colors" />
                </div>

                <h3
                  className="text-xl font-bold text-[#300200] font-serif-caaci group-hover:text-[#8e2e11] transition-colors"
                  style={{ fontFamily: 'var(--font-caaci-serif)' }}
                >
                  {item.title}
                </h3>

                <p className="text-sm text-neutral-600 font-poppins leading-relaxed">{item.desc}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center text-xs font-bold text-[#8e2e11] font-poppins uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                <span>{lang === 'en' ? 'Visit Official Portal' : '访问官方站点'}</span>
                <span className="ml-1">→</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <ContactSection content={content} />
    </div>
  );
}
