// Keeping an article body inside the fixed article format while it is edited.
// lib/articles.ts sanitises every render to the same tag set; this cleans what
// enters the editor (a saved body, a paste, a drop) so the stored HTML stays
// tidy too: no fonts, colours, inline styles, classes or stray <div>s.
// Keep ALLOWED_TAGS / ALLOWED_ATTR in step with lib/articles.ts.
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'h2',
  'h3',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'figure',
  'figcaption',
  'img',
  'hr',
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];
const URI = /^(?:https?:|mailto:|tel:|\/(?!\/)|#)/i;

const purify = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: URI,
  });

// DOMPurify lets data: URIs through on <img> whatever ALLOWED_URI_REGEXP says;
// a pasted base64 picture would bloat the stored body, so it goes here.
const dropOddImages = (body: HTMLElement) =>
  body.querySelectorAll('img').forEach((img) => {
    if (!URI.test(img.getAttribute('src') || '') || /^#/.test(img.getAttribute('src') || ''))
      img.remove();
  });

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

/** A saved body made safe to load into the editor. */
export function prepareBody(html: string): string {
  if (!html) return '';
  const doc = parse(html);
  dropOddImages(doc.body);
  return purify(doc.body.innerHTML);
}

// What other tags turn into. Anything else outside the format is unwrapped
// (its text kept) by DOMPurify.
const RENAME: Record<string, string> = {
  H1: 'h2',
  H4: 'h3',
  H5: 'h3',
  H6: 'h3',
  B: 'strong',
  I: 'em',
  STRIKE: 's',
  DEL: 's',
  DIV: 'p',
  SECTION: 'p',
  ARTICLE: 'p',
  HEADER: 'p',
  FOOTER: 'p',
  MAIN: 'p',
  ASIDE: 'p',
  ADDRESS: 'p',
  CENTER: 'p',
  PRE: 'p',
  DT: 'p',
  DD: 'p',
  TD: 'p',
  TH: 'p',
  CAPTION: 'p',
};
const DROP =
  'script,style,meta,link,title,noscript,template,iframe,object,embed,svg,canvas,video,audio,form,input,button,select,textarea';
const BLOCK =
  /^(P|H2|H3|UL|OL|LI|BLOCKQUOTE|FIGURE|HR|TABLE|TBODY|THEAD|TFOOT|TR|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|ADDRESS|CENTER|PRE|DL|DT|DD|TD|TH|CAPTION|H1|H4|H5|H6)$/;

/**
 * Pasted or dropped HTML (a web page, Word, an email) reduced to the article
 * format: headings become the two article levels, layout boxes become
 * paragraphs (or melt away when they hold paragraphs already), every style,
 * class and font goes, and only http(s) / site-relative links and pictures (no pasted base64 images)
 * stay. A short inline paste (a few words) stays inline.
 */
export function cleanPastedHtml(html: string): string {
  const doc = parse(html);
  const body = doc.body;
  body.querySelectorAll(DROP).forEach((n) => n.remove());
  dropOddImages(body);

  // Deepest first, so an outer box sees what its children became.
  for (const el of Array.from(body.querySelectorAll('*')).reverse()) {
    const to = RENAME[el.nodeName];
    if (!to) continue;
    const holdsBlocks = Array.from(el.children).some((c) => BLOCK.test(c.nodeName));
    if (to === 'p' && holdsBlocks) {
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const next = doc.createElement(to);
    next.append(...Array.from(el.childNodes));
    el.replaceWith(next);
  }

  // Loose text beside blocks gets a paragraph of its own.
  const hasBlock = Array.from(body.children).some((c) => BLOCK.test(c.nodeName));
  if (hasBlock) {
    let run: ChildNode[] = [];
    const flush = () => {
      if (run.some((n) => (n.textContent || '').trim() || n.nodeName === 'IMG')) {
        const p = doc.createElement('p');
        run[0].before(p);
        p.append(...run);
      } else run.forEach((n) => n.remove());
      run = [];
    };
    for (const n of Array.from(body.childNodes)) {
      if (n.nodeType === 1 && BLOCK.test(n.nodeName)) flush();
      else run.push(n);
    }
    flush();
  }
  return purify(body.innerHTML);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The markup the article format uses for a picture, with an optional caption. */
export function figureHtml(url: string, alt: string, caption: string): string {
  const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
  return `<figure><img src="${esc(url)}" alt="${esc(alt)}">${cap}</figure>`;
}
