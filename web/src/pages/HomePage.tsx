import { useEffect, useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { Hero } from '../components/Hero';
import { StackedCardsSection } from '../components/StackedCardsSection';
import { Benefits } from '../components/Benefits';
import { VibrantCommunity } from '../components/VibrantCommunity';
import { ContactSection } from '../components/ContactSection';
import { MarketplaceSection } from '../components/MarketplaceSection';
import type { CAACIContent } from '../data/content';

interface HomePageProps {
  content: CAACIContent;
  lang?: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function HomePage({ content, lang = 'en', onOpenModal, onNavigate }: HomePageProps) {
  // Stripe sends a finished donation to /thank-you/?d=…, which App.tsx turns into
  // /?donated=1. Thank the donor once, then drop the flag from the address so a
  // reload or a shared link doesn't thank anyone again.
  const [donated, setDonated] = useState(() =>
    new URLSearchParams(window.location.search).has('donated'),
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('donated')) return;
    url.searchParams.delete('donated');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  return (
    <div>
      {donated && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
          <div
            role="status"
            className="p-5 sm:p-6 bg-emerald-50 border border-emerald-200/80 rounded-2xl flex items-start gap-3 sm:gap-4 font-poppins"
          >
            <CheckCircle className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1">
              <h2 className="font-semibold text-emerald-900 text-base sm:text-lg">
                {lang === 'en' ? 'Thank you for your donation!' : '感谢您的慷慨捐赠！'}
              </h2>
              <p className="text-emerald-700 text-xs sm:text-sm leading-relaxed">
                {lang === 'en'
                  ? 'Your payment to CAACI went through. Your gift supports our community festivals, programs, and services across Central Illinois.'
                  : '您对华人协会的捐款已支付成功，将用于支持协会在伊利诺伊中部的节庆活动、社区项目与公共服务。'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDonated(false)}
              className="p-1 rounded-full text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 transition-colors cursor-pointer shrink-0"
              aria-label={content.modals.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
      <Hero content={content} lang={lang} onOpenModal={onOpenModal} onNavigate={onNavigate} />
      <MarketplaceSection lang={lang} placement="home" />
      <StackedCardsSection
        content={content}
        lang={lang}
        onNavigate={onNavigate}
        onOpenModal={onOpenModal}
      />
      <Benefits content={content} />
      <VibrantCommunity content={content} onOpenModal={onOpenModal} />
      <ContactSection content={content} />
    </div>
  );
}
