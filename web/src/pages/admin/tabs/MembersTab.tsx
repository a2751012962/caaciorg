import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Home, KeyRound, Mail, Pencil, Plus, Search as SearchIcon, X } from 'lucide-react';
import { listExit, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DataTable,
  EYEBROW,
  Field,
  INPUT,
  InlineConfirm,
  LiquidToggle,
  Loaded,
  Notice,
  PRIMARY,
  Pager,
  ROW_BTN,
  SECONDARY,
  SELECT,
  Status,
  TEXTAREA,
  TabHeader,
  dateInput,
  fmtDate,
  memberStatusLabel,
  memberStatusTone,
  useAdmin,
  useLoad,
  useTabParams,
} from '../kit';
import {
  HouseholdOptions,
  StatusOptions,
  TierOptions,
  useAsk,
  useTick,
  type Household,
  type HouseholdsAnswer,
  type MemberRow,
  type Msg,
} from './members/shared';

const ENDPOINT = '/api/admin/members';
const LIMIT = 25;

const SORTS: [string, string, string][] = [
  ['created_at.desc', 'Newest added', '最新加入'],
  ['created_at.asc', 'Oldest added', '最早加入'],
  ['full_name.asc', 'Name A–Z', '姓名 A–Z'],
  ['full_name.desc', 'Name Z–A', '姓名 Z–A'],
  ['email.asc', 'Email A–Z', '邮箱 A–Z'],
  ['email.desc', 'Email Z–A', '邮箱 Z–A'],
  ['expires_at.asc', 'Expires soonest', '到期最早'],
  ['expires_at.desc', 'Expires latest', '到期最晚'],
  ['member_since.asc', 'Member longest', '入会最早'],
  ['member_since.desc', 'Member newest', '入会最晚'],
];

// Supabase sends at most one auth email per user a minute. The expiry is kept
// per member + action outside the component, so closing and reopening an
// editor (or the list reloading) resumes the countdown instead of resetting it.
const AUTH_EMAIL_COOLDOWN_MS = 60_000;
const cooldownUntil = new Map<string, number>();

