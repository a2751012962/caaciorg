// Hand-drawn SVG charts for the Dashboard (no chart library). Colours are theme
// tokens: `currentColor` under a text-* class, or fill-* classes on the shapes.
// Hover (or tap) a slice or a legend row to read it out below the chart; the
// rest dims. The line charts are components/bencho/ScrubChart.tsx.
import { useState } from 'react';

const num = (n: number) => Math.round(n * 100) / 100;

// Slice colours in legend order: the brand first, then the other tokens.
// fill-* for the slice, bg-* for the legend swatch (static strings for Tailwind).
const PALETTE = [
  { fill: 'fill-brick', bg: 'bg-brick' },
  { fill: 'fill-gold', bg: 'bg-gold' },
  { fill: 'fill-rust', bg: 'bg-rust' },
  { fill: 'fill-neutral-400', bg: 'bg-neutral-400' },
  { fill: 'fill-maroon', bg: 'bg-maroon' },
  { fill: 'fill-tan', bg: 'bg-tan' },
  { fill: 'fill-emerald-600', bg: 'bg-emerald-600' },
  { fill: 'fill-sky-600', bg: 'bg-sky-600' },
];

export interface Slice {
  name: string;
  value: number;
  /** e.g. "12%" */
  share: string;
  title: string;
}

/** A pie with its legend; zero slices are skipped, one slice is a disc. */
export function PieChart({
  slices,
  emptyText,
  size = 200,
}: {
  slices: Slice[];
  /** Shown instead of the pie when every slice is zero. */
  emptyText: string;
  size?: number;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const c = size / 2;
  const r = c - 4;
  const pt = (a: number) => [num(c + r * Math.cos(a)), num(c + r * Math.sin(a))];
  let a0 = -Math.PI / 2;
  const paths = slices.map((s, i) => {
    if (s.value <= 0) return null;
    const a1 = a0 + (s.value / total) * 2 * Math.PI;
    let d: string;
    if (s.value === total) {
      d = `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c} ${c + r} A ${r} ${r} 0 1 1 ${c} ${c - r} Z`;
    } else {
      const [x0, y0] = pt(a0);
      const [x1, y1] = pt(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      d = `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    }
    a0 = a1;
    return { d, i };
  });
  const dim = (i: number) => (hot != null && hot !== i ? 'opacity-50' : '');
  const toggle = (i: number) => setHot((h) => (h === i ? null : i));

  return (
    <div className="w-full" onMouseLeave={() => setHot(null)}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center">
        <div className="max-w-[220px] w-full mx-auto">
          {total ? (
            <svg
              viewBox={`0 0 ${size} ${size}`}
              className="w-full h-auto"
              role="img"
              aria-label={slices.map((s) => s.title).join('; ')}
            >
              {paths.map((p) =>
                p ? (
                  <path
                    key={p.i}
                    d={p.d}
                    className={`${PALETTE[p.i % PALETTE.length].fill} stroke-white transition-opacity duration-150 cursor-pointer ${dim(p.i)}`}
                    strokeWidth={1.5}
                    onMouseEnter={() => setHot(p.i)}
                    onClick={() => toggle(p.i)}
                  />
                ) : null,
              )}
            </svg>
          ) : (
            <p className="text-sm text-neutral-500 text-center">{emptyText}</p>
          )}
        </div>
        <ul className="space-y-0.5">
          {slices.map((s, i) => (
            <li key={s.name + i}>
              <button
                type="button"
                className={`w-full min-h-11 px-2 rounded-xl flex items-center justify-between gap-3 text-sm text-left cursor-pointer hover:bg-neutral-100 transition-[opacity,background-color] duration-150 ${dim(i)}`}
                onMouseEnter={() => setHot(i)}
                onFocus={() => setHot(i)}
                onBlur={() => setHot(null)}
                onClick={() => toggle(i)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-3 h-3 rounded-sm shrink-0 ${PALETTE[i % PALETTE.length].bg}`}
                    aria-hidden
                  />
                  <span
                    className={`truncate ${hot === i ? 'font-bold text-ink' : 'text-neutral-700'}`}
                  >
                    {s.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-neutral-700">
                  {s.value} <span className="text-xs text-neutral-500">({s.share})</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="min-h-5 mt-2 text-center text-xs text-neutral-500" aria-live="polite">
        {hot == null ? '' : slices[hot]?.title}
      </p>
    </div>
  );
}
