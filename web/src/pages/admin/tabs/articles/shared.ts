// What the Articles tab's pieces share: endpoints, row shapes and the status
// words. Contract: docs/content-management.md.
import type { ArticleColumn, ArticleSummary } from '../../../../lib/articles';
import type { Lang } from '../../../../lib/lang';
import { columnName } from '../../../../lib/articles';

export const ARTICLES = '/api/admin/articles';
export const COLUMNS = '/api/admin/article-columns';
export const EDITORS = '/api/admin/content-editors';
export const LIMIT = 25;

/** A row of GET /api/admin/articles (no bodies) or the full ?id= article. */
export interface AdminArticle extends ArticleSummary {
  status: 'draft' | 'published';
  body_en?: string;
  body_zh?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A row of GET /api/admin/content-editors. */
export interface EditorRow {
  member_id: string;
  full_name: string | null;
  email: string | null;
  all_columns: boolean;
  column_ids: string[];
  can_edit_pages: boolean;
}

export type ArticleState = 'draft' | 'scheduled' | 'published';

export const stateTone = (s: ArticleState) =>
  s === 'published'
    ? ('good' as const)
    : s === 'scheduled'
      ? ('muted' as const)
      : ('warn' as const);

export const stateLabel = (t: (en: string, zh: string) => string, s: ArticleState) =>
  s === 'published'
    ? t('Published', '已发布')
    : s === 'scheduled'
      ? t('Scheduled', '定时发布')
      : t('Draft', '草稿');

/** The column's name in `lang` (falling back to the other), or '—'. */
export const colName = (lang: Lang, cols: ArticleColumn[], id: string) =>
  columnName(
    lang,
    cols.find((c) => c.id === id),
  ) || '—';
