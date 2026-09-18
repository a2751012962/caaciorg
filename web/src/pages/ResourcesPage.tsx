import { SubpageHero } from '../components/SubpageHero';
import { ContactSection } from '../components/ContactSection';
import { ExternalLink, Compass, Building, GraduationCap, Globe } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { resourcesDataEN, resourcesDataZH } from '../data/pagesContent';
import { Reveal } from '../components/Reveal';

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
      <section className="py-14 bg-surface-warm border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="max-w-4xl">
            <span className="text-xs font-bold text-brick font-sans">
              {lang === 'en' ? 'Welcome to Central Illinois' : '欢迎来到伊利诺伊州中部'}
            </span>
            <p className="mt-3 text-base sm:text-lg text-neutral-800 font-sans leading-relaxed">
              {data.intro}
            </p>
          </Reveal>
        </div>
      </section>

      {/* Resource Grid */}
      <section className="py-16 md:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
          {data.items.map((item, idx) => (
            <Reveal key={idx} index={idx} className="h-full">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group h-full p-8 rounded-2xl bg-white border border-neutral-200 shadow-sm hover:shadow-xl hover:border-brick/40 transition-all flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-brick font-sans">{item.category}</span>
                    <ExternalLink className="w-4 h-4 text-neutral-400 group-hover:text-brick transition-colors" />
                  </div>

                  <h3 className="text-xl font-bold text-maroon group-hover:text-brick transition-colors">
                    {item.title}
                  </h3>

                  <p className="text-sm text-neutral-600 font-sans leading-relaxed">{item.desc}</p>
                </div>

                <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center text-xs font-bold text-brick font-sans group-hover:translate-x-1 transition-transform">
                  <span>{lang === 'en' ? 'Visit Official Portal' : '访问官方站点'}</span>
                  <span className="ml-1">→</span>
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
