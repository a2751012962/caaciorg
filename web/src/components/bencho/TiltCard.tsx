// TiltCard, from bencho.dev's "Tilt card" block (MIT, © 2026 Lorenzo Cabra,
// bencho.dev/licence). Bencho names it Tilt; the notes below keep that name.
// Its styles are the "Tilt" section of web/src/index.css.
//
// CAACI: Bencho's card is a picture (BUTTERFLY, its own photos, which are not
// licensed to travel). Here the card is whatever is put inside it — the digital
// member card on the account page and the sample card on the membership page —
// so the block takes children, and takes its size from them instead of the
// fixed 260 × 320 portrait. The press itself is unchanged.
import { useRef, useState, type ReactNode } from 'react';
import { clamp, mix, stillness, useSpring } from './spring';

/* ══ Tilt ═════════════════════════════════════════════════
   A picture card that gives under the pointer.

   IT SINKS, IT DOES NOT LIFT. Every tilt card on the internet
   rotates TOWARD the cursor: the corner you are nearest rises
   to meet you and the card reads as a slab of glass catching
   the light. This one does the opposite — the point you are
   over goes AWAY, and the far side comes up. The difference
   is one minus sign and it is the whole component: a surface
   that rises to your finger is being displayed to you, and a
   surface that gives under it is being touched.

   Which means the sign is not a detail to get right by
   fiddling. Cursor at the top → the top edge has to go back,
   which is a POSITIVE rotateX; cursor at the right → the
   right edge goes back, which is a positive rotateY. Hence
   `rx = -ny` and `ry = +nx`, the negation of the usual pair.

   THE ROTATION ALONE IS NOT ENOUGH. A rotation about the
   centre is symmetric — the near side down, the far side up
   by the same amount — and on its own it reads as a card
   pivoting, not as one being pressed. What makes it a press
   is that the darkest point tracks the pointer: a depression
   catches shadow at its deepest, and the rim opposite catches
   light. Those two gradients are doing at least as much of
   the work as the transform is, and neither would convince on
   its own.

   ONE PAIR OF NUMBERS IS THE STATE. Two springs hold where
   the pointer is, normalised to -1..1, and the rotation, both
   gradients and the shadow are all read off them. Nothing
   here has a transition of its own — see the note on Sound
   for why that matters, which is the same reason. */

/* ── how deep the room is ──────────────────────────────────
   The one number that decides whether this reads as a card
   turning or as a poster being sheared. Perspective is the
   distance from the viewer to the screen, so a small number
   is a face close to the glass: the near corner grows, the
   far corner shrinks, and ten degrees looks like thirty.

   800 against a 320px card is about two and a half card
   heights back — far enough that the foreshortening is a
   suggestion rather than a fisheye, close enough that the
   corners are visibly different sizes. It is not a knob
   because it is not a separate idea from the tilt: both
   answer "how 3D", and two sliders for one feeling is how a
   panel stops meaning anything.

   CAACI: the member card is wider than Bencho's picture (up
   to 448px at the bank-card ratio), so at 800 the corners
   differ a little more than on the wall. Still a suggestion. */
const DEPTH = 800;

/* how far the whole card retreats while it is being touched.
   Small on purpose — this is the difference between a card
   that tips and a card that is pushed, and at anything past
   about twenty it stops being a press and becomes a zoom. */
const SINK = 14;

/* CAACI: 16, not Bencho's 20. Cards and pictures on this site
   are `rounded-2xl`, which is 16px (web/DESIGN_SYSTEM.md §4.1),
   and a picture card that is rounder than every other card
   beside it reads as borrowed. */
const CORNER = 16;
const TILT = 10;
const SHADE = 60;

