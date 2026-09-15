import { Heart, Calendar, UserPlus } from 'lucide-react';
import type { CAACIContent } from '../data/content';

interface SubpageHeroProps {
  title: string;
  subtitle?: string;
  bgImage?: string;
  content: CAACIContent;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
  currentPage: string;
  showActionBanners?: boolean;
}

export function SubpageHero({
  title,
  subtitle,
  bgImage = '/images/hero-bg.jpg',
  content,
  onOpenModal,
  onNavigate,
  currentPage,
  showActionBanners = true,
}: SubpageHeroProps) {
  return (
    <div className="relative w-full">
      {/* Subpage Parallax Banner */}
      <div
        className="relative w-full min-h-[220px] sm:min-h-[260px] md:min-h-[290px] bg-cover bg-center flex items-center bg-fixed transition-all"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(246, 245, 243, 0.92) 100%), url('${bgImage}')`,
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-10 md:py-14">
          <div className="max-w-3xl">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3 font-poppins">
              <button
                onClick={() => onNavigate('home')}
                className="hover:text-brick transition-colors cursor-pointer"
              >
                {content.nav.welcome}
              </button>
              <span>/</span>
              <span className="text-brick font-bold">{title}</span>
            </div>

            <h1
              className="text-3xl sm:text-4xl md:text-5xl font-bold text-maroon leading-tight tracking-wide font-serif-caaci"
              style={{ fontFamily: 'var(--font-caaci-serif)' }}
            >
              {title}
            </h1>

            <div className="w-16 h-1 bg-brick my-4 rounded-full" />

            {subtitle && (
              <p className="font-poppins text-neutral-700 text-sm sm:text-base leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 3 Restrained Action Banners (Unified Harmonious Terracotta/Lacquer Palette) */}
      {showActionBanners && (
        <div className="relative w-full z-20">
          <div className="grid grid-cols-1 md:grid-cols-3 w-full border-t border-b border-black/10">
            {/* Banner 1: Make A Donation - Signature Terracotta */}
            <button
              onClick={() => onOpenModal('donate')}
              type="button"
              className="group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none bg-brick"
            >
              <Heart className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
              <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
                {content.hero.btnDonation}
              </span>
            </button>

            {/* Banner 2: Check Out Events - Deep Warm Terracotta */}
            <button
              onClick={() => onNavigate('events')}
              type="button"
              className={`group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none ${
                currentPage === 'events' ? 'brightness-110 ring-2 ring-white/50 inset-ring' : ''
              } bg-brick-deep`}
            >
              <Calendar className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
              <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
                {content.hero.btnEvents}
              </span>
            </button>

            {/* Banner 3: Become A Member - Deep Lacquer Espresso */}
            <button
              onClick={() => onNavigate('membership')}
              type="button"
              className={`group py-3.5 sm:py-4 px-5 text-center text-white transition-all cursor-pointer flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] focus:outline-none ${
                currentPage === 'membership' ? 'brightness-110 ring-2 ring-white/50 inset-ring' : ''
              } bg-maroon`}
            >
              <UserPlus className="w-4 h-4 text-white/90 group-hover:scale-110 transition-transform shrink-0" />
              <span className="font-poppins font-semibold text-xs sm:text-[13px] tracking-wider uppercase">
                {content.hero.btnMembership}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
