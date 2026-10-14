// Columns (专栏) and their articles: the shapes /api/articles and
// /api/admin/articles return, and the helpers both the public pages and the
// admin editor's preview use, so a preview is the page a reader will see.
// Contract: docs/content-management.md.
import DOMPurify from 'dompurify';
import type { Lang } from './lang';

export interface ArticleColumn {
  id: string;
  slug: string;
  name_en: string;
  name_zh: string;
  description_en: string;
  description_zh: string;
  sort_order: number;
}

/** A published article without its body: what the column list shows. */
export interface ArticleSummary {
  id: string;
  slug: string;
  column_id: string;
  title_en: string;
  title_zh: string;
  summary_en: string;
  summary_zh: string;
  cover_url: string | null;
  cover_alt_en: string;
  cover_alt_zh: string;
  author: string;
  published_at: string | null;
  pinned: boolean;
}

export interface Article extends ArticleSummary {
  body_en: string;
  body_zh: string;
  status: 'draft' | 'published';
  updated_at: string | null;
}

/**
 * The text for `lang`, or the other language's when this one is empty: an
 * article written only in Chinese still shows on the English site.
 */
export const pick = (lang: Lang, en: string | null | undefined, zh: string | null | undefined) =>
  (lang === 'zh' ? zh || en : en || zh) || '';

export const columnName = (lang: Lang, c: ArticleColumn | null | undefined) =>
  c ? pick(lang, c.name_en, c.name_zh) : '';

/** /about/columns/ (all columns) or /about/columns/?c=<slug>, with /zh/ for Chinese. */
export const columnsUrl = (lang: Lang, columnSlug?: string) =>
  `${lang === 'zh' ? '/zh' : ''}/about/columns/${columnSlug ? `?c=${encodeURIComponent(columnSlug)}` : ''}`;

/** /about/articles/<slug>/, with /zh/ for Chinese. */
export const articleUrl = (lang: Lang, slug: string) =>
  `${lang === 'zh' ? '/zh' : ''}/about/articles/${encodeURIComponent(slug)}/`;

export const fmtArticleDate = (lang: Lang, iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: lang === 'zh' ? 'long' : 'short',
        day: 'numeric',
      })
    : '';

// The article format is fixed: the body may hold paragraphs, two heading
// levels, lists, quotes, links, images with captions and a horizontal rule —
// nothing that could restyle the page or run code. The admin editor offers
// only these, and every render passes the HTML through here as well, so a
// pasted <style>, an inline colour or an onerror never reaches a reader.
const ALLOWED_TAGS = [
  'p',
  'br',
  'h2',
  'h3',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'figure',
  'figcaption',
  'img',
  'hr',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'width', 'height'];

export function sanitizeArticleHtml(html: string): string {
  if (!html) return '';
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/(?!\/)|#)/i,
  });
  // Links leave the site in a new tab; images load lazily.
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href) && !href.startsWith(window.location.origin)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
  doc.querySelectorAll('img').forEach((img) => {
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  });
  return doc.body.innerHTML;
}
