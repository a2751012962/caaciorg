import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Loader2, Newspaper, Pin } from 'lucide-react';
import { SubpageHero } from '../components/SubpageHero';
import { FluidTabs } from '../components/FluidTabs';
import { Reveal } from '../components/Reveal';
import { ArticleByline, ArticleCover, SpaLink } from '../components/articles/ArticleList';
import type { CAACIContent } from '../data/content';
import { columnsDataEN, columnsDataZH, type ColumnsContent } from '../data/pagesContent';
import { fetchArticleList, ARTICLES_PAGE_SIZE } from '../lib/articleApi';
import { columnFromSearch, searchWithColumn } from '../lib/articleRoutes';
import {
  articleUrl,
  columnName,
  pick,
  type ArticleColumn,
  type ArticleSummary,
} from '../lib/articles';
import type { Lang } from '../lib/lang';
import { fill } from '../lib/text';

interface ColumnsPageProps {
  content: CAACIContent;
  lang: Lang;
  onOpenModal: (type: 'donate' | 'events' | 'membership' | 'volunteer') => void;
  onNavigate: (page: string) => void;
}

// web/DESIGN_SYSTEM.md §5.1, the light secondary button, kept on one line.
const SECONDARY =
  'min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brick disabled:opacity-70 disabled:cursor-wait';
// A whole row is one link; its focus ring sits just outside the row.
const ROW_LINK =
  'group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-4';

/**
 * /about/columns/ (专栏): every published article, newest first with pinned
 * ones on top, and a tab per column. The chosen column is kept in ?c= so the
 * address can be shared or bookmarked; the list pages with "Load more".
 */
