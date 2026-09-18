import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { Lang } from '../../lib/lang';
import { normalizePhone } from '../../lib/shared';
import {
  EMAIL_COOLDOWN_S,
  EMAIL_RE,
  SMS_COOLDOWN_S,
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

// The mobile number Supabase will text a sign-in code to: only one it has confirmed.
const verifiedPhoneOf = (user: User) => (user.phone_confirmed_at && user.phone) || '';

type AuthError = { message?: string; code?: string; status?: number } | null;

// Change / set password (with Supabase's reauthentication code when it asks for
// one), change email, and add the mobile number for the phone tab on /login-3/.
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

  // ---- mobile number (sign in by text message) ----
  // updateUser({ phone }) has Supabase text a code to the new number and keeps
  // the old one until verifyOtp(type 'phone_change') confirms it. With "Enable
  // phone confirmations" switched off in the dashboard, Supabase saves the
  // number at once instead and there is no code step; the reply says which.
  const [verifiedPhone, setVerifiedPhone] = useState(() => verifiedPhoneOf(user));
  const [newPhone, setNewPhone] = useState('');
  const [pendingPhone, setPendingPhone] = useState(''); // E.164, awaiting its code
  const [phCode, setPhCode] = useState('');
  const [phSaving, setPhSaving] = useState(false);
  const [phConfirming, setPhConfirming] = useState(false);
  const [phResending, setPhResending] = useState(false);
  const [phNotice, setPhNotice] = useState<Notice>(null);
  // One pending number per account, so the countdown is keyed by the account.
  const phCooldown = useCooldown('sms_change', user.id);

  useEffect(() => {
    // Supabase hands over a fresh user after the change is confirmed.
    setVerifiedPhone(verifiedPhoneOf(user));
  }, [user.id, user.phone, user.phone_confirmed_at]);

  const phoneSaved = (phone: string) => {
    setVerifiedPhone(phone);
    setPendingPhone('');
    setNewPhone('');
    setPhCode('');
    setPhNotice({
      ok: true,
      msg: t(
        `Mobile number saved. You can now sign in with a code texted to ${phone}.`,
        `手机号已保存。现在可以用发送到 ${phone} 的短信验证码登录。`,
      ),
    });
  };

  const phoneProblem = (error: NonNullable<AuthError>) =>
    error.code === 'phone_exists' || /already\s+(been\s+)?registered/i.test(error.message || '')
      ? t('That number is already on another account.', '该手机号已被其他账户使用。')
      : error.code === 'sms_send_failed'
        ? t(
            'We could not send a text to that number right now. Check it and try again in a moment.',
            '暂时无法向该号码发送短信。请核对号码后稍后重试。',
          )
        : error.message || network;

  const handlePhone = async (e: FormEvent) => {
    e.preventDefault();
    if (phSaving) return;
    const value = normalizePhone(newPhone);
    if (!value)
      return setPhNotice({
        ok: false,
        msg: t(
          'Enter a valid mobile number. Outside the US and Canada, start with + and the country code.',
          '请输入有效的手机号。美国/加拿大以外的号码请以 + 和国家代码开头。',
        ),
      });
    if (value === verifiedPhone)
      return setPhNotice({
        ok: false,
        msg: t('That is already the mobile number on your account.', '这已经是您账户上的手机号。'),
      });
    setPhSaving(true);
    setPhNotice(null);
    let updated: User | null = null;
    let error: AuthError = null;
    try {
      const res = await supabase.auth.updateUser({ phone: value });
      updated = res.data.user;
      error = res.error;
    } catch {
      error = { message: network };
    }
    setPhSaving(false);
    if (error) {
      setPhNotice({ ok: false, msg: phoneProblem(error) });
      const wait = emailRetryAfter(error);
      if (wait) phCooldown.start(wait);
      return;
    }
    if (updated && verifiedPhoneOf(updated) === value) return phoneSaved(value); // no code step
    setPendingPhone(value);
    setPhCode('');
    setPhNotice({
      ok: true,
      msg: t(
        `We texted a code to ${value}. Enter it below to finish.`,
        `验证码已发送到 ${value}，请在下方输入以完成绑定。`,
      ),
    });
    phCooldown.start(SMS_COOLDOWN_S);
  };

  const handlePhoneConfirm = async () => {
    if (phConfirming || !pendingPhone) return;
    const token = phCode.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token))
      return setPhNotice({
        ok: false,
        msg: t('Enter the code from the text message.', '请输入短信中的验证码。'),
      });
    setPhConfirming(true);
    let error: AuthError = null;
    try {
      ({ error } = await supabase.auth.verifyOtp({
        phone: pendingPhone,
        token,
        type: 'phone_change',
      }));
    } catch {
      error = { message: network };
    }
    setPhConfirming(false);
    if (error)
      return setPhNotice({
        ok: false,
        msg: t(
          'That code is wrong or has expired — request a new one.',
          '验证码错误或已过期，请重新获取。',
        ),
      });
    phoneSaved(pendingPhone);
  };

  const handlePhoneResend = async () => {
    if (phResending || phCooldown.left > 0 || !pendingPhone) return;
    setPhResending(true);
    let error: AuthError = null;
    try {
      ({ error } = await supabase.auth.resend({ type: 'phone_change', phone: pendingPhone }));
    } catch {
      error = { message: network };
    }
    setPhResending(false);
    if (error) {
      setPhNotice({ ok: false, msg: phoneProblem(error) });
      const wait = emailRetryAfter(error);
      if (wait) phCooldown.start(wait);
      return;
    }
    setPhNotice({
      ok: true,
      msg: t(`Code sent again to ${pendingPhone}.`, `验证码已重新发送到 ${pendingPhone}。`),
    });
    phCooldown.start(SMS_COOLDOWN_S);
  };

  const resendIn = (left: number) => t(`Resend in ${left}s`, `${left} 秒后可重新发送`);

  return (
    <div id="account-security" className={`${className} space-y-6 scroll-mt-24`}>
      <div className="flex items-center gap-2">
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
            <div className="pt-5 border-t border-neutral-200/80 space-y-2.5">
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
                  className="shrink-0 whitespace-nowrap min-h-[44px] px-5 py-2 rounded-xl bg-brick text-white hover:brightness-110 text-xs font-semibold cursor-pointer active:scale-98 disabled:opacity-60"
                >
                  {confirming ? t('Confirming…', '确认中…') : t('Confirm', '确认')}
                </button>
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={sendingCode || codeCooldown.left > 0}
                  className="shrink-0 whitespace-nowrap min-h-[44px] px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
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
      <div className="space-y-3 pt-5 border-t border-neutral-200/80">
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
            className="shrink-0 whitespace-nowrap min-h-[44px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 active:scale-98"
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

      {/* Mobile Number Section (sign in with a texted code) */}
      <div id="account-phone" className="space-y-3 pt-5 border-t border-neutral-200/80">
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-neutral-900">
            {verifiedPhone
              ? t('Mobile Number for Sign-in', '登录手机号')
              : t('Sign in with a Mobile Number', '手机号登录')}
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {verifiedPhone
              ? t(
                  `You can sign in with a code texted to ${verifiedPhone}. Enter a new number below to change it; the old one works until the new one is confirmed.`,
                  `您可以用发送到 ${verifiedPhone} 的短信验证码登录。在下方输入新号码即可更换；新号码确认前旧号码仍可使用。`,
                )
              : t(
                  'Add a mobile number and the sign-in page can text you a one-time code instead of asking for your password. US and Canadian numbers as 10 digits; elsewhere start with + and the country code.',
                  '添加手机号后，登录页可以向您发送一次性短信验证码，无需输入密码。美国/加拿大号码直接输入 10 位数字；其他国家请以 + 和国家代码开头。',
                )}
          </p>
        </div>

        <NoticeLine notice={phNotice} />

        <form onSubmit={handlePhone} className="flex flex-col sm:flex-row gap-2" noValidate>
          <label htmlFor="caaci-ph-new" className="sr-only">
            {t('Mobile number', '手机号')}
          </label>
          <input
            id="caaci-ph-new"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder={verifiedPhone ? t('New mobile number', '新手机号') : '(217) 555-0123'}
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            className={`${inputCls} sm:flex-1`}
          />
          <button
            type="submit"
            disabled={phSaving}
            className="shrink-0 whitespace-nowrap min-h-[44px] px-5 py-2.5 rounded-full bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 active:scale-98"
          >
            {phSaving
              ? t('Sending…', '发送中…')
              : verifiedPhone
                ? t('Change Number', '更换手机号')
                : t('Add Mobile Number', '添加手机号')}
          </button>
        </form>

        {pendingPhone && (
          <div className="space-y-2.5">
            <label
              htmlFor="caaci-ph-code"
              className="block text-[11px] font-medium text-neutral-600"
            >
              {t('Code from the text message', '短信中的验证码')}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="caaci-ph-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={phCode}
                onChange={(e) => setPhCode(e.target.value)}
                className={`${inputCls} sm:flex-1 font-mono tracking-widest`}
              />
              <button
                type="button"
                onClick={handlePhoneConfirm}
                disabled={phConfirming}
                className="shrink-0 whitespace-nowrap min-h-[44px] px-5 py-2 rounded-xl bg-brick text-white hover:brightness-110 text-xs font-semibold cursor-pointer active:scale-98 disabled:opacity-60"
              >
                {phConfirming ? t('Confirming…', '确认中…') : t('Confirm', '确认')}
              </button>
              <button
                type="button"
                onClick={handlePhoneResend}
                disabled={phResending || phCooldown.left > 0}
                className="shrink-0 whitespace-nowrap min-h-[44px] px-4 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
              >
                {phResending
                  ? t('Sending…', '发送中…')
                  : phCooldown.left > 0
                    ? resendIn(phCooldown.left)
                    : t('Text the code again', '重新发送短信')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
