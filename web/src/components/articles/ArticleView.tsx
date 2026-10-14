// One article in the fixed format every column uses: column, title, summary,
// byline and date, a 16:9 cover, then the body. The public article page and
// the admin editor's preview both render this, so what an editor previews is
// what a reader gets.
import type { Lang } from '../../lib/lang';
import {
  columnName,
  fmtArticleDate,
  pick,
  sanitizeArticleHtml,
  type Article,
  type ArticleColumn,
} from '../../lib/articles';

export type ArticleViewData = Pick<
  Article,
  | 'title_en'
  | 'title_zh'
  | 'summary_en'
  | 'summary_zh'
  | 'body_en'
  | 'body_zh'
  | 'cover_url'
  | 'cover_alt_en'
  | 'cover_alt_zh'
  | 'author'
  | 'published_at'
>;

export function ArticleView({
  lang,
  article,
  column,
  onColumn,
}: {
  lang: Lang;
  article: ArticleViewData;
  column?: ArticleColumn | null;
  /** Called when the column name above the title is clicked. */
  onColumn?: () => void;
}) {
  const title = pick(lang, article.title_en, article.title_zh);
  const summary = pick(lang, article.summary_en, article.summary_zh);
  const body = sanitizeArticleHtml(pick(lang, article.body_en, article.body_zh));
  const alt = pick(lang, article.cover_alt_en, article.cover_alt_zh) || title;
  const date = fmtArticleDate(lang, article.published_at);
  const colName = columnName(lang, column);

  return (
    <article className="max-w-3xl mx-auto">
      <header className="space-y-4 pb-6 border-b border-neutral-200/80">
        {colName &&
          (onColumn ? (
            <button
              type="button"
              onClick={onColumn}
              className="text-xs font-semibold text-brick hover:text-brick-hover cursor-pointer"
            >
              {colName}
            </button>
          ) : (
            <span className="text-xs font-semibold text-brick block">{colName}</span>
          ))}
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink leading-tight break-words">
          {title || (lang === 'zh' ? '（无标题）' : '(Untitled)')}
        </h1>
        {summary && (
          <p className="text-base sm:text-lg text-neutral-600 leading-relaxed">{summary}</p>
        )}
        {(article.author || date) && (
          <p className="text-sm text-neutral-500 flex flex-wrap gap-x-2">
            {article.author && (
              <span className="font-medium text-neutral-700">{article.author}</span>
            )}
            {article.author && date && <span aria-hidden>·</span>}
            {date && <time dateTime={article.published_at ?? undefined}>{date}</time>}
          </p>
        )}
      </header>

      {article.cover_url && (
        <figure className="mt-8">
          <img
            src={article.cover_url}
            alt={alt}
            className="w-full aspect-video object-cover rounded-2xl bg-neutral-100"
          />
        </figure>
      )}

      <div
        className="article-body mt-8"
        // Sanitized above to the fixed article tag set (lib/articles.ts).
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </article>
  );
}
