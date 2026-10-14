import { useEffect, useState } from 'react';
import { ExternalLink, Pencil, Plus, Search as SearchIcon } from 'lucide-react';
import { FluidTabs } from '../../../components/FluidTabs';
import { articleState, writableColumns } from '../../../lib/articleAdmin.js';
import { articleUrl, pick, type ArticleColumn } from '../../../lib/articles';
import {
  DataTable,
  fmtDate,
  INPUT,
  InlineConfirm,
  Loaded,
  Notice,
  Pager,
  PRIMARY,
  ROW_BTN,
  SELECT,
  Status,
  TabHeader,
  useAdmin,
  useLoad,
  useTabParams,
} from '../kit';
import { ArticleEditor } from './articles/ArticleEditor';
import { ColumnsAdmin } from './articles/ColumnsAdmin';
import { EditorsAdmin } from './articles/EditorsAdmin';
import {
  ARTICLES,
  colName,
  COLUMNS,
  LIMIT,
  stateLabel,
  stateTone,
  type AdminArticle,
  type ArticleState,
} from './articles/shared';

type View = 'articles' | 'columns' | 'editors';

// Columns (专栏) and their articles. Everyone who can open this tab writes
// articles in the columns they are allowed; administrators also manage the
// columns and who the content editors are. #articles?article=<id> opens one
// article in the editor. functions/api/admin/articles.js, article-columns.js,
// content-editors.js; docs/content-management.md.
export default function ArticlesTab() {
  const { t, api, role } = useAdmin();
  const params = useTabParams();
  const [view, setView] = useState<View>('articles');
  // null = the list; 'new' = a new article; an id = editing that article.
  const [editing, setEditing] = useState<string | null>(params.article || null);
  const [columnFilter, setColumnFilter] = useState('');
  const [listKey, setListKey] = useState(0);

  const cols = useLoad(() => api<{ rows: ArticleColumn[] }>(COLUMNS), []);
  const allColumns = cols.data?.rows ?? [];
  const mine = writableColumns(allColumns, role);

  const open = (id: string | null) => {
    setEditing(id);
    window.scrollTo({ top: 0 });
  };

  if (editing)
    return (
      <ArticleEditor
        key={editing}
        id={editing === 'new' ? null : editing}
        columns={mine}
        allColumns={allColumns}
        startColumn={columnFilter}
        onClose={(changed) => {
          setEditing(null);
          if (changed) setListKey((k) => k + 1);
          window.scrollTo({ top: 0 });
        }}
      />
    );

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Articles', '专栏文章')}
        description={t(
          'Columns are the sections under About › Columns; every article sits in one column and shares the same layout. Drafts stay here until you publish them.',
          '专栏是“关于我们 › 专栏”下的各个栏目；每篇文章属于一个专栏，版式统一。草稿在发布前只在这里可见。',
        )}
        actions={
          view === 'articles' && (
            <button
              type="button"
              className={PRIMARY}
              disabled={!mine.length}
              onClick={() => open('new')}
            >
              <Plus className="w-4 h-4" aria-hidden />
              {t('New article', '新建文章')}
            </button>
          )
        }
      />

      {role.is_admin && (
        <FluidTabs<View>
          id="articles-view"
          ariaLabel={t('Articles sections', '专栏文章栏目')}
          value={view}
          onChange={setView}
          items={[
            { value: 'articles', label: t('Articles', '文章') },
            { value: 'columns', label: t('Columns', '专栏') },
            { value: 'editors', label: t('Editors', '内容编辑') },
          ]}
        />
      )}

      {cols.error && <Notice tone="error">{cols.error}</Notice>}

      {view === 'articles' && (
        <ArticleList
          key={listKey}
          columns={allColumns}
          mine={mine}
          columnsReady={!!cols.data}
          column={columnFilter}
          onColumn={setColumnFilter}
          onEdit={open}
        />
      )}
      {view === 'columns' && role.is_admin && (
        <ColumnsAdmin columns={allColumns} reload={cols.reload} />
      )}
      {view === 'editors' && role.is_admin && <EditorsAdmin columns={allColumns} />}
    </div>
  );
}

