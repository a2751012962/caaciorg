import { Hero } from '../components/Hero';
import { StackedCardsSection } from '../components/StackedCardsSection';
import { Benefits } from '../components/Benefits';
import { VibrantCommunity } from '../components/VibrantCommunity';
import { ContactSection } from '../components/ContactSection';
import type { CAACIContent } from '../data/content';

interface HomePageProps {
  content: CAACIContent;
  lang?: 'en' | 'zh';
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

export function HomePage({ content, lang = 'en', onOpenModal, onNavigate }: HomePageProps) {
  return (
    <div>
      <Hero content={content} onOpenModal={onOpenModal} onNavigate={onNavigate} />
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
