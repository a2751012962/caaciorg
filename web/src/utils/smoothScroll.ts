import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenisInstance: Lenis | null = null;
type ScrollCallback = (data: { scroll: number; direction: number; velocity: number }) => void;
const scrollListeners = new Set<ScrollCallback>();

export function initSmoothScroll(): Lenis {
  if (typeof window === 'undefined') {
    return null as unknown as Lenis;
  }

  if (lenisInstance) {
    return lenisInstance;
  }

  // Native scrolling when the OS asks for less motion; every helper below
  // already falls back to window.scrollTo when there is no Lenis instance.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return null as unknown as Lenis;
  }

  lenisInstance = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    touchMultiplier: 1.5,
  });

  // Sync Lenis scroll with GSAP ScrollTrigger and broadcast to listeners
  lenisInstance.on('scroll', (e: { scroll: number; direction: number; velocity: number }) => {
    ScrollTrigger.update();
    scrollListeners.forEach((cb) => {
      try {
        cb(e);
      } catch (err) {
        console.error('Scroll callback error:', err);
      }
    });
  });

  // GSAP ticker drives Lenis RAF for perfectly synchronized frame timing
  const tickerCallback = (time: number) => {
    lenisInstance?.raf(time * 1000);
  };

  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  return lenisInstance;
}

export function addSmoothScrollListener(callback: ScrollCallback): () => void {
  scrollListeners.add(callback);
  return () => {
    scrollListeners.delete(callback);
  };
}

export function getLenis(): Lenis | null {
  return lenisInstance;
}

export function destroySmoothScroll(): void {
  if (lenisInstance) {
    lenisInstance.destroy();
    lenisInstance = null;
  }
}

export function scrollToTop(immediate = false): void {
  if (lenisInstance) {
    lenisInstance.scrollTo(0, { immediate });
  } else {
    window.scrollTo({ top: 0, behavior: immediate ? 'auto' : 'smooth' });
  }
  // Refresh ScrollTrigger to recalculate DOM offsets after page changes
  setTimeout(() => {
    ScrollTrigger.refresh();
  }, 100);
}

/**
 * Lenis-powered smooth scroll helper with GSAP precision
 */
export function smoothScrollTo(
  target: string | number | HTMLElement,
  options?: {
    offset?: number;
    duration?: number;
    immediate?: boolean;
    onComplete?: () => void;
  },
) {
  if (lenisInstance) {
    lenisInstance.scrollTo(target, {
      offset: options?.offset ?? 0,
      duration: options?.duration ?? 1.1,
      immediate: options?.immediate ?? false,
      onComplete: options?.onComplete,
    });
  } else if (typeof window !== 'undefined') {
    if (typeof target === 'number') {
      window.scrollTo({ top: target, behavior: 'smooth' });
    } else if (typeof target === 'string') {
      const el = document.getElementById(target.replace('#', '')) || document.querySelector(target);
      if (el) {
        const top = el.getBoundingClientRect().top + window.pageYOffset + (options?.offset ?? 0);
        window.scrollTo({ top, behavior: 'smooth' });
      }
    } else if (target instanceof HTMLElement) {
      const top = target.getBoundingClientRect().top + window.pageYOffset + (options?.offset ?? 0);
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }
}
