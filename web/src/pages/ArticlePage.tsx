import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { Reveal } from '../components/Reveal';
import { ArticleView } from '../components/articles/ArticleView';
import { SpaLink } from '../components/articles/ArticleList';
import type { CAACIContent } from '../data/content';
import { columnsDataEN, columnsDataZH, type ColumnsContent } from '../data/pagesContent';
import { fetchArticle, type ArticleResult } from '../lib/articleApi';
import { articleSlugFrom } from '../lib/articleRoutes';
import {
  articleUrl,
  columnName,
  columnsUrl,
  pick,
  type ArticleColumn,
  type ArticleSummary,
} from '../lib/articles';
import type { Lang } from '../lib/lang';
import { fill } from '../lib/text';
import { scrollToTop } from '../utils/smoothScroll';

interface ArticlePageProps {
  content: CAACIContent;
  lang: Lang;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// web/DESIGN_SYSTEM.md §5.1, kept on one line.
const PRIMARY =
  'min-h-[44px] px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider whitespace-nowrap shadow-xs transition-all active:scale-98 inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2';
const SECONDARY =
  'min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold whitespace-nowrap transition-colors inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brick';
const TEXT_LINK =
  'rounded hover:text-brick transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brick';

/**
 * /about/articles/<slug>/ (served by the _redirects rewrite to /about/article/,
 * which keeps the slug in the address): one published article in the fixed
 * layout (ArticleView), where it sits under About, and its neighbours in the
 * same column. App keys this page on the address, so each article starts over.
 */
export function ArticlePage({ lang, onNavigate }: ArticlePageProps) {
  const data = lang === 'en' ? columnsDataEN : columnsDataZH;
  const [slug] = useState(() => articleSlugFrom(window.location.pathname));
  const [result, setResult] = useState<ArticleResult | { status: 'loading' }>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setResult({ status: 'loading' });
    void fetchArticle(slug).then((r) => {
      if (alive) setResult(r);
    });
    return () => {
      alive = false;
    };
  }, [slug, attempt]);

  // A new article opens at its top, also when reached with Back or Forward.
  useEffect(() => {
    scrollToTop(true);
  }, []);

  const answer = result.status === 'ok' ? result.answer : null;
  const title = answer
    ? pick(lang, answer.article.title_en, answer.article.title_zh)
    : result.status === 'missing'
      ? data.notFoundTitle
      : '';

  // The browser tab names the article; the site's own title comes back on leaving.
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    if (title) document.title = fill(data.documentTitle, { title });
  }, [title, data.documentTitle]);

  const column = answer?.column ?? null;

  return (
    <div className="bg-white min-h-screen text-ink font-sans antialiased">
      <Crumbs data={data} lang={lang} column={column} onNavigate={onNavigate} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-16 sm:pb-24">
        {result.status === 'loading' ? (
          <Skeleton label={data.articleLoading} />
        ) : result.status === 'error' ? (
          <div
            role="alert"
            className="max-w-3xl mx-auto py-16 text-center text-sm text-neutral-600"
          >
            <AlertCircle className="w-8 h-8 text-neutral-300 mx-auto mb-3" aria-hidden="true" />
            <p>{data.articleError}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2 text-xs font-semibold text-brick hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brick rounded"
            >
              {data.retry}
            </button>
          </div>
        ) : result.status === 'missing' ? (
          <Reveal onMount from="up-sm" className="max-w-3xl mx-auto py-6 sm:py-10 space-y-4">
            <span className="text-xs font-semibold text-brick block">{data.title}</span>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink leading-tight">
              {data.notFoundTitle}
            </h1>
            <p className="text-base text-neutral-600 leading-relaxed">{data.notFoundBody}</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <SpaLink
                href={columnsUrl(lang)}
                to="columns"
                onNavigate={onNavigate}
                className={PRIMARY}
              >
                {data.allColumns}
              </SpaLink>
              <SpaLink
                href={lang === 'zh' ? '/zh/about/' : '/about/'}
                to="about"
                onNavigate={onNavigate}
                className={SECONDARY}
              >
                {data.crumbAbout}
              </SpaLink>
            </div>
          </Reveal>
        ) : (
          <>
            <Reveal onMount from="up-sm">
              <ArticleView
                lang={lang}
                article={result.answer.article}
                column={column}
                onColumn={column ? () => onNavigate(`columns:${column.slug}`) : undefined}
              />
            </Reveal>

            <footer className="max-w-3xl mx-auto mt-12 sm:mt-16 space-y-6">
              <SpaLink
                href={columnsUrl(lang, column?.slug)}
                to={column ? `columns:${column.slug}` : 'columns'}
                onNavigate={onNavigate}
                className={`group inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 ${TEXT_LINK}`}
              >
                <ArrowLeft
                  className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5"
                  aria-hidden="true"
                />
                {column
                  ? fill(data.backToColumn, { column: columnName(lang, column) })
                  : data.allColumns}
              </SpaLink>

              {(result.answer.prev || result.answer.next) && (
                <nav
                  aria-label={data.adjacentLabel}
                  className="grid grid-cols-1 sm:grid-cols-2 border-y border-neutral-200/80 divide-y sm:divide-y-0 sm:divide-x divide-neutral-200/80"
                >
                  {result.answer.prev ? (
                    <Neighbour
                      lang={lang}
                      row={result.answer.prev}
                      label={data.previous}
                      side="prev"
                      onNavigate={onNavigate}
                    />
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                  {result.answer.next && (
                    <Neighbour
                      lang={lang}
                      row={result.answer.next}
                      label={data.next}
                      side="next"
                      onNavigate={onNavigate}
                    />
                  )}
                </nav>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** 关于我们 › 专栏 › <column>: where the article sits, every step a link. */
function Crumbs({
  data,
  lang,
  column,
  onNavigate,
}: {
  data: ColumnsContent;
  lang: Lang;
  column: ArticleColumn | null;
  onNavigate: (page: string) => void;
}) {
  const sep = (
    <span aria-hidden="true" className="text-neutral-300">
      ›
    </span>
  );
  return (
    <div className="border-b border-neutral-200/80 bg-surface-2">
      <nav
        aria-label={data.breadcrumbLabel}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5"
      >
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-neutral-500">
          <li>
            <SpaLink
              href={lang === 'zh' ? '/zh/about/' : '/about/'}
              to="about"
              onNavigate={onNavigate}
              className={TEXT_LINK}
            >
              {data.crumbAbout}
            </SpaLink>
          </li>
          <li className="flex items-center gap-2">
            {sep}
            <SpaLink
              href={columnsUrl(lang)}
              to="columns"
              onNavigate={onNavigate}
              className={TEXT_LINK}
            >
              {data.title}
            </SpaLink>
          </li>
          {column && (
            <li className="flex items-center gap-2">
              {sep}
              <SpaLink
                href={columnsUrl(lang, column.slug)}
                to={`columns:${column.slug}`}
                onNavigate={onNavigate}
                className={`text-brick ${TEXT_LINK}`}
              >
                {columnName(lang, column)}
              </SpaLink>
            </li>
          )}
        </ol>
      </nav>
    </div>
  );
}

/** One half of the previous / next pair under an article. */
function Neighbour({
  lang,
  row,
  label,
  side,
  onNavigate,
}: {
  lang: Lang;
  row: ArticleSummary;
  label: string;
  side: 'prev' | 'next';
  onNavigate: (page: string) => void;
}) {
  const Arrow = side === 'prev' ? ArrowLeft : ArrowRight;
  return (
    <SpaLink
      href={articleUrl(lang, row.slug)}
      to={`article:${row.slug}`}
      onNavigate={onNavigate}
      className={`group block py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-inset rounded ${
        side === 'prev' ? 'sm:pr-6' : 'sm:pl-6 sm:text-right'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs font-medium text-neutral-500 ${
          side === 'next' ? 'sm:justify-end' : ''
        }`}
      >
        {side === 'prev' && <Arrow className="w-3.5 h-3.5" aria-hidden="true" />}
        {label}
        {side === 'next' && <Arrow className="w-3.5 h-3.5" aria-hidden="true" />}
      </span>
      <span className="mt-1.5 block text-sm sm:text-base font-semibold text-ink leading-snug line-clamp-2 break-words group-hover:text-brick transition-colors">
        {pick(lang, row.title_en, row.title_zh)}
      </span>
    </SpaLink>
  );
}

/** The article's shape in grey while it loads: no spinner, no layout jump. */
function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" className="max-w-3xl mx-auto">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4 pb-6 border-b border-neutral-200/80">
        <div className="h-3 w-24 rounded-full bg-neutral-100" />
        <div className="h-9 w-4/5 rounded-xl bg-neutral-100" />
        <div className="h-4 w-full rounded-full bg-neutral-100" />
        <div className="h-4 w-2/3 rounded-full bg-neutral-100" />
        <div className="h-3 w-40 rounded-full bg-neutral-100" />
      </div>
      <div aria-hidden="true" className="mt-8 aspect-video rounded-2xl bg-neutral-100" />
    </div>
  );
}
