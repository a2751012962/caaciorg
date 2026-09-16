import { LayoutGroup, motion } from 'motion/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { fluidTab } from '../lib/motion';

export interface FluidTabItem<V extends string> {
  value: V;
  /** Static content, or a render function that gets whether the tab is active. */
  label: ReactNode | ((active: boolean) => ReactNode);
  ariaLabel?: string;
}

interface FluidTabsProps<V extends string> {
  /** Unique per instance: keys the sliding pill's layout animation. */
  id: string;
  items: FluidTabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** light = white pill on a grey track (filters, toggles); brand = brick pill, white text (page sections). */
  tone?: 'light' | 'brand';
  /** tablist for switching views; group for a setting with a pressed state. */
  role?: 'tablist' | 'group';
  ariaLabel?: string;
  /** Layout of the track. Defaults to an inline row; pass e.g. `grid grid-cols-2` or `flex flex-1`. */
  className?: string;
  /** Extra classes for every tab button, e.g. `flex-1` to share the track's width. */
  itemClassName?: string;
}

const TONE = {
  light: {
    pill: 'bg-white shadow-xs',
    on: 'text-ink',
    off: 'text-neutral-600 hover:text-neutral-900',
  },
  brand: {
    pill: 'bg-brick shadow-sm',
    on: 'text-white',
    off: 'text-neutral-700 hover:text-neutral-900',
  },
} as const;

/**
 * The site's one tab control (DESIGN_SYSTEM.md §5.5): a rounded track with a
 * pill that slides to the chosen tab instead of each tab repainting. Arrow keys
 * move between tabs; Home/End jump to the ends.
 */
export function FluidTabs<V extends string>({
  id,
  items,
  value,
  onChange,
  tone = 'light',
  role = 'tablist',
  ariaLabel,
  className = 'inline-flex items-center',
  itemClassName = '',
}: FluidTabsProps<V>) {
  const t = TONE[tone];

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % items.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].value);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <LayoutGroup id={id}>
      <div
        role={role}
        aria-label={ariaLabel}
        className={`h-10 p-1 rounded-full bg-neutral-100 border border-neutral-200/80 ${className}`}
      >
        {items.map((item, index) => {
          const active = item.value === value;
          const selected =
            role === 'tablist' ? { 'aria-selected': active } : { 'aria-pressed': active };
          return (
            <button
              key={item.value}
              type="button"
              role={role === 'tablist' ? 'tab' : undefined}
              tabIndex={role === 'tablist' ? (active ? 0 : -1) : undefined}
              aria-label={item.ariaLabel}
              onClick={() => onChange(item.value)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`relative h-8 px-4 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brick ${
                active ? t.on : t.off
              } ${itemClassName}`}
              {...selected}
            >
              {active && (
                <motion.span
                  layoutId={`${id}-pill`}
                  transition={fluidTab}
                  className={`absolute inset-0 rounded-full ${t.pill}`}
                  aria-hidden="true"
                />
              )}
              <span className="relative inline-flex items-center gap-[inherit]">
                {typeof item.label === 'function' ? item.label(active) : item.label}
              </span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
