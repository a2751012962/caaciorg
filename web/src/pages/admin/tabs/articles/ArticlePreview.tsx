// The article as a reader will see it, redrawn from the unsaved form. It is the
// public page's own ArticleView inside the page's own container, rendered into
// an iframe that carries the site's stylesheets: the frame is as wide as a
// desktop window (scaled down to fit) or a 375 px phone, so the page's
// breakpoints answer to the frame, not to the admin's window.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FluidTabs } from '../../../../components/FluidTabs';
import { ArticleView } from '../../../../components/articles/ArticleView';
import { fromLocalInput, type ArticleForm } from '../../../../lib/articleAdmin.js';
import type { ArticleColumn } from '../../../../lib/articles';
import type { Lang } from '../../../../lib/lang';
import { LABEL, useAdmin } from '../../kit';

type Layout = 'desktop' | 'phone';
const WIDTH: Record<Layout, number> = { desktop: 1280, phone: 375 };

export function ArticlePreview({
  form,
  column,
}: {
  form: ArticleForm;
  column: ArticleColumn | null;
}) {
  const { t, lang: adminLang } = useAdmin();
  const [lang, setLang] = useState<Lang>(adminLang);
  const [layout, setLayout] = useState<Layout>('desktop');
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [height, setHeight] = useState(800);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const width = WIDTH[layout];
  const scale = avail ? Math.min(1, avail / width) : 1;

  // A draft shows the date it would get if it were published now.
  const article = {
    ...form,
    cover_url: form.cover_url.trim() || null,
    published_at: fromLocalInput(form.published_at) ?? new Date().toISOString(),
  };

  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${LABEL} mb-0`}>{t('Preview', '预览')}</span>
        <div className="flex flex-wrap gap-2">
          <FluidTabs<Lang>
            id="article-preview-lang"
            role="group"
            ariaLabel={t('Preview language', '预览语言')}
            value={lang}
            onChange={setLang}
            items={[
              { value: 'en', label: 'EN' },
              { value: 'zh', label: '中文' },
            ]}
          />
          <FluidTabs<Layout>
            id="article-preview-layout"
            role="group"
            ariaLabel={t('Preview width', '预览宽度')}
            value={layout}
            onChange={setLayout}
            items={[
              { value: 'desktop', label: t('Desktop', '电脑') },
              { value: 'phone', label: t('Phone', '手机') },
            ]}
          />
        </div>
      </div>
      <div ref={box} className="min-w-0">
        <div
          className="mx-auto overflow-hidden rounded-xl border border-neutral-200/80 bg-white"
          style={{ width: width * scale, height: height * scale }}
        >
          <Frame
            width={width}
            height={height}
            scale={scale}
            lang={lang}
            title={t('Article preview', '文章预览')}
            onHeight={setHeight}
          >
            <section className="py-16 md:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <ArticleView lang={lang} article={article} column={column} />
            </section>
          </Frame>
        </div>
      </div>
      <p className="text-[11px] text-neutral-500">
        {t(
          'An empty language shows the other language’s text, as on the site.',
          '某种语言留空时，与网站上一样显示另一种语言的内容。',
        )}
      </p>
    </div>
  );
}

// An iframe whose body React renders into (a portal), with the admin page's
// stylesheets copied in so Tailwind and .article-body look as on the site.
function Frame({
  width,
  height,
  scale,
  lang,
  title,
  onHeight,
  children,
}: {
  width: number;
  height: number;
  scale: number;
  lang: Lang;
  title: string;
  onHeight: (h: number) => void;
  children: ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const heightCb = useRef(onHeight);
  heightCb.current = onHeight;

  useEffect(() => () => ro.current?.disconnect(), []);
  useEffect(() => {
    if (mount) mount.ownerDocument.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [mount, lang]);

  const onLoad = () => {
    const doc = frame.current?.contentDocument;
    if (!doc || mount) return;
    for (const n of Array.from(document.querySelectorAll('link[rel="stylesheet"], style')))
      doc.head.appendChild(n.cloneNode(true));
    doc.body.className = 'bg-white font-sans text-neutral-800 antialiased';
    doc.body.style.margin = '0';
    // A link in the preview does not navigate the frame away from the preview.
    doc.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('a, button')) e.preventDefault();
    });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const Observer = (doc.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
    ro.current = new (Observer ?? ResizeObserver)(() =>
      heightCb.current(Math.max(200, Math.ceil(root.getBoundingClientRect().height))),
    );
    ro.current.observe(root);
    setMount(root);
  };

  return (
    <>
      <iframe
        ref={frame}
        title={title}
        srcDoc="<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
        onLoad={onLoad}
        className="block border-0 origin-top-left"
        style={{ width, height, transform: `scale(${scale})` }}
      />
      {mount && createPortal(children, mount)}
    </>
  );
}