export function ColumnsPage({ content, lang, onOpenModal, onNavigate }: ColumnsPageProps) {
  const data = lang === 'en' ? columnsDataEN : columnsDataZH;
  // '' is "All"; the address decides the first value, the tabs every later one.
  const [column, setColumn] = useState(() => columnFromSearch(window.location.search));
  const [columns, setColumns] = useState<ArticleColumn[]>([]);
  const [rows, setRows] = useState<ArticleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  // Only the latest request may write: a slow answer for the tab the reader
  // just left must not replace the one they are looking at.
  const request = useRef(0);

  // Switch column: the address follows (replaced, not pushed, so Back still
  // leaves the page rather than stepping through every tab clicked).
  const choose = useCallback((next: string) => {
    setColumn(next);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      pathname + searchWithColumn(search, next) + hash,
    );
  }, []);

  const load = useCallback(
    async (col: string, offset: number) => {
      const id = ++request.current;
      if (offset === 0) setStatus('loading');
      else setMore('loading');
      const answer = await fetchArticleList({ column: col, offset });
      if (id !== request.current) return;
      if (!answer) {
        if (offset === 0) setStatus('error');
        else setMore('error');
        return;
      }
      // ?c= naming a column that does not exist (renamed, mistyped): show all.
      if (col && answer.columns.length && !answer.columns.some((c) => c.slug === col)) {
        choose('');
        return;
      }
      setColumns(answer.columns);
      setTotal(answer.total);
      setRows((prev) =>
        offset === 0
          ? answer.rows
          : // An article published between two pages shifts the offsets by one;
            // drop the repeat rather than list it twice.
            [...prev, ...answer.rows.filter((r) => !prev.some((p) => p.id === r.id))],
      );
      setStatus('ready');
      setMore('idle');
    },
    [choose],
  );

  useEffect(() => {
    void load(column, 0);
  }, [column, load]);

  useEffect(() => {
    const previous = document.title;
    document.title = fill(data.documentTitle, { title: data.title });
    return () => {
      document.title = previous;
    };
  }, [data.documentTitle, data.title]);

  const byId = new Map(columns.map((c) => [c.id, c]));
  const current = columns.find((c) => c.slug === column) ?? null;
  const description = current ? pick(lang, current.description_en, current.description_zh) : '';
  const [lead, ...rest] = rows;
  const go = (row: ArticleSummary) => ({
    href: articleUrl(lang, row.slug),
    to: `article:${row.slug}`,
    onNavigate,
  });

  return (
    <div className="bg-white min-h-screen text-ink font-sans antialiased">
      <SubpageHero
        title={data.title}
        subtitle={data.subtitle}
        bgImage={data.heroImage}
        content={content}
        onOpenModal={onOpenModal}
        onNavigate={onNavigate}
        currentPage="columns"
        showActionBanners={false}
        parent={{
          label: data.crumbAbout,
          href: lang === 'zh' ? '/zh/about/' : '/about/',
          page: 'about',
        }}
      />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-10 pb-16 sm:pb-24">
        {/* Column tabs: scroll sideways on a phone rather than wrap. */}
        <div className="min-h-10 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto no-scrollbar">
          {columns.length > 0 && (
            <FluidTabs<string>
              id="columns-filter"
              ariaLabel={data.tabsLabel}
              value={column}
              onChange={choose}
              className="inline-flex items-center w-max"
              items={[
                { value: '', label: data.allTab },
                ...columns.map((c) => ({ value: c.slug, label: columnName(lang, c) })),
              ]}
            />
          )}
        </div>
        {description && (
          <p className="mt-3 text-sm text-neutral-500 leading-relaxed max-w-2xl">{description}</p>
        )}

        <div className="mt-8 sm:mt-10">
          {status === 'loading' ? (
            <StatusBlock role="status" icon={<Loader2 className="w-8 h-8 animate-spin" />}>
              <p>{data.loading}</p>
            </StatusBlock>
          ) : status === 'error' ? (
            <StatusBlock role="alert" icon={<AlertCircle className="w-8 h-8" />}>
              <p>{data.error}</p>
              <button
                type="button"
                onClick={() => void load(column, 0)}
                className="mt-2 text-xs font-semibold text-brick hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brick rounded"
              >
                {data.retry}
              </button>
            </StatusBlock>
          ) : !lead ? (
            <StatusBlock role="status" icon={<Newspaper className="w-8 h-8" />}>
              <p>
                {current
                  ? fill(data.emptyColumn, { column: columnName(lang, current) })
                  : data.empty}
              </p>
              {current && (
                <button
                  type="button"
                  onClick={() => choose('')}
                  className="mt-2 text-xs font-semibold text-brick hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brick rounded"
                >
                  {data.allColumns}
                </button>
              )}
            </StatusBlock>
          ) : (
            <>
              {/* The lead story: the first article (pinned ones come first), larger. */}
              <Reveal from="up-sm">
                <SpaLink
                  {...go(lead)}
                  className={`${ROW_LINK} grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-10 lg:items-center`}
                >
                  <ArticleCover url={lead.cover_url} eager className="lg:col-span-7" />
                  <div className="lg:col-span-5 space-y-3">
                    <RowMeta data={data} lang={lang} row={lead} column={byId.get(lead.column_id)} />
                    <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink leading-snug break-words group-hover:text-brick transition-colors">
                      {pick(lang, lead.title_en, lead.title_zh)}
                    </h2>
                    {pick(lang, lead.summary_en, lead.summary_zh) && (
                      <p className="text-sm sm:text-base text-neutral-600 leading-relaxed line-clamp-3">
                        {pick(lang, lead.summary_en, lead.summary_zh)}
                      </p>
                    )}
                    <ArticleByline lang={lang} article={lead} />
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brick pt-1">
                      {data.readMore}
                      <ArrowRight
                        className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                </SpaLink>
              </Reveal>

              {rest.length > 0 && (
                <ul className="mt-10 sm:mt-14 divide-y divide-neutral-200/80 border-y border-neutral-200/80">
                  {rest.map((row, idx) => {
                    const summary = pick(lang, row.summary_en, row.summary_zh);
                    return (
                      <Reveal as="li" key={row.id} from="up-sm" index={idx % ARTICLES_PAGE_SIZE}>
                        <SpaLink
                          {...go(row)}
                          className={`${ROW_LINK} flex items-start gap-4 sm:gap-6 py-5 sm:py-6`}
                        >
                          <ArticleCover
                            url={row.cover_url}
                            className="w-28 sm:w-48 lg:w-56 shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <RowMeta
                              data={data}
                              lang={lang}
                              row={row}
                              column={byId.get(row.column_id)}
                            />
                            <h2 className="text-sm sm:text-lg font-semibold tracking-tight text-ink leading-snug break-words line-clamp-3 sm:line-clamp-2 group-hover:text-brick transition-colors">
                              {pick(lang, row.title_en, row.title_zh)}
                            </h2>
                            {summary && (
                              <p className="hidden sm:block text-sm text-neutral-600 leading-relaxed line-clamp-2">
                                {summary}
                              </p>
                            )}
                            <ArticleByline lang={lang} article={row} className="pt-0.5" />
                          </div>
                        </SpaLink>
                      </Reveal>
                    );
                  })}
                </ul>
              )}

              {/* Paging: how many are showing, and the next page on request. */}
              <div className="mt-8 flex flex-col items-center gap-3 text-center">
                {total > ARTICLES_PAGE_SIZE && (
                  <p className="text-xs text-neutral-500" aria-live="polite">
                    {fill(data.shownCount, {
                      shown: rows.length,
                      total: Math.max(total, rows.length),
                    })}
                  </p>
                )}
                {rows.length < total && (
                  <button
                    type="button"
                    onClick={() => void load(column, rows.length)}
                    disabled={more === 'loading'}
                    aria-busy={more === 'loading'}
                    className={SECONDARY}
                  >
                    {more === 'loading' && (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    )}
                    {more === 'loading' ? data.loadingMore : data.loadMore}
                  </button>
                )}
                {more === 'error' && (
                  <p role="alert" className="text-xs text-rose-700">
                    {data.error}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Column name in brick, and a pin when the article is pinned. */
function RowMeta({
  data,
  lang,
  row,
  column,
}: {
  data: ColumnsContent;
  lang: Lang;
  row: ArticleSummary;
  column: ArticleColumn | undefined;
}) {
  const name = columnName(lang, column);
  if (!name && !row.pinned) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
      {name && <span className="text-brick">{name}</span>}
      {row.pinned && (
        <span className="inline-flex items-center gap-1 text-neutral-500 font-medium">
          <Pin className="w-3 h-3" aria-hidden="true" />
          {data.pinned}
        </span>
      )}
    </p>
  );
}

/** Loading, empty and error: an icon and a line or two, centred, no box. */
function StatusBlock({
  role,
  icon,
  children,
}: {
  role: 'status' | 'alert';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role={role} className="py-16 sm:py-20 text-center text-sm text-neutral-600">
      <div className="mx-auto mb-3 w-fit text-neutral-300" aria-hidden="true">
        {icon}
      </div>
      {children}
    </div>
  );
}
