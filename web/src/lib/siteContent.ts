// Page copy and photos an editor can change from the admin "Page content" tab
// (docs/content-management.md). Every visible string on a public page lives in
// a data object under web/src/data/; this file registers those objects, keeps
// a pristine copy of them (the defaults "Reset" goes back to), and writes saved
// overrides into them in place before the first render, so the pages that
// import them need no changes. The rules themselves (walking, typing,
// applying, diffing) are plain JS in siteContentCore.js, where they are tested.
import { useSyncExternalStore } from 'react';
import { contentEN, contentZH } from '../data/content';
import { aboutDataEN, aboutDataZH } from '../data/pages/about';
import { eventsDataEN, eventsDataZH } from '../data/pages/events';
import { membershipPageDataEN, membershipPageDataZH } from '../data/pages/membership';
import { resourcesDataEN, resourcesDataZH } from '../data/pages/resources';
import { calendarDataEN, calendarDataZH } from '../data/pages/calendar';
import { businessServicesDataEN, businessServicesDataZH } from '../data/pages/business';
import { notFoundDataEN, notFoundDataZH } from '../data/pages/notFound';
import { smoothScrollTo } from '../utils/smoothScroll';
import {
  clone,
  createApplier,
  focusNeedle,
  groupFields,
  humanize,
  isPlainObject,
  walkFields,
} from './siteContentCore';

export type Bilingual = { en: string; zh: string };
export type ContentLang = 'en' | 'zh';
/** `{ [key]: { en?, zh? } }` — the shape /api/site-content answers with. */
export type OverrideSet = Record<string, { en?: unknown; zh?: unknown }>;

export interface SiteContentEntry {
  /** First segment of every override key (`about.missionText`). No dots. */
  id: string;
  label: Bilingual;
  /** Where the preview opens (the /zh/ copy for Chinese). */
  previewPath: string;
  en: object;
  zh: object;
  /**
   * Paths that are not page copy and must not be overridden (a `*` segment
   * matches any key). Each one says why where it is listed.
   */
  exclude?: string[];
  /** Top-level strings that belong with a section other than the one named like them. */
  sections?: Record<string, string>;
  /**
   * `<list>.<item key>` values inside list items that are code, not copy (an
   * enum the page switches on): kept as they are, never shown to the editor.
   */
  fixed?: string[];
}

// ------------------------------------------------------------------ registry

// content.ts holds the home page's sections and the chrome every page shares.
// Which is which, explicitly: a section listed as 'home' is edited under Home,
// everything else (including sections added later, unless their name starts
// with "home") under "Whole site".
const COMMON_SECTION_PAGE: Record<string, 'home' | 'site'> = {
  hero: 'home',
  welcome: 'home',
  whyJoin: 'home',
  community: 'home',
  nav: 'site',
  footer: 'site',
  contact: 'site',
  modals: 'site',
};
export const commonSectionPage = (section: string): 'home' | 'site' =>
  COMMON_SECTION_PAGE[section] ?? (/^home(?:[A-Z]|$)/.test(section) ? 'home' : 'site');

