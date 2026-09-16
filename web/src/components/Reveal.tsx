import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import {
  MOTION,
  inView,
  rise,
  riseFrom,
  riseFromSm,
  shown,
  slideFromLeft,
  slideFromRight,
} from '../lib/motion';

type From = 'up' | 'left' | 'right' | 'fade' | 'up-sm';

const FROM: Record<From, Record<string, number>> = {
  up: riseFrom,
  'up-sm': riseFromSm,
  left: slideFromLeft,
  right: slideFromRight,
  fade: { opacity: 0 },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Direction the block travels from (DESIGN_SYSTEM.md §4.4). */
  from?: From;
  /** Seconds. Prefer `index` for siblings, which caps the wait for long lists. */
  delay?: number;
  /** Position among siblings: each waits MOTION.stagger longer, up to MOTION.staggerMax. */
  index?: number;
  /** `true` animates on mount instead of when scrolled into view (hero content). */
  onMount?: boolean;
  as?: 'div' | 'section' | 'li' | 'article';
}

/**
 * The page-level building block for scroll reveals: wrap a section header, a
 * card or a list item and it fades up once as it enters the viewport, on the
 * shared curve and durations. Reduced motion is handled by MotionConfig in App.
 */
export function Reveal({
  children,
  className,
  from = 'up',
  delay,
  index,
  onMount = false,
  as = 'div',
}: RevealProps) {
  const Tag = motion[as];
  const wait =
    delay ?? (index === undefined ? 0 : Math.min(index * MOTION.stagger, MOTION.staggerMax));
  const visible = onMount ? { animate: shown } : { whileInView: shown, viewport: inView };
  return (
    <Tag className={className} initial={FROM[from]} transition={rise(wait)} {...visible}>
      {children}
    </Tag>
  );
}
