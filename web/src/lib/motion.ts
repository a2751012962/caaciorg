// The site's one motion vocabulary (web/DESIGN_SYSTEM.md §4.4). Every entrance,
// hover and scroll reveal reads its numbers from here, so a change to the feel of
// the site is a change to this file, not a hunt through components.
//
// Three consumers share the same values:
//   - `motion/react` props: rise(), mountIn, listItem(), hoverLift, hoverScale, tap
//   - GSAP scroll reveals: reveal() and revealGroup()
//   - CSS: --ease-out and --duration-* in index.css mirror MOTION.ease / durations
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Transition } from 'motion/react';

gsap.registerPlugin(ScrollTrigger);

export const MOTION = {
  /** Seconds. instant = colour/hover, fast = list items + overlays, base = page
   *  mount, reveal = scroll reveals, slow = hero-sized columns only. */
  duration: { instant: 0.15, fast: 0.25, base: 0.4, reveal: 0.6, slow: 0.9 },
  /** One curve for every entrance: quick start, long soft landing. */
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  easeCss: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** GSAP's closest named curve to `ease`; inOut is for scrubbed sequences. */
  easeGsap: 'power3.out',
  easeGsapInOut: 'power1.inOut',
  /** Pixels an element travels while fading in. */
  rise: 24,
  riseSm: 12,
  slide: 40,
  /** Seconds between siblings, and the most any sibling waits. */
  stagger: 0.08,
  staggerMax: 0.3,
  /** Hover lift in px and press scale. */
  lift: -2,
  hoverScale: 1.02,
  tapScale: 0.98,
  /** ScrollTrigger start line: reveal once the element's top passes 80% of the viewport. */
  revealStart: 'top 80%',
} as const;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ---------------------------------------------------------------- motion/react

const easeOut: Transition = { duration: MOTION.duration.reveal, ease: MOTION.ease };

/** Scroll-reveal or entrance: fades up MOTION.rise px. `delay` in seconds. */
export const rise = (delay = 0): Transition => ({ ...easeOut, delay });
export const riseFrom = { opacity: 0, y: MOTION.rise };
export const riseFromSm = { opacity: 0, y: MOTION.riseSm };
export const slideFromLeft = { opacity: 0, x: -MOTION.slide };
export const slideFromRight = { opacity: 0, x: MOTION.slide };
export const shown = { opacity: 1, y: 0, x: 0 };
export const inView = { once: true, margin: '-30px' } as const;

/** A page or panel mounting: short, small rise. */
export const mountIn: Transition = { duration: MOTION.duration.base, ease: MOTION.ease };

/** The n-th item of a list, delay capped so long lists never feel slow. */
export const listItem = (index: number): Transition => ({
  duration: MOTION.duration.fast,
  ease: MOTION.ease,
  delay: Math.min(index * MOTION.stagger, MOTION.staggerMax),
});
export const listExit = { opacity: 0, scale: 0.98 };

export const hoverLift = { y: MOTION.lift, transition: { duration: MOTION.duration.instant } };
export const hoverScale = {
  scale: MOTION.hoverScale,
  transition: { duration: MOTION.duration.instant },
};
export const tap = { scale: MOTION.tapScale };

/** The pill that slides between fluid tabs (components/FluidTabs.tsx): a firm
 *  spring so it lands in about a quarter second with no visible bounce. */
export const fluidTab: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 };

/** Overlay + panel for dialogs. */
export const overlayIn: Transition = { duration: MOTION.duration.fast };
export const panelFrom = { opacity: 0, scale: 0.96, y: MOTION.riseSm };
export const panelShown = { opacity: 1, scale: 1, y: 0 };
export const panelIn: Transition = { type: 'spring', damping: 26, stiffness: 320 };

// Bencho-style blocks (components/bencho/, after bencho.dev, MIT).
/** InlineConfirm: the button's width is the animation, with a small overshoot. */
export const confirmMorph: Transition = { type: 'spring', stiffness: 520, damping: 30, mass: 0.9 };
/** LiquidToggle: where the thumb lands, and the drop chasing it. */
export const liquidLand: Transition = { type: 'spring', stiffness: 220, damping: 18, mass: 0.9 };
export const liquidChase = { stiffness: 300, damping: 22, mass: 1 };

// ------------------------------------------------------------------------ GSAP

type RevealOpts = {
  /** Element whose position starts the reveal; defaults to the target itself. */
  trigger?: Element | null;
  from?: 'up' | 'left' | 'right' | 'fade';
  duration?: number;
  delay?: number;
  stagger?: number;
  start?: string;
};

function fromVars(from: RevealOpts['from']): gsap.TweenVars {
  switch (from) {
    case 'left':
      return { x: -MOTION.slide, opacity: 0 };
    case 'right':
      return { x: MOTION.slide, opacity: 0 };
    case 'fade':
      return { opacity: 0 };
    default:
      return { y: MOTION.rise, opacity: 0 };
  }
}

/**
 * Reveal `targets` once when they scroll into view. Call inside a gsap.context so
 * the caller's ctx.revert() cleans it up. Honors prefers-reduced-motion by
 * leaving the elements exactly as laid out.
 */
export function reveal(targets: gsap.TweenTarget, opts: RevealOpts = {}): gsap.core.Tween | null {
  if (prefersReducedMotion()) return null;
  const trigger =
    opts.trigger ??
    (targets instanceof Element ? targets : (gsap.utils.toArray<Element>(targets)[0] ?? null));
  if (!trigger) return null;
  return gsap.fromTo(targets, fromVars(opts.from), {
    x: 0,
    y: 0,
    opacity: 1,
    duration: opts.duration ?? MOTION.duration.reveal,
    delay: opts.delay ?? 0,
    stagger: opts.stagger ?? 0,
    ease: MOTION.easeGsap,
    clearProps: 'transform',
    scrollTrigger: { trigger, start: opts.start ?? MOTION.revealStart, once: true },
  });
}

/** A parent's children rising one after another. */
export function revealGroup(
  targets: gsap.TweenTarget,
  opts: Omit<RevealOpts, 'stagger'> & { stagger?: number } = {},
): gsap.core.Tween | null {
  return reveal(targets, { stagger: MOTION.stagger, ...opts });
}