export const SITE_CONTENT: SiteContentEntry[] = [
  {
    id: 'common',
    label: { en: 'Whole site', zh: '全站通用' },
    previewPath: '/',
    en: contentEN,
    zh: contentZH,
  },
  {
    id: 'about',
    label: { en: 'About', zh: '关于我们' },
    previewPath: '/about/',
    en: aboutDataEN,
    zh: aboutDataZH,
    sections: {
      missionTitle: 'mission',
      missionText: 'mission',
      howWeDoItTitle: 'howWeDoIt',
      howWeDoItText: 'howWeDoIt',
      yearInReviewTitle: 'yearInReview',
      yearInReviewVideoId: 'yearInReview',
      managementTitle: 'team',
      managementSubtitle: 'team',
    },
  },
  // TODO(lead): register the column directory's copy here once its data object
  // lands: { id: 'columns', label: { en: 'Columns', zh: '专栏' },
  //   previewPath: '/about/columns/', en: columnsDataEN, zh: columnsDataZH },
  {
    id: 'events',
    label: { en: 'Events', zh: '活动' },
    previewPath: '/events/',
    en: eventsDataEN,
    zh: eventsDataZH,
    // Upcoming events are rows of public.events (the Events tab); `past` is the
    // static archive in the data file, so it stays editable here.
    sections: {
      searchPlaceholder: 'filters',
      filterAll: 'filters',
      filterUpcoming: 'filters',
      filterPast: 'filters',
      upcomingTitle: 'upcoming',
      upcomingSubtitle: 'upcoming',
    },
    // The page filters the archive on these values (job, culture, ...).
    fixed: ['past.category'],
  },
  {
    id: 'membership',
    label: { en: 'Membership', zh: '会员' },
    previewPath: '/membership/',
    en: membershipPageDataEN,
    zh: membershipPageDataZH,
    // A plan card's benefit lines are edited in the Membership plans tab
    // (membership_tiers.features / features_zh), which wins over these built-in
    // ones (components/PlanCard.tsx planCopy); two places for one list would
    // let an editor change text that never shows. The period label stays here.
    exclude: ['tiers.*.features'],
    sections: {
      note: 'notes',
      inviteNote: 'notes',
      formTitle: 'form',
      formTier: 'form',
      formSubmit: 'form',
    },
  },
  {
    id: 'resources',
    label: { en: 'Resources', zh: '社区资源' },
    previewPath: '/resources/',
    en: resourcesDataEN,
    zh: resourcesDataZH,
  },
  {
    id: 'calendar',
    label: { en: 'Community calendar', zh: '社区日历' },
    previewPath: '/community-calendar/',
    en: calendarDataEN,
    zh: calendarDataZH,
  },
  {
    id: 'business',
    label: { en: 'Business services', zh: '商业服务' },
    previewPath: '/business-services/',
    en: businessServicesDataEN,
    zh: businessServicesDataZH,
    // The directory is the business_directory table (Business directory tab,
    // lib/directory.ts); `merchants` is only the built-in fallback for when
    // that read fails, so editing it here would change nothing visitors see.
    exclude: ['merchants'],
    // What the option's button does (membership checkout or the loan form).
    fixed: ['sponsorTiers.action'],
  },
  {
    id: 'notFound',
    label: { en: 'Page not found (404)', zh: '404 页面' },
    previewPath: '/this-page-does-not-exist/',
    en: notFoundDataEN,
    zh: notFoundDataZH,
  },
];

/** Every registered object exactly as the code ships it, copied before any override. */
export const SITE_DEFAULTS: Record<string, { en: object; zh: object }> = Object.fromEntries(
  SITE_CONTENT.map((e) => [e.id, { en: structuredClone(e.en), zh: structuredClone(e.zh) }]),
);

const applier = createApplier(
  SITE_CONTENT.map((e) => ({
    id: e.id,
    en: e.en,
    zh: e.zh,
    defaults: SITE_DEFAULTS[e.id],
    exclude: e.exclude,
  })),
);

/** The default value behind an override key, or undefined for an unknown key. */
export function defaultOf(key: string, lang: ContentLang): unknown {
  const dot = key.indexOf('.');
  const d = SITE_DEFAULTS[key.slice(0, dot)];
  if (!d || dot < 1) return undefined;
  let cur: unknown = d[lang];
  for (const seg of key.slice(dot + 1).split('.')) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return clone(cur);
}

// ------------------------------------------------------------------ labels

