// /api/articles  (public) — the column directory and the article pages.
//   GET ?column=<slug>&limit=12&offset=0
//       → { columns, rows, total }: every column (sort order), and the
//         published articles, pinned first then newest, without their bodies.
//         No column → all columns' articles; an unknown column → no rows.
//   GET ?slug=<slug>
//       → { article, column, prev, next }: one published article with its
//         body, its column, and the neighbouring published articles of the
//         same column (prev = older, next = newer), or 404 for a draft, a
//         scheduled article or no such slug.
// Published = status 'published' and published_at <= now(). Only ever reads,
// with the service-role key (the tables are server-only, 0040); answers may be
// cached for 30 seconds.
import { json, bad, sb } from './_lib.js';
import {
  SLUG_RE,
  MAX_SLUG,
  SUMMARY_COLS,
  COLUMN_COLS,
  publishedFilter,
  quotedTime,
} from './_content.js';

const CACHE = { 'cache-control': 'public, max-age=30' };
const ARTICLE_COLS = `${SUMMARY_COLS},body_en,body_zh,status,updated_at`;
const MAX_LIMIT = 50;

async function columns(DB) {
  const { rows } = await DB.select('article_columns', {
    columns: COLUMN_COLS,
    order: 'sort_order.asc,name_en.asc',
    limit: 200,
  });
  return rows;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  const DB = sb(env);
  const now = new Date().toISOString();

  try {
    if (url.searchParams.has('slug')) {
      if (!slug || slug.length > MAX_SLUG || !SLUG_RE.test(slug))
        return bad('Article not found.', 404);
      const { rows } = await DB.select('articles', {
        columns: ARTICLE_COLS,
        filters: [`slug=eq.${slug}`, publishedFilter(now)],
        limit: 1,
      });
      const article = rows[0];
      if (!article) return bad('Article not found.', 404);
      const column = await DB.selectOne('article_columns', { id: article.column_id }, COLUMN_COLS);
      // Neighbours in the same column, by date. An article published at the
      // very same instant as this one is neither older nor newer, so skipped.
      const at = quotedTime(article.published_at);
      const near = (cmp, order) =>
        DB.select('articles', {
          columns: SUMMARY_COLS,
          filters: [
            `column_id=eq.${article.column_id}`,
            publishedFilter(now, [`published_at.${cmp}.${at}`]),
          ],
          order,
          limit: 1,
        }).then((r) => r.rows[0] || null);
      const [prev, next] = await Promise.all([
        near('lt', 'published_at.desc'),
        near('gt', 'published_at.asc'),
      ]);
      return json({ article, column, prev, next }, 200, CACHE);
    }

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '12', 10) || 12, 1),
      MAX_LIMIT,
    );
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
    const all = await columns(DB);
    const wanted = (url.searchParams.get('column') || '').trim();
    const filters = [publishedFilter(now)];
    if (wanted) {
      const col = all.find((c) => c.slug === wanted);
      if (!col) return json({ columns: all, rows: [], total: 0 }, 200, CACHE);
      filters.push(`column_id=eq.${col.id}`);
    }
    const { rows, total } = await DB.select('articles', {
      columns: SUMMARY_COLS,
      filters,
      order: 'pinned.desc,published_at.desc,id.asc',
      limit,
      offset,
      count: 'exact',
    });
    return json({ columns: all, rows, total }, 200, CACHE);
  } catch (e) {
    return bad(e.message, 500);
  }
}