export function TiltCard({
  children,
  /* the most either axis turns, in degrees */
  tilt = TILT,
  corner = CORNER,
  /* how dark the dent gets, 0..100 */
  shade = SHADE,
  className = '',
}: {
  children?: ReactNode;
  tilt?: number;
  corner?: number;
  shade?: number;
  /** Sizing classes for the frame (e.g. `w-full`); it is otherwise unstyled. */
  className?: string;
}) {
  const skin = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [on, setOn] = useState(false);
  /* the frame's size at the last reading, for the dent below */
  const size = useRef({ w: 0, h: 0 });
  const still = stillness();

  /* ── the state, and there is only this ───────────────────
     Where the pointer is, as -1..1 on each axis, sprung. The
     spring is on the POSITION rather than on the rotation, so
     the gradients and the transform can never disagree about
     where the finger is — they are three readings of one
     number instead of three things being animated towards
     the same place.

     Sprung rather than tracked one-to-one because a card with
     no weight follows the cursor exactly and reads as a
     texture pinned to the mouse. The lag is what gives it
     mass, and the settle on the way out is the only reason
     leaving the card feels like anything at all. */
  const sx = useSpring(on ? at.x : 0, 50, still);
  const sy = useSpring(on ? at.y : 0, 50, still);
  /* one more for how much of any of this applies, so the
     shadow and the sheen fade rather than cutting */
  const lit = useSpring(on ? 1 : 0, 50, still);

  const max = clamp(tilt, 0, 20);
  const rx = -sy * max;
  const ry = sx * max;

  /* the pointer in the card's own terms, as a PERCENTAGE —
     the wall and the overlay both draw this block at their
     own scale, and a gradient placed in pixels would land
     somewhere else in each of them

     CAACI: the dent is drawn UNDER THE POINTER, not at the
     sprung position. Two things put Bencho's dent beside the
     cursor on a card this wide: the spring, which trails the
     pointer by design, and the transform itself — a point at
     px% of a card that has turned ten degrees and sunk 14px
     lands somewhere else on screen (about 20px inward at the
     edges of a 448px card). So the dent reads the raw pointer
     and is placed through the current transform's inverse:
     find the card-local point whose projection is the pointer.
     The rotation, the sink and the shadow stay sprung; what
     moved is only where the shading is painted. */
  const s = SINK * lit;
  const rxr = (rx * Math.PI) / 180;
  const ryr = (ry * Math.PI) / 180;
  const { w: fw, h: fh } = size.current;
  // the pointer as a screen offset from the card's centre, px
  const fx = (at.x * fw) / 2;
  const fy = (at.y * fh) / 2;
  let u = fx;
  let v = fy;
  /* translateZ(-s) rotateX(rx) rotateY(ry) on (u, v, 0), then the
     frame's perspective; the distortion is small, so a few
     fixed-point steps land on it */
  for (let k = 0; k < 4; k++) {
    const x1 = u * Math.cos(ryr);
    const z1 = -u * Math.sin(ryr);
    const y2 = v * Math.cos(rxr) - z1 * Math.sin(rxr);
    const z2 = v * Math.sin(rxr) + z1 * Math.cos(rxr) - s;
    const f = DEPTH / (DEPTH - z2);
    u += fx - x1 * f;
    v += fy - y2 * f;
  }
  const px = fw ? clamp(50 + (u / fw) * 100, 0, 100) : 50;
  const py = fh ? clamp(50 + (v / fh) * 100, 0, 100) : 50;

  const dark = (clamp(shade, 0, 100) / 100) * 0.55 * lit;
  const rim = (clamp(shade, 0, 100) / 100) * 0.34 * lit;

  const track = (e: React.PointerEvent) => {
    const el = skin.current;
    if (!el) return;
    /* measured from the FRAME, which never moves. Reading the
       card instead would be asking a rotating object where it
       is, and near the edges it has already turned away from
       the pointer that is asking. */
    const r = el.getBoundingClientRect();
    size.current = { w: r.width, h: r.height };
    setAt({
      x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
      y: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1),
    });
    setOn(true);
  };

  return (
    <div
      className={`tlt ${className}`}
      ref={skin}
      style={{ perspective: DEPTH }}
      /* pointer, not mouse: the same handler carries a finger
         dragged across the card, so a phone gets the effect
         while it is being touched rather than getting nothing
         at all. */
      onPointerMove={track}
      /* ── `out` with a containment test, NOT `leave` ───────
         Which is what leave IS — the browser derives it from
         exactly this event by asking whether the thing you
         moved to is inside the thing you were on — so this is
         not a second mechanism, it is the same one written
         out. What it buys is the case React would not
         synthesise: the rehearsal drives a scripted pointer by
         dispatching `pointerout`, and its final beat walks off
         the card carrying `relatedTarget: null`. Measured, no
         `onPointerLeave` came of it, and every card on the
         wall finished its demo still sunk under a cursor that
         had gone.

         Null counts as outside, which is also the honest
         answer for a real pointer leaving the window. */
      onPointerOut={(e) => {
        const el = skin.current;
        const to = e.relatedTarget as Node | null;
        if (!el || !to || !el.contains(to)) setOn(false);
      }}
      /* a touch taken over by a scroll never reports leaving */
      onPointerCancel={() => setOn(false)}
    >
      <div
        className="tlt-card"
        style={{
          borderRadius: clamp(corner, 0, 40),
          /* translateZ FIRST, so the retreat is measured in
             the room's axes rather than in the card's own —
             after a rotation, the card's z points somewhere
             off to the side and "back" stops meaning back. */
          transform: `translateZ(${-SINK * lit}px) rotateX(${rx}deg) rotateY(${ry}deg)`,
          /* ── the shadow TIGHTENS ────────────────────────
             A thing pressed into a surface has less air under
             it, so the gap closes and the shadow draws in.
             Growing it on hover is the reflex — it is what a
             card that LIFTS would do — and it fights every
             other cue here. */
          boxShadow: `0 ${mix(20, 9, lit)}px ${mix(44, 24, lit)}px -8px rgba(15, 23, 42, ${mix(
            0.22,
            0.15,
            lit,
          )})`,
        }}
      >
        {children}
        {/* ── the dent, and the rim opposite it ───────────
            The shadow pools where the surface is deepest,
            which is under the pointer, and the light catches
            the far edge that has risen — so the two are
            placed at mirrored points and neither is centred
            on anything. This is the layer that makes the
            transform read as a press. */}
        <span
          className="tlt-sheen"
          aria-hidden="true"
          style={{
            backgroundImage: `radial-gradient(42% 34% at ${px}% ${py}%, rgba(9, 14, 28, ${dark}) 0%, rgba(9, 14, 28, 0) 100%), radial-gradient(52% 42% at ${
              100 - px
            }% ${100 - py}%, rgba(255, 255, 255, ${rim}) 0%, rgba(255, 255, 255, 0) 100%)`,
          }}
        />
      </div>
    </div>
  );
}
