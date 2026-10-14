// Who may write (administrators only): content editors are members given some
// columns — or all of them — and, separately, permission to change page copy.
// They sign in at /admin/ like an administrator and see only those tabs.
// Administrators are appointed under My account; developers have GitHub.
// /api/admin/content-editors, docs/content-management.md.
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
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  SECTION,
  useAdmin,
  useLoad,
} from '../../kit';
import { EDITORS, type EditorRow } from './shared';

export function EditorsAdmin({ columns }: { columns: ArticleColumn[] }) {
  const { lang, t, api, toast } = useAdmin();
  // null = closed; 'new' = adding someone; a member id = editing their access.
  const [editing, setEditing] = useState<string | null>(null);
  const list = useLoad(() => api<{ rows: EditorRow[] }>(EDITORS), []);
  const rows = list.data?.rows ?? [];

  const scope = (r: EditorRow) => {
    if (r.all_columns) return t('All columns', '全部专栏');
    const names = r.column_ids
      .map((id) => columns.find((c) => c.id === id))
      .filter((c): c is ArticleColumn => !!c)
      .map((c) => pick(lang, c.name_en, c.name_zh));
    return names.length ? names.join(lang === 'zh' ? '、' : ', ') : t('No columns', '无专栏');
  };

  const remove = async (r: EditorRow) => {
    const res = await api(`${EDITORS}?member_id=${encodeURIComponent(r.member_id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return toast('error', res.data.error || t('Remove failed.', '移除失败。'));
    toast('success', t('Editor removed.', '已移除内容编辑。'));
    await list.reload();
  };

  const done = async (text: string) => {
    setEditing(null);
    toast('success', text);
    await list.reload();
  };

  return (
    <div className={SECTION}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ul className="border-l-2 border-neutral-300 pl-3 text-xs text-neutral-600 leading-relaxed space-y-1 max-w-2xl">
          <li>
            <strong className="text-ink">{t('Administrator', '管理员')}</strong> ·{' '}
            {t(
              'everything in this console (appointed under My account).',
              '可使用后台全部功能（在“我的账号”中任命）。',
            )}
          </li>
          <li>
            <strong className="text-ink">{t('Content editor', '内容编辑')}</strong> ·{' '}
            {t(
              'writes articles in their columns only, plus page content if allowed.',
              '只能在自己的专栏发文；获准时还可编辑页面内容。',
            )}
          </li>
          <li>
            <strong className="text-ink">{t('Developer', '开发者')}</strong> ·{' '}
            {t('managed on GitHub, not here.', '在 GitHub 上管理，不在这里。')}
          </li>
        </ul>
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
          {editing === 'new' ? t('Cancel', '取消') : t('Add an editor', '添加内容编辑')}
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
            <EditorForm
              row={null}
              columns={columns}
              onCancel={() => setEditing(null)}
              onSaved={() => done(t('Editor added.', '已添加内容编辑。'))}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
        empty={t('No content editors yet.', '还没有内容编辑。')}
      >
        <ul className={DIVIDED}>
          {rows.map((r) => (
            <li key={r.member_id} className="py-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-ink break-all">
                    {r.full_name || r.email || '—'}
                    {r.full_name && r.email && (
                      <span className="font-normal text-neutral-500"> · {r.email}</span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-600 break-words">
                    {scope(r)}
                    {r.can_edit_pages && (
                      <span className="text-neutral-500"> · {t('page content', '页面内容')}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={ROW_BTN}
                    aria-expanded={editing === r.member_id}
                    onClick={() => setEditing((e) => (e === r.member_id ? null : r.member_id))}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden />
                    {t('Edit', '编辑')}
                  </button>
                  <InlineConfirm
                    label={t('Remove', '移除')}
                    keepLabel={t('Keep', '保留')}
                    confirmLabel={t('Remove', '移除')}
                    doneLabel={t('Removing…', '即将移除…')}
                    undoLabel={t('Undo', '撤销')}
                    onCommit={() => void remove(r)}
                  />
                </div>
              </div>
              {editing === r.member_id && (
                <EditorForm
                  row={r}
                  columns={columns}
                  onCancel={() => setEditing(null)}
                  onSaved={() => done(t('Saved.', '已保存。'))}
                />
              )}
            </li>
          ))}
        </ul>
      </Loaded>
    </div>
  );
}

function EditorForm({
  row,
  columns,
  onCancel,
  onSaved,
}: {
  row: EditorRow | null;
  columns: ArticleColumn[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { lang, t, api } = useAdmin();
  const [email, setEmail] = useState(row?.email ?? '');
  const [all, setAll] = useState(row?.all_columns ?? false);
  const [ids, setIds] = useState<string[]>(row?.column_ids ?? []);
  const [pages, setPages] = useState(row?.can_edit_pages ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const toggle = (id: string, on: boolean) =>
    setIds((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)));

  const save = async () => {
    setMsg('');
    if (!email.trim()) return setMsg(t('Enter their email.', '请输入对方的邮箱。'));
    if (!all && !ids.length && !pages)
      return setMsg(
        t(
          'Give them at least one column, all columns, or page content.',
          '请至少给对方一个专栏、全部专栏或页面内容权限。',
        ),
      );
    setBusy(true);
    const res = await api(EDITORS, {
      method: 'POST',
      body: {
        email: email.trim(),
        all_columns: all,
        column_ids: all ? [] : ids,
        can_edit_pages: pages,
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

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field
        label={t('Email of their CAACI account', '对方华协账号的邮箱')}
        hint={
          row
            ? undefined
            : t('They must have signed up on the site first.', '对方需要先在网站注册。')
        }
      >
        <input
          type="email"
          className={INPUT}
          value={email}
          disabled={!!row}
          autoFocus={!row}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
          <LiquidToggle
            checked={all}
            onChange={setAll}
            label={t('All columns, including new ones', '全部专栏（包括以后新建的）')}
          />
          {t('All columns, including new ones', '全部专栏（包括以后新建的）')}
        </div>
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
        <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
          <LiquidToggle
            checked={pages}
            onChange={setPages}
            label={t('May edit page content', '可编辑页面内容')}
          />
          <span>
            {t('May edit page content', '可编辑页面内容')}
            <span className="block text-[11px] font-normal text-neutral-500">
              {t(
                'The words and photos of the public pages (the Page content tab).',
                '公开页面上的文字和图片（“页面内容”栏目）。',
              )}
            </span>
          </span>
        </div>
      </div>

      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {row ? t('Save', '保存') : t('Add editor', '添加')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
