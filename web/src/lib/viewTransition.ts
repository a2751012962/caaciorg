// Cross-fades a state change instead of cutting to it. The browser keeps a
// snapshot of the old page on screen while the new one fades in over it
// (::view-transition-old/new(root) in index.css), so text swaps in place with
// no blank frame, no remount and no scroll jump. Used by the language toggle.
//
// Browsers without the View Transitions API, and users who ask for reduced
// motion, get the plain state change. React would otherwise commit after the
// snapshot is taken, so the update is flushed inside the callback.
import { flushSync } from 'react-dom';

type WithViewTransition = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function withViewTransition(update: () => void): void {
  const doc = typeof document !== 'undefined' ? (document as WithViewTransition) : undefined;
  if (!doc?.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}
