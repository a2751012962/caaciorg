import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Menu, X, Globe, User, LogOut } from 'lucide-react';
import type { CAACIContent } from '../data/content';
import { addSmoothScrollListener } from '../utils/smoothScroll';

export interface NavUser {
  name: string;
  email?: string | null;
}

interface NavbarProps {
  content: CAACIContent;
  lang: 'en' | 'zh';
  currentPage: string;
  onToggleLang: () => void;
  onNavigate: (page: string) => void;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  isLoggedIn?: boolean;
  user?: NavUser;
  /** Signed out: "Log In" goes here (the Tabler /login-3/ page). */
  onLogin?: () => void;
  onLogout?: () => void;
}

export function Navbar({
  content,
  lang,
  currentPage,
  onToggleLang,
  onNavigate,
  onOpenModal,
  isLoggedIn = false,
  user,
  onLogin,
  onLogout,
}: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aboutDropdownOpen, setAboutDropdownOpen] = useState(false);
  const [resourcesDropdownOpen, setResourcesDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    let lastY =
      typeof window !== 'undefined' ? window.scrollY || document.documentElement.scrollTop || 0 : 0;
    let touchStartY = 0;

    const showNavbar = () => {
      setIsVisible(true);
    };

    const hideNavbar = () => {
      setIsVisible(false);
      setAboutDropdownOpen(false);
      setResourcesDropdownOpen(false);
      setUserDropdownOpen(false);
    };

    // 1. Lenis smooth scroll listener (fires on every smooth frame)
    const removeLenisListener = addSmoothScrollListener(({ scroll, direction }) => {
      if (scroll <= 60 || direction < 0) {
        showNavbar();
      } else if (direction > 0 && scroll > 80) {
        hideNavbar();
      }
      lastY = scroll;
    });

    // 2. Native scroll listener (fires on native scroll & momentum)
    const onScroll = () => {
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;
      const diff = currentY - lastY;

      if (currentY <= 60) {
        showNavbar();
      } else if (diff < 0) {
        // Any upward scroll immediately shows navbar
        showNavbar();
      } else if (diff > 8 && currentY > 80) {
        // Scrolling downwards hides navbar
        hideNavbar();
      }
      lastY = currentY;
    };

    // 3. Direct Mobile Touch Handlers (captures immediate swipe intent before momentum finishes)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!e.touches || e.touches.length === 0) return;
      const touchY = e.touches[0].clientY;
      const touchDelta = touchY - touchStartY;
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;

      if (currentY <= 60) {
        showNavbar();
      } else if (touchDelta > 5) {
        // Finger dragging downwards -> user scrolling page UP -> immediately reveal navbar
        showNavbar();
      } else if (touchDelta < -15 && currentY > 80) {
        // Finger dragging upwards -> user scrolling page DOWN -> hide navbar
        hideNavbar();
      }
      touchStartY = touchY;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      removeLenisListener();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const handleNavClick = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
    setAboutDropdownOpen(false);
    setResourcesDropdownOpen(false);
    setUserDropdownOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header
      className={`sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 shadow-xs transition-transform duration-300 will-change-transform ${
        isVisible || mobileMenuOpen ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-[72px]">
          {/* Official CAACI Logo */}
          <div className="flex-shrink-0 flex items-center">
            <button
              onClick={() => handleNavClick('home')}
              className="flex items-center gap-3 cursor-pointer text-left"
            >
              <img
                src="/images/logo.png"
                alt="Chinese American Association of Central Illinois organization"
                className="h-12 w-auto max-h-[56px] object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="flex flex-col">
                <span className="font-bold text-lg leading-tight tracking-tight text-[#300200] font-serif-caaci">
                  CAACI
                </span>
                <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-poppins hidden sm:inline">
                  {lang === 'en' ? 'Central Illinois' : '伊利诺伊中部'}
                </span>
              </div>
            </button>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center space-x-1 xl:space-x-2 font-poppins">
            {/* Welcome / Home */}
            <button
              onClick={() => handleNavClick('home')}
              className={`px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                currentPage === 'home'
                  ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                  : 'text-neutral-700 hover:text-[#8e2e11]'
              }`}
            >
              {content.nav.welcome}
            </button>

            {/* About Us Dropdown */}
            <div
              className="relative group"
              onMouseEnter={() => setAboutDropdownOpen(true)}
              onMouseLeave={() => setAboutDropdownOpen(false)}
            >
              <button
                type="button"
                onClick={() => handleNavClick('about')}
                className={`flex items-center gap-1 px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                  currentPage === 'about'
                    ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                    : 'text-neutral-700 hover:text-[#8e2e11]'
                }`}
              >
                <span>{content.nav.aboutUs}</span>
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400 group-hover:text-[#8e2e11] transition-transform" />
              </button>
              {aboutDropdownOpen && (
                <div className="absolute left-0 mt-0 w-48 bg-white border border-neutral-200/80 shadow-lg py-2 rounded-2xl z-50 animate-fadeIn">
                  <button
                    onClick={() => handleNavClick('about')}
                    className="w-full text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer"
                  >
                    {content.nav.aboutUs}
                  </button>
                  <button
                    onClick={() => {
                      setAboutDropdownOpen(false);
                      onOpenModal('volunteer');
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer"
                  >
                    {content.nav.volunteer}
                  </button>
                  <button
                    onClick={() => {
                      setAboutDropdownOpen(false);
                      onOpenModal('donate');
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer"
                  >
                    {content.nav.donate}
                  </button>
                </div>
              )}
            </div>

            {/* Events */}
            <button
              onClick={() => handleNavClick('events')}
              className={`px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                currentPage === 'events'
                  ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                  : 'text-neutral-700 hover:text-[#8e2e11]'
              }`}
            >
              {content.nav.events}
            </button>

            {/* Membership (Direct Navigation - Account removed from dropdown) */}
            <button
              onClick={() => handleNavClick('membership')}
              className={`px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                currentPage === 'membership'
                  ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                  : 'text-neutral-700 hover:text-[#8e2e11]'
              }`}
            >
              {content.nav.membership}
            </button>

            {/* Resources Dropdown */}
            <div
              className="relative group"
              onMouseEnter={() => setResourcesDropdownOpen(true)}
              onMouseLeave={() => setResourcesDropdownOpen(false)}
            >
              <button
                type="button"
                onClick={() => handleNavClick('resources')}
                className={`flex items-center gap-1 px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                  currentPage === 'resources' || currentPage === 'community-calendar'
                    ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                    : 'text-neutral-700 hover:text-[#8e2e11]'
                }`}
              >
                <span>{content.nav.resources}</span>
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400 group-hover:text-[#8e2e11] transition-transform" />
              </button>
              {resourcesDropdownOpen && (
                <div className="absolute left-0 mt-0 w-56 bg-white border border-neutral-200/80 shadow-lg py-2 rounded-2xl z-50 animate-fadeIn">
                  <button
                    onClick={() => handleNavClick('resources')}
                    className="w-full text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer"
                  >
                    {content.nav.resources}
                  </button>
                  <button
                    onClick={() => handleNavClick('community-calendar')}
                    className="w-full text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer"
                  >
                    {content.nav.communityCalendar}
                  </button>
                </div>
              )}
            </div>

            {/* Business Services */}
            <button
              onClick={() => handleNavClick('business-services')}
              className={`px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                currentPage === 'business-services'
                  ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                  : 'text-neutral-700 hover:text-[#8e2e11]'
              }`}
            >
              {content.nav.businessServices}
            </button>

            {/* Log In / User Account Entry (Replaces Log In button when logged in) */}
            {isLoggedIn && user ? (
              <div
                className="relative group"
                onMouseEnter={() => setUserDropdownOpen(true)}
                onMouseLeave={() => setUserDropdownOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => handleNavClick('account')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                    currentPage === 'account'
                      ? 'bg-[#8e2e11] text-white shadow-xs'
                      : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 border border-neutral-200'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      currentPage === 'account'
                        ? 'bg-white text-[#8e2e11]'
                        : 'bg-[#8e2e11] text-white'
                    }`}
                  >
                    {user.name.slice(0, 1)}
                  </div>
                  <span className="truncate max-w-[120px]">
                    {lang === 'en' ? 'My Account' : '我的账户'}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                </button>

                {userDropdownOpen && (
                  <div className="absolute right-0 mt-0 w-52 bg-white border border-neutral-200/90 shadow-xl py-2 rounded-2xl z-50 animate-fadeIn">
                    <div className="px-4 py-2 border-b border-neutral-100">
                      <p className="text-xs font-bold text-neutral-900 truncate">{user.name}</p>
                      <p className="text-[10px] text-neutral-400 truncate font-mono">
                        {user.email}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleNavClick('account');
                      }}
                      className="w-full text-left px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-[#8e2e11] transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <User className="w-3.5 h-3.5 text-[#8e2e11]" />
                      <span>{lang === 'en' ? 'Member Portal' : '会员中心'}</span>
                    </button>
                    {onLogout && (
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer flex items-center gap-2"
                      >
                        <LogOut className="w-3.5 h-3.5 text-rose-500" />
                        <span>{lang === 'en' ? 'Sign Out' : '退出登录'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => (onLogin ? onLogin() : handleNavClick('account'))}
                className={`px-3 py-2 text-sm font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                  currentPage === 'account'
                    ? 'text-[#8e2e11] font-bold border-b-2 border-[#8e2e11]'
                    : 'text-neutral-700 hover:text-[#8e2e11]'
                }`}
              >
                {content.nav.login}
              </button>
            )}

            {/* Language Switcher pill in header */}
            <button
              onClick={onToggleLang}
              className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-300 text-xs font-semibold text-neutral-700 hover:border-[#8e2e11] hover:text-[#8e2e11] transition-all bg-neutral-50 cursor-pointer shrink-0"
              title="Switch Language / 切换语言"
            >
              <Globe className="w-3.5 h-3.5 text-[#8e2e11]" />
              <span className="font-semibold">{lang === 'en' ? '中' : 'En'}</span>
            </button>
          </nav>

          {/* Mobile hamburger button */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <button
              onClick={onToggleLang}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-neutral-300 text-xs font-semibold text-neutral-700 bg-neutral-50 cursor-pointer shrink-0"
            >
              <Globe className="w-3.5 h-3.5 text-[#8e2e11]" />
              <span>{lang === 'en' ? '中' : 'En'}</span>
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-neutral-700 hover:text-[#8e2e11] focus:outline-none cursor-pointer"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-t border-neutral-200 px-4 pt-2 pb-6 space-y-2 shadow-xl font-poppins">
          <button
            onClick={() => handleNavClick('home')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'home' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.welcome}
          </button>

          <div className="pl-3 border-l-2 border-neutral-200 space-y-1.5">
            <button
              onClick={() => handleNavClick('about')}
              className={`block w-full text-left py-1 text-sm font-semibold uppercase ${
                currentPage === 'about' ? 'text-[#8e2e11]' : 'text-neutral-700'
              }`}
            >
              {content.nav.aboutUs}
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenModal('volunteer');
              }}
              className="block w-full text-left py-1 text-xs text-neutral-600 hover:text-[#8e2e11]"
            >
              {content.nav.volunteer}
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenModal('donate');
              }}
              className="block w-full text-left py-1 text-xs text-neutral-600 hover:text-[#8e2e11]"
            >
              {content.nav.donate}
            </button>
          </div>

          <button
            onClick={() => handleNavClick('events')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'events' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.events}
          </button>

          <button
            onClick={() => handleNavClick('membership')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'membership' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.membership}
          </button>

          <button
            onClick={() => handleNavClick('resources')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'resources' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.resources}
          </button>

          <button
            onClick={() => handleNavClick('community-calendar')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'community-calendar' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.communityCalendar}
          </button>

          <button
            onClick={() => handleNavClick('business-services')}
            className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
              currentPage === 'business-services' ? 'text-[#8e2e11]' : 'text-neutral-700'
            }`}
          >
            {content.nav.businessServices}
          </button>

          {isLoggedIn && user ? (
            <div className="pt-3 border-t border-neutral-200 space-y-1">
              <button
                onClick={() => handleNavClick('account')}
                className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
                  currentPage === 'account' ? 'text-[#8e2e11]' : 'text-neutral-700'
                }`}
              >
                {lang === 'en' ? 'My Account' : '我的账户'}
              </button>
              {onLogout && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onLogout();
                  }}
                  className="block w-full text-left py-1 text-xs text-rose-600 font-medium"
                >
                  {lang === 'en' ? 'Sign Out' : '退出登录'}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => (onLogin ? onLogin() : handleNavClick('account'))}
              className={`block w-full text-left py-2 text-sm font-semibold uppercase ${
                currentPage === 'account' ? 'text-[#8e2e11]' : 'text-neutral-700'
              }`}
            >
              {content.nav.login}
            </button>
          )}
        </div>
      )}
    </header>
  );
}