// Readable names for the sections and fields an editor reaches for most. Keys
// are `<entry id>.<section or path>`; anything not listed gets its key turned
// into words (missionText → "Mission text").
const LABELS: Record<string, Bilingual> = {
  'common.nav': { en: 'Menu', zh: '导航菜单' },
  'common.hero': { en: 'Home banner', zh: '首页横幅' },
  'common.hero.title': { en: 'Banner title', zh: '横幅标题' },
  'common.hero.subtitle': { en: 'Banner subtitle', zh: '横幅副标题' },
  'common.hero.btnDonation': { en: 'Donate button', zh: '捐赠按钮' },
  'common.hero.btnEvents': { en: 'Events button', zh: '活动按钮' },
  'common.hero.btnMembership': { en: 'Membership button', zh: '会员按钮' },
  'common.welcome': { en: 'Welcome', zh: '欢迎' },
  'common.welcome.aboutCta': { en: 'Link to About', zh: '“关于我们”链接' },
  'common.whyJoin': { en: 'Why join', zh: '为什么加入' },
  'common.whyJoin.blurbs': { en: 'Reasons', zh: '加入理由' },
  'common.community': { en: 'Join now', zh: '加入社区' },
  'common.community.tag': { en: 'Small heading', zh: '小标题' },
  'common.contact': { en: 'Contact form', zh: '联系表单' },
  'common.footer': { en: 'Footer', zh: '页脚' },
  'common.footer.aboutText': { en: 'About text', zh: '简介' },
  'common.modals': { en: 'Donation window', zh: '捐赠弹窗' },
  'common.modals.donateTitle': { en: 'Donation window title', zh: '捐赠弹窗标题' },
  'common.modals.donateDesc': { en: 'Donation window text', zh: '捐赠弹窗说明' },
  'about.mission': { en: 'Our mission', zh: '我们的使命' },
  'about.missionTitle': { en: 'Mission heading', zh: '使命标题' },
  'about.missionText': { en: 'Mission text', zh: '使命内容' },
  'about.values': { en: 'Core values', zh: '核心价值观' },
  'about.valuesTitle': { en: 'Values heading', zh: '价值观标题' },
  'about.howWeDoIt': { en: 'How we do it', zh: '实现途径' },
  'about.yearInReview': { en: 'Year in review video', zh: '年度回顾视频' },
  'about.yearInReviewVideoId': { en: 'YouTube video ID', zh: 'YouTube 视频 ID' },
  'about.team': { en: 'Board members', zh: '理事会成员' },
  'about.managementTitle': { en: 'Board heading', zh: '理事会标题' },
  'about.managementSubtitle': { en: 'Board subtitle', zh: '理事会副标题' },
  'about.pastPresidents': { en: 'Past presidents', zh: '历任主席' },
  'events.filters': { en: 'Search and filters', zh: '搜索与筛选' },
  'events.upcoming': { en: 'Upcoming events', zh: '近期活动' },
  'events.past': { en: 'Past events archive', zh: '往期活动档案' },
  'membership.benefits': { en: 'Member benefits', zh: '会员权益' },
  'membership.tiers': { en: 'Plan cards', zh: '会员方案卡片' },
  'membership.notes': { en: 'Notes under the plans', zh: '方案下方说明' },
  'membership.form': { en: 'Sign-up form', zh: '注册表单' },
  'resources.items': { en: 'Resource links', zh: '资源链接' },
  'calendar.calendars': { en: 'Calendars', zh: '日历列表' },
  'business.stats': { en: 'Key numbers', zh: '关键数据' },
  'business.events': { en: 'Business events', zh: '商业活动' },
  'business.sponsorTiers': { en: 'Sponsorship options', zh: '赞助方案' },
};

// Common key names, the same on every page.
const WORDS: Record<string, Bilingual> = {
  _page: { en: 'Headings and text', zh: '标题与文字' },
  title: { en: 'Title', zh: '标题' },
  subtitle: { en: 'Subtitle', zh: '副标题' },
  heading: { en: 'Heading', zh: '标题' },
  description: { en: 'Description', zh: '描述' },
  desc: { en: 'Description', zh: '描述' },
  intro: { en: 'Introduction', zh: '简介' },
  instruction: { en: 'Instruction', zh: '说明' },
  body: { en: 'Text', zh: '正文' },
  name: { en: 'Name', zh: '名称' },
  role: { en: 'Role', zh: '职务' },
  year: { en: 'Year', zh: '年份' },
  url: { en: 'Link', zh: '链接' },
  logo: { en: 'Logo', zh: '标志' },
  category: { en: 'Category', zh: '类别' },
  date: { en: 'Date', zh: '日期' },
  isoDate: { en: 'Date (YYYY-MM-DD)', zh: '日期（年-月-日）' },
  time: { en: 'Time', zh: '时间' },
  location: { en: 'Location', zh: '地点' },
  organizer: { en: 'Organizer', zh: '主办方' },
  recapSummary: { en: 'Recap', zh: '回顾摘要' },
  label: { en: 'Label', zh: '标签' },
  value: { en: 'Value', zh: '数值' },
  price: { en: 'Price', zh: '价格' },
  period: { en: 'Period', zh: '周期' },
  features: { en: 'Lines (one per line)', zh: '条目（每行一条）' },
  email: { en: 'Email', zh: '电子邮箱' },
  rsvpUrl: { en: 'RSVP link', zh: '报名链接' },
};

/** The label for a section (`about.team`) or a field (`about.missionText`). */
export function labelFor(entryId: string, path: string): Bilingual {
  const hit = LABELS[`${entryId}.${path}`];
  if (hit) return hit;
  const segs = path.split('.');
  const last = segs.pop() ?? path;
  const word = WORDS[last] ?? { en: humanize(last), zh: humanize(last) };
  // Below the section, the keys in between tell fields apart (tiers.free.period
  // and tiers.family.period are both "Period").
  const middle = segs.slice(1).map(humanize);
  if (!middle.length) return word;
  return { en: [...middle, word.en].join(' · '), zh: [...middle, word.zh].join(' · ') };
}

