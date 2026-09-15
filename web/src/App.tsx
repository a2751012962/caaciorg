import { lazy, Suspense, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { Modals, type ModalType } from './components/Modals';
import { contentEN, contentZH } from './data/content';
import { initSmoothScroll, destroySmoothScroll, scrollToTop } from './utils/smoothScroll';
import { AuthProvider, loginUrl, useAuth } from './lib/auth';
import { initialLang, isZhPath, storeLang, type Lang } from './lib/lang';

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

export type PageId =
  | 'home'
  | 'about'
  | 'events'
  | 'membership'
  | 'account'
  | 'resources'
  | 'community-calendar'
  | 'business-services';

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
};

function pageFromPath(pathname: string): PageId {
  const segment =
    pathname
      .replace(/^\/zh(?=\/|$)/, '')
      .split('/')
      .filter(Boolean)[0] ?? '';
  return PAGE_BY_SEGMENT[segment.toLowerCase()] ?? 'home';
}

const pathFor = (page: PageId, lang: Lang) =>
  `${lang === 'zh' ? '/zh' : ''}/${page === 'home' ? '' : `${page}/`}`;

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
  const settled = pathFor(page, lang) + url.search + url.hash;
  if (settled !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.replaceState(null, '', settled);
  }
  return { page, lang, modal };
}

function Site() {
  const [initial] = useState(boot);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [currentPage, setCurrentPage] = useState<PageId>(initial.page);
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
    setLang(nextLang);
    window.history.replaceState(
      null,
      '',
      pathFor(currentPage, nextLang) + window.location.search + window.location.hash,
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
      <Site />
    </AuthProvider>
  );
}
