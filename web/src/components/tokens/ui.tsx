// Shared pieces of the token pages (/charge/, /merchant/, /token-admin/ and the
// wallet on /account/). Classes are web/DESIGN_SYSTEM.md §5 verbatim. These are
// working screens used on a phone at a counter, so they skip the hero and keep
// one column.
import { useEffect, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { loginUrl, useAuth } from '../../lib/auth';
import type { Lang } from '../../lib/lang';

export const PRIMARY =
  'min-h-[44px] px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider shadow-xs transition-all active:scale-98 cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait';
export const SECONDARY =
  'shrink-0 whitespace-nowrap min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold cursor-pointer transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed';
export const DANGER =
  'min-h-[44px] px-6 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60';
export const INPUT =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-brick';
export const LABEL = 'block text-xs font-bold text-neutral-500 mb-2';
export const CARD = 'bg-surface-2 p-5 sm:p-7 rounded-2xl border border-neutral-200/80 shadow-xs';
export const EYEBROW = 'text-xs font-semibold text-brick block mb-2';

const DOT =
  "inline-flex items-center gap-1.5 text-xs font-medium before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current";
const TONE = {
  good: 'text-emerald-700',
  warn: 'text-amber-800',
  bad: 'text-rose-700',
  muted: 'text-neutral-500',
} as const;

/** Status: a coloured dot and words, no pill (DESIGN_SYSTEM §5.4). */
export function Status({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return <span className={`${DOT} ${TONE[tone]}`}>{children}</span>;
}

export function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'warn';
  children: ReactNode;
}) {
  const look = {
    error: 'bg-rose-50 border-rose-200 text-rose-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`p-3 border rounded-xl text-xs flex items-start gap-2 ${look}`}
    >
      <Icon className="w-4 h-4 shrink-0 mt-px" aria-hidden />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-xs text-neutral-500"
      role="status"
    >
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** The frame of a token page: a narrow column with a serif title. */
export function ToolPage({
  eyebrow,
  title,
  wide = false,
  children,
}: {
  eyebrow: string;
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | CAACI`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <div className="bg-white">
      <section className="py-8 sm:py-14">
        <div
          className={`${wide ? 'max-w-5xl' : 'max-w-xl'} mx-auto px-4 sm:px-6 lg:px-8 font-sans`}
        >
          <span className={EYEBROW}>{eyebrow}</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-maroon tracking-tight">{title}</h1>
          <div className="w-12 h-0.5 bg-brick mt-3 mb-6 rounded-full" />
          <div className="space-y-5">{children}</div>
        </div>
      </section>
    </div>
  );
}

/**
 * Sends a signed-out visitor to the sign-in page and back. Returns true once a
 * session is known to exist, false while it is still being read or the
 * redirect is under way.
 */
export function useSignedIn(): boolean {
  const auth = useAuth();
  useEffect(() => {
    if (auth.ready && !auth.user) window.location.assign(loginUrl());
  }, [auth.ready, auth.user]);
  return auth.ready && !!auth.user;
}

export const tr = (lang: Lang, en: string, zh: string) => (lang === 'zh' ? zh : en);
