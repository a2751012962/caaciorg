import { lazy, Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { Modals, type ModalType } from './components/Modals';
import { contentEN, contentZH } from './data/content';
import { initSmoothScroll, destroySmoothScroll, scrollToTop } from './utils/smoothScroll';
import { AuthProvider, loginUrl, useAuth } from './lib/auth';
import { initialLang, isZhPath, storeLang, type Lang } from './lib/lang';
import { fadeLang } from './lib/langFade';

// The home page ships in the main bundle; every other page loads on first visit.
import { HomePage } from './pages/HomePage';
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const EventsPage = lazy(() =>
  import('./pages/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const MembershipPage = lazy(() =>
  import('./pages/MembershipPage').then((m) => ({ default: m.MembershipPage })),
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const ResourcesPage = lazy(() =>
  import('./pages/ResourcesPage').then((m) => ({ default: m.ResourcesPage })),
);
const CommunityCalendarPage = lazy(() =>
  import('./pages/CommunityCalendarPage').then((m) => ({ default: m.CommunityCalendarPage })),
);
const BusinessServicesPage = lazy(() =>
  import('./pages/BusinessServicesPage').then((m) => ({ default: m.BusinessServicesPage })),
);
const EventRegisterPage = lazy(() =>
  import('./pages/EventRegisterPage').then((m) => ({ default: m.EventRegisterPage })),
);
// Token pages: reached from a scanned member card or the account page, never from the nav.
const ChargePage = lazy(() =>
  import('./pages/ChargePage').then((m) => ({ default: m.ChargePage })),
);
const MerchantPage = lazy(() =>
  import('./pages/MerchantPage').then((m) => ({ default: m.MerchantPage })),
);
const TokenAdminPage = lazy(() =>
  import('./pages/TokenAdminPage').then((m) => ({ default: m.TokenAdminPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

export type PageId =
  | 'home'
  | 'about'
  | 'events'
  | 'membership'
  | 'account'
  | 'resources'
  | 'community-calendar'
  | 'business-services'
  | 'event-register'
  | 'charge'
  | 'merchant'
  | 'token-admin'
  // Cloudflare Pages serves dist/404.html (this app) at any address that
  // matches nothing; the page keeps that address and says so.
  | 'not-found';

// build.mjs writes this app's index.html at each of these paths (and under /zh/).
const PAGE_BY_SEGMENT: Record<string, PageId> = {
  '': 'home',
  about: 'about',
  events: 'events',
  membership: 'membership',
  account: 'account',
  resources: 'resources',
  'community-calendar': 'community-calendar',
  'business-services': 'business-services',
  'event-register': 'event-register',
  charge: 'charge',
  merchant: 'merchant',
  'token-admin': 'token-admin',
};

// The registration page also answers at /events/<slug>/register/ (with or
// without the /zh/ prefix): the _redirects rewrite serves this SPA there and
// keeps the slug in the address bar, which is how the page knows its event.
const REGISTER_PATH = /^\/(?:zh\/)?events\/([^/]+)\/register\/?$/i;

// A path with more segments than its page has (/about/x/) or one no page owns
// is the 404 page: Pages only serves this app there through dist/404.html.
function pageFromPath(pathname: string): PageId {
  if (REGISTER_PATH.test(pathname)) return 'event-register';
  const segments = pathname
    .replace(/^\/zh(?=\/|$)/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length > 1) return 'not-found';
  return PAGE_BY_SEGMENT[(segments[0] ?? '').toLowerCase()] ?? 'not-found';
}

// `from` is the address the visitor is on: a /events/<slug>/register/ URL keeps
// its slug (dropping it would leave the page with no event to load), the 404
// page keeps the address that was not found, while every other page has one
// path per language.
const pathFor = (page: PageId, lang: Lang, from = '') => {
  const prefix = lang === 'zh' ? '/zh' : '';
  const match = page === 'event-register' ? REGISTER_PATH.exec(from) : null;
  if (match) return `${prefix}/events/${match[1]}/register/`;
  if (page === 'not-found') return prefix + (from.replace(/^\/zh(?=\/|$)/, '') || '/');
  return `${prefix}/${page === 'home' ? '' : `${page}/`}`;
};

// Read the address once, before the first render, and settle it: the language
// being shown decides the /zh/ prefix, ?lang= and ?modal= are consumed, and
// Stripe's success_url (/thank-you/?m=… for a membership, ?d=… for a donation)
// is forwarded to where the result is shown.
function boot(): { page: PageId; lang: Lang; modal: ModalType } {
  const url = new URL(window.location.href);
  const lang = initialLang();
  url.searchParams.delete('lang');
  let modal: ModalType = null;
  const requested = url.searchParams.get('modal');
  if (requested === 'donate' || requested === 'volunteer') modal = requested;
  url.searchParams.delete('modal');

  let page = pageFromPath(url.pathname);
  if (/^\/(zh\/)?thank-you\/?$/i.test(url.pathname)) {
    const membership = url.searchParams.has('m');
    const donation = url.searchParams.has('d');
    url.search = '';
    if (membership) {
      page = 'account';
      url.searchParams.set('checkout', 'success');
    } else if (donation) {
      url.searchParams.set('donated', '1');
    }
  }
  const settled = pathFor(page, lang, url.pathname) + url.search + url.hash;
  if (settled !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(null, '', settled);
  }
  return { page, lang, modal };
}

function Site() {
  const [initial] = useState(boot);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [currentPage, setCurrentPage] = useState<PageId>(initial.page);
  // The address as the page-level identity, updated on back/forward so a page
  // that reads location once (event-register) is remounted for a new URL.
  const [route, setRoute] = useState(() => window.location.pathname + window.location.search);
  const [modalType, setModalType] = useState<ModalType>(initial.modal);
  const auth = useAuth();

  const content = lang === 'en' ? contentEN : contentZH;

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  // Initialize Lenis Smooth Scrolling and synchronize with GSAP ScrollTrigger
  useEffect(() => {
    initSmoothScroll();
    return () => {
      destroySmoothScroll();
    };
  }, []);

  // Browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(pageFromPath(window.location.pathname));
      setLang(isZhPath(window.location.pathname) ? 'zh' : 'en');
      setRoute(window.location.pathname + window.location.search);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Accepts a page id, optionally with a #section ("events#past").
  const navigateTo = (target: string) => {
    const [id, hash] = target.split('#');
    const page = PAGE_BY_SEGMENT[id === 'home' ? '' : id] ?? 'home';
    setCurrentPage(page);
    window.history.pushState(null, '', pathFor(page, lang) + (hash ? `#${hash}` : ''));
    if (hash) {
      setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 50);
    } else {
      scrollToTop();
    }
  };

  const toggleLang = () => {
    const nextLang = lang === 'en' ? 'zh' : 'en';
    storeLang(nextLang);
    // Text by text: the old wording fades out, the new one rises into place.
    // Layout, images and the scroll position stay put; nothing remounts.
    fadeLang(() => setLang(nextLang));
    window.history.replaceState(
      null,
      '',
      pathFor(currentPage, nextLang, window.location.pathname) +
        window.location.search +
        window.location.hash,
    );
  };

  const handleOpenModal = (type: 'donate' | 'events' | 'membership' | 'volunteer') => {
    if (type === 'events') {
      navigateTo('events');
    } else if (type === 'membership') {
      navigateTo('membership');
    } else {
      setModalType(type);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    if (currentPage === 'account') navigateTo('home');
  };

  const pageProps = { content, lang, onOpenModal: handleOpenModal, onNavigate: navigateTo };

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'about':
        return <AboutPage {...pageProps} />;
      case 'events':
        return <EventsPage {...pageProps} />;
      case 'membership':
        return <MembershipPage {...pageProps} />;
      case 'account':
        return <AccountPage {...pageProps} onLogout={handleLogout} />;
      case 'resources':
        return <ResourcesPage {...pageProps} />;
      case 'community-calendar':
        return <CommunityCalendarPage {...pageProps} />;
      case 'business-services':
        return <BusinessServicesPage {...pageProps} />;
      case 'event-register':
        // Keyed on the address: the registration page reads its event from the
        // path once, so stepping back to a different /events/<slug>/register/
        // has to start it over rather than leave the old event on screen.
        return <EventRegisterPage key={route} {...pageProps} />;
      case 'charge':
        return <ChargePage key={route} {...pageProps} />;
      case 'merchant':
        return <MerchantPage key={route} {...pageProps} />;
      case 'token-admin':
        return <TokenAdminPage {...pageProps} />;
      case 'not-found':
        return <NotFoundPage key={route} {...pageProps} />;
      case 'home':
      default:
        return <HomePage {...pageProps} />;
    }
  };

  const navUser = auth.user
    ? { name: auth.member?.full_name || auth.user.email || '', email: auth.user.email }
    : undefined;

  return (
    <div className="min-h-screen bg-white text-neutral-800 font-poppins selection:bg-brick selection:text-white flex flex-col justify-between">
      <Navbar
        content={content}
        lang={lang}
        currentPage={currentPage}
        onToggleLang={toggleLang}
        onNavigate={navigateTo}
        onOpenModal={handleOpenModal}
        isLoggedIn={!!auth.user}
        user={navUser}
        onLogin={() => window.location.assign(loginUrl())}
        onLogout={handleLogout}
      />

      <main className="flex-1">
        <Suspense fallback={<div className="min-h-[70vh]" />}>{renderCurrentPage()}</Suspense>
      </main>

      <Footer content={content} onOpenModal={handleOpenModal} onNavigate={navigateTo} />

      <Modals
        modalType={modalType}
        onClose={() => setModalType(null)}
        lang={lang}
        content={content}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      {/* reducedMotion="user": every motion/react animation collapses to a plain
          state change when the OS asks for less motion. GSAP reveals check the
          same media query in lib/motion.ts. */}
      <MotionConfig reducedMotion="user">
        <Site />
      </MotionConfig>
    </AuthProvider>
  );
}
