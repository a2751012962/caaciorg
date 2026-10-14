// The public reads of /api/articles (docs/content-management.md, "API"), in
// the shapes the column directory, the article page and the About page's
// latest-articles strip use. Answers are read defensively: a field missing
// from a reply becomes an empty list or null rather than a crash.
import { api } from './api';
import type { Article, ArticleColumn, ArticleSummary } from './articles';

/** Rows per request on the directory; "Load more" asks for the next this many. */
export const ARTICLES_PAGE_SIZE = 12;

export interface ArticleList {
  columns: ArticleColumn[];
  rows: ArticleSummary[];
  total: number;
}

export interface ArticleAnswer {
  article: Article;
  column: ArticleColumn | null;
  /** Older, same column. */
  prev: ArticleSummary | null;
  /** Newer, same column. */
  next: ArticleSummary | null;
}

/** Published articles, pinned first then newest; null when the call failed. */
export async function fetchArticleList(
  opts: { column?: string; limit?: number; offset?: number } = {},
): Promise<ArticleList | null> {
  const q = new URLSearchParams();
  if (opts.column) q.set('column', opts.column);
  q.set('limit', String(opts.limit ?? ARTICLES_PAGE_SIZE));
  q.set('offset', String(opts.offset ?? 0));
  const res = await api<Partial<ArticleList>>(`/api/articles?${q}`);
  if (!res.ok) return null;
  const rows = Array.isArray(res.data.rows) ? res.data.rows : [];
  return {
    columns: Array.isArray(res.data.columns) ? res.data.columns : [],
    rows,
    total: typeof res.data.total === 'number' ? res.data.total : rows.length,
  };
}

export type ArticleResult =
  | { status: 'ok'; answer: ArticleAnswer }
  /** 404: no such article, or a draft / scheduled one. */
  | { status: 'missing' }
  /** Network or server failure: worth a retry. */
  | { status: 'error' };

export async function fetchArticle(slug: string): Promise<ArticleResult> {
  if (!slug) return { status: 'missing' };
  const res = await api<Partial<ArticleAnswer>>(`/api/articles?slug=${encodeURIComponent(slug)}`);
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok || !res.data.article) return { status: 'error' };
  return {
    status: 'ok',
    answer: {
      article: res.data.article,
      column: res.data.column ?? null,
      prev: res.data.prev ?? null,
      next: res.data.next ?? null,
    },
  };
}
