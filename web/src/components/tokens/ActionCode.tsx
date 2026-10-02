// The emailed verification code that money leaving the account must carry
// (functions/api/admin/_action-code.js): the same step the admin panel takes
// for membership refunds (pages/admin/kit.tsx), here for the token back office,
// which has no AdminProvider. `guarded` runs a request; on a 428 it asks for
// the code in a dialog and runs the request again with it. The code is kept
// for the visit, so several refunds in a row need one email.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import type { ApiResult } from '../../lib/api';
import type { Lang } from '../../lib/lang';
import { panelFrom, panelIn, panelShown } from '../../lib/motion';
import { tokens } from '../../lib/tokens';
import { CARD, INPUT, LABEL, Notice, PRIMARY, SECONDARY, tr } from './ui';

export type Guarded = <T>(
  attempt: (headers: Record<string, string>) => Promise<ApiResult<T>>,
) => Promise<ApiResult<T> & { cancelled?: boolean }>;

interface Ask {
  error?: string;
  resolve: (code: string | null) => void;
}

export function useActionCode(lang: Lang): { guarded: Guarded; dialog: ReactNode } {
  const code = useRef<string | null>(null);
  const sentAt = useRef(0);
  const [ask, setAsk] = useState<Ask | null>(null);

  const guarded = useCallback<Guarded>(async (attempt) => {
    let error: string | undefined;
    for (;;) {
      const res = await attempt(code.current ? { 'x-admin-code': code.current } : {});
      if (res.status !== 428) return res;
      if (code.current) error = res.data.error; // the kept code was refused
      code.current = null;
      const given = await new Promise<string | null>((resolve) => setAsk({ error, resolve }));
      setAsk(null);
      if (!given) return { ...res, ok: false, cancelled: true };
      code.current = given;
    }
  }, []);

  const dialog = (
    <AnimatePresence>
      {ask && (
        <CodeDialog
          key="code"
          lang={lang}
          error={ask.error}
          onDone={ask.resolve}
          sentRecently={() => Date.now() - sentAt.current < 60_000}
          send={async () => {
            const res = await tokens.admin.actionCode();
            if (res.ok) sentAt.current = Date.now();
            return res;
          }}
        />
      )}
    </AnimatePresence>
  );

  return { guarded, dialog };
}

// Sends the code on open unless one went out in the last minute.
function CodeDialog({
  lang,
  error,
  onDone,
  send,
  sentRecently,
}: {
  lang: Lang;
  error?: string;
  onDone: (code: string | null) => void;
  send: () => Promise<ApiResult<{ sent_to: string; valid_minutes: number }>>;
  sentRecently: () => boolean;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
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
    // `t` is a fresh closure each render; the message only depends on the language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, lang]);

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
        aria-labelledby="token-code-title"
        initial={panelFrom}
        animate={panelShown}
        exit={panelFrom}
        transition={panelIn}
        className={`${CARD} w-full max-w-md bg-white space-y-4`}
      >
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-brick shrink-0" aria-hidden />
          <div>
            <h2 id="token-code-title" className="text-lg font-bold text-ink">
              {t('Verification code', '验证码')}
            </h2>
            <p className="text-sm text-neutral-600 mt-1">
              {t(
                'Money is leaving CAACI’s account, so this needs the verification code we email to you.',
                '这笔操作会从华协账户退出资金，需要输入发送到您邮箱的验证码。',
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
