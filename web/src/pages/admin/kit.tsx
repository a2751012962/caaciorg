// The admin console's shared pieces: the context every tab reads (language,
// the signed-in admin, an authenticated API call, the emailed-code step for
// guarded actions, the tier list, toasts, tab navigation) and the small UI
// vocabulary the tabs are written in. Tabs import from here, not from each
// other, so any tab can be rewritten without touching the rest.
//
// Classes follow web/DESIGN_SYSTEM.md (tokens/ui.tsx holds the verbatim ones);
// the interactive pieces are the Bencho blocks in components/bencho/.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Inbox, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { loginUrl } from '../../lib/auth';
import type { Lang } from '../../lib/lang';
import { mountIn, panelFrom, panelIn, panelShown, riseFromSm, shown } from '../../lib/motion';
import {
  CARD,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  Spinner,
} from '../../components/tokens/ui';

export {
  CARD,
  DANGER,
  EYEBROW,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  Spinner,
  Status,
} from '../../components/tokens/ui';
export { InlineConfirm } from '../../components/bencho/InlineConfirm';
export { LiquidToggle } from '../../components/bencho/LiquidToggle';
export { DragStepper } from '../../components/bencho/DragStepper';
export { Search } from '../../components/bencho/Search';

/** A <select> styled like INPUT. */
export const SELECT = `${INPUT} pr-9 cursor-pointer`;
/** A multi-line INPUT. */
export const TEXTAREA = `${INPUT} min-h-[96px] leading-relaxed`;
/** Small pill button for row actions (44px tall for touch). */
export const ROW_BTN =
  'h-11 px-4 rounded-full border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

// ------------------------------------------------------------------ formats