function ArticleList({
  columns,
  mine,
  columnsReady,
  column,
  onColumn,
  onEdit,
}: {
  columns: ArticleColumn[];
  mine: ArticleColumn[];
  columnsReady: boolean;
  column: string;
  onColumn: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const { lang, t, api, toast, role } = useAdmin();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | ArticleState>('');
  const [offset, setOffset] = useState(0);

  // Search waits for a 300 ms pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  // The API knows draft and published; scheduled is published with a future
  // date, so it is asked for as published and told apart here.
  const list = useLoad(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (column) p.set('column_id', column);
    if (status) p.set('status', status === 'draft' ? 'draft' : 'published');
    if (q) p.set('q', q);
    return api<{ rows: AdminArticle[]; total: number }>(`${ARTICLES}?${p}`);
  }, [column, status, q, offset]);
  const now = Date.now();
  const rows = (list.data?.rows ?? []).filter(
    (r) => !status || status === 'draft' || articleState(r.status, r.published_at, now) === status,
  );

  const remove = async (r: AdminArticle) => {
    const res = await api(`${ARTICLES}?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t('Article deleted.', '文章已删除。'));
    await list.reload();
  };

  if (columnsReady && !mine.length)
    return (
      <Notice tone="warn">
        {role.is_admin
          ? t(
              'There are no columns yet. Add one under Columns first.',
              '还没有专栏，请先在“专栏”中添加。',
            )
          : t(
              'You have not been given a column to write in yet. Ask an administrator.',
              '您还没有被分配可写的专栏，请联系管理员。',
            )}
      </Notice>
    );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="relative block sm:col-span-2 lg:col-span-1">
          <span className="sr-only">{t('Search titles', '搜索标题')}</span>
          <SearchIcon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            className={`${INPUT} pl-10`}
            placeholder={t('Search titles', '搜索标题')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </label>
        <select
          className={SELECT}
          value={column}
          aria-label={t('Column', '专栏')}
          onChange={(e) => {
            onColumn(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('All my columns', '我的全部专栏')}</option>
          {mine.map((c) => (
            <option key={c.id} value={c.id}>
              {pick(lang, c.name_en, c.name_zh)}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          value={status}
          aria-label={t('Status', '状态')}
          onChange={(e) => {
            setStatus(e.target.value as '' | ArticleState);
            setOffset(0);
          }}
        >
          <option value="">{t('Any status', '全部状态')}</option>
          <option value="draft">{t('Drafts', '草稿')}</option>
          <option value="published">{t('Published', '已发布')}</option>
          <option value="scheduled">{t('Scheduled', '定时发布')}</option>
        </select>
      </div>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 && offset === 0 : undefined}
        empty={t('No articles here yet.', '这里还没有文章。')}
      >
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'title',
              label: t('Title', '标题'),
              render: (r) => (
                <button
                  type="button"
                  onClick={() => onEdit(r.id)}
                  className="text-left min-w-0 cursor-pointer group"
                >
                  <span className="block font-semibold text-ink break-words group-hover:text-brick">
                    {r.pinned && (
                      <span className="mr-1.5 text-[11px] font-semibold text-brick">
                        {t('Pinned', '置顶')}
                      </span>
                    )}
                    {r.title_zh || r.title_en || t('(Untitled)', '（无标题）')}
                  </span>
                  {r.title_zh && r.title_en && (
                    <span className="block text-xs text-neutral-500 break-words">{r.title_en}</span>
                  )}
                </button>
              ),
            },
            {
              key: 'column',
              label: t('Column', '专栏'),
              render: (r) => colName(lang, columns, r.column_id),
            },
            {
              key: 'status',
              label: t('Status', '状态'),
              render: (r) => {
                const s = articleState(r.status, r.published_at, now);
                return <Status tone={stateTone(s)}>{stateLabel(t, s)}</Status>;
              },
            },
            {
              key: 'date',
              label: t('Date', '日期'),
              className: 'whitespace-nowrap tabular-nums',
              render: (r) => fmtDate(lang, r.published_at || r.updated_at),
            },
            {
              key: 'author',
              label: t('Author', '作者'),
              wideOnly: true,
              render: (r) => r.author || '—',
            },
          ]}
          actions={(r) => (
            <>
              <button type="button" className={ROW_BTN} onClick={() => onEdit(r.id)}>
                <Pencil className="w-3.5 h-3.5" aria-hidden />
                {t('Edit', '编辑')}
              </button>
              {articleState(r.status, r.published_at, now) === 'published' && (
                <a
                  className={ROW_BTN}
                  href={articleUrl(lang, r.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('View', '查看')}
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                </a>
              )}
              <InlineConfirm
                label={t('Delete', '删除')}
                keepLabel={t('Keep', '保留')}
                confirmLabel={t('Delete', '删除')}
                doneLabel={t('Deleting…', '即将删除…')}
                undoLabel={t('Undo', '撤销')}
                onCommit={() => void remove(r)}
              />
            </>
          )}
        />
        <Pager
          offset={offset}
          limit={LIMIT}
          total={list.data?.total ?? 0}
          onPage={(o) => setOffset(o)}
        />
      </Loaded>
    </div>
  );
}
