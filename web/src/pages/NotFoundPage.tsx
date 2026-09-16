import { useEffect } from 'react';
import { Calendar, Home, Mail, UserPlus } from 'lucide-react';
import { SubpageHero } from '../components/SubpageHero';
import { Reveal } from '../components/Reveal';
import type { CAACIContent } from '../data/content';
import { notFoundDataEN, notFoundDataZH } from '../data/pagesContent';

// web/DESIGN_SYSTEM.md §5.1 / §5.3, verbatim (as on the registration page).
const PRIMARY =
  'min-h-[44px] px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider shadow-xs transition-all active:scale-98 cursor-pointer inline-flex items-center justify-center gap-2';
const SECONDARY =
  'min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold cursor-pointer transition-colors inline-flex items-center justify-center gap-2';

interface NotFoundPageProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// Served by Cloudflare Pages as dist/404.html (see build.mjs) for any address
// that matches nothing, in both languages: the shell, header and footer are the
// site's own, so a dead link still lands somewhere that looks like CAACI.
export function NotFoundPage({ content, lang, onOpenModal, onNavigate }: NotFoundPageProps) {
  const data = lang === 'en' ? notFoundDataEN : notFoundDataZH;
  // Only the path: a query string could carry something a person would not
  // want echoed on screen, and the path is what they mistyped or followed.
  const requested = window.location.pathname;

  useEffect(() => {
    const previous = document.title;
    document.title = `${data.title} | Chinese American Association of Central Illinois`;
    return () => {
      document.title = previous;
    };
  }, [data.title]);

  return (
    <div className="bg-white">
      <SubpageHero
        title={data.title}
        subtitle={data.subtitle}
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="not-found"
        showActionBanners={false}
      />

      <section className="py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 shadow-xs max-w-2xl mx-auto space-y-5">
            <span className="text-xs font-semibold text-brick block font-poppins">
              {data.eyebrow}
            </span>
            <p className="text-sm sm:text-base text-neutral-700 font-poppins leading-relaxed">
              {data.body}
            </p>
            <p className="text-xs text-neutral-500 font-poppins break-all">
              {data.requested}
              {lang === 'en' ? ': ' : '：'}
              <code className="font-mono text-neutral-700">{requested}</code>
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <button type="button" onClick={() => onNavigate('home')} className={PRIMARY}>
                <Home className="w-4 h-4" aria-hidden="true" />
                {data.home}
              </button>
              <button type="button" onClick={() => onNavigate('events')} className={SECONDARY}>
                <Calendar className="w-4 h-4" aria-hidden="true" />
                {data.events}
              </button>
              <button type="button" onClick={() => onNavigate('membership')} className={SECONDARY}>
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                {data.membership}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('home#contact')}
                className={SECONDARY}
              >
                <Mail className="w-4 h-4" aria-hidden="true" />
                {data.contact}
              </button>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
