// Back-office access (后台权限): who may use /admin/ and for what, in one list
// (/api/admin/staff). Root sees and changes everyone; any other administrator
// sees and manages the content managers only — appointing or changing an
// administrator stays root's, as the old administrator list was. Root itself
// is set in the database. Nothing changes without a save, and taking access
// away asks twice.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, UserPlus, X } from 'lucide-react';
import { pick, type ArticleColumn } from '../../../../lib/articles';
import { listExit, mountIn, riseFromSm, shown } from '../../../../lib/motion';
import {
  DIVIDED,
  Field,
  INPUT,
  InlineConfirm,
  LABEL,
  LiquidToggle,
  Loaded,
  Notice,
  Panel,
  PERMS,
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  useAdmin,
  useLoad,
  type Perm,
} from '../../kit';

const STAFF = '/api/admin/staff';
const COLUMNS = '/api/admin/article-columns';

type Role = 'root' | 'admin' | 'content' | 'none';
interface StaffRow {
  member_id: string;
  full_name: string;
  email: string;
  role: Role;
  all_columns: boolean;
  column_ids: string[];
  can_edit_pages: boolean;
  perms: Perm[];
}

// What each permission opens, in the console's words.
const PERM_TEXT: Record<Perm, { en: string; zh: string; hintEn: string; hintZh: string }> = {
  events: {
    en: 'Events',
    zh: '活动',
    hintEn: 'Create and edit events and their forms, see registrations and volunteers.',
    hintZh: '新建和修改活动及报名表单，查看报名名单和志愿者。',
  },
  news: {
    en: 'Send news',
    zh: '发送通讯',
    hintEn: 'Email members (with a test send first).',
    hintZh: '给会员群发邮件（可先发测试）。',
  },
  invites: {
    en: 'Invitation codes',
    zh: '邀请码',
    hintEn: 'Create and withdraw invitation codes.',
    hintZh: '新建和作废邀请码。',
  },
  plans: {
    en: 'Membership plans',
    zh: '会员方案',
    hintEn: 'Names, card text and prices. A price change also changes the Stripe price.',
    hintZh: '方案名称、卡片文字和价格。改价格会同步修改 Stripe 收费。',
  },
  directory: {
    en: 'Business directory',
    zh: '商家名录',
    hintEn: 'Approve, edit and hide merchant listings.',
    hintZh: '审核、修改和隐藏商家条目。',
  },
};

