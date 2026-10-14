// Write or edit one article: the column, the text in English and Chinese
// (either may be empty — the site shows the other language), the body, a 16:9
// cover, the byline, when it goes live, its address, and whether it is pinned.
// Save keeps a draft a draft; Publish makes it public (now, or at the date
// given); Unpublish takes it back to a draft. Unsaved changes are guarded
// (closing the window, leaving the editor, switching tab). The preview is the
// public page drawn from the unsaved form: beside the form on a wide screen,
// behind an Edit / Preview switch on a narrow one.
// POST / PATCH / DELETE /api/admin/articles, docs/content-management.md.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { FluidTabs } from '../../../../components/FluidTabs';
import {
  articleState,
  emptyForm,
  formFromArticle,
  formProblem,
  formToBody,
  sameForm,
  slugify,
  slugInput,
  SUMMARY_SOFT_LIMIT,
  toLocalInput,
  type ArticleForm,
} from '../../../../lib/articleAdmin.js';
import { articleUrl, type ArticleColumn } from '../../../../lib/articles';
import type { Lang } from '../../../../lib/lang';
import {
  Field,
  INPUT,
  InlineConfirm,
  LiquidToggle,
  Notice,
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  SECTION,
  SELECT,
  Spinner,
  Status,
  TEXTAREA,
  useAdmin,
  useWide,
} from '../../kit';
import { ImagePicker } from '../../media/ImagePicker';
import { ArticleBodyEditor } from '../../articles/ArticleBodyEditor';
import { ArticlePreview } from './ArticlePreview';
import { ARTICLES, stateLabel, stateTone, type AdminArticle } from './shared';

