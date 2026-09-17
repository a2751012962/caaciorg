// Liquid toggle, after bencho.dev's block of the same name (MIT, Lorenzo Cabra).
// Two blobs share ONE position: the thumb's x is a motion value (a finger
// writes it, a spring settles it) and the drop is a spring following that
// value, so the pair necks out by exactly how fast the thumb moves. A goo
// filter (blur, then a steep alpha threshold) melts them into one shape.
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { animate, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { liquidChase, liquidLand } from '../../lib/motion';

interface LiquidToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

// Track 56×32, thumb 24, drop 14: all in px so the travel is exact.
const OFF = 4;
const ON = 28;
const THUMB = 24;
const DROP = 14;

export function LiquidToggle({ checked, onChange, label, disabled = false }: LiquidToggleProps) {
  const filterId = `liq-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const x = useMotionValue(checked ? ON : OFF);
  const chase = useSpring(x, liquidChase);
  const dropX = useTransform(chase, (v) => v + (THUMB - DROP) / 2);
  const drag = useRef<{ startX: number; from: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!drag.current) void animate(x, checked ? ON : OFF, liquidLand);
  }, [checked, x]);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, from: x.get(), moved: false };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.moved) x.set(Math.min(ON, Math.max(OFF, d.from + dx)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // A tap flips it; a drag lands on whichever side the thumb was let go nearer.
    const next = d.moved ? x.get() > (ON + OFF) / 2 : !checked;
    void animate(x, next ? ON : OFF, liquidLand);
    if (next !== checked) onChange(next);
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      className={`relative shrink-0 w-14 h-8 rounded-full touch-none cursor-pointer transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brick focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-brick' : 'bg-neutral-300'
      }`}
    >
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="smear" />
            <feColorMatrix
              in="smear"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
            />
          </filter>
        </defs>
      </svg>
      {/* Opaque on purpose: the threshold would erase a translucent fill. */}
      <span className="absolute inset-0" style={{ filter: `url(#${filterId})` }} aria-hidden>
        <motion.span
          className="absolute left-0 rounded-full bg-white"
          style={{ x: dropX, top: (32 - DROP) / 2, width: DROP, height: DROP }}
        />
        <motion.span
          className="absolute left-0 rounded-full bg-white"
          style={{ x, top: (32 - THUMB) / 2, width: THUMB, height: THUMB }}
        />
      </span>
    </button>
  );
}
