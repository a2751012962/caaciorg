// Drag stepper, after bencho.dev's block of the same name (MIT, Lorenzo Cabra).
// Tap − or + for one step; hold either for a moment and slide sideways to sweep
// across the whole range. The sweep is proportional to the control's width, so
// it feels the same at any size. The number itself stays typeable.
import { useRef, useState, type PointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';

interface DragStepperProps {
  value: number | null;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  label: string;
  hint?: string;
}

const HOLD_MS = 260;

export function DragStepper({
  value,
  onChange,
  min = 1,
  max = 100,
  suffix = '',
  label,
  hint,
}: DragStepperProps) {
  const rail = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; v: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const current = value ?? min;

  const down = (dir: 1 | -1) => (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = {
      x: e.clientX,
      v: current,
      timer: setTimeout(() => setSweeping(true), HOLD_MS),
    };
    e.currentTarget.dataset.dir = String(dir);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press.current || !sweeping) return;
    const width = rail.current?.offsetWidth || 200;
    onChange(clamp(press.current.v + ((e.clientX - press.current.x) / width) * (max - min)));
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!sweeping) onChange(clamp(current + Number(e.currentTarget.dataset.dir))); // it was a tap
    setSweeping(false);
  };

  const fill = value == null ? 0 : ((current - min) / (max - min)) * 100;
  const btn =
    'w-11 h-11 shrink-0 rounded-full inline-flex items-center justify-center text-neutral-700 hover:bg-neutral-200/70 active:bg-neutral-200 touch-none cursor-pointer select-none transition-colors';

  return (
    <div>
      <div
        ref={rail}
        className={`relative flex items-center gap-1 p-1 rounded-full bg-neutral-100 border transition-colors ${
          sweeping ? 'border-brick' : 'border-neutral-200'
        }`}
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 rounded-full bg-brick/10 transition-[width] duration-150"
          style={{ width: `${fill}%` }}
        />
        <button
          type="button"
          aria-label={`− ${label}`}
          className={`relative ${btn}`}
          onPointerDown={down(-1)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <Minus className="w-4 h-4" aria-hidden />
        </button>
        <label className="relative flex-1 flex items-baseline justify-center gap-0.5">
          <span className="sr-only">{label}</span>
          <input
            type="text"
            inputMode="numeric"
            value={value ?? ''}
            placeholder="—"
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              if (Number.isFinite(n)) onChange(clamp(n));
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange(clamp(current + (e.key === 'ArrowUp' ? 1 : -1)));
              }
            }}
            className="w-12 bg-transparent text-center text-xl font-bold tabular-nums text-ink focus:outline-none"
          />
          {suffix && <span className="text-sm font-semibold text-neutral-500">{suffix}</span>}
        </label>
        <button
          type="button"
          aria-label={`+ ${label}`}
          className={`relative ${btn}`}
          onPointerDown={down(1)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <Plus className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}
