// The React half of the Turnstile check (web/src/components/Turnstile.tsx) has
// to mount the widget when the form's box is actually in the document, not when
// the hook first runs. Three of the four protected forms have no box on their
// first render: event registration shows "Loading…" until its GET answers, the
// business-services form lives inside a dialog that opens later, and the contact
// form is unmounted around its success message and remounted by "Send another".
// An effect keyed only on the action mounted into a null ref once, recorded
// "unavailable", and never tried again — so those forms could never be sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SRC = new URL('../web/src/', import.meta.url);
const read = (p) => readFile(new URL(p, SRC), 'utf8');

test('the widget mounts on the box element arriving, not on the hook running', async () => {
  const src = await read('components/Turnstile.tsx');
  // The box is state (its arrival re-renders and re-runs the effect), handed to
  // the hook through a callback ref on TurnstileBox.
  assert.match(src, /useState<HTMLDivElement \| null>\(null\)/);
  assert.match(src, /setBox: \(el: HTMLDivElement \| null\) => void;/, 'handle exposes setBox');
  assert.match(src, /<div ref=\{handle\.setBox\}/, 'TurnstileBox hands its element to the hook');
  assert.doesNotMatch(src, /boxRef/, 'no ref object: a ref never re-runs an effect');
  // The mount effect depends on the element, mounts into it, and leaves quietly
  // while there is none.
  assert.match(src, /if \(!box\) return;/);
  assert.match(src, /mountTurnstile\(box, action\)/);
  assert.match(src, /\}, \[box, action\]\);/, 'effect keyed on the box and the action');
  // Cleanup forgets the widget and its verdict, so a box that comes back starts
  // from "pending" rather than from a stale "unavailable".
  assert.match(
    src,
    /widget\.current\?\.remove\(\);\s*widget\.current = null;\s*state\.current = 'pending';/,
  );
});

test('every protected React form renders its box through TurnstileBox', async () => {
  for (const [file, action] of [
    ['components/ContactSection.tsx', 'contact'],
    ['components/Modals.tsx', 'volunteer'],
    ['pages/EventRegisterPage.tsx', 'event_register'],
  ]) {
    const src = await read(file);
    assert.match(src, new RegExp(`useTurnstile\\('${action}'\\)`), `${file}: hook`);
    assert.match(src, /<TurnstileBox handle=\{turnstile\}/, `${file}: box`);
  }
  const biz = await read('pages/BusinessServicesPage.tsx');
  assert.match(biz, /useTurnstile\(isListing \? 'business_listing' : 'contact'\)/);
  assert.match(biz, /<TurnstileBox handle=\{turnstile\}/);
});
