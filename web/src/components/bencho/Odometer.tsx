// Odometer: a figure whose digits roll to their new value, the way a clock or a
// counter turns — each digit is a column of 0–9 that slides to the digit shown,
// so a change from 165 to 103 turns the tens down through 5, 4, 3… instead of
// the number simply becoming another number. Written for ScrubChart, whose
// figure changes with every reading under the pointer.
//
// Only digits roll. The currency sign, commas and the point stay in place, and
// tabular-nums (set by the caller) keeps every column the same width, so the
// whole figure holds still while its digits turn. When the count of digits
// changes (999 → 1,000) the new columns simply appear: there is nothing they
// could roll from.
import { Fragment } from 'react';

const DIGITS = '0123456789'.split('');

export function Odometer({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`odo ${className}`} aria-label={text} role="text">
      {text.split('').map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="odo-col" aria-hidden>
            {/* the reel: 0–9 stacked; translateY(-d em) shows digit d */}
            <span className="odo-reel" style={{ transform: `translateY(${-Number(ch)}em)` }}>
              {DIGITS.map((d) => (
                <span key={d} className="odo-digit">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <Fragment key={i}>{ch}</Fragment>
        ),
      )}
    </span>
  );
}