// Members & Subscriptions: search / filter / sort / page the members list,
// add a member (creates a login), and an inline editor per row with plan
// changes (guarded by the emailed code), auth emails and a direct password.
// functions/api/admin/members.js, member-email.js, member-password.js,
// households.js (the Family dropdown).
export default function MembersTab() {
  const { t, api, tiers, toast } = useAdmin();
  const params = useTabParams();
  const [qInput, setQInput] = useState(params.q ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [sort, setSort] = useState('created_at.desc');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const setMsg = (id: string, m: Msg) => setMsgs((all) => ({ ...all, [id]: m }));

  // Search waits for a 300 ms pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const list = useLoad(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (sort) p.set('sort', sort);
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (tier) p.set('tier_id', tier);
    return api<{ rows: MemberRow[]; total: number }>(`${ENDPOINT}?${p}`);
  }, [q, status, tier, sort, offset]);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  // Families for the editor's Family dropdown. Until they have loaded once the
  // dropdown only offers "— none —", so the editor must not send it.
  const [households, setHouseholds] = useState<Household[] | null>(null);
  useEffect(() => {
    void api<HouseholdsAnswer>('/api/admin/households').then((r) => {
      if (r.ok) setHouseholds(r.data.rows ?? []);
    });
  }, [api]);

  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setOffset(0);
  };

  const toggle = (id: string) => {
    setOpen((o) => (o === id ? null : id));
    setMsg(id, null);
  };

  const remove = async (m: MemberRow) => {
    const res = await api(`${ENDPOINT}?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    if (!res.ok) {
      setMsg(m.id, { tone: 'error', text: res.data.error || t('Delete failed.', '删除失败。') });
      return;
    }
    if (open === m.id) setOpen(null);
    toast('success', t(`Deleted ${m.full_name || m.email}.`, `已删除 ${m.full_name || m.email}。`));
    await list.reload();
  };

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Members & Subscriptions', '会员与订阅')}
        description={
          list.data
            ? total === 0
              ? t('No members match the filters.', '没有符合筛选条件的会员。')
              : t(total === 1 ? '1 member' : `${total} members`, `共 ${total} 位会员`)
            : undefined
        }
        actions={
          <button type="button" className={PRIMARY} onClick={() => setAdding((a) => !a)}>
            {adding ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {adding ? t('Cancel', '取消') : t('Add member', '添加会员')}
          </button>
        }
      />

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            key="add"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <AddMember
              households={households ?? []}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false);
                setOffset(0);
                void list.reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search on its own line, the three narrowers side by side under it: at
          any width they share one row, so none of them is ever left standing
          alone on a line of its own. */}
      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">{t('Search name or email', '搜索姓名或邮箱')}</span>
          <SearchIcon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            className={`${INPUT} pl-10`}
            placeholder={t('Search name or email', '搜索姓名或邮箱')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            className={SELECT}
            value={status}
            onChange={(e) => filter(setStatus)(e.target.value)}
            aria-label={t('Status', '状态')}
          >
            <option value="">{t('All statuses', '全部状态')}</option>
            <StatusOptions />
          </select>
          <select
            className={SELECT}
            value={tier}
            onChange={(e) => filter(setTier)(e.target.value)}
            aria-label={t('Tier', '类型')}
          >
            <option value="">{t('All tiers', '全部类型')}</option>
            {tiers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className={SELECT}
            value={sort}
            onChange={(e) => filter(setSort)(e.target.value)}
            aria-label={t('Sort', '排序')}
          >
            {SORTS.map(([v, en, zh]) => (
              <option key={v} value={v}>
                {t(en, zh)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
        empty={t('No members', '暂无会员')}
      >
        <DataTable
          rows={rows}
          rowKey={(m) => m.id}
          columns={[
            // Name and email are one column, stacked: five columns across the
            // console's ~700px leave an address so little room that it breaks
            // mid-domain ("…@exam / ple.com"). One wide column fits both.
            {
              key: 'member',
              label: t('Member', '会员'),
              render: (m) => (
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{m.full_name || '—'}</div>
                  <div className="text-xs text-neutral-500 break-all">{m.email}</div>
                </div>
              ),
            },
            { key: 'tier', label: t('Tier', '类型'), render: (m) => <TierLabel id={m.tier_id} /> },
            // Status and date are short and must stay on one line: the member
            // column takes what is left rather than breaking "已过期" in two.
            {
              key: 'status',
              label: t('Status', '状态'),
              className: 'whitespace-nowrap',
              render: (m) => (
                <Status tone={memberStatusTone(m.status)}>{memberStatusLabel(t, m.status)}</Status>
              ),
            },
            {
              key: 'expires',
              label: t('Expires', '到期'),
              className: 'whitespace-nowrap',
              render: (m) => <FmtDate d={m.expires_at} />,
            },
          ]}
          actions={(m) => (
            <button
              type="button"
              className={ROW_BTN}
              aria-expanded={open === m.id}
              onClick={() => toggle(m.id)}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              {open === m.id ? t('Close', '收起') : t('Edit', '编辑')}
            </button>
          )}
          expand={(m) =>
            open === m.id ? (
              <Editor
                key={m.id}
                m={m}
                households={households}
                msg={msgs[m.id] ?? null}
                setMsg={(x) => setMsg(m.id, x)}
                onSaved={() => void list.reload()}
                onDelete={() => void remove(m)}
              />
            ) : null
          }
        />
        {/* The count of everything that matches is in the header; the pager
            only appears once there is more than one page of it. */}
        <Pager offset={offset} limit={LIMIT} total={total} onPage={setOffset} />
      </Loaded>
    </div>
  );
}

function TierLabel({ id }: { id: string | null }) {
  return <>{useAdmin().tierName(id)}</>;
}
function FmtDate({ d }: { d: string | null }) {
  return <>{fmtDate(useAdmin().lang, d)}</>;
}

// ------------------------------------------------------------------ editor

function Editor({
  m,
  households,
  msg,
  setMsg,
  onSaved,
  onDelete,
}: {
  m: MemberRow;
  households: Household[] | null;
  msg: Msg;
  setMsg: (m: Msg) => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const { t, api, guarded, myId, tierName, go } = useAdmin();
  const { ask, panel } = useAsk({ ruled: false });
  const [status, setStatus] = useState(m.status || 'active');
  const [tierId, setTierId] = useState(m.tier_id || '');
  const [expires, setExpires] = useState(dateInput(m.expires_at));
  const [householdId, setHouseholdId] = useState(m.household_id || '');
  const [saving, setSaving] = useState(false);
  const loaded = households !== null;
  const who = m.full_name || m.email || '';
  const statusLabel = (s: string | null) => memberStatusLabel(t, s);

  const save = () => {
    const body: Record<string, string> = {
      id: m.id,
      status,
      tier_id: tierId,
      expires_at: expires,
    };
    // Left out, the API keeps the member's family as it is.
    if (loaded) body.household_id = householdId;
    // A second look before anything is written: what changes, for whom.
    const changes: string[] = [];
    if (status !== m.status)
      changes.push(`${t('status', '状态')}: ${statusLabel(m.status)} → ${statusLabel(status)}`);
    if (tierId !== (m.tier_id || ''))
      changes.push(
        `${t('plan', '方案')}: ${m.tier_id ? tierName(m.tier_id) : t('none', '无')} → ${tierId ? tierName(tierId) : t('none', '无')}`,
      );
    const expWas = dateInput(m.expires_at);
    if (expires !== expWas)
      changes.push(`${t('expires', '到期')}: ${expWas || '—'} → ${expires || '—'}`);
    if (loaded && householdId !== (m.household_id || '')) changes.push(t('family', '家庭'));
    ask(
      changes.length
        ? t(
            `Save these changes to ${who}?\n\n${changes.join('\n')}`,
            `确认保存对 ${who} 的以下修改？\n\n${changes.join('\n')}`,
          )
        : t(`Save ${who} with no changes?`, `${who} 没有改动，仍然保存？`),
      t('Save', '保存'),
      async () => {
        setSaving(true);
        // A plan change also needs the emailed verification code (the API insists).
        const res = await guarded((headers) => api(ENDPOINT, { method: 'POST', body, headers }));
        setSaving(false);
        if (res.cancelled) return;
        if (!res.ok)
          return setMsg({
            tone: 'error',
            text: res.data.error || t('Update failed.', '更新失败。'),
          });
        setMsg({ tone: 'success', text: t('Saved.', '已保存。') });
        onSaved();
      },
    );
  };

  return (
    // A rule down the left ties the panel to the row it belongs to, and the
    // editor falls into three groups: what the membership is, how the member
    // signs in, and — on its own, at the end — the one irreversible action.
    // Four across only above xl: below it the console's column is ~700px, and
    // four controls there are narrower than the words inside them.
    <div className="border-l-2 border-brick/40 pl-4 sm:pl-5">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t('Status', '状态')}>
            <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)}>
              <StatusOptions />
            </select>
          </Field>
          <Field label={t('Tier', '类型')}>
            <select className={SELECT} value={tierId} onChange={(e) => setTierId(e.target.value)}>
              <TierOptions />
            </select>
          </Field>
          <Field label={t('Expires', '到期')}>
            <input
              type="date"
              className={INPUT}
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
          <Field
            label={t('Family', '家庭')}
            hint={
              loaded
                ? undefined
                : t(
                    "Families couldn't be loaded, so family is unchanged",
                    '家庭列表加载失败，家庭不会被修改',
                  )
            }
          >
            <select
              className={SELECT}
              value={loaded ? householdId : ''}
              disabled={!loaded}
              onChange={(e) => setHouseholdId(e.target.value)}
            >
              <HouseholdOptions households={households ?? []} />
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={saving} onClick={save}>
            {t('Save', '保存')}
          </button>
          {m.household_id && (
            <button
              type="button"
              className={SECONDARY}
              onClick={() => go('families', { household: m.household_id as string })}
            >
              <Home className="w-4 h-4" aria-hidden />
              {t('Open family', '查看家庭')}
            </button>
          )}
        </div>

        {panel}
      </div>

      <div className="mt-5 pt-5 border-t border-neutral-200/80 space-y-3">
        <span className={EYEBROW}>{t('Sign-in & password', '登录与密码')}</span>
        <AuthEmails m={m} setMsg={setMsg} />
        {m.id === myId ? (
          <p className="text-xs text-neutral-500">
            {t(
              'To change your own password, use the My account tab.',
              '修改自己的密码请到“我的账号”标签页。',
            )}
          </p>
        ) : (
          <SetPassword m={m} setMsg={setMsg} />
        )}
      </div>

      {/* Last, alone, and behind its own confirm: the only thing here that
          cannot be taken back. */}
      <div className="mt-5 pt-5 border-t border-neutral-200/80 space-y-2">
        <InlineConfirm
          label={t('Delete member', '删除会员')}
          keepLabel={t('Keep', '保留')}
          confirmLabel={t('Delete + login', '删除及登录账户')}
          doneLabel={t('Deleting…', '即将删除…')}
          undoLabel={t('Undo', '撤销')}
          disabled={m.id === myId}
          onCommit={onDelete}
        />
        <p className="text-[11px] text-neutral-500">
          {m.id === myId
            ? t('You cannot delete your own account.', '不能删除自己的账户。')
            : t('Deleting also removes their login account.', '删除会员将同时删除其登录账户。')}
        </p>
      </div>

      {msg && (
        <div className="mt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
    </div>
  );
}

// Password reset / invitation emails, each with a 60 s countdown after a send
// (or after the server says one went out very recently). It asks for itself, so
// the question appears under the buttons that raised it.
function AuthEmails({ m, setMsg }: { m: MemberRow; setMsg: (x: Msg) => void }) {
  const { t, api } = useAdmin();
  const { ask, panel } = useAsk({ ruled: false });
  const [busy, setBusy] = useState<string | null>(null);
  const cooling = (a: string) => (cooldownUntil.get(`${m.id}:${a}`) ?? 0) > Date.now();
  const now = useTick(cooling('reset') || cooling('invite'));
  const who = m.full_name || m.email || '';

  const kinds = {
    reset: {
      label: t('Send password reset', '发送重置密码邮件'),
      ask: t(`Email ${who} a link to set a new password?`, `向 ${who} 发送设置新密码的链接？`),
      done: t(`Password reset email sent to ${who}.`, `已向 ${who} 发送重置密码邮件。`),
      passwordSetup: '',
    },
    invite: {
      label: t('Send invitation', '发送邀请邮件'),
      ask: t(
        `Email ${who} a link to set up their login? Members without a login get an invitation; existing accounts get a password-setup link.`,
        `向 ${who} 发送登录设置链接？尚未启用登录的会员会收到邀请邮件；已有账户的会员会收到设置密码的链接。`,
      ),
      done: t(`Invitation sent to ${who}.`, `已向 ${who} 发送邀请邮件。`),
      // The server sends an existing account the password-setup email instead.
      passwordSetup: t(
        `${who} already has an account, so they were emailed a link to set their password. The email's subject reads "Set or reset your CAACI password".`,
        `${who} 已有账户，已向其发送设置密码的链接。邮件主题为“设置或重置你的 CAACI 账号密码”。`,
      ),
    },
  } as const;

  const send = async (action: keyof typeof kinds) => {
    const k = kinds[action];
    setBusy(action);
    const res = await api<{ delivered?: string }>('/api/admin/member-email', {
      method: 'POST',
      body: { member_id: m.id, action },
    });
    setBusy(null);
    if (res.ok || res.status === 429) {
      cooldownUntil.set(`${m.id}:${action}`, Date.now() + AUTH_EMAIL_COOLDOWN_MS);
      setMsg(
        res.ok
          ? {
              tone: 'success',
              text: (res.data.delivered === 'password_setup' && k.passwordSetup) || k.done,
            }
          : {
              tone: 'error',
              text: t(
                'An email was sent to this member very recently. Please wait a minute and try again.',
                '刚刚已向该会员发送过邮件，请等一分钟后再试。',
              ),
            },
      );
      return;
    }
    setMsg({
      tone: 'error',
      text: res.data.error || t('Could not send the email.', '邮件发送失败。'),
    });
  };

  return (
    <div className="space-y-2">
      {/* -ml-3 cancels the quiet button's own padding, so its text lines up
          with the heading above it. */}
      <div className="flex flex-wrap items-center gap-1 -ml-3">
        {(Object.keys(kinds) as (keyof typeof kinds)[]).map((a) => {
          const left = Math.ceil(((cooldownUntil.get(`${m.id}:${a}`) ?? 0) - now) / 1000);
          return (
            <button
              key={a}
              type="button"
              className={ROW_BTN}
              disabled={busy === a || left > 0}
              onClick={() => ask(kinds[a].ask, t('Send', '发送'), () => send(a))}
            >
              <Mail className="w-3.5 h-3.5" aria-hidden />
              {left > 0 ? `${kinds[a].label} (${left}s)` : kinds[a].label}
            </button>
          );
        })}
      </div>
      {/* The sentence sits under the buttons, not beside them: on a narrow
          column it is two lines of explanation, not a third button. */}
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        {t(
          "Members who haven't set up a login yet get an invitation; members who already have one get a link to set their password.",
          '尚未启用登录账户的会员会收到邀请；已有账户的会员会收到设置密码的链接。',
        )}
      </p>
      {panel}
    </div>
  );
}