export function ArticleEditor({
  id,
  columns,
  allColumns,
  startColumn,
  onClose,
}: {
  /** null = a new article. */
  id: string | null;
  /** The columns this person may write in. */
  columns: ArticleColumn[];
  /** Every column (the preview names the article's column). */
  allColumns: ArticleColumn[];
  /** The column a new article starts in (the list's filter, if any). */
  startColumn: string;
  /** `changed` = something was saved or deleted, so the list should reload. */
  onClose: (changed: boolean) => void;
}) {
  const { t, lang: adminLang, api, toast, setLeaveGuard } = useAdmin();
  const wideScreen = useWide('(min-width: 1280px)');

  const [saved, setSaved] = useState<AdminArticle | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState('');
  const first = emptyForm(startColumn || columns[0]?.id || '');
  const [form, setForm] = useState<ArticleForm>(first);
  const [baseline, setBaseline] = useState<ArticleForm>(first);
  // The address follows the English title until someone edits it (or the
  // article has been saved: a published address should not move by itself).
  const [slugTouched, setSlugTouched] = useState(!!id);
  const [textLang, setTextLang] = useState<Lang>(adminLang);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!id) return;
    let gone = false;
    void api<{ article: AdminArticle }>(`${ARTICLES}?id=${encodeURIComponent(id)}`).then((r) => {
      if (gone) return;
      setLoading(false);
      if (!r.ok || !r.data.article)
        return setLoadError(r.data.error || t('Could not load the article.', '无法加载文章。'));
      const f = formFromArticle(r.data.article as unknown as Record<string, unknown>);
      setSaved(r.data.article);
      setForm(f);
      setBaseline(f);
    });
    return () => {
      gone = true;
    };
    // Once per article: switching the console's language must not reload the
    // saved copy over unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dirty = !sameForm(form, baseline);
  const leaveQuestion = t(
    'You have unsaved changes. Leave without saving?',
    '有尚未保存的修改，确定不保存就离开吗？',
  );

  // Guard the window and the console's tab rail while there is unsaved work.
  useEffect(() => {
    setLeaveGuard(dirty ? leaveQuestion : null);
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, leaveQuestion, setLeaveGuard]);
  useEffect(() => () => setLeaveGuard(null), [setLeaveGuard]);

  const set = <K extends keyof ArticleForm>(k: K, v: ArticleForm[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === 'title_en' && !slugTouched) next.slug = slugify(v as string);
      return next;
    });

  const close = () => {
    if (dirty && !window.confirm(leaveQuestion)) return;
    setLeaveGuard(null);
    onClose(changed);
  };

  const state = saved ? articleState(saved.status, saved.published_at) : 'draft';
  const isLive = state === 'published';
  const column = useMemo(
    () => allColumns.find((c) => c.id === form.column_id) ?? null,
    [allColumns, form.column_id],
  );
  // The article's own column may be one this person cannot pick (an
  // administrator moved it); keep it in the list so the select shows it.
  const choices =
    column && !columns.some((c) => c.id === column.id) ? [column, ...columns] : columns;

  /** `to` = the status to set; undefined keeps it (a new article starts as a draft). */
  const save = async (to?: 'draft' | 'published') => {
    setMsg('');
    const problem = formProblem(form);
    if (problem) return setMsg(t(problem[0], problem[1]));
    const body: Record<string, unknown> = formToBody(form);
    if (to) body.status = to;
    else if (!saved) body.status = 'draft';
    if (to === 'published' && !body.published_at) body.published_at = new Date().toISOString();
    setBusy(true);
    const res = saved
      ? await api<{ article: AdminArticle }>(ARTICLES, {
          method: 'PATCH',
          body: { id: saved.id, ...body },
        })
      : await api<{ article: AdminArticle }>(ARTICLES, { method: 'POST', body });
    setBusy(false);
    if (!res.ok || !res.data.article)
      return setMsg(
        res.status === 403
          ? t('You may not write in this column.', '您没有在此专栏发文的权限。')
          : res.data.error || t('Save failed.', '保存失败。'),
      );
    const a = res.data.article;
    const f = formFromArticle(a as unknown as Record<string, unknown>);
    setSaved(a);
    setForm(f);
    setBaseline(f);
    setSlugTouched(true);
    setChanged(true);
    const now = articleState(a.status, a.published_at);
    toast(
      'success',
      to === 'published'
        ? now === 'scheduled'
          ? t('Scheduled. It goes live at the publish date.', '已定时，将在发布时间上线。')
          : t('Published.', '已发布。')
        : to === 'draft'
          ? t('Unpublished: it is a draft again.', '已取消发布，恢复为草稿。')
          : t('Saved.', '已保存。'),
    );
  };

  const remove = async () => {
    if (!saved) return;
    const res = await api(`${ARTICLES}?id=${encodeURIComponent(saved.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t('Article deleted.', '文章已删除。'));
    setLeaveGuard(null);
    onClose(true);
  };

  if (loading) return <Spinner label={t('Loading…', '加载中…')} />;
  if (loadError)
    return (
      <div className="space-y-4">
        <Notice tone="error">{loadError}</Notice>
        <button type="button" className={SECONDARY} onClick={() => onClose(false)}>
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {t('All articles', '全部文章')}
        </button>
      </div>
    );

  const liveUrl = (l: Lang) => `${window.location.origin}${articleUrl(l, form.slug || '…')}`;
  const summaryKey = textLang === 'zh' ? 'summary_zh' : 'summary_en';
  const summaryLen = form[summaryKey].trim().length;

  const langFields = (l: Lang) => {
    const zh = l === 'zh';
    return (
      <div key={l} className={textLang === l ? 'space-y-5' : 'hidden'}>
        <Field
          label={zh ? t('Title (Chinese)', '标题（中文）') : t('Title (English)', '标题（英文）')}
        >
          <input
            className={`${INPUT} text-base font-semibold`}
            lang={l}
            value={zh ? form.title_zh : form.title_en}
            onChange={(e) => set(zh ? 'title_zh' : 'title_en', e.target.value)}
          />
        </Field>
        <Field
          label={
            zh ? t('Summary (Chinese)', '摘要（中文）') : t('Summary (English)', '摘要（英文）')
          }
          hint={
            <span className="flex justify-between gap-3">
              <span>
                {t(
                  'One or two sentences, shown under the title and in the column list.',
                  '一两句话，显示在标题下方和专栏列表中。',
                )}
              </span>
              <span
                className={`tabular-nums shrink-0 ${summaryLen > SUMMARY_SOFT_LIMIT ? 'text-amber-800 font-semibold' : ''}`}
              >
                {summaryLen} / {SUMMARY_SOFT_LIMIT}
              </span>
            </span>
          }
        >
          <textarea
            className={TEXTAREA}
            rows={3}
            lang={l}
            value={zh ? form.summary_zh : form.summary_en}
            onChange={(e) => set(zh ? 'summary_zh' : 'summary_en', e.target.value)}
          />
        </Field>
        <div>
          <label
            htmlFor={`article-body-${l}`}
            className="block text-xs font-bold text-neutral-500 mb-2"
          >
            {zh ? t('Article (Chinese)', '正文（中文）') : t('Article (English)', '正文（英文）')}
          </label>
          <ArticleBodyEditor
            id={`article-body-${l}`}
            value={zh ? form.body_zh : form.body_en}
            onChange={(html) => set(zh ? 'body_zh' : 'body_en', html)}
          />
        </div>
      </div>
    );
  };

  const formPane = (
    <div className="space-y-6 min-w-0">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('Column', '专栏')}>
          <select
            className={SELECT}
            value={form.column_id}
            onChange={(e) => set('column_id', e.target.value)}
          >
            {!form.column_id && <option value="">{t('Choose…', '请选择…')}</option>}
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {t(c.name_en || c.name_zh, c.name_zh || c.name_en)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Author', '作者')} hint={t('Shown as the byline.', '显示为署名。')}>
          <input
            className={INPUT}
            value={form.author}
            onChange={(e) => set('author', e.target.value)}
          />
        </Field>
      </div>

      <div className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FluidTabs<Lang>
            id="article-text-lang"
            ariaLabel={t('Language of the text', '文字语言')}
            value={textLang}
            onChange={setTextLang}
            items={[
              { value: 'en', label: <LangLabel name="English" filled={!!form.title_en.trim()} /> },
              { value: 'zh', label: <LangLabel name="中文" filled={!!form.title_zh.trim()} /> },
            ]}
          />
          <p className="text-[11px] text-neutral-500 max-w-sm">
            {t(
              'Write in one language or both. A language left empty shows the other one’s text.',
              '可以只写一种语言，也可以两种都写。留空的语言会显示另一种语言的内容。',
            )}
          </p>
        </div>
        {/* Both languages stay mounted, so switching never loses an editor's text. */}
        {langFields('en')}
        {langFields('zh')}
      </div>

      <div className={SECTION}>
        <ImagePicker
          label={t('Cover picture', '封面图片')}
          value={form.cover_url}
          onChange={(url) => set('cover_url', url)}
          aspect="16:9"
          lockAspect
          hint={t(
            'Shown at the top of the article and in the column list, cropped to 16:9.',
            '显示在文章顶部和专栏列表中，裁成 16:9。',
          )}
        />
        {form.cover_url && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('Describe the cover (English)', '封面说明（英文）')}
              hint={t('For people who cannot see the picture.', '供看不到图片的读者使用。')}
            >
              <input
                className={INPUT}
                value={form.cover_alt_en}
                onChange={(e) => set('cover_alt_en', e.target.value)}
              />
            </Field>
            <Field label={t('Describe the cover (Chinese)', '封面说明（中文）')}>
              <input
                className={INPUT}
                value={form.cover_alt_zh}
                onChange={(e) => set('cover_alt_zh', e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>

      <div className={`${SECTION} grid gap-5 sm:grid-cols-2`}>
        <Field
          label={t('Publish date and time', '发布时间')}
          hint={t(
            'Empty = the moment you press Publish. A future time schedules it.',
            '留空 = 点击“发布”的那一刻。填未来的时间即定时发布。',
          )}
        >
          <input
            type="datetime-local"
            className={INPUT}
            value={form.published_at}
            onChange={(e) => set('published_at', e.target.value)}
          />
        </Field>
        <Field
          label={t('Web address', '网址')}
          hint={
            <span className="block space-y-0.5 break-all">
              {form.slug ? (
                <>
                  <span className="block">{liveUrl('en')}</span>
                  <span className="block">{liveUrl('zh')}</span>
                </>
              ) : (
                t(
                  'Made from the English title; without one, a short code is used.',
                  '根据英文标题生成；没有英文标题时使用一串短代码。',
                )
              )}
            </span>
          }
        >
          <input
            className={`${INPUT} font-mono text-xs`}
            value={form.slug}
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug', slugInput(e.target.value));
            }}
          />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3 text-sm font-semibold text-neutral-700">
          <LiquidToggle
            checked={form.pinned}
            onChange={(v) => set('pinned', v)}
            label={t('Pin to the top of the column', '在专栏中置顶')}
          />
          <span>
            {t('Pin to the top of the column', '在专栏中置顶')}
            <span className="block text-[11px] font-normal text-neutral-500">
              {t('Pinned articles are listed first.', '置顶的文章排在最前面。')}
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  const showPreview = wideScreen || mode === 'preview';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" className={ROW_BTN} onClick={close}>
          <ArrowLeft className="w-4 h-4" aria-hidden />
          {t('All articles', '全部文章')}
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-maroon tracking-tight">
          {saved ? t('Edit article', '编辑文章') : t('New article', '新建文章')}
        </h1>
        <Status tone={stateTone(state)}>
          {stateLabel(t, state)}
          {state === 'scheduled' && saved?.published_at && (
            <span className="text-neutral-500">
              · {toLocalInput(saved.published_at).replace('T', ' ')}
            </span>
          )}
        </Status>
        {dirty && (
          <span className="text-xs text-amber-800">{t('Unsaved changes', '有未保存的修改')}</span>
        )}
        {isLive && saved && (
          <a
            href={articleUrl(adminLang, saved.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className={ROW_BTN}
          >
            {t('View live', '查看页面')}
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </a>
        )}
      </div>

      {!wideScreen && (
        <FluidTabs<'edit' | 'preview'>
          id="article-edit-mode"
          ariaLabel={t('Edit or preview', '编辑或预览')}
          value={mode}
          onChange={setMode}
          items={[
            { value: 'edit', label: t('Edit', '编辑') },
            { value: 'preview', label: t('Preview', '预览') },
          ]}
        />
      )}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-8 xl:items-start">
        {/* Kept mounted while previewing on a phone, so the editors keep their state. */}
        <div className={showPreview && !wideScreen ? 'hidden' : 'min-w-0'}>{formPane}</div>
        {showPreview && (
          <div className="min-w-0 xl:sticky xl:top-24">
            <ArticlePreview form={form} column={column} />
          </div>
        )}
      </div>

      {/* Always within reach, however long the article. */}
      <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-neutral-200/80 space-y-3">
        {msg && <Notice tone="error">{msg}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          {state === 'draft' ? (
            <>
              <button
                type="button"
                className={PRIMARY}
                disabled={busy}
                onClick={() => void save('published')}
              >
                {form.published_at && new Date(form.published_at) > new Date()
                  ? t('Schedule', '定时发布')
                  : t('Publish', '发布')}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy}
                onClick={() => void save()}
              >
                {t('Save draft', '保存草稿')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()}>
                {t('Save changes', '保存修改')}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy}
                onClick={() => void save('draft')}
              >
                {t('Unpublish', '取消发布')}
              </button>
            </>
          )}
          {saved && (
            <span className="ml-auto">
              <InlineConfirm
                label={t('Delete', '删除')}
                keepLabel={t('Keep', '保留')}
                confirmLabel={t('Delete', '删除')}
                doneLabel={t('Deleting…', '即将删除…')}
                undoLabel={t('Undo', '撤销')}
                onCommit={() => void remove()}
              />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LangLabel({ name, filled }: { name: string; filled: boolean }) {
  return (
    <>
      {name}
      <span
        className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-emerald-600' : 'bg-neutral-300'}`}
        aria-hidden
      />
    </>
  );
}
