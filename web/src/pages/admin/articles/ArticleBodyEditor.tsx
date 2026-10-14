// The body of an article: Jodit (self-hosted, tabs/news/jodit.ts) with only
// what the fixed article format has — paragraphs, two heading levels, quotes,
// bold / italic / underline / strike, lists, links, pictures with captions, a
// rule — plus undo, clear formatting and the HTML source for administrators
// who need it. Pastes are cleaned to that format (articleHtml.ts). The editing
// area wears the public page's .article-body styles, so it reads like the page.
// When Jodit cannot load, a plain HTML box takes its place (as in NewsEditor).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { ImagePlus } from 'lucide-react';
import { canonicalHtml } from '../../../lib/articleAdmin.js';
import { Notice, ROW_BTN, TEXTAREA, useAdmin } from '../kit';
import { ImageEditor, type ImageEditorResult } from '../media/ImageEditor';
import { loadJodit, type JoditEditor } from '../tabs/news/jodit';
import { cleanPastedHtml, figureHtml, prepareBody } from './articleHtml';

// The parts of Jodit's API used here beyond tabs/news/jodit.ts's minimum.
type Editor = JoditEditor & {
  s: { save: () => unknown; restore: () => void; insertHTML: (html: string) => void };
};

const BUTTONS = [
  'undo',
  'redo',
  '|',
  'paragraph',
  '|',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  '|',
  'ul',
  'ol',
  '|',
  'link',
  'articleImage',
  'hr',
  '|',
  'eraser',
  'source',
];

// The admin header (64px) is sticky, and below 1024px so is the tab strip under
// it (61px); the toolbar sticks below them. Jodit drops stickiness on phones.
const stickyOffset = () => (window.matchMedia('(min-width: 1024px)').matches ? 64 : 125);

export function ArticleBodyEditor({
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
  const editor = useRef<Editor | null>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [state, setState] = useState<'loading' | 'jodit' | 'plain'>('loading');
  const [picking, setPicking] = useState(false);
  const token = useRef('');

  // A picture pasted or dropped as a file uploads with the current access token.
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
          buttons: BUTTONS,
          buttonsMD: BUTTONS,
          buttonsSM: BUTTONS,
          buttonsXS: BUTTONS,
          toolbarAdaptive: false,
          toolbarSticky: true,
          toolbarStickyOffset: stickyOffset(),
          height: 'auto',
          minHeight: 420,
          iframe: false,
          editorClassName: 'article-body',
          hidePoweredByJodit: true,
          showXPathInStatusbar: false,
          showCharsCounter: false,
          // Pasting never asks; Word and web markup are cleaned, then reduced
          // to the article format in the beforePasteInsert handler below.
          askBeforePasteHTML: false,
          askBeforePasteFromWord: false,
          defaultActionOnPaste: 'insert_clear_html',
          // External links open in a new tab on the public page anyway.
          link: { noFollowCheckbox: false, openInNewTabCheckbox: false },
          // Not cleanHTML.allowTags: Jodit removes a tag outside that list
          // together with its text, so a pasted <div> or <span> would lose its
          // words. Pastes are reduced to the format before they land instead,
          // and every render sanitises again (lib/articles.ts).
          cleanHTML: { replaceOldTags: { i: 'em', b: 'strong', strike: 's' } },
          // A screenshot pasted (or a file dropped) into the text goes to the
          // media library like the event pictures, never into the body as base64.
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
          controls: {
            paragraph: {
              list: Jodit.atom({
                p: t('Paragraph', '正文'),
                h2: t('Heading', '标题'),
                h3: t('Subheading', '小标题'),
                blockquote: t('Quote', '引用'),
              }),
            },
            articleImage: {
              icon: 'image',
              tooltip: t('Insert a picture', '插入图片'),
              exec: () => {
                editor.current?.s.save();
                setPicking(true);
              },
            },
          },
        }) as Editor;
        ed.value = prepareBody(latest.current.value);
        ed.events.on('change', (html: string) => latest.current.onChange(html));
        ed.events.on('beforePasteInsert', (pasted: unknown) =>
          typeof pasted === 'string' ? cleanPastedHtml(pasted) : undefined,
        );
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
    // Made once per mount; the language is fixed at creation, like NewsEditor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Something outside the editor replaced the body (a reset to the saved copy).
  useEffect(() => {
    const ed = editor.current;
    if (ed && canonicalHtml(ed.value) !== canonicalHtml(value)) ed.value = prepareBody(value);
  }, [value]);

  const insertPicture = (r: ImageEditorResult) => {
    setPicking(false);
    const html = figureHtml(r.url, r.alt, r.caption);
    const ed = editor.current;
    if (ed) {
      ed.s.restore();
      // An empty paragraph after the figure, so typing can carry on below it.
      ed.s.insertHTML(`${html}<p><br></p>`);
    } else onChange(`${value}${html}`);
  };
  const cancelPicture = () => {
    setPicking(false);
    editor.current?.s.restore();
  };

  return (
    <div className="space-y-2 min-w-0">
      {state === 'loading' && (
        <p className="text-xs text-neutral-500" role="status">
          {t('Loading the editor…', '正在加载编辑器…')}
        </p>
      )}
      {state === 'plain' && (
        <>
          <Notice tone="warn">
            {t(
              'The rich-text editor could not load, so this is a plain HTML box.',
              '富文本编辑器未能加载，这里暂用纯 HTML 输入框。',
            )}
          </Notice>
          <button type="button" className={ROW_BTN} onClick={() => setPicking(true)}>
            <ImagePlus className="w-4 h-4" aria-hidden />
            {t('Add a picture at the end', '在末尾添加图片')}
          </button>
        </>
      )}
      {/* Visible while Jodit loads (it lays out its frame from this box). */}
      <div className="min-w-0">
        <textarea
          ref={host}
          id={id}
          className={`${TEXTAREA} font-mono text-xs`}
          rows={16}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {picking && (
        <ImageEditor source={null} askText onDone={insertPicture} onCancel={cancelPicture} />
      )}
    </div>
  );
}
