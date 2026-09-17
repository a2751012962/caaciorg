// The self-hosted Jodit editor (MIT, xdan/jodit 4.15.1) that the Tabler admin
// page loads with <link href="/assets/jodit.min.css"> and
// <script src="/assets/jodit.min.js"> (build.mjs copies both into /assets/).
// Loaded here at runtime, once, from the same paths — no npm dependency.
// Resolves to window.Jodit, or null when it did not load (not served, e.g. the
// web/ vite dev server, or blocked); the composer then uses a plain HTML box.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface JoditEditor {
  value: string;
  events: { on: (name: string, fn: (...args: any[]) => void) => void };
  destruct: () => void;
}
export interface JoditStatic {
  make: (el: HTMLElement | string, options: Record<string, unknown>) => JoditEditor;
  atom: <T>(v: T) => T;
  defaultOptions?: { iframeStyle?: string };
}

const CSS = '/assets/jodit.min.css';
const JS = '/assets/jodit.min.js';
const TIMEOUT_MS = 15_000;

let loading: Promise<JoditStatic | null> | null = null;

const current = () => (window as unknown as { Jodit?: JoditStatic }).Jodit ?? null;

export function loadJodit(): Promise<JoditStatic | null> {
  if (current()) return Promise.resolve(current());
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS;
      document.head.appendChild(link);
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${JS}"]`);
    const done = () => {
      clearTimeout(timer);
      const J = current();
      // Let a later visit to the tab try again (with a fresh tag) if this one failed.
      if (!J) {
        loading = null;
        script?.remove();
      }
      resolve(J);
    };
    const timer = setTimeout(done, TIMEOUT_MS);
    if (!script) {
      script = document.createElement('script');
      script.src = JS;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', done, { once: true });
  });
  return loading;
}
