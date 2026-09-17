// Hand-drawn SVG charts for the Dashboard (no chart library). Colours are theme
// tokens: `currentColor` under a text-* class, or fill-* classes on the shapes.
// Hover (or tap) a month column, a slice or a legend row to read it out below
// the chart; the rest dims.
import { useState } from 'react';

export interface Point {
  label: string;
  value: number;
  /** The sentence the read-out shows for this point. */
  title: string;
}

// The 1-2-5 step at or above v, so the top gridline is a round figure.
const niceCeil = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};
const num = (n: number) => Math.round(n * 100) / 100;

/** One series as a line with an area beneath, three gridlines, a dot and a label per point. */
export function LineChart({
  points,
  fmt,
  idle = '',
  width = 900,
  height = 300,
}: {
  points: Point[];
  fmt: (n: number) => string;
  /** What the read-out says while nothing is hovered. */
  idle?: string;
  width?: number;
  height?: number;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const padL = 60;
  const padR = 20;
  const padT = 16;
  const padB = 28;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const top = niceCeil(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => padL + (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
  const y = (v: number) => padT + h - (v / top) * h;
  const coords = points.map((p, i) => `${num(x(i))},${num(y(p.value))}`).join(' ');
  const area = `${num(x(0))},${num(y(0))} ${coords} ${num(x(points.length - 1))},${num(y(0))}`;
  // Hovering anywhere in a month's column reads that month out, so the small
  // dot need not be hit exactly.
  const half = points.length > 1 ? w / (points.length - 1) / 2 : w / 2;
  const last = points[points.length - 1];
  // On a phone the labels would collide: show every other one when crowded.
  const every = points.length > 8 ? 2 : 1;

  return (
    <div onMouseLeave={() => setHot(null)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={points.map((p) => p.title).join('; ')}
      >
        <g className="text-neutral-400">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={padL}
                x2={width - padR}
                y1={num(y(f * top))}
                y2={num(y(f * top))}
                stroke="currentColor"
                strokeOpacity={0.35}
              />
              <text
                x={padL - 8}
                y={num(y(f * top) + 4)}
                textAnchor="end"
                fontSize={13}
                fill="currentColor"
              >
                {fmt(f * top)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 || i === points.length - 1 ? (
              <text
                key={p.label + i}
                x={num(x(i))}
                y={height - 6}
                textAnchor="middle"
                fontSize={13}
                fill="currentColor"
                className={hot === i ? 'text-ink font-semibold' : ''}
              >
                {p.label}
              </text>
            ) : null,
          )}
        </g>
        <g className="text-brick">
          <polygon points={area} fill="currentColor" fillOpacity={0.08} />
          <polyline
            points={coords}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={num(x(i))}
              cy={num(y(p.value))}
              r={hot === i ? 6 : 4}
              fill="currentColor"
              className="transition-[r] duration-150"
            />
          ))}
          {last && (
            <text
              x={num(x(points.length - 1))}
              y={num(y(last.value) - 12)}
              textAnchor={points.length > 1 ? 'end' : 'middle'}
              fontSize={14}
              fontWeight={600}
              fill="currentColor"
            >
              {fmt(last.value)}
            </text>
          )}
          {points.map((p, i) => (
            <rect
              key={`col${i}`}
              x={num(x(i) - half)}
              y={padT}
              width={num(half * 2)}
              height={h}
              fill="currentColor"
              fillOpacity={0}
              onMouseEnter={() => setHot(i)}
              onClick={() => setHot((c) => (c === i ? null : i))}
            />
          ))}
        </g>
      </svg>
      <p className="min-h-5 mt-1 text-center text-xs text-neutral-500" aria-live="polite">
        {hot == null ? idle : points[hot]?.title}
      </p>
    </div>
  );
}

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
