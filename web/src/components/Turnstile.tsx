// The Turnstile widget for a React form. The widget itself is mounted by
// src/caaci-turnstile.js, the same module the mirrored pages use, so both sides
// of the site agree on the sitekey, the action names and the reset discipline.
//
// A token is redeemed by the request that carries it, so the rule for every
// form is: read the token, send it, reset. useTurnstile returns exactly that.
// The widget takes its language from <html lang>, which the site already sets,
// so no caller has to thread it through.
import { useEffect, useRef, type RefObject } from 'react';
import { mountTurnstile, turnstileUnavailable } from '../../../src/caaci-turnstile.js';

interface Widget {
  token: () => string;
  reset: () => void;
  remove: () => void;
}

export interface TurnstileHandle {
  /** Goes on the element the widget renders into — use <TurnstileBox handle={…} />. */
  boxRef: RefObject<HTMLDivElement | null>;
  /** The solved token, or '' while it is still working or unavailable. */
  token: () => string;
  /** Call after every submit attempt, successful or not. */
  reset: () => void;
  /**
   * '' when there is a token to send; otherwise the sentence to show. Tells
   * "still solving" apart from "the script never loaded", which a content
   * blocker makes a real case — the second would otherwise read as a wait that
   * never ends.
   */
  problem: (zh: boolean) => string;
}

export function useTurnstile(action: string): TurnstileHandle {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widget = useRef<Widget | null>(null);
  const state = useRef<'pending' | 'ok' | 'unavailable'>('pending');

  useEffect(() => {
    let alive = true;
    state.current = 'pending';
    void mountTurnstile(boxRef.current, action).then((w: Widget | null) => {
      // Unmounted while the script was loading: take the widget straight back
      // out rather than leaving one attached to a detached node.
      if (!alive) return w?.remove();
      widget.current = w;
      state.current = w ? 'ok' : 'unavailable';
    });
    return () => {
      alive = false;
      widget.current?.remove();
      widget.current = null;
    };
  }, [action]);

  return {
    boxRef,
    token: () => widget.current?.token() ?? '',
    reset: () => widget.current?.reset(),
    problem: (zh: boolean) => {
      if (state.current === 'unavailable') return turnstileUnavailable(zh);
      return widget.current?.token() ? '' : turnstileWaiting(zh);
    },
  };
}

// Where the widget appears. Managed mode usually resolves without the visitor
// doing anything, so this is empty space until Cloudflare decides otherwise.
export function TurnstileBox({
  handle,
  className = '',
}: {
  handle: TurnstileHandle;
  className?: string;
}) {
  return <div ref={handle.boxRef} className={className} />;
}

// The one refusal a form shows when the token is not ready yet; the server's
// own refusal is translated by each page's existing error mapper.
export const turnstileWaiting = (zh: boolean) =>
  zh
    ? '请稍候，等验证框完成后再提交一次。'
    : 'Please wait a moment for the verification box, then send again.';
