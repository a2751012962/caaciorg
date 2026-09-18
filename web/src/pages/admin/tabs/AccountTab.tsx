import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AuthError, User } from '@supabase/supabase-js';
import { KeyRound, RotateCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { listExit, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  Field,
  INPUT,
  Notice,
  PRIMARY,
  Panel,
  SECONDARY,
  Spinner,
  TabHeader,
  useAdmin,
} from '../kit';
import { useTick, type Msg } from './members/shared';

// The signed-in admin's own password. Mirrors the member account page: an
// email/password login confirms its current password, a Google/Microsoft-only
// login sets a first one, and when Supabase answers "reauthentication needed"
// it emails a code that goes back as `nonce`. No admin endpoint is involved:
// /api/admin/member-password refuses the caller's own account on purpose.
const hasPasswordLogin = (user: User) =>
  (user.identities || []).some((i) => i.provider === 'email') ||
  ((user.app_metadata?.providers as string[] | undefined) || []).includes('email');

const needsReauth = (error: AuthError | null) =>
  !!error &&
  (error.code === 'reauthentication_needed' || /reauthenticat/i.test(error.message || ''));

const REAUTH_COOLDOWN_MS = 60_000; // Supabase sends at most one auth email a minute

export default function AccountTab() {
  const { t } = useAdmin();
  const [user, setUser] = useState<User | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return setFailed(true);
    setUser(data.user);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('My password', '我的密码')}
        description={t('Signed-in administrator', '当前管理员')}
      />
      {user ? (
        <MyPassword user={user} />
      ) : failed ? (
        <div className="space-y-3 max-w-xl">
          <Notice tone="error">
            {t('Could not load your account. Please try again.', '无法加载账号信息，请重试。')}
          </Notice>
          <button type="button" className={SECONDARY} onClick={() => void load()}>
            <RotateCw className="w-4 h-4" aria-hidden />
            {t('Try again', '重试')}
          </button>
        </div>
      ) : (
        <Spinner label={t('Loading…', '加载中…')} />
      )}
    </div>
  );
}

function MyPassword({ user }: { user: User }) {
  const { t } = useAdmin();
  const [hasPassword, setHasPassword] = useState(() => hasPasswordLogin(user));
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [code, setCode] = useState('');
  const [reauth, setReauth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const now = useTick(resendUntil > Date.now());
  const left = Math.ceil((resendUntil - now) / 1000);
  const resendLabel = t('Resend code', '重新发送验证码');

  // The update the fields describe right now, read at Save and again at
  // Confirm. Null after saying what is wrong.
  const passwordUpdate = () => {
    let problem = '';
    if (hasPassword && !current) problem = t('Enter your current password.', '请输入当前密码。');
    else if (next.length < 8)
      problem = t('Password must be at least 8 characters.', '密码至少 8 位。');
    else if (next !== next2) problem = t('Passwords do not match.', '两次输入的密码不一致。');
    if (problem) {
      setMsg({ tone: 'error', text: problem });
      return null;
    }
    return hasPassword ? { password: next, current_password: current } : { password: next };
  };

  const sendCode = async () => {
    setSending(true);
    const { error } = await supabase.auth.reauthenticate();
    setSending(false);
    if (error) return setMsg({ tone: 'error', text: error.message });
    setResendUntil(Date.now() + REAUTH_COOLDOWN_MS);
  };

  const saved = () => {
    const text = hasPassword
      ? t('Password updated.', '密码已更新。')
      : t(
          'Password set — you can now also sign in with your email address.',
          '密码已设置，现在也可以使用邮箱登录。',
        );
    setReauth(false);
    setHasPassword(true);
    setCurrent('');
    setNext('');
    setNext2('');
    setCode('');
    setMsg({ tone: 'success', text });
  };

  const save = async () => {
    const attrs = passwordUpdate();
    if (!attrs) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser(attrs);
    setSaving(false);
    if (needsReauth(error)) {
      setMsg(null);
      setReauth(true);
      // A code sent moments ago (Resend still counting down) is still valid.
      if (resendUntil <= Date.now()) await sendCode();
      return;
    }
    if (error) return setMsg({ tone: 'error', text: error.message });
    saved();
  };

  const confirm = async () => {
    if (!reauth) return;
    const attrs = passwordUpdate();
    if (!attrs) return;
    const nonce = code.trim();
    if (!nonce)
      return setMsg({
        tone: 'error',
        text: t('Enter the code from the email.', '请输入邮件中的验证码。'),
      });
    setConfirming(true);
    const { error } = await supabase.auth.updateUser({ ...attrs, nonce });
    setConfirming(false);
    if (error) return setMsg({ tone: 'error', text: error.message });
    saved();
  };

  return (
    <Panel className="max-w-xl space-y-5">
      <p className="text-sm text-neutral-700">
        {t('Signed in as', '当前登录账号：')}{' '}
        <strong className="text-ink break-all">{user.email}</strong>
      </p>
      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* lets password managers pair the fields with the account */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={user.email ?? ''}
          readOnly
          hidden
        />
        {hasPassword ? (
          <Field label={t('Current password', '当前密码')}>
            <input
              type="password"
              className={INPUT}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
        ) : (
          <p className="text-sm text-neutral-500">
            {t(
              'You sign in with Google or Microsoft. Set a password to also sign in with your email address.',
              '您目前通过 Google 或 Microsoft 登录。设置密码后也可以使用邮箱登录。',
            )}
          </p>
        )}
        <Field label={t('New password (at least 8 characters)', '新密码（至少 8 位）')}>
          <input
            type="password"
            className={INPUT}
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label={t('Confirm new password', '确认新密码')}>
          <input
            type="password"
            className={INPUT}
            autoComplete="new-password"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
          />
        </Field>
        <button type="submit" className={PRIMARY} disabled={saving}>
          <KeyRound className="w-4 h-4" aria-hidden />
          {hasPassword ? t('Change password', '修改密码') : t('Set password', '设置密码')}
        </button>
      </form>

      <AnimatePresence initial={false}>
        {reauth && (
          <motion.div
            key="reauth"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
            className="space-y-4 pt-5 border-t border-neutral-200/80"
          >
            <p className="text-sm text-neutral-700">
              {t(
                `We emailed a verification code to ${user.email}. Enter it below to finish.`,
                `我们已向 ${user.email} 发送验证码，请在下方输入以完成修改。`,
              )}
            </p>
            <Field label={t('Verification code', '验证码')}>
              <input
                className={`${INPUT} font-mono tracking-widest`}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void confirm();
                  }
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={confirming}
                onClick={() => void confirm()}
              >
                {t('Confirm', '确认')}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={sending || left > 0}
                onClick={() => void sendCode()}
              >
                {left > 0 ? `${resendLabel} (${left}s)` : resendLabel}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Panel>
  );
}
