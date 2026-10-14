// The live preview: the real public page in an iframe (?cms_preview=1), fed
// the saved overrides plus the unsaved draft by postMessage, so what the
// editor types shows on the page as it will look. lib/siteContent.ts is the
// other end. Desktop is a 1280px-wide page scaled down to the column; Phone is
// a 390px-wide frame.
import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { FluidTabs } from '../../../../components/FluidTabs';
import { previewUrl, type ContentLang, type OverrideSet } from '../../../../lib/siteContent';
import { ROW_BTN, useAdmin } from '../../kit';

type Layout = 'desktop' | 'phone';
const WIDTH: Record<Layout, number> = { desktop: 1280, phone: 390 };
const DEBOUNCE_MS = 150;

/** A field asked to be shown: its text in each language (or photo URL); `n` makes each ask new. */
export interface FocusRequest {
  texts: { en: string; zh: string };
  image: boolean;
  n: number;
}

export function PreviewPane({
  path,
  overrides,
  focus,
  className = '',
}: {
  path: string;
  overrides: OverrideSet;
  focus: FocusRequest | null;
  className?: string;
}) {
  const { t, lang: adminLang } = useAdmin();
  const [lang, setLang] = useState<ContentLang>(adminLang === 'zh' ? 'zh' : 'en');
  const [layout, setLayout] = useState<Layout>('desktop');
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const src = previewUrl(path, lang);

  // The latest values, for the message handler and timers.
  const latest = useRef({ overrides, focus, lang });
  latest.current = { overrides, focus, lang };

  const post = (msg: unknown) =>
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  const sendDraft = () => post({ type: 'caaci-cms:draft', overrides: latest.current.overrides });
  const sendFocus = () => {
    const f = latest.current.focus;
    if (f) post({ type: 'caaci-cms:focus', text: f.texts[latest.current.lang], image: f.image });
  };

  // A new address loads a new page, which says when it is listening.
  useEffect(() => setReady(false), [src]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type !== 'caaci-cms:ready') return;
      setReady(true);
      sendDraft();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // the handler reads `latest`, so it never needs replacing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(sendDraft, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, ready]);

  useEffect(() => {
    // Let a pending draft land first, so the text being looked for is on the page.
    if (!ready || !focus) return;
    const id = setTimeout(sendFocus, DEBOUNCE_MS + 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = WIDTH[layout];
  const scale = size.w ? Math.min(1, size.w / width) : 1;

  return (
    <div className={`flex flex-col gap-3 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <FluidTabs<ContentLang>
            id="cms-preview-lang"
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
            id="cms-preview-layout"
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
        <a
          href={src.replace(/\?cms_preview=1$/, '')}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW_BTN}
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          {t('Open the live page', '打开线上页面')}
        </a>
      </div>
      <div
        ref={box}
        className="relative flex-1 min-h-0 overflow-hidden rounded-xl border border-neutral-200/80 bg-surface-3"
      >
        {size.w > 0 && (
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={t('Page preview', '页面预览')}
            onLoad={sendDraft}
            className="absolute top-0 bg-white border-0"
            style={{
              width,
              height: size.h / scale,
              left: Math.max(0, (size.w - width * scale) / 2),
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        )}
      </div>
      <p className="text-[11px] text-neutral-500">
        {t(
          'Unsaved changes show only here. Click a field to find it on the page.',
          '未保存的修改只在此预览中显示。点击字段即可在页面中找到它。',
        )}
      </p>
    </div>
  );
}
