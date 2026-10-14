// Page content (页面内容): the words and photos on the public pages, edited in
// both languages with a live preview beside them. Saved values are overrides
// in public.site_content, written into the pages' data objects when the site
// loads (lib/siteContent.ts); the code's values stay the defaults that "Reset"
// goes back to. functions/api/admin/site-content.js.
import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Search as SearchIcon } from 'lucide-react';
import { FluidTabs } from '../../../components/FluidTabs';
import {
  contentPages,
  defaultOf,
  labelFor,
  type ContentField,
  type ContentPage,
} from '../../../lib/siteContent';
import { normalizeText, textsOf } from '../../../lib/siteContentCore';
import {
  Empty,
  INPUT,
  InlineConfirm,
  Loaded,
  PRIMARY,
  SECONDARY,
  SELECT,
  TabHeader,
  useAdmin,
  useWide,
} from '../kit';
import { FieldEditor, type EditorCtx } from './pages/FieldEditors';
import { PreviewPane, type FocusRequest } from './pages/PreviewPane';
import { useContentDraft } from './pages/useContentDraft';

export default function PagesTab() {
  const { t, lang } = useAdmin();
  const pages = useMemo(contentPages, []);
  const pageOfKey = useMemo(() => {
    const m = new Map<string, ContentPage>();
    for (const p of pages) for (const s of p.sections) for (const f of s.fields) m.set(f.key, p);
    return m;
  }, [pages]);
  const [pageId, setPageId] = useState(pages[0]?.id ?? '');
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const [previewPath, setPreviewPath] = useState(page?.previewPath ?? '/');
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [query, setQuery] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const wide = useWide('(min-width: 1024px)');
  const roomy = useWide();
  const d = useContentDraft();
  const dirty = d.changes.length;

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const pick = (id: string) => {
    setPageId(id);
    const p = pages.find((x) => x.id === id);
    if (p) setPreviewPath(p.previewPath);
  };

  const ctx: EditorCtx = {
    d,
    t,
    lang,
    focus: (key, texts, image) => {
      const p = pageOfKey.get(key);
      if (p) setPreviewPath(p.previewPath);
      setFocus((f) => ({ texts, image, n: (f?.n ?? 0) + 1 }));
    },
  };

  // Search: a field matches by its key, its label, or any text in it (saved,
  // draft or default, either language), on every page.
  const q = normalizeText(query);
  const results = useMemo(() => {
    if (!q) return [];
    const hits = (f: ContentField) => {
      const label = labelFor(f.entryId, f.path);
      const texts = [
        f.key,
        label.en,
        label.zh,
        ...textsOf(d.value(f.key, 'en')),
        ...textsOf(d.value(f.key, 'zh')),
        ...textsOf(defaultOf(f.key, 'en')),
        ...textsOf(defaultOf(f.key, 'zh')),
      ];
      return texts.some((s) => normalizeText(s).includes(q));
    };
    return pages
      .map((p) => ({
        page: p,
        sections: p.sections
          .map((s) => ({ ...s, fields: s.fields.filter(hits) }))
          .filter((s) => s.fields.length),
      }))
      .filter((r) => r.sections.length);
  }, [q, pages, d]);

  const sectionList = (sections: ContentPage['sections']) =>
    sections.map((s) => (
      <section key={s.id} className="pt-6 border-t border-neutral-200/80">
        <h2 className="text-base font-bold text-ink">{s.label[lang]}</h2>
        <div className="divide-y divide-neutral-200/80">
          {s.fields.map((f) => (
            <FieldEditor
              key={f.key}
              field={f}
              ctx={ctx}
              // A list named like its section needs no second heading.
              hideLabel={`${f.entryId}.${f.path}` === s.id}
            />
          ))}
        </div>
      </section>
    ));

  const editor = (
    <div className="min-w-0 space-y-6">
      <label className="relative block">
        <span className="sr-only">{t('Find a field', '查找字段')}</span>
        <SearchIcon
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          className={`${INPUT} pl-10`}
          value={query}
          placeholder={t(
            'Find text on any page, e.g. "mission" or 我们的使命',
            '在所有页面中查找文字，例如 “mission” 或 我们的使命',
          )}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {q ? (
        results.length ? (
          results.map((r) => (
            <div key={r.page.id} className="space-y-2">
              <p className="text-xs font-bold text-brick">{r.page.label[lang]}</p>
              {sectionList(r.sections)}
            </div>
          ))
        ) : (
          <Empty>{t('No field on any page has that text.', '没有页面包含这段文字。')}</Empty>
        )
      ) : (
        <>
          {roomy ? (
            <div className="overflow-x-auto [scrollbar-width:none] -mx-1 px-1">
              <FluidTabs<string>
                id="cms-pages"
                ariaLabel={t('Page', '页面')}
                value={page?.id ?? ''}
                onChange={pick}
                items={pages.map((p) => ({ value: p.id, label: p.label[lang] }))}
                className="inline-flex items-center whitespace-nowrap"
              />
            </div>
          ) : (
            <label className="block">
              <span className="sr-only">{t('Page', '页面')}</span>
              <select
                className={SELECT}
                value={page?.id ?? ''}
                onChange={(e) => pick(e.target.value)}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label[lang]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {page && sectionList(page.sections)}
        </>
      )}
    </div>
  );

  const preview = (className: string) => (
    <PreviewPane path={previewPath} overrides={d.effective} focus={focus} className={className} />
  );

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Page content', '页面内容')}
        description={t(
          'The words and photos on the public pages, in English and Chinese. What you type shows in the preview at once and goes live when you save.',
          '公开页面上的文字和图片（中英文）。输入的内容会立即显示在预览中，保存后正式上线。',
        )}
        actions={
          !wide && (
            <button type="button" className={SECONDARY} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? (
                <EyeOff className="w-4 h-4" aria-hidden />
              ) : (
                <Eye className="w-4 h-4" aria-hidden />
              )}
              {showPreview ? t('Hide preview', '隐藏预览') : t('Preview', '预览')}
            </button>
          )
        }
      />

      <Loaded loading={d.loading} error={d.error} isEmpty={false}>
        {wide ? (
          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0">{editor}</div>
            <div className="w-[46%] shrink-0 sticky top-24 h-[calc(100vh-8rem)]">
              {preview('h-full')}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {showPreview && preview('h-[70vh]')}
            {editor}
          </div>
        )}
      </Loaded>

      {dirty > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-neutral-200/80 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-600 mr-auto">
            {t(`${dirty} unsaved ${dirty === 1 ? 'change' : 'changes'}`, `${dirty} 处修改未保存`)}
          </span>
          <InlineConfirm
            label={t('Discard', '放弃修改')}
            keepLabel={t('Keep', '保留')}
            confirmLabel={t('Discard', '放弃')}
            doneLabel={t('Discarding…', '即将放弃…')}
            undoLabel={t('Undo', '撤销')}
            onCommit={d.discard}
          />
          <button
            type="button"
            className={PRIMARY}
            disabled={d.saving}
            onClick={() => void d.save()}
          >
            {d.saving
              ? t('Saving…', '保存中…')
              : t(`Save changes (${dirty})`, `保存修改（${dirty}）`)}
          </button>
        </div>
      )}
    </div>
  );
}
