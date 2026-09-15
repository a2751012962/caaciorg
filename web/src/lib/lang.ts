import { LANG_KEY, browserLang } from './shared';

export type Lang = 'en' | 'zh';

export const isZhPath = (path: string) => /^\/zh(\/|$)/.test(path);

export function storeLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Storage blocked: the switch still works, it just isn't remembered.
  }
}

// Same rules as the mirrored pages (mirrorLangBoot in src/caaci-shared.js):
// ?lang= wins and is remembered; then the stored choice; without one a /zh/
// page is never left (opened on purpose) and crawlers get the URL's language;
// everyone else gets their browser's language on a first visit.
export function initialLang(loc: Location = window.location, nav: Navigator = navigator): Lang {
  const q = new URLSearchParams(loc.search).get('lang');
  if (q === 'zh' || q === 'en') {
    storeLang(q);
    return q;
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {
    // fall through to the URL / browser
  }
  if (stored === 'zh' || stored === 'en') return stored;
  if (isZhPath(loc.pathname)) return 'zh';
  if (/bot|crawl|spider|slurp/i.test(nav.userAgent || '')) return 'en';
  return browserLang(nav.languages?.length ? nav.languages : [nav.language]) as Lang;
}
