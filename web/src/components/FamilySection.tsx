import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  LogOut,
  Mail,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  History,
} from 'lucide-react';
import type { Lang } from '../lib/lang';
import type { ApiResult } from '../lib/api';
import { statusLabel } from '../lib/shared';
import {
  EMAIL_COOLDOWN_S,
  dropParams,
  errorText,
  familyAction,
  fmtDate,
  tr,
  useCooldown,
} from '../lib/account';
import type { FamilyActionData, FamilyData, FamilyInvite, FamilyPerson } from '../types/account';

interface FamilySectionProps {
  lang: Lang;
  /** GET /api/family, or null while loading / when it failed (the card hides). */
  family: FamilyData | null;
  loading: boolean;
  /** A reload after a change failed; the last good view stays on screen. */
  refreshFailed: boolean;
  signedInEmail: string;
  /** ?family_invite=<id> from the invitation email. Compared with server ids only. */
  focusInviteId: string;
  /** Fallback when the server omits can_start_family: own active family tier. */
  ownFamilyTier: boolean;
  /** "$62.10/yr" for the upsell, or null. */
  familyPriceLabel: string | null;
  onReload: () => Promise<void>;
  onNavigate: (page: string) => void;
}

type Notice = { ok: boolean; msg: string } | null;
type RunOpts = { ask?: string; success: (d: FamilyActionData) => string };

const RELATIONSHIPS = ['head', 'spouse', 'child', 'parent', 'other'];

// Own keys only, so "constructor" or "__proto__" from the server gets no label.
function relLabel(r: string | null, lang: Lang) {
  const t = tr(lang);
  const labels: Record<string, string> = {
    head: t('Head of household', '户主'),
    spouse: t('Spouse', '配偶'),
    child: t('Child', '子女'),
    parent: t('Parent', '父母'),
    other: t('Other', '其他'),
  };
  return r && Object.hasOwn(labels, r) ? labels[r] : '';
}

const EVENT_LABEL: Record<string, [string, string]> = {
  invite_sent: ['sent an invitation', '发送了邀请'],
  invite_cancelled: ['cancelled an invitation', '取消了邀请'],
  invite_declined: ['declined the invitation', '拒绝了邀请'],
  joined: ['joined the family', '加入了家庭'],
  left: ['left the family', '退出了家庭'],
  removed: ['removed a member', '移除了成员'],
  member_removed: ['removed a member', '移除了成员'],
  person_added: ['added a person without an account', '添加了未关联账号的成员'],
  person_removed: ['removed a person without an account', '移除了未关联账号的成员'],
  dissolved: ['dissolved the family', '解散了家庭'],
};

const PLAN_BADGE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  past_due: 'bg-orange-50 text-orange-700 border-orange-200',
  expired: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

const inputSm =
  'w-full min-h-[40px] px-3 py-2 text-xs bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brick disabled:bg-neutral-100 disabled:text-neutral-400';
const sectionLabel = 'text-xs font-bold text-neutral-700 block';

