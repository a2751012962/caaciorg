import { useState, type FormEvent } from 'react';
import { AlertCircle, Award, CheckCircle2, X } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { api } from '../../lib/api';
import { dropParams, tr } from '../../lib/account';

// An invitation code for Honorable Membership (POST /api/invite). The link an
// admin sends is /account/?invite=<code>: the page arrives with the code, shows
// it here and one press activates the membership. With no code in the address
// the same block is a quiet "Have an invitation code?" line under the plan,
// for someone who was given the code in person.
interface InviteRedeemProps {
  lang: Lang;
  /** ?invite=<code> from the link, or '' when the visitor has to type one. */
  initialCode: string;
  /** Re-read the members row once the tier has changed. */
  onActivated: () => void | Promise<void>;
}

interface Answer {
  ok?: boolean;
  tier_id?: string;
  tokens_granted?: number;
  error_zh?: string;
}

export function InviteRedeem({ lang, initialCode, onActivated }: InviteRedeemProps) {
  const t = tr(lang);
  const fromLink = !!initialCode;
  const [open, setOpen] = useState(fromLink);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ tokens: number } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const clean = code.trim().toUpperCase();
    if (!clean) {
      setError(t('Enter your invitation code.', '请输入邀请码。'));
      return;
    }
    setBusy(true);
    setError('');
    const res = await api<Answer>('/api/invite', { code: clean }, { auth: true });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.status === 0
          ? t('Network error — please try again.', '网络错误，请重试。')
          : (lang === 'zh' && res.data.error_zh) ||
              res.data.error ||
              t('The invitation could not be used.', '无法使用该邀请。'),
      );
      return;
    }
    // A reload or bookmark must not offer the spent code again.
    dropParams(['invite']);
    setDone({ tokens: Number(res.data.tokens_granted) || 0 });
    // The wallet on this page re-reads its balance (TokenWallet listens).
    window.dispatchEvent(new Event('caaci:wallet-refresh'));
    await onActivated();
  };

  if (done)
    return (
      <div
        role="status"
        className="p-4 rounded-2xl border bg-emerald-50 border-emerald-200 flex items-start gap-3"
      >
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs">
          <span className="font-bold block sm:inline mr-2 text-emerald-950">
            {t('Honorable Membership activated — welcome!', '荣誉会员已激活，欢迎！')}
          </span>
          <span className="text-emerald-800">
            {done.tokens > 0
              ? t(
                  `${done.tokens} 华协币 have been added to your wallet.`,
                  `已向您的钱包发放 ${done.tokens} 个华协币。`,
                )
              : t('Your membership is active.', '您的会员资格已生效。')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="p-1 cursor-pointer text-emerald-700"
          aria-label={t('Dismiss', '关闭')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[36px] text-xs text-brick hover:underline font-semibold cursor-pointer inline-flex items-center gap-1.5"
      >
        <Award className="w-3.5 h-3.5" />
        <span>{t('Have an invitation code?', '有邀请码？')}</span>
      </button>
    );

  return (
    <form
      onSubmit={submit}
      className={`space-y-3 ${fromLink ? 'border-l-2 border-brick pl-4' : ''}`}
      aria-labelledby="invite-code-title"
    >
      <div className="flex items-center gap-2">
        <Award className="w-4 h-4 text-brick" />
        <h4 id="invite-code-title" className="text-sm font-bold text-ink">
          {t('Invitation code', '邀请码')}
        </h4>
      </div>
      <p className="text-xs text-neutral-600 leading-relaxed">
        {fromLink
          ? t(
              'You have been invited to Honorable Membership. Activate it on this account with the code below.',
              '您被邀请成为荣誉会员。使用下面的邀请码即可在本账号上激活。',
            )
          : t(
              'Enter the code CAACI gave you to activate Honorable Membership on this account.',
              '输入华协给您的邀请码，即可在本账号上激活荣誉会员。',
            )}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('Invitation code', '邀请码')}
          placeholder="HM-XXXXXXXX"
          className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brick"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] px-6 py-2.5 rounded-full bg-brick hover:brightness-110 text-white font-semibold text-xs cursor-pointer shadow-xs active:scale-98 disabled:opacity-60"
        >
          {busy ? t('Activating…', '正在激活…') : t('Activate', '激活')}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
