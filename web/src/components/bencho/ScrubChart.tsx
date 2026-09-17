// ScrubChart: the balance chart out of bencho.dev's "Pull to refresh" block
// (MIT, © 2026 Lorenzo Cabra, bencho.dev/licence) — the line you can put a
// finger on, with the figures above it read off the same array. The pull, the
// goo and the loading wheel stayed on the wall; this is the chart alone, and
// it is not in a card: the figures, a smooth line and a ring at the reading,
// on the page itself.
import { useRef, useState } from 'react';
import { clamp, stillness, useSpring } from './spring';

export interface ScrubPoint {
  label: string;
  value: number;
  /** The sentence the SVG reads out for this point (aria-label). */
  title: string;
}

const num = (n: number) => Math.round(n * 100) / 100;

/* Tracking the finger is instant, because it IS the finger.
   The spring is only ever the journey home — elasticity is
   feedback, never latency. */
const HOME = 58;

/* The line is a Catmull-Rom spline through the readings, written
   as cubic Béziers: c1 = p1 + (p2 − p0)/6, c2 = p2 − (p3 − p1)/6.
   Smooth, and it still passes through every point, so the ring
   at a reading sits on the line. The x step is uniform, so the
   same formula serves x and y. */
function splinePath(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n === 0) return '';
  if (n === 1) return `M${num(xs[0])},${num(ys[0])}`;
  const at = (i: number) => clamp(i, 0, n - 1);
  let d = `M${num(xs[0])},${num(ys[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, x1, x2, x3] = [xs[at(i - 1)], xs[i], xs[i + 1], xs[at(i + 2)]];
    const [y0, y1, y2, y3] = [ys[at(i - 1)], ys[i], ys[i + 1], ys[at(i + 2)]];
    d += ` C${num(x1 + (x2 - x0) / 6)},${num(y1 + (y2 - y0) / 6)} ${num(x2 - (x3 - x1) / 6)},${num(
      y2 - (y3 - y1) / 6,
    )} ${num(x2)},${num(y2)}`;
  }
  return d;
}

/* The spline's own y at a fractional index, for the ring while it travels. */
function splineY(ys: number[], f: number) {
  const n = ys.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0];
  const at = (i: number) => ys[clamp(i, 0, n - 1)];
  const i = Math.min(Math.floor(f), n - 2);
  const t = f - i;
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

// "$1,904.50" → ["$1,904", ".50"]; "175" → ["175", ""]. The cents are set
// smaller and grey: the figure is read at the dollar.
const splitFraction = (s: string): [string, string] => {
  const m = /^(.*?)(\.\d+)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ''];
};

export function ScrubChart({
  points,
  fmt,
  width = 900,
  height = 260,
}: {
  points: ScrubPoint[];
  fmt: (n: number) => string;
  width?: number;
  height?: number;
}) {
  const box = useRef<SVGSVGElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const still = stillness();

  // room for the ring at either end and the labels below
  const padX = 12;
  const padT = 14;
  const padB = 30;
  const w = width - 2 * padX;
  const h = height - padT - padB;
  const last = points.length - 1;
  const series = points.map((p) => p.value);
  const lo = Math.min(...series, 0);
  const hi = Math.max(...series, 1);
  const x = (i: number) => padX + (last > 0 ? (i / last) * w : w / 2);
  const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const xs = points.map((_, i) => x(i));
  const ys = series.map(y);
  // On a phone the labels would collide: show every other one when crowded.
  const every = points.length > 8 ? 2 : 1;

  /* ONE ARRAY IS THE WHOLE TRUTH. The balance is the last
     point, the change is last minus first, the percentage is
     that over the first, and the scrub just moves the index.
     They were three hand-written figures beside a decorative
     line — three things that can disagree with each other and
     with the chart above them. */
  const at = scrub ?? last;
  const value = series[at] ?? 0;
  const change = value - (series[0] ?? 0);
  const pct = series[0] ? Math.round(Math.abs(change / series[0]) * 1000) / 10 : null;
  const [whole, frac] = splitFraction(fmt(value));

  /* The scrub reads a FRACTION of the plot's own box, so it
     needs no zoom correction: both sides of the division are
     screen pixels and the ratio holds at any scale. It snaps to
     a real reading rather than interpolating between two and
     presenting the result as a measurement. */
  const read = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || last < 0) return;
    const r = el.getBoundingClientRect();
    const left = r.left + (padX / width) * r.width;
    const plot = (w / width) * r.width;
    const t = clamp((e.clientX - left) / plot, 0, 1);
    setScrub(Math.round(t * last));
  };
  const home = () => setScrub(null);

  /* The ring is the one thing here with weight: it sits under
     the finger while there is one, and on release it travels
     back along the line to the last point rather than
     reappearing there. The figures snap — they are readings,
     not positions. */
  const markX = useSpring(x(at), HOME, still || scrub != null);
  const markY = last > 0 ? splineY(ys, clamp(((markX - padX) / w) * last, 0, last)) : y(value);

  // the line takes the colour of the whole series' direction, as a balance does
  const overall = (series[last] ?? 0) - (series[0] ?? 0);
  const line =
    overall > 0 ? 'text-emerald-600' : overall < 0 ? 'text-rose-600' : 'text-neutral-400';
  const tone = change > 0 ? 'text-emerald-700' : change < 0 ? 'text-rose-700' : 'text-neutral-500';
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';

  return (
    /* NO MONO. tabular-nums is the only thing the monospaced face
       was providing — same advance for every digit, so nothing
       shifts as the number changes under the pointer — and Inter
       has it. */
    <div className="tabular-nums">
      <div className="px-1">
        <div className="text-3xl sm:text-4xl font-bold tracking-tight text-ink leading-none">
          {whole}
          {frac && <span className="text-xl sm:text-2xl text-neutral-400">{frac}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-sm">
          {points.length > 1 ? (
            <span className={`font-semibold ${tone}`}>
              {sign}
              {fmt(Math.abs(change))}
              {pct != null && <> · {pct}%</>}
            </span>
          ) : null}
          <span className="text-neutral-500">{points[at]?.label}</span>
        </div>
      </div>
      <svg
        ref={box}
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 w-full h-auto touch-pan-y cursor-crosshair select-none"
        role="img"
        aria-label={points.map((p) => p.title).join('; ')}
        /* pointer, not mouse: a finger dragged along the line
           scrubs it the same as a cursor does */
        onPointerDown={read}
        onPointerMove={read}
        onPointerUp={home}
        onPointerCancel={home}
        onPointerLeave={home}
      >
        <g className="text-neutral-400">
          {points.map((p, i) =>
            i % every === 0 || i === last ? (
              <text
                key={p.label + i}
                x={num(x(i))}
                y={height - 8}
                textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
                fontSize={13}
                fill="currentColor"
                className={at === i ? 'text-ink font-semibold' : ''}
              >
                {p.label}
              </text>
            ) : null,
          )}
        </g>
        <g className={line}>
          <path
            d={splinePath(xs, ys)}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {last >= 0 && (
            <circle
              cx={num(markX)}
              cy={num(markY)}
              r={7}
              fill="white"
              stroke="currentColor"
              strokeWidth={3}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