// One pending invitation: Cancel, and Resend with a 60 s cooldown per address
// (kept across reloads; a 429 from the server starts it too).
function PendingInviteRow({
  inv,
  lang,
  disabled,
  onCancel,
  onResent,
  onError,
}: {
  inv: FamilyInvite;
  lang: Lang;
  disabled: boolean;
  onCancel: (inv: FamilyInvite) => void;
  onResent: (inv: FamilyInvite) => Promise<void>;
  onError: (res: ApiResult<FamilyActionData>) => void;
}) {
  const t = tr(lang);
  const cooldown = useCooldown('family_invite', inv.email);
  const [sending, setSending] = useState(false);
  const rel = relLabel(inv.relationship, lang);

  const resend = async () => {
    if (sending || cooldown.left > 0) return;
    setSending(true);
    const res = await familyAction({ action: 'resend_invite', invite_id: inv.id });
    setSending(false);
    if (!res.ok) {
      onError(res);
      if (res.status === 429) {
        const wait = Number(res.data.retry_after);
        cooldown.start(wait > 0 ? wait : EMAIL_COOLDOWN_S);
      }
      return;
    }
    cooldown.start(EMAIL_COOLDOWN_S);
    await onResent(inv);
  };

  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
      <div className="flex items-start gap-2.5 min-w-0">
        <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-semibold text-neutral-800 font-mono break-all">{inv.email}</span>
          {(inv.full_name || rel) && (
            <span className="text-neutral-500 ml-1.5 break-words">
              {[inv.full_name, rel].filter(Boolean).join(' · ')}
            </span>
          )}
          <span className="text-[11px] text-neutral-400 block">
            {t('Sent', '发送于')} {fmtDate(inv.created_at, lang)} · {t('Expires', '过期时间')}{' '}
            {fmtDate(inv.expires_at, lang)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 pl-6 sm:pl-0">
        <button
          type="button"
          onClick={resend}
          disabled={sending || cooldown.left > 0}
          className="min-h-[36px] text-xs text-neutral-700 hover:text-brick cursor-pointer font-semibold hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
        >
          {sending
            ? t('Sending…', '发送中…')
            : cooldown.left > 0
              ? t(`Resend in ${cooldown.left}s`, `${cooldown.left} 秒后可重新发送`)
              : t('Resend', '重新发送')}
        </button>
        <button
          type="button"
          onClick={() => onCancel(inv)}
          disabled={disabled}
          className="min-h-[36px] text-xs text-neutral-500 hover:text-rose-600 cursor-pointer font-medium hover:underline disabled:opacity-50"
        >
          {t('Cancel invitation', '取消邀请')}
        </button>
      </div>
    </div>
  );
}

