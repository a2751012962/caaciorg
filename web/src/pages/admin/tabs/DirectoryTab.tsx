import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil, Plus, Search as SearchIcon, X } from 'lucide-react';
import { DIRECTORY_CATEGORIES } from '../../../lib/directory';
import { listExit, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DataTable,
  INPUT,
  InlineConfirm,
  LiquidToggle,
  Loaded,
  Notice,
  PRIMARY,
  Pager,
  ROW_BTN,
  SELECT,
  Status,
  TabHeader,
  useAdmin,
  useLoad,
} from '../kit';
import { BusinessForm } from './directory/BusinessForm';
import { BIZ_LIMIT, ENDPOINT, type BizPage, type BizRow } from './directory/shared';

// Business directory (approve = make it official): community submissions land
// here as Pending; approving one makes it a card on the public Business
// Services page. Search / approval filter / pages, a pending tile, the listing
// form with its live card preview, approve toggle and delete per row.
// functions/api/admin/business.js.
export default function DirectoryTab() {
  const { t, api, toast } = useAdmin();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [approved, setApproved] = useState('');
  const [offset, setOffset] = useState(0);
  // null = closed, 'new' = + New listing, a row = editing it.
  const [form, setForm] = useState<BizRow | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // Search waits for a 300 ms pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const list = useLoad(async () => {
    const p = new URLSearchParams({ limit: String(BIZ_LIMIT), offset: String(offset) });
    if (q) p.set('q', q);
    if (approved) p.set('approved', approved);
    const res = await api<BizPage>(`${ENDPOINT}?${p}`);
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load listings.', '无法加载商家条目。');
    return res;
  }, [q, approved, offset]);
  const data = list.data;
  const rows = data?.rows ?? [];
  const pending = data?.pending_total ?? 0;

  const setApproval = async (r: BizRow, next: boolean) => {
    setBusy(r.id);
    setMsg('');
    const res = await api(ENDPOINT, { method: 'POST', body: { id: r.id, approved: next } });
    if (!res.ok) setMsg(res.data.error || t('Update failed.', '更新失败。'));
    await list.reload();
    setBusy(null);
  };

  const remove = async (r: BizRow) => {
    setMsg('');
    const res = await api(`${ENDPOINT}?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    if (!res.ok) return setMsg(res.data.error || t('Delete failed.', '删除失败。'));
    if (form !== 'new' && form?.id === r.id) setForm(null);
    toast('success', t(`Deleted "${r.name}".`, `已删除“${r.name}”。`));
    await list.reload();
  };

  const catLabel = (id: string | null) => {
    if (!id) return '—';
    const c = DIRECTORY_CATEGORIES.find((x) => x.id === id);
    return c ? t(c.en, c.zh) : id;
  };

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Directory', '商家名录')}
        description={t(
          'Community submissions land here as Pending. Approving a listing makes it official — it becomes publicly visible in the directory.',
          '社区提交的商家信息会以“待审核”状态出现在这里。批准后即正式生效——将在名录中公开显示。',
        )}
        actions={
          <button
            type="button"
            className={PRIMARY}
            onClick={() => setForm((f) => (f === null ? 'new' : null))}
          >
            {form !== null ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {form !== null ? t('Cancel', '取消') : t('New listing', '新建条目')}
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-2 p-4 rounded-2xl border border-neutral-200/80 shadow-xs">
          <div className="text-xs font-semibold text-neutral-500">
            {t('Pending review', '待审核')}
          </div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${pending ? 'text-amber-700' : 'text-ink'}`}
          >
            {data ? pending : '—'}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {form !== null && (
          <motion.div
            key={form === 'new' ? 'new' : form.id}
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <BusinessForm
              biz={form === 'new' ? null : form}
              onCancel={() => setForm(null)}
              onSaved={() => {
                const name = form === 'new' ? '' : form.name;
                setForm(null);
                toast(
                  'success',
                  name ? t(`${name} saved.`, `${name} 已保存。`) : t('Saved.', '已保存。'),
                );
                void list.reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="relative block">
          <span className="sr-only">{t('Search name or description', '搜索名称或描述')}</span>
          <SearchIcon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            className={`${INPUT} pl-10`}
            placeholder={t('Search name or description', '搜索名称或描述')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </label>
        <select
          className={SELECT}
          value={approved}
          aria-label={t('Status', '状态')}
          onChange={(e) => {
            setApproved(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('All listings', '全部条目')}</option>
          <option value="true">{t('Approved', '已批准')}</option>
          <option value="false">{t('Pending', '待审核')}</option>
        </select>
      </div>

      {msg && <Notice tone="error">{msg}</Notice>}
      {list.error && data && <Notice tone="error">{list.error}</Notice>}

      <Loaded
        loading={list.loading}
        error={data ? '' : list.error}
        isEmpty={data ? rows.length === 0 && offset === 0 : undefined}
        empty={t('No listings yet.', '暂无商家条目。')}
      >
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'name',
              label: t('Name', '名称'),
              render: (r) => <NameCell r={r} />,
            },
            {
              key: 'category',
              label: t('Category', '类别'),
              render: (r) => catLabel(r.category),
            },
            {
              key: 'contact',
              label: t('Contact', '联系方式'),
              render: (r) =>
                r.phone || r.website ? (
                  <span className="block break-all">
                    {r.phone && <span className="block">{r.phone}</span>}
                    {r.website && <span className="block">{r.website}</span>}
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'status',
              label: t('Status', '状态'),
              render: (r) =>
                r.approved ? (
                  <Status tone="good">{t('Approved', '已批准')}</Status>
                ) : (
                  <Status tone="warn">{t('Pending', '待审核')}</Status>
                ),
            },
          ]}
          actions={(r) => (
            <>
              <button
                type="button"
                className={ROW_BTN}
                aria-expanded={form !== null && form !== 'new' && form.id === r.id}
                onClick={() =>
                  setForm((f) => (f !== null && f !== 'new' && f.id === r.id ? null : r))
                }
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden />
                {t('Edit', '编辑')}
              </button>
              <LiquidToggle
                checked={r.approved}
                disabled={busy === r.id}
                onChange={(next) => void setApproval(r, next)}
                label={r.approved ? t('Unapprove', '取消批准') : t('Approve', '批准')}
              />
              <InlineConfirm
                label={t('Delete', '删除')}
                keepLabel={t('Keep', '保留')}
                confirmLabel={t('Delete', '删除')}
                doneLabel={t('Deleting…', '即将删除…')}
                undoLabel={t('Undo', '撤销')}
                onCommit={() => void remove(r)}
              />
            </>
          )}
        />
        <Pager
          offset={offset}
          limit={BIZ_LIMIT}
          total={data?.total ?? 0}
          onPage={(o) => setOffset(o)}
        />
      </Loaded>
    </div>
  );
}

function NameCell({ r }: { r: BizRow }) {
  const { t } = useAdmin();
  const tags = [...new Set([...(r.tags || []), ...(r.tags_zh || [])])];
  return (
    <div className="min-w-0 space-y-1 text-left">
      <div className="flex items-center gap-2 justify-end md:justify-start">
        {r.image_url && (
          <img
            src={r.image_url}
            alt=""
            className="w-8 h-8 rounded-full object-cover border border-neutral-200 shrink-0"
          />
        )}
        <div className="min-w-0">
          <div className="font-semibold text-ink break-words">{r.name}</div>
          {r.name_zh && r.name_zh !== r.name && (
            <div className="text-xs text-neutral-500 break-words">{r.name_zh}</div>
          )}
        </div>
      </div>
      {(r.verified || tags.length > 0) && (
        <div className="flex flex-wrap gap-1 justify-end md:justify-start">
          {r.verified && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              {t('Verified', '认证')}
            </span>
          )}
          {tags.map((x) => (
            <span
              key={x}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-600"
            >
              {x}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