// Takes effect at once. The server refuses administrators (your own account
// included) and emails the member that it was changed.
function SetPassword({ m, setMsg }: { m: MemberRow; setMsg: (x: Msg) => void }) {
  const { t, api } = useAdmin();
  const { ask, panel } = useAsk({ ruled: false });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const who = m.full_name || m.email || '';

  const submit = () => {
    if (password.length < 8)
      return setMsg({
        tone: 'error',
        text: t('Password must be at least 8 characters.', '密码至少 8 位。'),
      });
    ask(
      t(
        `Set a new password for ${who}? It works immediately, and ${who} is emailed that an administrator changed it.`,
        `为 ${who} 设置新密码？新密码立即生效，并会邮件通知 ${who} 密码已被管理员修改。`,
      ),
      t('Set password', '设置密码'),
      async () => {
        setBusy(true);
        const res = await api('/api/admin/member-password', {
          method: 'POST',
          body: { member_id: m.id, password },
        });
        setBusy(false);
        if (res.ok) {
          setPassword('');
          setMsg({
            tone: 'success',
            text: t(
              `Password updated for ${who}. Give them the new password in person or through another channel you trust.`,
              `已为 ${who} 更新密码。请当面或通过其他可靠渠道告知对方新密码。`,
            ),
          });
          return;
        }
        setMsg({
          tone: 'error',
          text: res.data.error || t('Could not change the password.', '密码修改失败。'),
        });
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          className="w-full sm:w-80"
          // Short enough to stay on one line above the box it labels.
          label={t(
            'Or set a password directly (min 8 characters)',
            '或直接设置新密码（至少 8 位）',
          )}
        >
          <input
            type="password"
            className={INPUT}
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button type="button" className={SECONDARY} disabled={busy} onClick={submit}>
          <KeyRound className="w-4 h-4" aria-hidden />
          {t('Set password', '设置密码')}
        </button>
      </div>
      {panel}
    </div>
  );
}

// ------------------------------------------------------------------ add

function AddMember({
  households,
  onCancel,
  onCreated,
}: {
  households: Household[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { t, api, toast } = useAdmin();
  const [f, setF] = useState({
    full_name: '',
    email: '',
    password: '',
    phone: '',
    tier_id: '',
    status: 'active',
    member_since: '',
    expires_at: '',
    household_id: '',
    notes: '',
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      ...f,
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim(),
      notes: f.notes.trim(),
      is_admin: isAdmin,
    };
    if (!body.email) return setMsg(t('Email is required.', '邮箱为必填项。'));
    setBusy(true);
    const res = await api(ENDPOINT, { method: 'PUT', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Could not create member.', '无法创建会员。'));
    toast('success', t(`Created ${body.email}.`, `已创建 ${body.email}。`));
    onCreated();
  };

  return (
    // Named and ruled off at the bottom: ten fields appearing above the list
    // otherwise read as part of it.
    <form onSubmit={submit} className="space-y-5 pb-6 border-b border-neutral-200/80" noValidate>
      <span className={EYEBROW}>{t('New member', '新会员')}</span>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t('Full name', '姓名')}>
          <input className={INPUT} value={f.full_name} onChange={set('full_name')} autoFocus />
        </Field>
        <Field label={`${t('Email (login)', '邮箱（登录）')} *`}>
          <input type="email" className={INPUT} value={f.email} onChange={set('email')} required />
        </Field>
        <Field label={t('Password (optional)', '密码（可选）')}>
          <input
            type="password"
            className={INPUT}
            autoComplete="new-password"
            value={f.password}
            onChange={set('password')}
          />
        </Field>
        <Field label={t('Phone', '电话')}>
          <input type="tel" className={INPUT} value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label={t('Tier', '类型')}>
          <select className={SELECT} value={f.tier_id} onChange={set('tier_id')}>
            <TierOptions />
          </select>
        </Field>
        <Field label={t('Status', '状态')}>
          <select className={SELECT} value={f.status} onChange={set('status')}>
            <StatusOptions />
          </select>
        </Field>
        <Field label={t('Member since', '加入时间')}>
          <input
            type="date"
            className={INPUT}
            value={f.member_since}
            onChange={set('member_since')}
          />
        </Field>
        <Field label={t('Expires', '到期')}>
          <input type="date" className={INPUT} value={f.expires_at} onChange={set('expires_at')} />
        </Field>
        <Field label={t('Family', '家庭')}>
          <select className={SELECT} value={f.household_id} onChange={set('household_id')}>
            <HouseholdOptions households={households} />
          </select>
        </Field>
        <div className="flex items-center gap-3 md:pt-6">
          <LiquidToggle
            checked={isAdmin}
            onChange={setIsAdmin}
            label={t('Administrator', '管理员')}
          />
          <span className="text-sm text-neutral-700">{t('Administrator', '管理员')}</span>
        </div>
        <Field className="md:col-span-2" label={t('Notes', '备注')}>
          <textarea className={TEXTAREA} rows={2} value={f.notes} onChange={set('notes')} />
        </Field>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {t('Create member', '创建会员')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
