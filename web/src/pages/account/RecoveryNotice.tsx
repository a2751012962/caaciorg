import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { loginUrl } from '../../lib/auth';
import type { Lang } from '../../lib/lang';
import { dropParams, forgetLandingHash, tr } from '../../lib/account';

interface RecoveryNoticeProps {
  lang: Lang;
  /** A password-reset link (?recovery=1 or #…type=recovery). */
  recovery: boolean;
  /** Supabase reported the link as expired / used / failed. */
  linkFailed: boolean;
  signedIn: boolean;
  onGoToSecurity: () => void;
}

// Set-new-password form for a reset link, or an explanation for a dead link —
// ported from recoveryCard / failedLinkCard in src/caaci-member.js. The error
// text in the URL is never shown: anyone could put words there.
export function RecoveryNotice({
  lang,
  recovery,
  linkFailed,
  signedIn,
  onGoToSecurity,
}: RecoveryNoticeProps) {
  const t = tr(lang);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (!recovery && !linkFailed)) return null;

  const dismiss = () => {
    forgetLandingHash();
    setDismissed(true);
  };

  if (done) {
    return (
      <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <p className="flex-1 text-xs text-emerald-900 font-semibold">
          {t('Password updated — you are signed in.', '密码已更新，您已登录。')}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-emerald-700 font-semibold hover:underline cursor-pointer p-1"
        >
          {t('Dismiss', '关闭')}
        </button>
      </div>
    );
  }

  // A reset link that did not sign anyone in is as dead as one Supabase refused.
  if (linkFailed || (recovery && !signedIn)) {
    let title = t('This link no longer works', '此链接已失效');
    let body: string;
    let action: { label: string; onClick: () => void };
    if (recovery) {
      title = t('This password reset link no longer works', '此重置密码链接已失效');
      body = t(
        'The link has expired or has already been used — each link works once, for a limited time.',
        '该链接已过期或已被使用——每个链接只能使用一次，且有时效。',
      );
      action = signedIn
        ? {
            label: t(
              "You're signed in — change your password under Account security",
              '您已登录——请在“账户安全”中修改密码',
            ),
            onClick: onGoToSecurity,
          }
        : {
            label: t('Request a new reset link', '重新申请重置链接'),
            onClick: () => window.location.assign('/login-3/'),
          };
    } else if (signedIn) {
      body = t(
        'It may have expired or already been used. If it was for changing your email address, request the change again under Account security.',
        '链接可能已过期或已被使用。如果这是修改邮箱的链接，请在“账户安全”中重新申请。',
      );
      action = { label: t('Go to Account security', '前往账户安全'), onClick: onGoToSecurity };
    } else {
      body = t(
        'It may have expired or already been used. Sign in to continue — if you still need the email, you can ask for a new one from there.',
        '链接可能已过期或已被使用。请登录后继续——如仍需要该邮件，可在登录后重新申请。',
      );
      action = {
        label: t('Go to sign in', '前往登录'),
        onClick: () => window.location.assign(loginUrl('/account/')),
      };
    }
    return (
      <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-left">
        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs space-y-1">
          <span className="font-bold text-rose-950 block">{title}</span>
          <span className="text-rose-800 block">{body}</span>
          <button
            type="button"
            onClick={() => {
              dismiss();
              action.onClick();
            }}
            className="text-rose-700 font-semibold underline cursor-pointer py-1 text-left"
          >
            {action.label}
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-rose-600 font-semibold hover:underline cursor-pointer p-1"
        >
          {t('Dismiss', '关闭')}
        </button>
      </div>
    );
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (password.length < 8)
      return setError(t('Password must be at least 8 characters.', '密码至少 8 位。'));
    if (password !== confirm)
      return setError(t('Passwords do not match.', '两次输入的密码不一致。'));
    setSaving(true);
    let message: string | null = null;
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      message = err ? err.message : null;
    } catch {
      message = t('Network error — please try again.', '网络错误，请重试。');
    }
    setSaving(false);
    if (message) return setError(message);
    // Drop ?recovery (and the spent hash) so a reload doesn't bring the form back.
    dropParams(['recovery'], { hash: true });
    setPassword('');
    setConfirm('');
    setDone(true);
  };

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl border border-amber-200 p-4.5 sm:p-7 shadow-xs space-y-4 text-left">
      <div className="flex items-center gap-2 pb-3 border-b border-neutral-100">
        <KeyRound className="w-5 h-5 text-brick" />
        <h3 className="text-base sm:text-lg font-bold text-ink">
          {t('Set a new password', '设置新密码')}
        </h3>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="caaci-recovery-new"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('New password (at least 8 characters)', '新密码（至少 8 位）')}
            </label>
            <input
              id="caaci-recovery-new"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-brick"
            />
          </div>
          <div>
            <label
              htmlFor="caaci-recovery-confirm"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Confirm password', '确认密码')}
            </label>
            <input
              id="caaci-recovery-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-brick"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-full bg-brick text-white hover:brightness-110 text-xs font-semibold cursor-pointer active:scale-98 disabled:opacity-60"
        >
          {saving ? t('Saving…', '保存中…') : t('Save password', '保存密码')}
        </button>
      </form>
    </div>
  );
}