export const fmtDate = (lang: Lang, d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';
export const fmtDateTime = (lang: Lang, d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
/** cents → $1,234.56 */
export const usd = (cents: number | null | undefined) =>
  `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** cents → $1,235 */
export const usdShort = (cents: number | null | undefined) =>
  `$${Math.round((cents || 0) / 100).toLocaleString('en-US')}`;
/** ISO → YYYY-MM-DD for <input type="date">. */
export const dateInput = (d: string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : '';

// ------------------------------------------------------------------ context

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
  /** Set by guarded() when the admin closed the code step. */
  cancelled?: boolean;
}
export type ApiOpts = { method?: string; body?: unknown; headers?: Record<string, string> };
export type Tier = { id: string; name: string };
export type TabId =
  | 'dashboard'
  | 'members'
  | 'families'
  | 'payments'
  | 'discounts'
  | 'events'
  | 'volunteers'
  | 'directory'
  | 'plans'
  | 'news'
  | 'refunds'
  | 'account';

interface AdminContext {
  lang: Lang;
  /** Pick the string for the current language. */
  t: (en: string, zh: string) => string;
  /** The signed-in admin's member id (= auth user id) and email. */
  myId: string;
  myEmail: string | null;
  /**
   * An authenticated call to a Pages Function. Never throws (a network failure
   * is { ok: false, status: 0 }). A 401 sends the visitor to sign in.
   */
  api: <T = Record<string, unknown>>(path: string, opts?: ApiOpts) => Promise<ApiResult<T>>;
  /**
   * Runs `attempt(headers)`; on 428 (code_required) asks for the emailed code in
   * a dialog, then runs it again with the code. The code is kept for the visit.
   * Use for refunds, plan changes and anything else the API guards.
   */
  guarded: <T>(
    attempt: (headers: Record<string, string>) => Promise<ApiResult<T>>,
  ) => Promise<ApiResult<T>>;
  /** membership_tiers in sort order, and a label lookup. */
  tiers: Tier[];
  tierName: (id: string | null | undefined) => string;
  /** A short message at the bottom of the screen. */
  toast: (tone: 'success' | 'error', text: string) => void;
  /** Switch tab; `params` land in useTabParams() of the target tab. */
  go: (tab: TabId, params?: Record<string, string>) => void;
  params: Record<string, string>;
}

const Ctx = createContext<AdminContext | null>(null);

export function useAdmin(): AdminContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside <AdminProvider>');
  return c;
}

/** The params the current tab was opened with (e.g. { event: '…' }). */
export const useTabParams = () => useAdmin().params;

export function AdminProvider({
  lang,
  myId,
  myEmail,
  go,
  params,
  children,
}: {
  lang: Lang;
  myId: string;
  myEmail: string | null;
  go: AdminContext['go'];
  params: Record<string, string>;
  children: ReactNode;
}) {
  const t = useCallback((en: string, zh: string) => (lang === 'zh' ? zh : en), [lang]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [toasts, setToasts] = useState<{ id: number; tone: 'success' | 'error'; text: string }[]>(
    [],
  );
  const [codeAsk, setCodeAsk] = useState<{
    error?: string;
    resolve: (code: string | null) => void;
  } | null>(null);
  const actionCode = useRef<string | null>(null);
  const codeSentAt = useRef(0);

  const api = useCallback(
    async function call<T>(
      path: string,
      { method, body, headers = {} }: ApiOpts = {},
    ): Promise<ApiResult<T>> {
      const { data: s } = await supabase.auth.getSession();
      const h: Record<string, string> = { ...headers };
      if (body !== undefined) h['content-type'] = 'application/json';
      if (s.session) h.authorization = `Bearer ${s.session.access_token}`;
      try {
        const res = await fetch(path, {
          method: method ?? (body === undefined ? 'GET' : 'POST'),
          headers: h,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 401) window.location.assign(loginUrl());
        const data = (await res.json().catch(() => ({}))) as T & { error?: string };
        return { ok: res.ok, status: res.status, data };
      } catch {
        const error = t(
          'Could not reach the server. Check the connection and try again.',
          '无法连接服务器，请检查网络后重试。',
        );
        return { ok: false, status: 0, data: { error } as T & { error?: string } };
      }
    },
    [t],
  );

  const guarded = useCallback<AdminContext['guarded']>(async (attempt) => {
    let error: string | undefined;
    for (;;) {
      const res = await attempt(actionCode.current ? { 'x-admin-code': actionCode.current } : {});
      if (res.status !== 428) return res;
      if (actionCode.current) error = res.data.error; // the kept code was refused
      actionCode.current = null;
      const code = await new Promise<string | null>((resolve) => setCodeAsk({ error, resolve }));
      setCodeAsk(null);
      if (!code) return { ...res, ok: false, cancelled: true };
      actionCode.current = code;
    }
  }, []);

  useEffect(() => {
    void supabase
      .from('membership_tiers')
      .select('id,name')
      .order('sort_order')
      .then(({ data }) => setTiers(Array.isArray(data) ? (data as Tier[]) : []));
  }, []);
  const tierName = useCallback(
    (id: string | null | undefined) => (id ? tiers.find((x) => x.id === id)?.name || id : '—'),
    [tiers],
  );

  const toast = useCallback((tone: 'success' | 'error', text: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, tone, text }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== id)),
      tone === 'error' ? 7000 : 4000,
    );
  }, []);

  return (
    <Ctx.Provider
      value={{ lang, t, myId, myEmail, api, guarded, tiers, tierName, toast, go, params }}
    >
      {children}
      <div
        className="fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:w-96 space-y-2 pointer-events-none"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((x) => (
            <motion.div
              key={x.id}
              initial={riseFromSm}
              animate={shown}
              exit={{ opacity: 0 }}
              transition={mountIn}
              className="pointer-events-auto shadow-lg rounded-xl bg-white"
            >
              <Notice tone={x.tone}>{x.text}</Notice>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {codeAsk && (
          <CodeDialog
            key="code"
            error={codeAsk.error}
            onDone={codeAsk.resolve}
            sentRecently={() => Date.now() - codeSentAt.current < 60_000}
            send={async () => {
              const res = await api<{ sent_to: string; valid_minutes: number }>(
                '/api/admin/action-code',
                { method: 'POST' },
              );
              if (res.ok) codeSentAt.current = Date.now();
              return res;
            }}
          />
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

// The emailed verification code, asked for in a dialog. Sends the code on open
// unless one went out in the last minute.
function CodeDialog({
  error,
  onDone,
  send,
  sentRecently,
}: {
  error?: string;
  onDone: (code: string | null) => void;
  send: () => Promise<ApiResult<{ sent_to: string; valid_minutes: number }>>;
  sentRecently: () => boolean;
}) {
  const { t } = useAdmin();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState(error || '');

  const sendNow = useCallback(async () => {
    setStatus(t('Sending the code…', '正在发送验证码…'));
    const res = await send();
    setStatus(
      res.ok
        ? t(
            `Code sent to ${res.data.sent_to}. It stays valid for about ${res.data.valid_minutes} minutes.`,
            `验证码已发送至 ${res.data.sent_to}，约 ${res.data.valid_minutes} 分钟内有效。`,
          )
        : res.data.error || t('The code could not be sent.', '验证码发送失败。'),
    );
  }, [send, t]);

  // A ref, not the effect alone: React's dev double-run would email twice.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (sentRecently())
      setStatus(t('Use the code we just emailed you.', '请输入刚发送到您邮箱的验证码。'));
    else void sendNow();
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = () => {
    if (!/^\d{6}$/.test(code.trim()))
      return setErr(t('Enter the 6-digit code from the email.', '请输入邮件中的 6 位验证码。'));
    onDone(code.trim());
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onDone(null)}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-code-title"
        initial={panelFrom}
        animate={panelShown}
        exit={panelFrom}
        transition={panelIn}
        className={`${CARD} w-full max-w-md bg-white space-y-4`}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-brick shrink-0" aria-hidden />
          <div>
            <h2 id="admin-code-title" className="text-lg font-bold text-ink font-poppins">
              {t('Verification code', '验证码')}
            </h2>
            <p className="text-sm text-neutral-600 mt-1">
              {t(
                'For safety this action needs the verification code we email to you.',
                '为安全起见，此操作需要输入发送到您邮箱的验证码。',
              )}
            </p>
          </div>
        </div>
        {status && <p className="text-xs text-neutral-500">{status}</p>}
        <label className="block">
          <span className={LABEL}>{t('6-digit code', '6 位验证码')}</span>
          <input
            className={`${INPUT} text-center text-xl tracking-[0.4em] font-mono`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
          />
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={confirm}>
            {t('Confirm', '确认')}
          </button>
          <button type="button" className={SECONDARY} onClick={() => void sendNow()}>
            {t('Resend code', '重新发送')}
          </button>
          <button type="button" className={SECONDARY} onClick={() => onDone(null)}>
            {t('Cancel', '取消')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ data

/**
 * Loads once on mount (and whenever `deps` change). `reload()` runs it again
 * without clearing what is on screen.
 */
export function useLoad<T>(
  load: () => Promise<ApiResult<T>>,
  deps: unknown[] = [],
): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  set: (d: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { t } = useAdmin();
  const run = useCallback(async () => {
    setLoading(true);
    const res = await load();
    setLoading(false);
    if (res.ok) {
      setData(res.data);
      setError('');
    } else
      setError(
        res.status === 403
          ? t('Admin access required.', '需要管理员权限。')
          : res.data.error || t('Could not load.', '加载失败。'),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, loading, reload: run, set: setData };
}

// ------------------------------------------------------------------ layout

/** The top of a tab: title, one-line description, and actions on the right. */
export function TabHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-maroon tracking-tight">{title}</h1>
        <div className="w-12 h-0.5 bg-brick mt-3 rounded-full" />
        {description && <p className="mt-3 text-sm text-neutral-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A labelled control. `hint` sits under it. */
export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="block mt-1.5 text-[11px] text-neutral-500">{hint}</span>}
    </label>
  );
}

/** A card that animates in; use for forms and panels inside a tab. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={riseFromSm}
      animate={shown}
      transition={mountIn}
      className={`${CARD} ${className}`}
    >
      {children}
    </motion.div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-sm text-neutral-500">
      <Inbox className="w-6 h-6 text-neutral-400" aria-hidden />
      {children}
    </div>
  );
}

/** Loading / error / empty around a list. Renders children only when there is data. */
export function Loaded({
  loading,
  error,
  empty,
  isEmpty,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: ReactNode;
  isEmpty?: boolean;
  children: ReactNode;
}) {
  const { t } = useAdmin();
  if (error) return <Notice tone="error">{error}</Notice>;
  if (loading && isEmpty !== false) return <Spinner label={t('Loading…', '加载中…')} />;
  if (isEmpty) return <Empty>{empty ?? t('Nothing here yet.', '暂无内容。')}</Empty>;
  return <>{children}</>;
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hidden in the phone card layout (kept in the table). */
  wideOnly?: boolean;
}

/**
 * A table on wide screens, a stack of cards on phones. `expand(row)` renders an
 * inline panel under the row (an editor, details) when it returns something.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  expand,
  actions,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  expand?: (row: T) => ReactNode;
  actions?: (row: T) => ReactNode;
}) {
  // Only one layout is mounted, so an editor in `expand` exists once (its state,
  // its requests) rather than once per layout with one of them hidden.
  const wide = useWide();
  return (
    <div className="bg-surface-2 rounded-2xl border border-neutral-200/80 shadow-xs overflow-hidden">
      {wide ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold text-neutral-500 border-b border-neutral-200/80">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-bold ${c.className ?? ''}`}>
                  {c.label}
                </th>
              ))}
              {actions && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const extra = expand?.(r);
              return (
                <FragmentRows key={rowKey(r)}>
                  <tr className="border-b border-neutral-200/60 last:border-0 hover:bg-white/70 transition-colors align-middle">
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-3 text-neutral-700 ${c.className ?? ''}`}>
                        {c.render(r)}
                      </td>
                    ))}
                    {actions && (
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-2">{actions(r)}</div>
                      </td>
                    )}
                  </tr>
                  {extra && (
                    <tr className="border-b border-neutral-200/60 bg-white">
                      <td colSpan={columns.length + (actions ? 1 : 0)} className="p-4">
                        {extra}
                      </td>
                    </tr>
                  )}
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      ) : (
        <ul className="divide-y divide-neutral-200/70">
          {rows.map((r) => {
            const extra = expand?.(r);
            return (
              <li key={rowKey(r)} className="p-4 space-y-2">
                {columns
                  .filter((c) => !c.wideOnly)
                  .map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-xs font-bold text-neutral-500 shrink-0">{c.label}</span>
                      <span className="text-right text-neutral-700 min-w-0 break-words">
                        {c.render(r)}
                      </span>
                    </div>
                  ))}
                {actions && <div className="flex flex-wrap gap-2 pt-1">{actions(r)}</div>}
                {extra && <div className="pt-2">{extra}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** True at Tailwind's md breakpoint and up; follows window resizes. */
export function useWide(query = '(min-width: 768px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

/** Previous / next for offset paging. */
export function Pager({
  offset,
  limit,
  total,
  onPage,
}: {
  offset: number;
  limit: number;
  total: number;
  onPage: (offset: number) => void;
}) {
  const { t } = useAdmin();
  if (total <= limit) return null;
  const from = Math.min(total, offset + 1);
  const to = Math.min(total, offset + limit);
  return (
    <div className="flex items-center justify-between gap-3 mt-4 text-xs text-neutral-500">
      <span>
        {from}–{to} / {total}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={SECONDARY}
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - limit))}
          aria-label={t('Previous page', '上一页')}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          className={SECONDARY}
          disabled={offset + limit >= total}
          onClick={() => onPage(offset + limit)}
          aria-label={t('Next page', '下一页')}
        >
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Member / subscription status as a coloured dot (DESIGN_SYSTEM §5.4). */
export const MEMBER_STATUSES = ['active', 'pending', 'past_due', 'expired', 'cancelled'] as const;
export function memberStatusLabel(t: AdminContext['t'], s: string | null | undefined) {
  return (
    {
      active: t('Active', '有效'),
      pending: t('Pending', '待处理'),
      past_due: t('Past due', '逾期'),
      expired: t('Expired', '已过期'),
      cancelled: t('Cancelled', '已取消'),
    }[s || ''] ||
    s ||
    '—'
  );
}
export function memberStatusTone(s: string | null | undefined): 'good' | 'warn' | 'bad' | 'muted' {
  if (s === 'active') return 'good';
  if (s === 'pending' || s === 'past_due') return 'warn';
  if (s === 'cancelled') return 'bad';
  return 'muted';
}