// The Family card — wireFamily in src/caaci-member.js, on GET/POST /api/family.
// The server enforces every rule; this mirrors them and shows its errors.
export function FamilySection({
  lang,
  family,
  loading,
  refreshFailed,
  signedInEmail,
  focusInviteId,
  ownFamilyTier,
  familyPriceLabel,
  onReload,
  onNavigate,
}: FamilySectionProps) {
  const t = tr(lang);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [focusId, setFocusId] = useState(focusInviteId);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef(false);
  const [showDissolveModal, setShowDissolveModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRel, setInviteRel] = useState('');
  const [addName, setAddName] = useState('');
  const [addRel, setAddRel] = useState('');
  const [rowInvite, setRowInvite] = useState<string | null>(null);
  const [rowEmail, setRowEmail] = useState('');
  const [showAllEvents, setShowAllEvents] = useState(false);

  // Scroll to the invitation the email link pointed at, once it is on screen.
  useEffect(() => {
    const el = focusRef.current;
    if (scrolled.current || !el || !el.getClientRects().length) return;
    scrolled.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  if (!family) {
    if (!loading) return null;
    return (
      <div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Users className="w-4 h-4 text-neutral-400" />
          <span>{t('Loading your family…', '正在加载家庭信息…')}</span>
        </div>
      </div>
    );
  }

  // One change at a time across the card: optional confirm, the server's error
  // or `success`, then a reload.
  const run = async (
    key: string,
    payload: Record<string, unknown>,
    opts: RunOpts,
  ): Promise<ApiResult<FamilyActionData> | null> => {
    if (busyRef.current) return null;
    if (opts.ask && !window.confirm(opts.ask)) return null;
    busyRef.current = true;
    setBusy(key);
    try {
      const res = await familyAction(payload);
      if (!res.ok) setNotice({ ok: false, msg: errorText(res, lang) });
      else {
        setNotice({ ok: true, msg: opts.success(res.data) });
        await onReload();
      }
      return res;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  // What went out after an invite: an invitation, or a sign-in link.
  const inviteSentText = (d: FamilyActionData, email: string) =>
    d.delivered === 'magic_link'
      ? t(
          `We emailed a sign-in link to ${email}. Once they sign in, they can accept your invitation on their account page.`,
          `已向 ${email} 发送登录链接。TA 登录后即可在账户页面接受你的邀请。`,
        )
      : t(`Invitation email sent to ${email}.`, `邀请邮件已发送至 ${email}。`);

  // An answered invitation is used up: its id must no longer read as "not found".
  const answered = (id: string) => {
    if (id && id === focusId) {
      setFocusId('');
      dropParams(['family_invite']);
    }
  };

  const role = family.role;
  const forMe = family.invitations_for_me;
  const canStart =
    role === 'none' &&
    (typeof family.can_start_family === 'boolean' ? family.can_start_family : ownFamilyTier);
  const seats = { used: Math.max(1, family.seats.used), limit: family.seats.limit || 3 };
  const full = seats.used >= seats.limit;
  const pending = family.invites.filter((i) => (i.status || 'pending') === 'pending');
  const missingFocus = !!focusId && !forMe.some((i) => i.id === focusId);
  const plan = family.plan ?? { tier_id: null, status: null, expires_at: null };
  const showSeats = role === 'founder' || canStart;

  const submitInvite = (e: FormEvent) => {
    e.preventDefault();
    if (full) return;
    const email = inviteEmail.trim();
    if (!email)
      return setNotice({ ok: false, msg: t('Enter an email address.', '请输入邮箱地址。') });
    const payload: Record<string, unknown> = { action: 'invite', email };
    if (inviteName.trim()) payload.full_name = inviteName.trim();
    if (inviteRel) payload.relationship = inviteRel;
    void run('invite', payload, { success: (d) => inviteSentText(d, email) }).then((res) => {
      if (res?.ok) {
        setInviteEmail('');
        setInviteName('');
        setInviteRel('');
      }
    });
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    if (full) return;
    const fullName = addName.trim();
    if (!fullName) return setNotice({ ok: false, msg: t('Enter a name.', '请输入姓名。') });
    const payload: Record<string, unknown> = { action: 'add_person', full_name: fullName };
    if (addRel) payload.relationship = addRel;
    void run('add', payload, {
      success: () => t(`${fullName} was added to your family.`, `已将 ${fullName} 添加到家庭。`),
    }).then((res) => {
      if (res?.ok) {
        setAddName('');
        setAddRel('');
      }
    });
  };

  // Inviting a name-only person carries their person_id, so accepting links the
  // existing row instead of taking a seat — which is why it works when full.
  const submitRowInvite = (e: FormEvent, p: FamilyPerson) => {
    e.preventDefault();
    const address = rowEmail.trim();
    if (!address)
      return setNotice({ ok: false, msg: t('Enter an email address.', '请输入邮箱地址。') });
    void run(
      `row-invite:${p.id}`,
      { action: 'invite', email: address, person_id: p.id },
      { success: (d) => inviteSentText(d, address) },
    ).then((res) => {
      if (res?.ok) {
        setRowInvite(null);
        setRowEmail('');
      }
    });
  };

  const removePerson = (p: FamilyPerson) => {
    const name = p.full_name || '';
    void run(
      `remove:${p.id}`,
      { action: 'remove_person', person_id: p.id },
      {
        ask: t(
          `Remove ${name} from your family? They will no longer be covered by your family plan.`,
          `确定将 ${name} 移出家庭？TA 将不再享有你的家庭会员权益。`,
        ),
        success: () => t(`${name} was removed from your family.`, `已将 ${name} 移出家庭。`),
      },
    );
  };

  const cancelInvite = (inv: FamilyInvite) =>
    void run(
      `cancel:${inv.id}`,
      { action: 'cancel_invite', invite_id: inv.id },
      {
        ask: t(`Cancel the invitation to ${inv.email}?`, `确定取消发给 ${inv.email} 的邀请？`),
        success: () =>
          t(`The invitation to ${inv.email} was cancelled.`, `已取消发给 ${inv.email} 的邀请。`),
      },
    );

  const relSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={full}
      aria-label={t('Relationship', '关系')}
      className={inputSm}
    >
      <option value="">{t('Relationship (optional)', '关系（可选）')}</option>
      {RELATIONSHIPS.map((r) => (
        <option key={r} value={r}>
          {relLabel(r, lang)}
        </option>
      ))}
    </select>
  );

  const planSummary = (extra?: { label: string; value: string }) => (
    <div className="space-y-3">
      <div className="text-sm font-bold text-neutral-900 break-words">
        {family.household?.name || t('Your family', '你的家庭')}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-neutral-400 block text-[10px]">{t('Family plan', '家庭会员')}</span>
          <span
            className={`inline-block mt-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${
              plan.status && Object.hasOwn(PLAN_BADGE, plan.status)
                ? PLAN_BADGE[plan.status]
                : 'bg-neutral-100 text-neutral-600 border-neutral-200'
            }`}
          >
            {statusLabel(plan.status, lang) || '—'}
          </span>
        </div>
        <div>
          <span className="text-neutral-400 block text-[10px]">
            {plan.status === 'active' ? t('Valid through', '有效期至') : t('Expires', '到期日期')}
          </span>
          <span className="font-semibold text-neutral-800 block mt-1">
            {fmtDate(plan.expires_at, lang)}
          </span>
        </div>
        {extra && (
          <div className="col-span-2">
            <span className="text-neutral-400 block text-[10px]">{extra.label}</span>
            <span className="font-semibold text-neutral-800 block mt-1 font-mono break-all">
              {extra.value}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const forms = () => (
    <div className="space-y-3">
      {full && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            {t(
              `Family is full (${seats.limit} people). Remove someone or cancel an invitation to add another person.`,
              `家庭已满（${seats.limit} 人）。请先移除成员或取消邀请，再添加其他人。`,
            )}
          </span>
        </div>
      )}

      <form
        onSubmit={submitInvite}
        noValidate
        className="pt-5 border-t border-neutral-200/80 space-y-3"
      >
        <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800">
          <UserPlus className="w-4 h-4 text-brick" />
          <span>{t('Invite by email', '通过邮箱邀请')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="fam-invite-email"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Email address', '邮箱地址')}
            </label>
            <input
              id="fam-invite-email"
              type="email"
              autoComplete="off"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={full}
              className={inputSm}
            />
          </div>
          <div>
            <label
              htmlFor="fam-invite-name"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Name (optional)', '姓名（可选）')}
            </label>
            <input
              id="fam-invite-name"
              type="text"
              autoComplete="off"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              disabled={full}
              className={inputSm}
            />
          </div>
          <div>
            <label
              htmlFor="fam-invite-rel"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Relationship', '关系')}
            </label>
            {relSelect(inviteRel, setInviteRel, 'fam-invite-rel')}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <p className="text-[11px] text-neutral-500">
            {t(
              'They get an email with a link to accept on their account page.',
              'TA 会收到邮件，点击链接后在账户页面接受邀请。',
            )}
          </p>
          <button
            type="submit"
            disabled={full || !!busy}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-brick hover:brightness-110 text-white text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {busy === 'invite' ? t('Working…', '处理中…') : t('Send invitation', '发送邀请')}
            </span>
          </button>
        </div>
      </form>

      <form
        onSubmit={submitAdd}
        noValidate
        className="pt-5 border-t border-neutral-200/80 space-y-3"
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800">
            <Users className="w-4 h-4 text-brick" />
            <span>{t('Add someone without an account', '添加没有账号的家人')}</span>
          </div>
          <p className="text-[11px] text-neutral-500">
            {t(
              `For example a young child with no email. They count toward the ${seats.limit} people.`,
              `例如还没有邮箱的年幼孩子。同样计入 ${seats.limit} 人名额。`,
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="fam-add-name"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Name', '姓名')}
            </label>
            <input
              id="fam-add-name"
              type="text"
              autoComplete="off"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              disabled={full}
              className={inputSm}
            />
          </div>
          <div>
            <label
              htmlFor="fam-add-rel"
              className="block text-[11px] font-medium text-neutral-600 mb-1"
            >
              {t('Relationship', '关系')}
            </label>
            {relSelect(addRel, setAddRel, 'fam-add-rel')}
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={full || !!busy}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-white border border-neutral-300 hover:border-neutral-900 text-neutral-800 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserPlus className="w-3.5 h-3.5 text-brick" />
            <span>{busy === 'add' ? t('Working…', '处理中…') : t('Add person', '添加')}</span>
          </button>
        </div>
      </form>
    </div>
  );

  const others = family.people.filter((p) => !p.is_founder).length;
  const shownEvents = showAllEvents ? family.events : family.events.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-bold text-ink">
          {lang === 'en' ? 'Family Plan & Shared Benefits' : '家庭方案与权益共享'}
        </h3>
        {showSeats && (
          <span className="text-xs font-semibold text-neutral-600 whitespace-nowrap">
            {seats.used} / {seats.limit} {t('people', '人')}
          </span>
        )}
      </div>

      {notice &&
        (notice.ok ? (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span className="break-words">{notice.msg}</span>
          </div>
        ) : (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="break-words">{notice.msg}</span>
          </div>
        ))}

      {refreshFailed && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          {t(
            'Couldn’t refresh your family — please reload the page.',
            '无法刷新家庭信息，请刷新页面。',
          )}
        </div>
      )}

      {/* Invitations addressed to the signed-in member (any role) */}
      {forMe.length > 0 && (
        <div className="space-y-3">
          <span className={sectionLabel}>{t('Invitations for you', '给你的邀请')}</span>
          {forMe.map((inv) => {
            const focused = !!focusId && inv.id === focusId;
            return (
              <div
                key={inv.id}
                ref={focused ? focusRef : undefined}
                aria-current={focused ? 'true' : undefined}
                className={`p-4 sm:p-5 rounded-2xl bg-amber-50 border space-y-3 ${
                  focused ? 'border-brick ring-2 ring-brick/25' : 'border-amber-200/90'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-amber-900 break-words">
                      <span className="font-bold">
                        {inv.founder_email || t('A family plan holder', '一位家庭会员持有人')}
                      </span>{' '}
                      {t(
                        'invited you to join their CAACI family membership.',
                        '邀请你加入 TA 的 CAACI 家庭会员。',
                      )}
                    </p>
                    {inv.household_name && (
                      <p className="text-xs text-amber-800 break-words">{inv.household_name}</p>
                    )}
                    <p className="text-[11px] text-amber-700/80">
                      {t('Expires', '过期时间')} {fmtDate(inv.expires_at, lang)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void run(
                        `accept:${inv.id}`,
                        { action: 'accept_invite', invite_id: inv.id },
                        {
                          success: () => {
                            answered(inv.id);
                            return t(
                              'You joined the family. Its plan benefits now apply to you.',
                              '你已加入该家庭，现可享受家庭会员权益。',
                            );
                          },
                        },
                      )
                    }
                    className="min-h-[38px] px-4 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-xs disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {busy === `accept:${inv.id}` ? t('Working…', '处理中…') : t('Accept', '接受')}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void run(
                        `decline:${inv.id}`,
                        { action: 'decline_invite', invite_id: inv.id },
                        {
                          ask: t(
                            `Decline the invitation from ${inv.founder_email || ''}?`,
                            `确定拒绝 ${inv.founder_email || ''} 的邀请？`,
                          ),
                          success: () => {
                            answered(inv.id);
                            return t('Invitation declined.', '已拒绝邀请。');
                          },
                        },
                      )
                    }
                    className="min-h-[38px] px-3.5 py-1.5 rounded-full bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <XCircle className="w-3.5 h-3.5 text-neutral-400" />
                    <span>
                      {busy === `decline:${inv.id}`
                        ? t('Working…', '处理中…')
                        : t('Decline', '拒绝')}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {missingFocus && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
          <p>
            {t(
              'That family invitation isn’t available. It may have expired or already been used, or it was sent to a different email address.',
              '该家庭邀请已不可用：可能已过期或已被使用，或者是发给另一个邮箱地址的。',
            )}
          </p>
          <p className="break-words">
            {t(`You are signed in as ${signedInEmail}.`, `你当前登录的邮箱是 ${signedInEmail}。`)}{' '}
            {t(
              'If needed, ask the person who invited you to send a new invitation to this address.',
              '如有需要，请让邀请人向这个邮箱重新发送邀请。',
            )}
          </p>
        </div>
      )}

      {/* FOUNDER VIEW */}
      {role === 'founder' && (
        <div className="space-y-6">
          {planSummary()}

          {/* People */}
          <div className="space-y-2 pt-5 border-t border-neutral-200/80">
            <div className="flex items-center justify-between">
              <span className={sectionLabel}>{t('People', '成员')}</span>
              <span className="text-[11px] text-neutral-500">
                {t(`max ${seats.limit}, including you`, `最多 ${seats.limit} 人（含你本人）`)}
              </span>
            </div>
            <div className="divide-y divide-neutral-200/80">
              {family.people.map((p) => {
                const rel = relLabel(p.relationship, lang);
                const last = !p.is_founder && others <= 1;
                const invited = !p.linked
                  ? pending.find((inv) => inv.person_id && inv.person_id === p.id)
                  : undefined;
                return (
                  <div key={p.id} className="py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-xs sm:text-sm font-semibold text-neutral-900 break-words">
                          {p.full_name || '—'}
                        </span>
                        {rel && <span className="text-xs text-neutral-500">{rel}</span>}
                        {p.is_founder && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brick/10 text-brick">
                            {t('Founder', '创建人')}
                          </span>
                        )}
                        {p.linked ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current">
                            {t('Linked account', '已关联账号')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current">
                            {t('Not linked to an account', '未关联账号')}
                          </span>
                        )}
                      </div>
                      {!p.is_founder && (
                        <button
                          type="button"
                          onClick={() => removePerson(p)}
                          disabled={last || !!busy}
                          className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                          title={t('Remove', '移除')}
                          aria-label={t('Remove', '移除')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {last && (
                      <p className="text-[11px] text-neutral-500">
                        {t(
                          'The last person besides you can’t be removed. Dissolve the family instead.',
                          '除你之外的最后一位成员无法移除，请改为解散家庭。',
                        )}
                      </p>
                    )}
                    {!p.linked && (
                      <div className="text-[11px] text-neutral-600 space-y-1.5">
                        <p>
                          {t(
                            'Once they have an email address, you can invite them so they can sign in.',
                            '等 TA 有了邮箱，你可以邀请 TA，这样 TA 就能登录。',
                          )}{' '}
                          <button
                            type="button"
                            disabled={!!invited}
                            onClick={() => {
                              setRowInvite(p.id);
                              setRowEmail('');
                            }}
                            className="text-brick font-semibold hover:underline cursor-pointer disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                          >
                            {t('Invite by email', '用邮箱邀请')}
                          </button>
                        </p>
                        {invited && (
                          <p className="text-neutral-500 break-words">
                            {t(
                              `Invitation pending to ${invited.email}`,
                              `已向 ${invited.email} 发送邀请，等待接受`,
                            )}
                          </p>
                        )}
                        {rowInvite === p.id && !invited && (
                          <form
                            onSubmit={(e) => submitRowInvite(e, p)}
                            noValidate
                            className="flex flex-col sm:flex-row gap-2"
                          >
                            <input
                              type="email"
                              autoFocus
                              autoComplete="off"
                              value={rowEmail}
                              onChange={(e) => setRowEmail(e.target.value)}
                              placeholder={t('Email address', '邮箱地址')}
                              aria-label={t('Email address', '邮箱地址')}
                              className={`${inputSm} sm:flex-1`}
                            />
                            <button
                              type="submit"
                              disabled={!!busy}
                              className="shrink-0 whitespace-nowrap min-h-[40px] px-3.5 py-2 rounded-lg bg-brick hover:brightness-110 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                            >
                              {busy === `row-invite:${p.id}`
                                ? t('Working…', '处理中…')
                                : t('Send invitation', '发送邀请')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRowInvite(null)}
                              className="shrink-0 whitespace-nowrap min-h-[40px] px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 text-xs font-medium cursor-pointer"
                            >
                              {t('Cancel', '取消')}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pending invitations */}
          {pending.length > 0 && (
            <div className="space-y-2 pt-5 border-t border-neutral-200/80">
              <span className={sectionLabel}>{t('Pending invitations', '待接受的邀请')}</span>
              <div className="divide-y divide-neutral-200/80">
                {pending.map((inv) => (
                  <PendingInviteRow
                    key={inv.id}
                    inv={inv}
                    lang={lang}
                    disabled={!!busy}
                    onCancel={cancelInvite}
                    onError={(res) => setNotice({ ok: false, msg: errorText(res, lang) })}
                    onResent={async (i) => {
                      setNotice({
                        ok: true,
                        msg: t(
                          `Invitation sent again to ${i.email}.`,
                          `已再次向 ${i.email} 发送邀请。`,
                        ),
                      });
                      await onReload();
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {forms()}

          {/* Family activity log */}
          {family.events.length > 0 && (
            <div className="space-y-2 pt-5 border-t border-neutral-200/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
                <History className="w-3.5 h-3.5 text-neutral-400" />
                <span>{t('Family Activity Log', '家庭动态记录')}</span>
              </div>
              <div className="divide-y divide-neutral-200/80">
                {shownEvents.map((ev, i) => {
                  const label = Object.hasOwn(EVENT_LABEL, ev.type) ? EVENT_LABEL[ev.type] : null;
                  // Name-only people have no email; their events carry subject_name.
                  const subject = ev.subject_email || ev.subject_name;
                  return (
                    <div
                      key={`${ev.created_at}-${i}`}
                      className="text-xs text-neutral-600 flex items-start gap-2 py-3"
                    >
                      <span className="font-mono text-[11px] text-neutral-400 shrink-0 mt-0.5">
                        {fmtDate(ev.created_at, lang, {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </span>
                      <span className="break-words min-w-0">
                        {ev.actor_email ? `${ev.actor_email} ` : ''}
                        {label ? t(label[0], label[1]) : ev.type}
                        {subject ? ` · ${subject}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
              {family.events.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllEvents((v) => !v)}
                  className="text-xs text-brick font-semibold hover:underline cursor-pointer py-1"
                >
                  {showAllEvents
                    ? t('Show less', '收起')
                    : t(
                        `Show all (${family.events.length})`,
                        `显示全部（${family.events.length}）`,
                      )}
                </button>
              )}
            </div>
          )}

          {/* Dissolve family */}
          <div className="pt-5 border-t border-neutral-200/80 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => setShowDissolveModal(true)}
              disabled={!!busy}
              className="min-h-[36px] text-xs text-rose-600 hover:text-rose-700 hover:underline cursor-pointer font-medium inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('Dissolve family', '解散家庭')}</span>
            </button>
            <p className="text-[11px] text-neutral-500 text-right">
              {t(
                'Ends the family. Everyone else loses the family plan benefits.',
                '解散后，其他所有成员都将失去家庭会员权益。',
              )}
            </p>
          </div>
        </div>
      )}

      {/* MEMBER VIEW */}
      {role === 'member' && (
        <div className="space-y-4">
          {planSummary({ label: t('Founder', '创建人'), value: family.founder?.email || '—' })}
          <p className="text-xs text-neutral-700 border-l-2 border-neutral-300 pl-3">
            {t(
              'While the family plan is active you share its benefits, including the digital membership card.',
              '家庭会员有效期间，你共享其会员权益，包括电子会员卡。',
            )}
          </p>
          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            disabled={!!busy}
            className="min-h-[40px] px-4 py-2 rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('Leave family', '退出家庭')}</span>
          </button>
        </div>
      )}

      {/* FAMILY PLAN, NO FAMILY YET */}
      {canStart && (
        <div className="space-y-4">
          <div className="space-y-2 text-center">
            <div className="w-11 h-11 rounded-full bg-brick/10 text-brick flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="text-base font-bold text-neutral-900">
              {t('Invite your family', '邀请家人')}
            </h4>
            <p className="text-xs text-neutral-600 max-w-md mx-auto">
              {t(
                `Your family plan covers up to ${seats.limit} people, you included. Invite family members by email, or add someone who has no account.`,
                `家庭会员最多包含 ${seats.limit} 人（含你本人）。可以通过邮箱邀请家人，也可以添加没有账号的家人。`,
              )}
            </p>
          </div>
          {forms()}
        </div>
      )}

      {/* NOT ON A FAMILY PLAN */}
      {role === 'none' && !canStart && forMe.length === 0 && !missingFocus && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-600">
            {familyPriceLabel
              ? t(
                  `Family benefits come with the CAACI Family membership (${familyPriceLabel}, incl. 3.5% card fee). It covers up to ${seats.limit} people, you included.`,
                  `家庭权益属于 CAACI 家庭会员（${familyPriceLabel}，含 3.5% 手续费），最多包含 ${seats.limit} 人（含你本人）。`,
                )
              : t(
                  `Family benefits come with the CAACI Family membership. It covers up to ${seats.limit} people, you included.`,
                  `家庭权益属于 CAACI 家庭会员，最多包含 ${seats.limit} 人（含你本人）。`,
                )}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('membership')}
            className="min-h-[40px] px-4 py-2 rounded-full bg-white border border-neutral-300 text-neutral-800 hover:border-brick text-xs font-semibold cursor-pointer"
          >
            {t('Explore Family Plan', '了解家庭方案详情')}
          </button>
        </div>
      )}

      {/* Dissolve Family confirmation */}
      {showDissolveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-neutral-900">
                {t('Dissolve your family?', '确认解散家庭？')}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {t(
                  'Everyone else loses the family plan benefits, including their digital membership card. Pending invitations are cancelled and people without an account are removed. This cannot be undone.',
                  '其他所有成员都将失去家庭会员权益，包括电子会员卡；待接受的邀请会被取消，未关联账号的成员会被移除。此操作无法撤销。',
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDissolveModal(false)}
                className="flex-1 min-h-[44px] py-2 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer"
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setShowDissolveModal(false);
                  void run(
                    'dissolve',
                    { action: 'dissolve' },
                    { success: () => t('Your family was dissolved.', '家庭已解散。') },
                  );
                }}
                className="flex-1 min-h-[44px] py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {t('Dissolve family', '确认解散')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Family confirmation */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-base font-bold text-neutral-900">
                {t('Leave this family?', '确定退出该家庭？')}
              </h4>
              <p className="text-xs text-neutral-500 mt-1">
                {t(
                  'You will lose the family plan benefits, including your digital membership card.',
                  '你将失去家庭会员权益，包括电子会员卡。',
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                className="flex-1 min-h-[44px] py-2 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer"
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  setShowLeaveModal(false);
                  void run(
                    'leave',
                    { action: 'leave' },
                    { success: () => t('You left the family.', '你已退出家庭。') },
                  );
                }}
                className="flex-1 min-h-[44px] py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {t('Leave family', '确认退出')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
