// Inline confirm, after bencho.dev's block of the same name (MIT, Lorenzo Cabra).
// The button becomes its own dialog: pressing it widens it into Keep / Delete
// under the same cursor, and after Delete it holds an Undo on a burning timer.
// onCommit only runs once that timer ends, so Undo never has to reverse a write.
//
// The width is the animation. All three faces stay mounted on top of each other
// and the shell springs to the width of the one showing; the hidden faces are
// inert at once, so a click never lands on a face that is still fading out.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { Trash2, Undo2 } from 'lucide-react';
import { confirmMorph } from '../../lib/motion';

type Phase = 'idle' | 'asking' | 'done';

interface InlineConfirmProps {
  label: string;
  keepLabel: string;
  confirmLabel: string;
  doneLabel: string;
  undoLabel: string;
  /** Called once the undo window has passed (or the block unmounts inside it). */
  onCommit: () => void | Promise<unknown>;
  undoMs?: number;
  disabled?: boolean;
}

// p-1 on each side plus the 1px border.
const FRAME = 10;

export function InlineConfirm({
  label,
  keepLabel,
  confirmLabel,
  doneLabel,
  undoLabel,
  onCommit,
  undoMs = 4000,
  disabled = false,
}: InlineConfirmProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const width = useMotionValue(0);
  const measured = useRef(false);
  const shell = useRef<HTMLDivElement>(null);
  const faces = useRef<Record<Phase, HTMLDivElement | null>>({
    idle: null,
    asking: null,
    done: null,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useLayoutEffect(() => {
    const face = faces.current[phase];
    if (!face) return;
    const target = face.offsetWidth + FRAME;
    // The first width is set, not sprung to: nothing should grow on page load.
    if (measured.current) void animate(width, target, confirmMorph);
    else width.set(target);
    measured.current = true;
  }, [phase, label, keepLabel, confirmLabel, doneLabel, undoLabel, width]);

  // Leaving the page inside the undo window still deletes: the admin said so.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        commit.current();
      }
    },
    [],
  );

  // Asking closes on Escape or a press anywhere else.
  useEffect(() => {
    if (phase !== 'asking') return;
    const away = (e: PointerEvent) => {
      if (!shell.current?.contains(e.target as Node)) setPhase('idle');
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPhase('idle');
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [phase]);

  const confirm = () => {
    setPhase('done');
    timer.current = setTimeout(() => {
      timer.current = null;
      // Back to the way in once the action has run. A block still on screen
      // afterwards — a row whose delete was refused, a composer whose send
      // failed — would otherwise be stuck offering an undo for work that is
      // over, with no way back but a reload.
      void Promise.resolve(commit.current()).finally(() => {
        if (shell.current?.isConnected) setPhase('idle');
      });
    }, undoMs);
  };
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase('idle');
  };

  const face = (p: Phase, children: ReactNode) => (
    <div
      ref={(el) => {
        faces.current[p] = el;
      }}
      inert={phase !== p}
      aria-hidden={phase !== p}
      className={`absolute left-1 top-1 inline-flex items-center gap-1 whitespace-nowrap transition-[opacity,filter] duration-150 ${
        phase === p ? 'opacity-100 blur-none' : 'opacity-0 blur-[3px] pointer-events-none'
      }`}
    >
      {children}
    </div>
  );

  const pill =
    'h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap';

  return (
    <motion.div
      ref={shell}
      data-phase={phase}
      style={{ width }}
      className="relative h-11 rounded-full bg-white border border-neutral-200 shadow-xs overflow-hidden"
    >
      {face(
        'idle',
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPhase('asking')}
          className={`${pill} text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden />
          {label}
        </button>,
      )}
      {face(
        'asking',
        <>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className={`${pill} text-neutral-700 hover:bg-neutral-100`}
          >
            {keepLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            className={`${pill} bg-rose-600 hover:bg-rose-700 text-white`}
          >
            {confirmLabel}
          </button>
        </>,
      )}
      {face(
        'done',
        <>
          <span className="px-2.5 text-xs text-neutral-500" role="status">
            {doneLabel}
          </span>
          <button
            type="button"
            onClick={undo}
            className={`${pill} text-ink bg-neutral-100 hover:bg-neutral-200`}
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden />
            {undoLabel}
          </button>
        </>,
      )}
      {phase === 'done' && (
        // How long Undo is still on offer.
        <motion.span
          aria-hidden
          className="absolute left-0 bottom-0 h-0.5 bg-rose-500"
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: undoMs / 1000, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}