export function StaffSection() {
  const { lang, t, api, toast, myId } = useAdmin();
  // null = closed; 'new' = adding someone; a member id = editing their access.
  const [editing, setEditing] = useState<string | null>(null);
  const list = useLoad(() => api<{ rows: StaffRow[]; caller_is_root: boolean }>(STAFF), []);
  const cols = useLoad(() => api<{ rows: ArticleColumn[] }>(COLUMNS), []);
  const rows = list.data?.rows ?? [];
  const isRoot = list.data?.caller_is_root === true;
  const columns = cols.data?.rows ?? [];

  const roleName = (r: Role) =>
    ({
      root: 'root',
      admin: t('Administrator', '管理员'),
      content: t('Content manager', '内容管理'),
      none: t('No access', '无权限'),
    })[r];

  const scope = (r: StaffRow) => {
    if (r.role !== 'content') return '';
    const parts: string[] = [];
    for (const p of PERMS) if (r.perms.includes(p)) parts.push(t(PERM_TEXT[p].en, PERM_TEXT[p].zh));
    if (r.all_columns) parts.push(t('all columns', '全部专栏'));
    else {
      const names = r.column_ids
        .map((id) => columns.find((c) => c.id === id))
        .filter((c): c is ArticleColumn => !!c)
        .map((c) => pick(lang, c.name_en, c.name_zh));
      if (names.length)
        parts.push(`${t('columns', '专栏')}: ${names.join(lang === 'zh' ? '、' : ', ')}`);
    }
    if (r.can_edit_pages) parts.push(t('page content', '页面内容'));
    return parts.join(' · ');
  };

  const remove = async (r: StaffRow) => {
    const res = await api(STAFF, {
      method: 'POST',
      body: { member_id: r.member_id, role: 'none' },
    });
    if (!res.ok) return toast('error', res.data.error || t('Could not remove.', '取消失败。'));
    toast('success', t('Access removed.', '已取消该人员的后台权限。'));
    await list.reload();
  };

  const done = async (text: string) => {
    setEditing(null);
    toast('success', text);
    await list.reload();
  };

  if (list.error && list.error.length && !list.data) return null; // not an administrator

  return (
    <Panel className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-bold text-ink">{t('Back-office access', '后台权限')}</h2>
          <ul className="border-l-2 border-neutral-300 pl-3 text-xs text-neutral-600 leading-relaxed space-y-1">
            <li>
              <strong className="text-ink">root</strong> ·{' '}
              {t(
                'everything, and the only one who appoints administrators. Set in the database.',
                '全部功能，且只有 root 能任命管理员。在数据库中设置。',
              )}
            </li>
            <li>
              <strong className="text-ink">{t('Administrator', '管理员')}</strong> ·{' '}
              {t(
                'everything in this console, including tokens, refunds and members.',
                '后台全部功能，包括华协币、退款和会员资料。',
              )}
            </li>
            <li>
              <strong className="text-ink">{t('Content manager', '内容管理')}</strong> ·{' '}
              {t(
                'only what is ticked: events (with registrations and volunteers), news, invitation codes, membership plans, business directory, article columns, page content. Never members, payments, refunds, discount codes or tokens.',
                '只能看到勾选的部分：活动（含报名和志愿者）、发送通讯、邀请码、会员方案、商家名录、专栏文章、页面内容；看不到会员资料、收款、退款、折扣码和华协币。',
              )}
            </li>
            <li>
              <strong className="text-ink">{t('Developer', '开发者')}</strong> ·{' '}
              {t('managed on GitHub, not here.', '在 GitHub 上管理，不在这里。')}
            </li>
          </ul>
          {list.data && !isRoot && (
            <p className="text-xs text-neutral-500">
              {t(
                'Only root sees and changes the administrators; you manage the content managers.',
                '管理员名单只有 root 能看到和修改；你可以管理内容管理人员。',
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setEditing((e) => (e === 'new' ? null : 'new'))}
        >
          {editing === 'new' ? (
            <X className="w-4 h-4" aria-hidden />
          ) : (
            <UserPlus className="w-4 h-4" aria-hidden />
          )}
          {editing === 'new' ? t('Cancel', '取消') : t('Add a person', '添加人员')}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {editing === 'new' && (
          <motion.div
            key="new"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
            className="pb-6 border-b border-neutral-200/80"
          >
            <AccessForm
              row={null}
              isRoot={isRoot}
              columns={columns}
              onCancel={() => setEditing(null)}
              onSaved={() => done(t('Access granted.', '已添加。'))}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
        empty={t('Nobody yet.', '暂无人员。')}
      >
        <ul className={DIVIDED}>
          {rows.map((r) => {
            const fixed = r.role === 'root' || r.member_id === myId;
            const mayChange = !fixed && (isRoot || r.role === 'content');
            return (
              <li key={r.member_id} className="py-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-ink break-all">
                      {r.full_name || r.email || '—'}
                      {r.full_name && r.email && (
                        <span className="font-normal text-neutral-500"> · {r.email}</span>
                      )}
                      {r.member_id === myId && (
                        <span className="font-normal text-neutral-500">
                          {t(' · you', ' · 本人')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-neutral-600 break-words">
                      <span className="font-semibold text-neutral-800">{roleName(r.role)}</span>
                      {scope(r) && <span> · {scope(r)}</span>}
                    </p>
                  </div>
                  {mayChange && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={ROW_BTN}
                        aria-expanded={editing === r.member_id}
                        onClick={() => setEditing((e) => (e === r.member_id ? null : r.member_id))}
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden />
                        {t('Change', '修改')}
                      </button>
                      <InlineConfirm
                        label={t('Remove access', '取消权限')}
                        keepLabel={t('Keep', '保留')}
                        confirmLabel={t('Remove access', '确定取消')}
                        doneLabel={t('Removing…', '即将取消…')}
                        undoLabel={t('Undo', '撤销')}
                        onCommit={() => void remove(r)}
                      />
                    </div>
                  )}
                </div>
                {editing === r.member_id && (
                  <AccessForm
                    row={r}
                    isRoot={isRoot}
                    columns={columns}
                    onCancel={() => setEditing(null)}
                    onSaved={() => done(t('Saved.', '已保存。'))}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Loaded>
    </Panel>
  );
}

function AccessForm({
  row,
  isRoot,
  columns,
  onCancel,
  onSaved,
}: {
  row: StaffRow | null;
  isRoot: boolean;
  columns: ArticleColumn[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { lang, t, api } = useAdmin();
  const wasAdmin = row?.role === 'admin';
  const [email, setEmail] = useState(row?.email ?? '');
  const [role, setRole] = useState<'admin' | 'content'>(wasAdmin ? 'admin' : 'content');
  // Defaults that take nothing away: someone moving from administrator to
  // content manager starts with every permission ticked; a new content manager
  // starts with events and every column. Untick what they don't need.
  const fresh = !row || wasAdmin;
  const [perms, setPerms] = useState<Perm[]>(wasAdmin ? [...PERMS] : row ? row.perms : ['events']);
  const flip = (p: Perm, on: boolean) =>
    setPerms((x) =>
      on ? PERMS.filter((q) => q === p || x.includes(q)) : x.filter((q) => q !== p),
    );
  const [all, setAll] = useState(fresh ? true : row.all_columns);
  const [ids, setIds] = useState<string[]>(fresh ? [] : row.column_ids);
  const [pages, setPages] = useState(wasAdmin ? true : (row?.can_edit_pages ?? false));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const toggle = (id: string, on: boolean) =>
    setIds((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)));

  const save = async () => {
    setMsg('');
    if (!row && !email.trim()) return setMsg(t('Enter their email.', '请输入对方的邮箱。'));
    if (role === 'content' && !perms.length && !all && !ids.length && !pages)
      return setMsg(t('Tick at least one permission.', '请至少勾选一项权限。'));
    setBusy(true);
    const res = await api(STAFF, {
      method: 'POST',
      body: {
        ...(row ? { member_id: row.member_id } : { email: email.trim() }),
        role,
        all_columns: all,
        column_ids: all ? [] : ids,
        can_edit_pages: pages,
        perms,
      },
    });
    setBusy(false);
    if (!res.ok)
      return setMsg(
        res.status === 404
          ? t(
              'No member has that email. They need to sign up on the site first.',
              '没有使用该邮箱的会员，对方需要先在网站注册。',
            )
          : res.data.error || t('Save failed.', '保存失败。'),
      );
    await onSaved();
  };

  const toggleRow = (checked: boolean, set: (v: boolean) => void, label: string, hint: string) => (
    <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
      <LiquidToggle checked={checked} onChange={set} label={label} />
      <span>
        {label}
        <span className="block text-[11px] font-normal text-neutral-500">{hint}</span>
      </span>
    </div>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!row && (
        <Field
          label={t('Email of their CAACI account', '对方华协账号的邮箱')}
          hint={t('They must have signed up on the site first.', '对方需要先在网站注册。')}
        >
          <input
            type="email"
            className={INPUT}
            value={email}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      )}

      {isRoot && (
        <fieldset>
          <legend className={LABEL}>{t('Role', '角色')}</legend>
          <div className="flex flex-wrap gap-x-6">
            {(['content', 'admin'] as const).map((r) => (
              <label
                key={r}
                className="flex items-center gap-2 min-h-[44px] text-sm text-neutral-700 cursor-pointer"
              >
                <input
                  type="radio"
                  name="staff-role"
                  className="w-4 h-4 accent-brick"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                {r === 'admin' ? t('Administrator', '管理员') : t('Content manager', '内容管理')}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {role === 'admin' ? (
        <Notice tone="warn">
          {t(
            'An administrator sees everything, including members, payments, refunds and tokens.',
            '管理员能看到并使用全部功能，包括会员资料、收款、退款和华协币。',
          )}
        </Notice>
      ) : (
        <div className="space-y-4">
          {wasAdmin && (
            <Notice tone="warn">
              {t(
                'They will lose the dashboard, members, families, payments, refunds, discount codes and tokens. Everything ticked below stays.',
                '对方将不再能使用看板、会员、家庭、收款、退款、折扣码和华协币；下面勾选的功能会保留。',
              )}
            </Notice>
          )}
          {PERMS.map((p) => (
            <div key={p}>
              {toggleRow(
                perms.includes(p),
                (on) => flip(p, on),
                t(PERM_TEXT[p].en, PERM_TEXT[p].zh),
                t(PERM_TEXT[p].hintEn, PERM_TEXT[p].hintZh),
              )}
            </div>
          ))}
          {toggleRow(
            all,
            setAll,
            t('All article columns', '全部专栏'),
            t('Including columns added later.', '包括以后新建的专栏。'),
          )}
          {!all && (
            <fieldset>
              <legend className={LABEL}>{t('Or only these columns', '或仅限以下专栏')}</legend>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {columns.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 min-h-[44px] text-sm text-neutral-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-brick"
                      checked={ids.includes(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                    {pick(lang, c.name_en, c.name_zh)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {toggleRow(
            pages,
            setPages,
            t('Page content', '页面内容'),
            t('The words and photos of the public pages.', '公开页面上的文字和图片。'),
          )}
        </div>
      )}

      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {wasAdmin && role === 'content'
            ? t('Change to content manager', '确认改为内容管理')
            : row
              ? t('Save', '保存')
              : t('Add', '添加')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
