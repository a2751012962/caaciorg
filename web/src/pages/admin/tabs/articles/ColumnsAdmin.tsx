// The columns themselves (administrators only): name and description in both
// languages, the address (?c=<slug> on /about/columns/) and the order they are
// listed in. A column that still has articles cannot be deleted — the API
// answers 409 and the message says what to do instead.
// /api/admin/article-columns, docs/content-management.md.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, Plus, X } from 'lucide-react';
import { SLUG_RE, slugify, slugInput } from '../../../../lib/articleAdmin.js';
import { columnsUrl, type ArticleColumn } from '../../../../lib/articles';
import { listExit, mountIn, riseFromSm, shown } from '../../../../lib/motion';
import {
  DIVIDED,
  Empty,
  Field,
  INPUT,
  InlineConfirm,
  Notice,
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  SECTION,
  TEXTAREA,
  useAdmin,
} from '../../kit';
import { COLUMNS } from './shared';

export function ColumnsAdmin({
  columns,
  reload,
}: {
  columns: ArticleColumn[];
  reload: () => Promise<void>;
}) {
  const { t, api, toast } = useAdmin();
  // null = closed; 'new' = adding one; an id = editing that column.
  const [editing, setEditing] = useState<string | null>(null);

  const remove = async (c: ArticleColumn) => {
    const res = await api(`${COLUMNS}?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    if (res.status === 409)
      return toast(
        'error',
        t(
          `“${c.name_en || c.name_zh}” still has articles. Move them to another column or delete them first.`,
          `“${c.name_zh || c.name_en}”下还有文章，请先把文章移到其他专栏或删除。`,
        ),
      );
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast('success', t('Column deleted.', '专栏已删除。'));
    await reload();
  };

  const sorted = [...columns].sort((a, b) => a.sort_order - b.sort_order);
  const nextOrder = sorted.length ? sorted[sorted.length - 1].sort_order + 10 : 10;

  return (
    <div className={SECTION}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-neutral-600 max-w-2xl">
          {t(
            'Each column is a section of /about/columns/ with its own list of articles. Lower numbers are listed first.',
            '每个专栏是 /about/columns/ 中的一个栏目，有自己的文章列表。数字越小排得越前。',
          )}
        </p>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setEditing((e) => (e === 'new' ? null : 'new'))}
        >
          {editing === 'new' ? (
            <X className="w-4 h-4" aria-hidden />
          ) : (
            <Plus className="w-4 h-4" aria-hidden />
          )}
          {editing === 'new' ? t('Cancel', '取消') : t('New column', '新建专栏')}
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
            <ColumnForm
              column={null}
              order={nextOrder}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                toast('success', t('Column added.', '专栏已添加。'));
                await reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sorted.length === 0 ? (
        <Empty>{t('No columns yet.', '还没有专栏。')}</Empty>
      ) : (
        <ul className={DIVIDED}>
          {sorted.map((c) => (
            <li key={c.id} className="py-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink break-words">
                    {c.name_zh}
                    {c.name_zh && c.name_en && <span className="text-neutral-400"> · </span>}
                    {c.name_en}
                  </p>
                  <p className="text-xs text-neutral-500 break-all">
                    <span className="tabular-nums">#{c.sort_order}</span> ·{' '}
                    {columnsUrl('en', c.slug)}
                  </p>
                  {(c.description_zh || c.description_en) && (
                    <p className="mt-1 text-xs text-neutral-600 break-words">
                      {t(
                        c.description_en || c.description_zh,
                        c.description_zh || c.description_en,
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={ROW_BTN}
                    aria-expanded={editing === c.id}
                    onClick={() => setEditing((e) => (e === c.id ? null : c.id))}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden />
                    {t('Edit', '编辑')}
                  </button>
                  <InlineConfirm
                    label={t('Delete', '删除')}
                    keepLabel={t('Keep', '保留')}
                    confirmLabel={t('Delete', '删除')}
                    doneLabel={t('Deleting…', '即将删除…')}
                    undoLabel={t('Undo', '撤销')}
                    onCommit={() => void remove(c)}
                  />
                </div>
              </div>
              {editing === c.id && (
                <ColumnForm
                  column={c}
                  order={c.sort_order}
                  onCancel={() => setEditing(null)}
                  onSaved={async () => {
                    setEditing(null);
                    toast('success', t('Saved.', '已保存。'));
                    await reload();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnForm({
  column,
  order,
  onCancel,
  onSaved,
}: {
  column: ArticleColumn | null;
  order: number;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, api } = useAdmin();
  const [f, setF] = useState({
    name_en: column?.name_en ?? '',
    name_zh: column?.name_zh ?? '',
    slug: column?.slug ?? '',
    description_en: column?.description_en ?? '',
    description_zh: column?.description_zh ?? '',
    sort_order: String(column?.sort_order ?? order),
  });
  // A new column's address follows its English name until edited; a saved
  // one keeps its address (links to it are already out there).
  const [slugTouched, setSlugTouched] = useState(!!column);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof f, v: string) =>
    setF((x) => ({
      ...x,
      [k]: v,
      ...(k === 'name_en' && !slugTouched ? { slug: slugify(v) } : {}),
    }));

  const save = async () => {
    setMsg('');
    const slug = f.slug.replace(/-+$/g, '');
    if (!f.name_en.trim() && !f.name_zh.trim())
      return setMsg(t('Give the column a name.', '请填写专栏名称。'));
    if (!SLUG_RE.test(slug))
      return setMsg(
        t(
          'The address needs lower-case letters, digits and single hyphens (e.g. community-stories).',
          '网址只能使用小写英文字母、数字和单个连字符（如 community-stories）。',
        ),
      );
    const body = {
      name_en: f.name_en.trim(),
      name_zh: f.name_zh.trim(),
      slug,
      description_en: f.description_en.trim(),
      description_zh: f.description_zh.trim(),
      sort_order: Number.parseInt(f.sort_order, 10) || 0,
    };
    setBusy(true);
    const res = column
      ? await api(COLUMNS, { method: 'PATCH', body: { id: column.id, ...body } })
      : await api(COLUMNS, { method: 'POST', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
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
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('Name (English)', '名称（英文）')}>
          <input
            className={INPUT}
            value={f.name_en}
            autoFocus={!column}
            onChange={(e) => set('name_en', e.target.value)}
          />
        </Field>
        <Field label={t('Name (Chinese)', '名称（中文）')}>
          <input
            className={INPUT}
            value={f.name_zh}
            onChange={(e) => set('name_zh', e.target.value)}
          />
        </Field>
        <Field
          label={t('Web address', '网址')}
          hint={f.slug ? columnsUrl('en', f.slug.replace(/-+$/g, '')) : undefined}
        >
          <input
            className={`${INPUT} font-mono text-xs`}
            value={f.slug}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug', slugInput(e.target.value));
            }}
          />
        </Field>
        <Field label={t('Order', '排序')} hint={t('Lower numbers come first.', '数字越小越靠前。')}>
          <input
            type="number"
            inputMode="numeric"
            className={INPUT}
            value={f.sort_order}
            onChange={(e) => set('sort_order', e.target.value)}
          />
        </Field>
        <Field label={t('Description (English)', '简介（英文）')}>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={f.description_en}
            onChange={(e) => set('description_en', e.target.value)}
          />
        </Field>
        <Field label={t('Description (Chinese)', '简介（中文）')}>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={f.description_zh}
            onChange={(e) => set('description_zh', e.target.value)}
          />
        </Field>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {column ? t('Save', '保存') : t('Add column', '添加专栏')}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          {t('Cancel', '取消')}
        </button>
      </div>
    </form>
  );
}
