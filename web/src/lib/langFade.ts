// Fades the page's wording from one language to the other, text by text: every
// element that holds text fades out (120ms), the language commits, and the new
// wording rises into place (opacity 0 → 1 while drifting up 6px, 280ms). Only
// the text animates: images, boxes, layout and the scroll position never move,
// so the page does not jump the way a whole-page cross-fade does.
//
// Browsers without the Web Animations API, and users who ask for reduced
// motion, get the plain state change. React would otherwise commit later, so
// the update is flushed synchronously between the two phases.
import { flushSync } from 'react-dom';

export const LANG_FADE = {
  outMs: 120,
  inMs: 280,
  rise: 6,
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Elements with a text node of their own, on screen or near it. */
export function textElements(root: ParentNode = document.body): HTMLElement[] {
  const out: HTMLElement[] = [];
  // A hidden tab reports a 0px viewport; animate everything rather than nothing.
  const margin = (typeof window !== 'undefined' && window.innerHeight) || Infinity;
  for (const el of root.querySelectorAll<HTMLElement>('body *')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    let hasText = false;
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        hasText = true;
        break;
      }
    }
    if (!hasText) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < -margin || r.top > margin * 2) continue;
    out.push(el);
  }
  return out;
}

export function fadeLang(update: () => void): void {
  if (
    typeof document === 'undefined' ||
    typeof HTMLElement === 'undefined' ||
    typeof HTMLElement.prototype.animate !== 'function' ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  const swap = () => {
    flushSync(update);
    for (const el of textElements()) {
      el.animate(
        [
          { opacity: 0, transform: `translateY(${LANG_FADE.rise}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: LANG_FADE.inMs, easing: LANG_FADE.ease, fill: 'backwards' },
      );
    }
  };
  const outgoing = textElements();
  if (!outgoing.length) {
    swap();
    return;
  }
  const fades = outgoing.map((el) =>
    el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: LANG_FADE.outMs,
      easing: 'ease-out',
      fill: 'forwards',
    }),
  );
  // Once every text is invisible: drop the forwards fills, commit the language
  // and start the rise-in, all before the next paint, so nothing cuts in between.
  Promise.all(fades.map((a) => a.finished.catch(() => undefined))).then(() => {
    for (const a of fades) a.cancel();
    swap();
  });
}