// ------------------------------------------------------------------ admin pages

export interface ContentField {
  /** `<entry id>.<path>` — the override key. */
  key: string;
  entryId: string;
  path: string;
  kind: 'text' | 'longtext' | 'image' | 'list';
  /** For lists: what one item looks like (itemShape in siteContentCore.js). */
  shape?: ItemShape;
  /** List item keys the editor leaves alone (SiteContentEntry.fixed). */
  fixedKeys?: string[];
}
export type ItemKey = {
  key: string;
  kind: 'text' | 'longtext' | 'image' | 'lines' | 'keep';
  required: boolean;
  sample: unknown;
};
export type ItemShape =
  { type: 'string'; kind: 'text' | 'longtext' | 'image' } | { type: 'object'; keys: ItemKey[] };

export interface ContentSection {
  id: string;
  label: Bilingual;
  fields: ContentField[];
}

/** One entry of the admin's page picker. content.ts is split over Home and Whole site. */
export interface ContentPage {
  id: string;
  label: Bilingual;
  previewPath: string;
  sections: ContentSection[];
}

function sectionsOf(entry: SiteContentEntry, keep: (top: string) => boolean): ContentSection[] {
  const d = SITE_DEFAULTS[entry.id];
  const fields = (
    walkFields(d.en, d.zh, entry.exclude ?? []) as Omit<ContentField, 'key' | 'entryId'>[]
  ).filter((f) => keep(f.path.split('.')[0]));
  return groupFields(fields, entry.sections ?? {}).map((g) => ({
    id: `${entry.id}.${g.id}`,
    label: labelFor(entry.id, g.id),
    fields: (g.fields as Omit<ContentField, 'key' | 'entryId'>[]).map((f) => ({
      ...f,
      entryId: entry.id,
      key: `${entry.id}.${f.path}`,
      fixedKeys: (entry.fixed ?? [])
        .filter((x) => x.startsWith(`${f.path}.`))
        .map((x) => x.slice(f.path.length + 1)),
    })),
  }));
}

/** The pages the admin tab offers, in menu order, with their fields. */
export function contentPages(): ContentPage[] {
  const common = SITE_CONTENT.find((e) => e.id === 'common');
  const pages: ContentPage[] = [];
  if (common)
    pages.push({
      id: 'home',
      label: { en: 'Home', zh: '首页' },
      previewPath: '/',
      sections: sectionsOf(common, (s) => commonSectionPage(s) === 'home'),
    });
  for (const e of SITE_CONTENT) {
    if (e.id === 'common') continue;
    pages.push({
      id: e.id,
      label: e.label,
      previewPath: e.previewPath,
      sections: sectionsOf(e, () => true),
    });
  }
  if (common)
    pages.push({
      id: 'site',
      label: common.label,
      previewPath: common.previewPath,
      sections: sectionsOf(common, (s) => commonSectionPage(s) === 'site'),
    });
  return pages;
}

/** The preview address for a page in one language. */
export const previewUrl = (path: string, lang: ContentLang) =>
  `${lang === 'zh' ? `/zh${path}` : path}?cms_preview=1`;

// ------------------------------------------------------------------ store

// Overrides change the module objects, which React cannot see; this counter
// is what main.tsx's root wrapper subscribes to so the tree re-renders.
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getVersion = () => version;

/** Re-renders the caller whenever overrides are applied. */
export const useSiteContentVersion = () => useSyncExternalStore(subscribe, getVersion, getVersion);

/** Writes a complete override set into the live objects and re-renders. Never throws. */
export function applyOverrides(overrides: unknown) {
  try {
    applier.apply(isPlainObject(overrides) ? (overrides as OverrideSet) : {});
  } catch {
    // A malformed set must not take the site down; the defaults stay.
    return;
  }
  version += 1;
  for (const fn of listeners) fn();
}

// ------------------------------------------------------------------ boot

const CACHE_KEY = 'caaci-site-content';
const BOOT_WAIT_MS = 800;
const ADMIN_PATH = /^\/(?:zh\/)?admin(?:[-/]|$)/i;

const inPreview = () => {
  try {
    return (
      new URLSearchParams(window.location.search).get('cms_preview') === '1' &&
      window.parent !== window
    );
  } catch {
    return false;
  }
};

