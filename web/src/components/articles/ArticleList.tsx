// Small pieces the column directory, the article page and the About page's
// latest-articles strip share, so an article looks the same wherever it is
// listed: the in-app link, the 16:9 cover (or its quiet placeholder) and the
// date · author line.
import type { ReactNode } from 'react';
import { Newspaper } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { fmtArticleDate, type ArticleSummary } from '../../lib/articles';
import { isPlainClick } from '../../lib/articleRoutes';

/**
 * A real link — open in a new tab, copy link address and middle-click all
 * work from `href` — that a plain click turns into an in-app navigation to
 * `to` (an App navigateTo target such as 'article:<slug>').
 */
export function SpaLink({
  href,
  to,
  onNavigate,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  to: string;
  onNavigate: (target: string) => void;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

/**
 * The 16:9 cover of a listed article, or a neutral tile with a newspaper mark
 * when it has none. The image is decorative here (alt=""): the row's link
 * already reads the title, and the cover's own alt text is used on the article
 * page, where the picture stands alone.
 */
export function ArticleCover({
  url,
  className = '',
  eager = false,
}: {
  url: string | null;
  className?: string;
  /** The lead story is above the fold: load it straight away. */
  eager?: boolean;
}) {
  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl bg-surface-3 ${className}`}>
      {url ? (
        <img
          src={url}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Newspaper
          aria-hidden="true"
          className="absolute inset-0 m-auto w-6 h-6 text-neutral-300"
        />
      )}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 pointer-events-none"
      />
    </div>
  );
}

/** "Oct 14, 2026 · Author", either part left out when empty. */
export function ArticleByline({
  lang,
  article,
  className = '',
}: {
  lang: Lang;
  article: Pick<ArticleSummary, 'published_at' | 'author'>;
  className?: string;
}) {
  const date = fmtArticleDate(lang, article.published_at);
  if (!date && !article.author) return null;
  return (
    <p className={`text-xs text-neutral-500 flex flex-wrap gap-x-1.5 ${className}`}>
      {date && <time dateTime={article.published_at ?? undefined}>{date}</time>}
      {date && article.author && <span aria-hidden="true">·</span>}
      {article.author && <span>{article.author}</span>}
    </p>
  );
}
