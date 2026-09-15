import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { Lang } from '../../lib/lang';
import {
  EMAIL_COOLDOWN_S,
  EMAIL_RE,
  emailRetryAfter,
  needsReauth,
  tr,
  useCooldown,
} from '../../lib/account';

type Notice = { ok: boolean; msg: string } | null;

// Email/password identity, or only Google/Microsoft.
const hasPasswordLogin = (user: User) =>
  (user.identities ?? []).some((i) => i.provider === 'email') ||
  ((user.app_metadata?.providers as string[] | undefined) ?? []).includes('email');

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return notice.ok ? (
    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
      <span>{notice.msg}</span>
    </div>
  ) : (
    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
      <span>{notice.msg}</span>
    </div>
  );
}

const inputCls =
  'w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-neutral-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-brick';

// Change / set password (with Supabase's reauthentication code when it asks for
// one) and change email — securityCard in src/caaci-member.js.
export function SecurityCard({
  lang,
  user,
  className = '',
}: {
  lang: Lang;
  user: User;
  className?: string;
}) {
  const t = tr(lang);
  const email = user.email ?? '';
  const network = t('Network error — please try again.', '网络错误，请重试。');

  // ---- password ----
  const [hasPassword, setHasPassword] = useState(() => hasPasswordLogin(user));
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [pwNotice, setPwNotice] = useState<Notice>(null);
  const codeCooldown = useCooldown('reauth', email);

  useEffect(() => {
    setHasPassword(hasPasswordLogin(user));
    // Keyed on the id: only a different account resets this, not a token
    // refresh (which hands over a new user object for the same account).
  }, [user.id]);

  // The update the fields describe right now, read at Save and again at Confirm.
  const passwordUpdate = () => {
    let problem = '';
    if (hasPassword && !current) problem = t('Enter your current password.', '请输入当前密码。');
    else if (password.length < 8)
      problem = t('Password must be at least 8 characters.', '密码至少 8 位。');
    else if (password !== password2)
      problem = t('Passwords do not match.', '两次输入的密码不一致。');
    if (problem) {
      setPwNotice({ ok: false, msg: problem });
      return null;
    }
    return hasPassword ? { password, current_password: current } : { password };
  };

  const saved = () => {
    setPwNotice({
      ok: true,
      msg: hasPassword
        ? t('Password updated.', '密码已更新。')
        : t(
            'Password set — you can now also sign in with your email address.',
            '密码已设置，现在也可以使用邮箱登录。',
          ),
    });
    setHasPassword(true);
    setReauthOpen(false);
    setCurrent('');
    setPassword('');
    setPassword2('');
    setCode('');
  };

  const sendCode = async () => {
    if (sendingCode || codeCooldown.left > 0) return;
    setSendingCode(true);
    let error: { message?: string; code?: string; status?: number } | null = null;
    try {
      ({ error } = await supabase.auth.reauthenticate());
    } catch (e) {
      error = { message: (e as Error)?.message || network };
    }
    setSendingCode(false);
    if (error) {
      setPwNotice({ ok: false, msg: error.message || network });
      const wait = emailRetryAfter(error);
      if (wait) codeCooldown.start(wait);
      return;
    }
    setPwNotice({
      ok: true,
      msg: t('Verification code sent — check your inbox.', '验证码已发送，请查收。'),
    });
    codeCooldown.start(EMAIL_COOLDOWN_S);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const attrs = passwordUpdate();
    if (!attrs) return;
    setSaving(true);
    setPwNotice(null);
    let error: { message?: string; code?: string } | null = null;
    try {
      ({ error } = await supabase.auth.updateUser(attrs));
    } catch {
      error = { message: network };
    }
    setSaving(false);
    if (needsReauth(error)) {
      setReauthOpen(true);
      // A code sent inside the cooldown is still valid: don't ask for another.
      if (!sendingCode && codeCooldown.left === 0) void sendCode();
      return;
    }
    if (error) return setPwNotice({ ok: false, msg: error.message || network });
    saved();
  };

  const handleConfirm = async () => {
    if (confirming || !reauthOpen) return;
    const attrs = passwordUpdate();
    if (!attrs) return;
    const nonce = code.trim();
    if (!nonce)
      return setPwNotice({
        ok: false,
        msg: t('Enter the code from the email.', '请输入邮件中的验证码。'),
      });
    setConfirming(true);
    let error: { message?: string } | null = null;
    try {
      ({ error } = await supabase.auth.updateUser({ ...attrs, nonce }));
    } catch {
      error = { message: network };
    }
    setConfirming(false);
    if (error) return setPwNotice({ ok: false, msg: error.message || network });
    saved();
  };

  // ---- email ----
  const [newEmail, setNewEmail] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [emSaving, setEmSaving] = useState(false);
  const [emResending, setEmResending] = useState(false);
  const [emNotice, setEmNotice] = useState<Notice>(null);
  const emCooldown = useCooldown('email_change', email);
  const redirectTo = `${window.location.origin}/account/`;

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (emSaving) return;
    const value = newEmail.trim();
    if (!EMAIL_RE.test(value))
      return setEmNotice({ ok: false, msg: t('Enter a valid email address.', '请填写有效邮箱。') });
    if (value.toLowerCase() === email.toLowerCase())
      return setEmNotice({
        ok: false,
        msg: t('That is already your email address.', '这已经是您当前的邮箱。'),
      });
    setEmSaving(true);
    let error: { message?: string; code?: string; status?: number } | null = null;
    try {
      ({ error } = await supabase.auth.updateUser(
        { email: value },
        { emailRedirectTo: redirectTo },
      ));
    } catch {
      error = { message: network };
    }
    setEmSaving(false);
    if (error) {
      setEmNotice({ ok: false, msg: error.message || network });
      const wait = emailRetryAfter(error);
      if (wait) emCooldown.start(wait);
      return;
    }
    setPendingEmail(value);
    setNewEmail('');
    setEmNotice({
      ok: true,
      msg: t(
        `Almost done — open the confirmation link we sent to ${value}. If ${email} gets a confirmation email too, open that link as well; the change finishes once both are confirmed.`,
        `即将完成——请打开我们发送到 ${value} 的确认链接。如果 ${email} 也收到确认邮件，请一并确认；全部确认后才会完成更改。`,
      ),
    });
    emCooldown.start(EMAIL_COOLDOWN_S);
  };

  // GoTrue finds the pending change by the CURRENT address and re-mails it.
  const handleEmailResend = async () => {
    if (emResending || emCooldown.left > 0) return;
    setEmResending(true);
    let error: { message?: string; code?: string; status?: number } | null = null;
    try {
      ({ error } = await supabase.auth.resend({
        type: 'email_change',
        email,
        options: { emailRedirectTo: redirectTo },
      }));
    } catch {
      error = { message: network };
    }
    setEmResending(false);
    if (error) {
      setEmNotice({ ok: false, msg: error.message || network });
      const wait = emailRetryAfter(error);
      if (wait) emCooldown.start(wait);
      return;
    }
    setEmNotice({
      ok: true,
      msg: t(`Confirmation email sent to ${pendingEmail}.`, `确认邮件已发送至 ${pendingEmail}。`),
    });
    emCooldown.start(EMAIL_COOLDOWN_S);
  };

  const resendIn = (left: number) => t(`Resend in ${left}s`, `${left} 秒后可重新发送`);

  return (
    <div
      id="account-security"
      className={`${className} bg-white rounded-2xl sm:rounded-3xl border border-neutral-200/90 p-4.5 sm:p-7 shadow-xs space-y-6 scroll-mt-24`}
    >
      <div className="flex items-center gap-2 pb-3 border-b border-neutral-100">
        <Shield className="w-5 h-5 text-brick" />
        <h3 className="text-base sm:text-lg font-bold text-ink">
          {t('Account Security', '账户安全')}
        </h3>
      </div>

      {/* Password Section */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-neutral-900">
            {hasPassword ? t('Change Password', '修改密码') : t('Set a Password', '设置密码')}
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {hasPassword
              ? t(
                  'Enter your current password, then the new one. If Supabase asks for extra verification, we email you a code.',
                  '请输入当前密码和新密码。如需额外验证，我们会向您的邮箱发送验证码。',
                )
              : t(
                  'You sign in with Google or Microsoft. Set a password to also sign in with your email address.',
                  '您目前通过 Google 或 Microsoft 登录。设置密码后也可以使用邮箱登录。',
                )}
          </p>
        </div>

        <NoticeLine notice={pwNotice} />

        <form onSubmit={handleSave} className="space-y-3" noValidate>
          {hasPassword && (
            <div>
              <label
                htmlFor="caaci-pw-current"
                className="block text-[11px] font-medium text-neutral-600 mb-1"
              >
                {t('Current Password', '当前密码')}
              </label>
              <input
                id="caaci-pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={inputCls}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="caaci-pw-new"
                className="block text-[11px] font-medium text-neutral-600 mb-1"
              >
                {t('New Password (8+ characters)', '新密码（至少 8 位）')}
              </label>
              <input
                id="caaci-pw-new"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label
                htmlFor="caaci-pw-new2"
                className="block text-[11px] font-medium text-neutral-600 mb-1"
              >
                {t('Confirm New Password', '确认新密码')}
              </label>
              <input
                id="caaci-pw-new2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 text-xs font-semibold cursor-pointer active:scale-98 disabled:opacity-60"
          >
            {saving
              ? t('Saving…', '保存中…')
              : hasPassword
                ? t('Update Password', '确认修改密码')
                : t('Set Password', '设置密码')}
          </button>

          {reauthOpen && (
            <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80 space-y-2.5">
              <p className="text-xs text-neutral-700">
                {t(
                  `We emailed a verification code to ${email}. Enter it below to finish.`,
                  `我们已向 ${email} 发送验证码，请在下方输入以完成修改。`,
                )}
              </p>
              <label
                htmlFor="caaci-pw-code"
                className="block text-[11px] font-medium text-neutral-600"
              >
                {t('Verification Code', '验证码')}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="caaci-pw-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={`${inputCls} sm:flex-1 font-mono tracking-widest`}
                />
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-brick text-white hover:brightness-110 text-xs font-semibold cursor-pointer whitespace-nowrap active:scale-98 disabled:opacity-60"
                >
                  {confirming ? t('Confirming…', '确认中…') : t('Confirm', '确认')}
                </button>
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={sendingCode || codeCooldown.left > 0}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-98"
                >
                  {sendingCode
                    ? t('Sending…', '发送中…')
                    : codeCooldown.left > 0
                      ? resendIn(codeCooldown.left)
                      : t('Resend code', '重新发送验证码')}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Email Change Section */}
      <div className="space-y-3 pt-5 border-t border-neutral-100">
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-neutral-900">
            {t('Change Email', '修改邮箱')}
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {t(
              `You sign in as ${email}. A confirmation link is sent to the new address; the change happens once it is confirmed.`,
              `您当前登录邮箱为 ${email}。系统会向新邮箱发送确认链接，确认后才会完成变更。`,
            )}
          </p>
        </div>

        <NoticeLine notice={emNotice} />

        <form onSubmit={handleEmail} className="flex flex-col sm:flex-row gap-2" noValidate>
          <label htmlFor="caaci-em-new" className="sr-only">
            {t('New email address', '新邮箱地址')}
          </label>
          <input
            id="caaci-em-new"
            type="email"
            autoComplete="email"
            placeholder={t('New email address', '新邮箱地址')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={`${inputCls} sm:flex-1`}
          />
          <button
            type="submit"
            disabled={emSaving}
            className="min-h-[44px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-98"
          >
            {emSaving ? t('Saving…', '保存中…') : t('Send Confirmation Email', '发送确认邮件')}
          </button>
        </form>

        {pendingEmail && (
          <button
            type="button"
            onClick={handleEmailResend}
            disabled={emResending || emCooldown.left > 0}
            className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-98"
          >
            {emResending
              ? t('Sending…', '发送中…')
              : emCooldown.left > 0
                ? resendIn(emCooldown.left)
                : t('Resend confirmation email', '重新发送确认邮件')}
          </button>
        )}
      </div>
    </div>
  );
}
