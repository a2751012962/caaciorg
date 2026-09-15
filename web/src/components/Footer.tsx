import { Mail, MapPin } from 'lucide-react';
import type { CAACIContent } from '../data/content';

interface FooterProps {
  content: CAACIContent;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate?: (page: string) => void;
}

export function Footer({ content, onOpenModal, onNavigate }: FooterProps) {
  const handleNav = (page: string) => {
    if (onNavigate) {
      onNavigate(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-footer text-neutral-300 border-t border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-neutral-800">
          {/* Logo & Description */}
          <div className="md:col-span-5 space-y-4">
            <div className="flex items-center gap-3">
              <img
                src="/images/logo.png"
                alt="CAACI"
                className="h-10 w-auto object-contain bg-white/10 rounded p-1"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="font-serif-caaci text-xl font-bold text-white tracking-wide">
                CAACI
              </div>
            </div>

            <p className="font-poppins text-sm text-neutral-400 leading-relaxed max-w-md">
              {content.footer.aboutText}
            </p>

            <div className="text-xs text-neutral-500 font-poppins pt-2">
              Serving Champaign, Urbana, Savoy, and the greater Central Illinois area since 2000.
            </div>
          </div>

          {/* Quick Links */}
          <div className="md:col-span-4 space-y-3 font-poppins text-sm">
            <h4 className="font-bold text-white text-xs border-b border-neutral-700 pb-2">
              {content.footer.quickLinks}
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleNav('home')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.welcome}
              </button>
              <button
                type="button"
                onClick={() => handleNav('about')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.aboutUs}
              </button>
              <button
                type="button"
                onClick={() => handleNav('events')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.events}
              </button>
              <button
                type="button"
                onClick={() => handleNav('membership')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.membership}
              </button>
              <button
                type="button"
                onClick={() => handleNav('resources')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.resources}
              </button>
              <button
                type="button"
                onClick={() => handleNav('community-calendar')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.communityCalendar}
              </button>
              <button
                type="button"
                onClick={() => handleNav('business-services')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.businessServices}
              </button>
              <button
                type="button"
                onClick={() => handleNav('account')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.account}
              </button>
              <button
                type="button"
                onClick={() => onOpenModal('donate')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer text-tan"
              >
                {content.nav.donate}
              </button>
              <button
                type="button"
                onClick={() => onOpenModal('volunteer')}
                className="text-left text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                {content.nav.volunteer}
              </button>
            </div>
          </div>

          {/* Contact Details */}
          <div className="md:col-span-3 space-y-3 font-poppins text-sm">
            <h4 className="font-bold text-white text-xs border-b border-neutral-700 pb-2">
              Contact
            </h4>
            <div className="space-y-3 text-neutral-400">
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-rust mt-1 shrink-0" />
                <span>
                  {content.contact.addressLine1}
                  <br />
                  {content.contact.addressLine2}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-rust shrink-0" />
                <a
                  href={`mailto:${content.contact.email}`}
                  className="hover:text-white transition-colors"
                >
                  {content.contact.email}
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="pt-8 flex flex-col sm:flex-row justify-between items-center text-xs text-neutral-500 font-poppins gap-4">
          <div>{content.footer.copyright}</div>
          <div className="flex items-center gap-4">
            <a
              href="https://www.facebook.com/profile.php?id=61558646710024"
              target="_blank"
              rel="noopener noreferrer"
              className="text-tan hover:underline"
            >
              {content.footer.facebook}
            </a>
            <span>•</span>
            <span>{content.footer.nonProfit}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
