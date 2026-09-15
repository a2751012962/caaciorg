// Data and helpers for the /account/ page. Ported from the Tabler reference
// (src/caaci-member.js, "/account/" sections): the same reads, the same
// request bodies, the same localStorage cooldown keys (so a countdown started
// on /login-3/ or the Tabler page carries over here) and the same QR target.
import { useCallback, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { supabase } from './supabase';
import { api, type ApiResult } from './api';
import { mergeTiers } from './shared';
import type { Lang } from './lang';
import type {
  EventSummary,
  FamilyActionData,
  FamilyData,
  FamilyRole,
  PaymentRow,
  RegisteredEvent,
  Tier,
} from '../types/account';

export const tr =
  (lang: Lang) =>
  (en: string, zh: string): string =>
    lang === 'zh' ? zh : en;

export const tierName = (tier: Tier, lang: Lang) => (lang === 'zh' && tier.name_zh) || tier.name;

// ---------- where the visitor landed ----------
// Supabase strips an auth callback hash (#access_token=…&type=recovery, or
// #error_code=…) from the address while the client starts up, so the hash is
// captured when this module is evaluated — before that — and only trusted when
// the site was opened on /account/. Query flags are read from the live address.
const LANDED = {
  path: window.location.pathname,
  hash: window.location.hash,
};
const landedOnAccount = /^\/(zh\/)?account\/?$/i.test(LANDED.path);
let landingHash = landedOnAccount ? LANDED.hash : '';

const hasLinkError = (part: string) => {
  const p = new URLSearchParams(part.replace(/^[#?]/, ''));
  return p.has('error_code') || p.has('error_description');
};

export interface Landing {
  recovery: boolean; // a password-reset link
  linkFailed: boolean; // Supabase reported a dead or failed email/OAuth link
  checkoutSuccess: boolean;
  familyInvite: string; // ?family_invite=<id>; compared with server ids, never rendered
}

export function readLanding(): Landing {
  const search = window.location.search;
  const q = new URLSearchParams(search);
  return {
    recovery: q.has('recovery') || /type=recovery/.test(landingHash),
    linkFailed: hasLinkError(landingHash) || hasLinkError(search),
    checkoutSuccess: q.get('checkout') === 'success',
    familyInvite: q.get('family_invite') || '',
  };
}

// Remove query flags (and optionally the spent hash) without a navigation, so
// a reload or bookmark does not replay a finished step.
export function dropParams(names: string[], { hash = false } = {}) {
  const url = new URL(window.location.href);
  for (const n of names) url.searchParams.delete(n);
  if (hash) {
    url.hash = '';
    landingHash = '';
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    try {
      window.history.replaceState(window.history.state, '', next);
    } catch {
      // No history API: the flag just stays in the address.
    }
  }
}

export function forgetLandingHash() {
  landingHash = '';
}

// ---------- reads (RLS) ----------
export async function loadTiers(): Promise<Tier[]> {
  try {
    const { data, error } = await supabase.from('membership_tiers').select('*').eq('active', true);
    return mergeTiers(error ? null : data) as unknown as Tier[];
  } catch {
    return fallbackTiers();
  }
}

export const fallbackTiers = () => mergeTiers(null) as unknown as Tier[];

// The member's own ledger rows (payments_self_read), newest first. null = could not load.
export async function loadPayments(uid: string): Promise<PaymentRow[] | null> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id,paid_at,kind,amount_cents,currency,tier_id,refunded_cents')
      .eq('member_id', uid)
      .order('paid_at', { ascending: false })
      .limit(10);
    if (error) return null;
    return (data ?? []) as unknown as PaymentRow[];
  } catch {
    return null;
  }
}

const EVENT_COLS = 'id,slug,title,title_zh,starts_at,ends_at,location';
const DAY_MS = 24 * 60 * 60 * 1000;

const isEvent = (e: unknown): e is EventSummary =>
  !!e && typeof e === 'object' && typeof (e as EventSummary).starts_at === 'string';

export const eventOver = (e: EventSummary, now = Date.now()) =>
  new Date(e.ends_at || e.starts_at).getTime() < now;

// Own RSVPs (rsvps_self_read; the events embed only returns published events),
// plus registration-form entries for upcoming published events. Registrations
// live in the server-only event_registrations table (0015), so each upcoming
// event is asked through GET /api/event-register, which reports the signed-in
// caller's own registration. RSVPs cannot be cancelled from the browser: 0013
// revoked delete on rsvps and there is no cancel endpoint. null = RSVPs failed.
export async function loadRegisteredEvents(uid: string): Promise<RegisteredEvent[] | null> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [rsvps, upcoming] = await Promise.all([
    supabase
      .from('rsvps')
      .select(`id,guests,created_at,events(${EVENT_COLS})`)
      .eq('member_id', uid)
      .limit(50)
      .then(
        (r) => r,
        () => ({ data: null, error: true }),
      ),
    supabase
      .from('events')
      .select(EVENT_COLS)
      .eq('published', true)
      .gte('starts_at', since)
      .order('starts_at', { ascending: true })
      .limit(10)
      .then(
        (r) => r,
        () => ({ data: null, error: true }),
      ),
  ]);

  const out: RegisteredEvent[] = [];
  const seen = new Set<string>();
  const rsvpRows = (rsvps.error ? [] : (rsvps.data ?? [])) as unknown as {
    id: string;
    guests: number | null;
    created_at: string | null;
    events: unknown;
  }[];
  for (const r of rsvpRows) {
    const ev = Array.isArray(r.events) ? r.events[0] : r.events;
    if (!isEvent(ev) || seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push({
      key: `rsvp:${r.id}`,
      source: 'rsvp',
      event: ev,
      guests: r.guests ?? 0,
      registered_at: r.created_at,
    });
  }

  const events = (upcoming.error ? [] : (upcoming.data ?? [])) as unknown as EventSummary[];
  const regs = await Promise.all(
    events
      .filter((ev) => isEvent(ev) && ev.slug && !seen.has(ev.id))
      .map(async (ev) => {
        const res = await api<{ registration?: { registered_at?: string } | null }>(
          `/api/event-register?event=${encodeURIComponent(ev.slug as string)}`,
          undefined,
          { auth: true },
        );
        const reg = res.ok ? res.data.registration : null;
        return reg
          ? ({
              key: `registration:${ev.id}`,
              source: 'registration',
              event: ev,
              guests: null,
              registered_at: reg.registered_at ?? null,
            } satisfies RegisteredEvent)
          : null;
      }),
  );
  for (const r of regs) if (r) out.push(r);

  // Upcoming first (soonest first), then past events (most recent first).
  const now = Date.now();
  out.sort((a, b) => {
    const pa = eventOver(a.event, now);
    const pb = eventOver(b.event, now);
    if (pa !== pb) return pa ? 1 : -1;
    const ta = new Date(a.event.starts_at).getTime();
    const tb = new Date(b.event.starts_at).getTime();
    return pa ? tb - ta : ta - tb;
  });
  if (rsvps.error && !out.length) return null;
  return out;
}

// ---------- /api/family ----------
const FAMILY_ROLES: FamilyRole[] = ['founder', 'member', 'none'];

// Only plain objects count as list entries; a missing or malformed list is empty.
const entries = <T>(list: unknown): T[] =>
  Array.isArray(list)
    ? (list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as T[])
    : [];

// GET /api/family. null when it fails or answers something unexpected.
export async function fetchFamily(): Promise<FamilyData | null> {
  const res = await api<Record<string, unknown>>('/api/family', undefined, { auth: true });
  const d = res.data as Record<string, unknown>;
  if (!res.ok || !FAMILY_ROLES.includes(d.role as FamilyRole)) return null;
  const seats = (d.seats && typeof d.seats === 'object' ? d.seats : {}) as Record<string, unknown>;
  return {
    role: d.role as FamilyRole,
    can_start_family: typeof d.can_start_family === 'boolean' ? d.can_start_family : null,
    household: (d.household as FamilyData['household']) ?? null,
    plan: (d.plan as FamilyData['plan']) ?? null,
    founder: (d.founder as FamilyData['founder']) ?? null,
    seats: { used: Number(seats.used) || 0, limit: Number(seats.limit) || 3 },
    people: entries(d.people),
    invites: entries(d.invites),
    events: entries(d.events),
    invitations_for_me: entries(d.invitations_for_me),
  };
}

export const familyAction = (body: Record<string, unknown>) =>
  api<FamilyActionData>('/api/family', body, { auth: true });

// The server's error text, or a bilingual fallback (network failures have status 0).
export function errorText(res: ApiResult<unknown>, lang: Lang): string {
  const t = tr(lang);
  if (res.status === 0) return t('Network error — please try again.', '网络错误，请重试。');
  const e = res.data?.error;
  return e ? String(e) : t('Something went wrong — please try again.', '出错了，请重试。');
}

// ---------- Apple Wallet ----------
// GET answers 204 only once the signing certificates are configured. Probed
// once per page load however many card components mount.
let walletProbe: Promise<boolean> | null = null;
export function walletPassAvailable(): Promise<boolean> {
  walletProbe ??= api('/api/wallet-pass').then((r) => r.status === 204);
  return walletProbe;
}

export async function downloadWalletPass(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch('/api/wallet-pass', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return false;
    const href = URL.createObjectURL(await res.blob());
    saveHref(href, 'caaci-membership.pkpass');
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    return true;
  } catch {
    return false;
  }
}

export function saveHref(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- membership card QR ----------
// The public live check a partner business scans. It shows only name, tier and
// validity; the QR is generated in the browser, so nothing goes to a third party.
export const verifyUrl = (memberId: string) =>
  `${window.location.origin}/api/verify?m=${encodeURIComponent(memberId)}`;

export function makeQr(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

// A short, readable reference for the card face. The QR carries the full id.
export const shortMemberId = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

// ---------- dates ----------
export const EVENT_TZ = 'America/Chicago';
const locale = (lang: Lang) => (lang === 'zh' ? 'zh-CN' : 'en-US');

// A date from the server, or a dash — never the raw string.
export function fmtDate(
  iso: string | null | undefined,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale(lang), opts).format(d);
}

// Events are stored in UTC and always shown in Champaign's time zone.
export const eventDay = (e: EventSummary, lang: Lang) =>
  fmtDate(e.starts_at, lang, {
    timeZone: EVENT_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export function eventTime(e: EventSummary, lang: Lang): string {
  const time: Intl.DateTimeFormatOptions = {
    timeZone: EVENT_TZ,
    hour: 'numeric',
    minute: '2-digit',
  };
  const from = fmtDate(e.starts_at, lang, time);
  if (!e.ends_at || fmtDate(e.ends_at, lang) === '—') return from;
  const sameDay =
    fmtDate(e.ends_at, lang, { timeZone: EVENT_TZ }) ===
    fmtDate(e.starts_at, lang, { timeZone: EVENT_TZ });
  const to = fmtDate(e.ends_at, lang, time);
  return sameDay
    ? `${from} – ${to}`
    : `${from} – ${fmtDate(e.ends_at, lang, { timeZone: EVENT_TZ, month: 'short', day: 'numeric' })} ${to}`;
}

// ---------- auth email helpers ----------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_COOLDOWN_S = 60;

interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

export const needsReauth = (error: AuthErrorLike | null | undefined) =>
  !!error &&
  (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message || ''));

// How long Supabase wants us to wait before another email, or 0 when the error
// is not a rate limit. "…after N seconds" when GoTrue says so, else 60 s.
export function emailRetryAfter(error: AuthErrorLike | null | undefined): number {
  if (!error) return 0;
  const m = /after (\d+) seconds?/i.exec(error.message || '');
  if (m) return Number(m[1]);
  return error.code === 'over_email_send_rate_limit' || error.status === 429 ? EMAIL_COOLDOWN_S : 0;
}

const cooldownKey = (action: string, email: string) =>
  `caaci-cooldown:${action}:${String(email || '')
    .trim()
    .toLowerCase()}`;

function storedCooldownEnd(action: string, email: string): number {
  try {
    const end = Number(localStorage.getItem(cooldownKey(action, email)));
    return end > Date.now() ? end : 0;
  } catch {
    return 0;
  }
}

// A 60 s "send again" countdown per action + address, kept in localStorage so
// a reload (or the Tabler pages, which use the same keys) does not reset it.
export function useCooldown(action: string, email: string) {
  const [end, setEnd] = useState(() => storedCooldownEnd(action, email));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setEnd(storedCooldownEnd(action, email));
  }, [action, email]);

  useEffect(() => {
    if (!end) return;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= end) {
        setEnd(0);
        try {
          if (Number(localStorage.getItem(cooldownKey(action, email))) <= n)
            localStorage.removeItem(cooldownKey(action, email));
        } catch {
          // storage blocked
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end, action, email]);

  const start = useCallback(
    (seconds: number) => {
      const e = Date.now() + seconds * 1000;
      try {
        localStorage.setItem(cooldownKey(action, email), String(e));
      } catch {
        // storage blocked — the countdown still runs on this page
      }
      setNow(Date.now());
      setEnd(e);
    },
    [action, email],
  );

  return { left: end ? Math.max(0, Math.ceil((end - now) / 1000)) : 0, start };
}