/**
 * Before the first render (main.tsx): apply the copy saved in localStorage at
 * once, then fetch /api/site-content and apply that. Resolves when the fetch
 * lands or after 800 ms, whichever is first; a later answer is still applied
 * and re-renders. The admin console is skipped (it reads the defaults and the
 * admin API itself), and so is the wait inside the admin's preview, which
 * sends what to show. Never rejects: under `vite dev` there is no /api.
 */
export function loadSiteContent(): Promise<void> {
  if (typeof window === 'undefined' || ADMIN_PATH.test(window.location.pathname)) {
    return Promise.resolve();
  }
  const preview = inPreview();
  if (preview) startPreviewChannel();
  else {
    try {
      const cached: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (isPlainObject(cached)) applyOverrides(cached);
    } catch {
      // No storage or a broken copy: wait for the fetch.
    }
  }
  const fetched = fetch('/api/site-content', { headers: { accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => {
      const overrides = isPlainObject(body) ? (body as { overrides?: unknown }).overrides : null;
      if (!isPlainObject(overrides)) return;
      // In the preview the admin's set (saved + draft) wins over the public one.
      if (preview) {
        if (!previewDraftSeen) applyOverrides(overrides);
        return;
      }
      applyOverrides(overrides);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(overrides));
      } catch {
        // Storage full or blocked: next visit fetches again.
      }
    })
    .catch(() => {});
  if (preview) return Promise.resolve();
  return Promise.race([fetched, new Promise<void>((r) => setTimeout(r, BOOT_WAIT_MS))]);
}

// ------------------------------------------------------------------ preview

let previewDraftSeen = false;

// The page inside the admin's preview iframe. It takes messages only from its
// own origin (the admin is the same site) and only from the window that framed
// it. Links keep working; a full page load leaves preview mode, an in-app one
// does not (the listener stays).
function startPreviewChannel() {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== window.parent) return;
    const msg: unknown = e.data;
    if (!isPlainObject(msg)) return;
    const { type } = msg as { type?: unknown };
    if (type === 'caaci-cms:draft') {
      const { overrides } = msg as { overrides?: unknown };
      if (!isPlainObject(overrides)) return;
      previewDraftSeen = true;
      applyOverrides(overrides);
    } else if (type === 'caaci-cms:focus') {
      const { text, image } = msg as { text?: unknown; image?: unknown };
      // After the re-render a draft may have caused.
      if (typeof text === 'string') setTimeout(() => focusOn(text, image === true), 60);
    }
  });
  window.parent.postMessage({ type: 'caaci-cms:ready' }, window.location.origin);
}

const visible = (el: Element) => {
  if (!(el instanceof HTMLElement) || !el.getClientRects().length) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
};

function findText(text: string): HTMLElement | null {
  const needle = focusNeedle(text);
  if (!needle) return null;
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  // A text node that holds it: the tightest element there is.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (el && norm(n.nodeValue).includes(needle) && visible(el)) return el;
  }
  // Split over several nodes (a <br>, a filled-in template): the smallest element holding it all.
  let best: HTMLElement | null = null;
  for (const el of document.body.querySelectorAll<HTMLElement>('body *')) {
    const t = norm(el.textContent);
    if (t.includes(needle) && visible(el) && (!best || t.length < norm(best.textContent).length))
      best = el;
  }
  return best;
}

function findImage(src: string): HTMLElement | null {
  const want = src.trim();
  if (!want) return null;
  for (const img of document.querySelectorAll('img')) {
    const at = img.getAttribute('src') || '';
    if ((at === want || img.src === want || img.src.endsWith(want)) && visible(img)) return img;
  }
  for (const el of document.body.querySelectorAll<HTMLElement>('[style*="background"]')) {
    if (el.style.backgroundImage.includes(want) && visible(el)) return el;
  }
  return null;
}

// Scrolls the field's text (or photo) to the middle of the preview and rings
// it for a moment. Inline styles, put back afterwards: the page has no class
// for this and must not get one.
function focusOn(text: string, image: boolean) {
  const el = image ? findImage(text) : findText(text);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  smoothScrollTo(el, { offset: -Math.max(0, (window.innerHeight - rect.height) / 2) });
  const before = { outline: el.style.outline, offset: el.style.outlineOffset };
  el.style.outline = '3px solid var(--color-brick)';
  el.style.outlineOffset = '4px';
  setTimeout(() => {
    el.style.outline = before.outline;
    el.style.outlineOffset = before.offset;
  }, 1500);
}
