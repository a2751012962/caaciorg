// Copy for the columns under About (专栏): the directory
// (web/src/pages/ColumnsPage.tsx), one article (ArticlePage.tsx) and the
// latest-articles strip (components/articles/LatestArticles.tsx). The articles
// themselves come from /api/articles; only the page's own words live here.
// Templates take values through fill() (lib/text.ts).
export interface ColumnsContent {
  /** The directory's hero heading, also its breadcrumb label. */
  title: string;
  subtitle: string;
  heroImage: string;
  /** The parent crumb: About. */
  crumbAbout: string;
  /** Screen-reader name of a breadcrumb trail. */
  breadcrumbLabel: string;
  /** Screen-reader name of the column tabs. */
  tabsLabel: string;
  allTab: string;
  pinned: string;
  /** The lead story's call to read on. */
  readMore: string;
  loading: string;
  /** No article published anywhere yet. */
  empty: string;
  /** None in the chosen column: {column}. */
  emptyColumn: string;
  error: string;
  retry: string;
  loadMore: string;
  loadingMore: string;
  /** {shown} of {total}, under the list. */
  shownCount: string;

  articleLoading: string;
  articleError: string;
  notFoundTitle: string;
  notFoundBody: string;
  allColumns: string;
  /** {column}: the article's column. */
  backToColumn: string;
  /** Older article in the same column. */
  previous: string;
  /** Newer article in the same column. */
  next: string;
  /** Screen-reader name of the previous / next pair. */
  adjacentLabel: string;
  /** The browser tab while an article is open: {title}. */
  documentTitle: string;

  latestEyebrow: string;
  latestTitle: string;
}

export const columnsDataEN: ColumnsContent = {
  title: 'Columns',
  subtitle:
    'News from the association, stories from our community and the people who make it what it is.',
  heroImage: '/images/about-team.jpg',
  crumbAbout: 'About Us',
  breadcrumbLabel: 'Breadcrumb',
  tabsLabel: 'Choose a column',
  allTab: 'All',
  pinned: 'Pinned',
  readMore: 'Read the article',
  loading: 'Loading articles…',
  empty: 'No articles have been published yet. Please check back soon.',
  emptyColumn: 'Nothing has been published in {column} yet.',
  error: 'We couldn’t load the articles.',
  retry: 'Try again',
  loadMore: 'Load more',
  loadingMore: 'Loading…',
  shownCount: 'Showing {shown} of {total}',

  articleLoading: 'Loading the article…',
  articleError: 'We couldn’t load this article.',
  notFoundTitle: 'Article not found',
  notFoundBody: 'This article may have been moved or taken down, or it is not published yet.',
  allColumns: 'All columns',
  backToColumn: 'Back to {column}',
  previous: 'Previous article',
  next: 'Next article',
  adjacentLabel: 'More from this column',
  documentTitle: '{title} | Chinese American Association of Central Illinois',

  latestEyebrow: 'Columns',
  latestTitle: 'Latest from our columns',
};

export const columnsDataZH: ColumnsContent = {
  title: '专栏',
  subtitle: '协会动态、社区故事，以及身边每一位让华协更好的人。',
  heroImage: '/images/about-team.jpg',
  crumbAbout: '关于我们',
  breadcrumbLabel: '当前位置',
  tabsLabel: '选择专栏',
  allTab: '全部',
  pinned: '置顶',
  readMore: '阅读全文',
  loading: '正在加载文章…',
  empty: '暂时还没有发布的文章，敬请关注。',
  emptyColumn: '「{column}」暂时还没有发布的文章。',
  error: '文章加载失败。',
  retry: '重试',
  loadMore: '加载更多',
  loadingMore: '加载中…',
  shownCount: '已显示 {shown} / {total} 篇',

  articleLoading: '正在加载文章…',
  articleError: '这篇文章加载失败。',
  notFoundTitle: '找不到这篇文章',
  notFoundBody: '这篇文章可能已被移动或撤下，也可能尚未发布。',
  allColumns: '全部专栏',
  backToColumn: '返回「{column}」',
  previous: '上一篇',
  next: '下一篇',
  adjacentLabel: '本专栏更多文章',
  documentTitle: '{title} | 中伊利诺伊华人协会',

  latestEyebrow: '专栏',
  latestTitle: '专栏最新文章',
};
