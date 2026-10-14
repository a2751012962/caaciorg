import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '../Reveal';
import { ArticleByline, ArticleCover, SpaLink } from './ArticleList';
import { columnsDataEN, columnsDataZH } from '../../data/pagesContent';
import { fetchArticleList, type ArticleList } from '../../lib/articleApi';
import { articleUrl, columnName, columnsUrl, pick } from '../../lib/articles';
import type { Lang } from '../../lib/lang';

const ROW_LINK =
  'group rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-4';

/**
 * The three newest articles across all columns, for the About page: an
 * eyebrow and heading, the articles (rows on a phone, three across from md)
 * and a link to the directory. Self-contained — it loads its own data — and
 * it renders nothing until there is something to show, so an empty or
 * unreachable /api/articles leaves no gap on the page.
 */
export function LatestArticles({
  lang,
  onNavigate,
}: {
  lang: Lang;
  onNavigate: (page: string) => void;
}) {
  const data = lang === 'en' ? columnsDataEN : columnsDataZH;
  const [list, setList] = useState<ArticleList | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchArticleList({ limit: 3 }).then((answer) => {
      if (alive) setList(answer);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!list || list.rows.length === 0) return null;
  const byId = new Map(list.columns.map((c) => [c.id, c]));

  return (
    <section className="py-16 sm:py-24 bg-white border-b border-neutral-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10 sm:mb-12">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold text-brick block mb-2">
              {data.latestEyebrow}
            </span>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">
              {data.latestTitle}
            </h2>
          </div>
          <SpaLink
            href={columnsUrl(lang)}
            to="columns"
            onNavigate={onNavigate}
            className="group shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brick whitespace-nowrap rounded hover:text-brick-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brick"
          >
            {data.allColumns}
            <ArrowRight
              className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </SpaLink>
        </Reveal>

        <ul className="divide-y divide-neutral-200/80 border-y border-neutral-200/80 md:border-0 md:divide-y-0 md:grid md:grid-cols-3 md:gap-8">
          {list.rows.slice(0, 3).map((row, idx) => {
            const name = columnName(lang, byId.get(row.column_id));
            return (
              <Reveal as="li" key={row.id} index={idx}>
                <SpaLink
                  href={articleUrl(lang, row.slug)}
                  to={`article:${row.slug}`}
                  onNavigate={onNavigate}
                  className={`${ROW_LINK} flex md:flex-col items-start gap-4 py-4 md:py-0`}
                >
                  <ArticleCover url={row.cover_url} className="w-28 md:w-full shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {name && <span className="text-xs font-semibold text-brick block">{name}</span>}
                    <h3 className="text-sm md:text-lg font-semibold tracking-tight text-ink leading-snug break-words line-clamp-3 md:line-clamp-2 group-hover:text-brick transition-colors">
                      {pick(lang, row.title_en, row.title_zh)}
                    </h3>
                    <ArticleByline lang={lang} article={row} />
                  </div>
                </SpaLink>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
