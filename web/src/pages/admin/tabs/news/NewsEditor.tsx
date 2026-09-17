import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { Notice, TEXTAREA, useAdmin } from '../../kit';
import { loadJodit, type JoditEditor } from './jodit';

// The toolbar, fonts and upload settings are the old panel's (initNewsEditor in
// src/caaci-admin.js). Jodit edits inside an iframe sandboxed with
// allow-same-origin but no allow-scripts, and cleans what is set or pasted.
const NEWS_BUTTONS = [
  'undo',
  'redo',
  '|',
  'bold',
  'italic',
  'underline',
  '|',
  'font',
  'fontsize',
  'brush',
  '|',
  'copyformat',
  'eraser',
  '|',
  'paragraph',
  'ul',
  'ol',
  'align',
  '|',
  'link',
  'image',
  '|',
  'source',
];
// Email-safe font stacks, plus the Chinese system fonts members are likely to have.
const NEWS_FONTS = {
  '': 'Default',
  'Arial,Helvetica,sans-serif': 'Arial',
  'Georgia,serif': 'Georgia',
  "'Times New Roman',Times,serif": 'Times New Roman',
  'Verdana,Geneva,sans-serif': 'Verdana',
  "'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif": '微软雅黑 / 苹方',
  "SimSun,'Songti SC',serif": '宋体',
  "KaiTi,'Kaiti SC',serif": '楷体',
};

// An empty Jodit editor still holds "<p><br></p>". Read that as no message, so
// an untouched editor neither blocks a template with "Replace…?" nor passes as a
// message body.
const NEWS_EMPTY = /^(?:\s|&nbsp;|<br\s*\/?>|<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)*$/i;
export const cleanHtml = (html: string) => (NEWS_EMPTY.test(html) ? '' : html);

/**
 * The message box. `value` / `onChange` carry the HTML; while Jodit loads, or
 * if it cannot, a plain HTML textarea is the editor.
 */
export function NewsEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
}) {
  const { t, lang } = useAdmin();
  const host = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<JoditEditor | null>(null);
  const token = useRef('');
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [state, setState] = useState<'loading' | 'jodit' | 'plain'>('loading');

  // The upload header needs the current access token; keep it fresh.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      token.current = data.session?.access_token ?? '';
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      token.current = s?.access_token ?? '';
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let gone = false;
    void loadJodit().then((Jodit) => {
      if (gone) return;
      if (!Jodit || !host.current) return setState('plain');
      try {
        const ed = Jodit.make(host.current, {
          language: lang === 'zh' ? 'zh_cn' : 'en',
          buttons: NEWS_BUTTONS,
          toolbarAdaptive: false,
          height: 520,
          iframe: true,
          iframeSandbox: 'allow-same-origin',
          askBeforePasteHTML: false,
          askBeforePasteFromWord: false,
          defaultActionOnPaste: 'insert_as_html',
          hidePoweredByJodit: true,
          // Jodit's default frame style stretches every table to the full width
          // and draws cell borders, so a template's button showed as a wide,
          // boxed bar the email does not have. Keep the rest of that style.
          // Then the frame's body is the width of the email (the templates are
          // 600px, functions/api/_event-emails.js), set on the left as a mail
          // client shows it — not a 600px column floating in a 1200px frame.
          iframeStyle:
            String(Jodit.defaultOptions?.iframeStyle || '').replace(
              /table\{[^}]*\}th,td\{[^}]*\}/,
              '',
            ) +
            'body{max-width:600px;margin:0;padding:20px 24px;box-sizing:content-box}' +
            'body table[width="100%"]{margin-left:0 !important}',
          controls: { font: { list: Jodit.atom(NEWS_FONTS) } },
          uploader: {
            url: '/api/admin/media',
            method: 'PUT',
            format: 'json',
            headers: () => ({ authorization: `Bearer ${token.current}` }),
            filesVariableName: () => 'file',
            imagesExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            insertImageAsBase64URI: false,
            isSuccess: (resp: { ok?: boolean }) => resp.ok === true,
            getMessage: (resp: { error?: string }) => resp.error || '',
            process: (resp: { file?: { url: string } }) => ({
              files: resp.file ? [resp.file.url] : [],
              isImages: [true],
              baseurl: '',
              messages: [],
            }),
          },
        });
        ed.value = latest.current.value;
        ed.events.on('change', (html: string) => latest.current.onChange(html));
        editor.current = ed;
        setState('jodit');
      } catch {
        setState('plain');
      }
    });
    return () => {
      gone = true;
      editor.current?.destruct();
      editor.current = null;
    };
    // Made once per mount, like the old panel (language is fixed at creation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A template (or anything else outside the editor) replaced the message.
  useEffect(() => {
    const ed = editor.current;
    if (ed && cleanHtml(ed.value) !== cleanHtml(value)) ed.value = value;
  }, [value]);

  return (
    <div className="space-y-2 min-w-0">
      {state === 'loading' && (
        <p className="text-xs text-neutral-500" role="status">
          {t('Loading the editor…', '正在加载编辑器…')}
        </p>
      )}
      {state === 'plain' && (
        <Notice tone="warn">
          {t(
            'The rich-text editor could not load, so this is a plain HTML box.',
            '富文本编辑器未能加载，这里暂用纯 HTML 输入框。',
          )}
        </Notice>
      )}
      {/* Visible while Jodit loads (it lays out its frame from this box). */}
      <div className="min-w-0">
        <textarea
          ref={host}
          id={id}
          className={`${TEXTAREA} font-mono text-xs`}
          rows={14}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
