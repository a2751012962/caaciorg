import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Copy,
  Download,
  HandHelping,
  Pencil,
  Plus,
  QrCode,
  Search as SearchIcon,
  Users,
  X,
} from 'lucide-react';
import qrcode from 'qrcode-generator';
import { listExit, listItem, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  INPUT,
  InlineConfirm,
  Loaded,
  Notice,
  PRIMARY,
  ROW_BTN,
  SECONDARY,
  SELECT,
  Pager,
  Status,
  TabHeader,
  useAdmin,
  useLoad,
} from '../kit';
import { EventForm } from './events/EventForm';
import { Registrations } from './events/Registrations';
import { fmtWhen, registrationOpen, registrationUrl, type AdminEvent } from './events/rules';

const ENDPOINT = '/api/admin/events';
const EV_LIMIT = 25;

function qrPng(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 16);
}

// Events: publish = make it official. Create/edit with the registration
// question builder, publish/unpublish, delete, copy the registration link or
// its QR code, and open who registered (or volunteered).
// functions/api/admin/events.js, event-registrations.js, media.js.
export default function EventsTab() {
  const { t, api, toast, go } = useAdmin();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [pub, setPub] = useState('');
  const [offset, setOffset] = useState(0);
  // null = closed; 'new' = create form; an event = editing it.
  const [editing, setEditing] = useState<AdminEvent | 'new' | null>(null);
  const [regFor, setRegFor] = useState<AdminEvent | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  // Search waits for a 300 ms pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  const list = useLoad(() => {
    const params = new URLSearchParams({ limit: String(EV_LIMIT), offset: String(offset) });
    if (q) params.set('q', q);
    if (pub) params.set('published', pub);
    return api<{ rows: AdminEvent[]; total: number }>(`${ENDPOINT}?${params}`);
  }, [q, pub, offset]);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  const togglePublish = async (e: AdminEvent) => {
    const res = await api(ENDPOINT, {
      method: 'POST',
      body: { id: e.id, published: !e.published },
    });
    if (!res.ok) return toast('error', res.data.error || t('Update failed.', '更新失败。'));
    await list.reload();
  };

  const remove = async (e: AdminEvent) => {
    const res = await api(`${ENDPOINT}?id=${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    if (regFor?.id === e.id) setRegFor(null);
    if (editing !== 'new' && editing?.id === e.id) setEditing(null);
    toast('success', t(`Deleted "${e.title}".`, `已删除“${e.title}”。`));
    await list.reload();
  };

  const copyLink = async (e: AdminEvent) => {
    const url = registrationUrl(e);
    try {
      await navigator.clipboard.writeText(url);
      toast('success', t(`Registration link copied: ${url}`, `报名链接已复制：${url}`));
    } catch {
      window.prompt(t('Copy the registration link:', '请复制报名链接：'), url);
    }
  };

  const openVolunteers = (e: AdminEvent) =>
    go('volunteers', { event: e.id, title: e.title, title_zh: e.title_zh || '' });

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Events', '活动')}
        description={t(
          'Only published events are visible to the public and open for RSVPs — drafts stay admin-only until you publish them.',
          '只有已发布的活动才对公众可见并接受报名——草稿在发布前仅管理员可见。',
        )}
        actions={
          <button
            type="button"
            className={PRIMARY}
            onClick={() => setEditing((x) => (x === 'new' ? null : 'new'))}
          >
            {editing === 'new' ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {editing === 'new' ? t('Cancel', '取消') : t('New event', '新建活动')}
          </button>
        }
      />

      <AnimatePresence initial={false} mode="wait">
        {editing && (
          <motion.div
            key={editing === 'new' ? 'new' : editing.id}
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <EventForm
              ev={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                const wasNew = editing === 'new';
                setEditing(null);
                toast(
                  'success',
                  wasNew ? t('Event created.', '活动已创建。') : t('Saved.', '已保存。'),
                );
                void list.reload();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false} mode="wait">
        {regFor && (
          <motion.div
            key={regFor.id}
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <Registrations ev={regFor} onClose={() => setRegFor(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative block">
          <span className="sr-only">{t('Search title or location', '搜索标题或地点')}</span>
          <SearchIcon
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            className={`${INPUT} pl-10`}
            placeholder={t('Search title or location', '搜索标题或地点')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </label>
        <select
          className={SELECT}
          value={pub}
          aria-label={t('Status', '状态')}
          onChange={(e) => {
            setPub(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('All events', '全部活动')}</option>
          <option value="true">{t('Published', '已发布')}</option>
          <option value="false">{t('Draft', '草稿')}</option>
        </select>
      </div>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 && offset === 0 : undefined}
        empty={t('No events yet.', '暂无活动。')}
      >
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {rows.map((e, i) => (
              <motion.li
                key={e.id}
                layout
                initial={riseFromSm}
                animate={shown}
                exit={listExit}
                transition={listItem(i)}
              >
                <EventRow
                  e={e}
                  qrOpen={qrFor === e.id}
                  onQr={() => setQrFor((x) => (x === e.id ? null : e.id))}
                  onCopy={() => void copyLink(e)}
                  onEdit={() => setEditing(e)}
                  onRegistrations={() => setRegFor((x) => (x?.id === e.id ? null : e))}
                  regOpen={regFor?.id === e.id}
                  onVolunteers={() => openVolunteers(e)}
                  onToggle={() => togglePublish(e)}
                  onDelete={() => void remove(e)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <Pager offset={offset} limit={EV_LIMIT} total={total} onPage={setOffset} />
      </Loaded>
    </div>
  );
}

function EventRow({
  e,
  qrOpen,
  regOpen,
  onQr,
  onCopy,
  onEdit,
  onRegistrations,
  onVolunteers,
  onToggle,
  onDelete,
}: {
  e: AdminEvent;
  qrOpen: boolean;
  regOpen: boolean;
  onQr: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRegistrations: () => void;
  onVolunteers: () => void;
  onToggle: () => Promise<void>;
  onDelete: () => void;
}) {
  const { lang, t } = useAdmin();
  const open = registrationOpen(e);
  const [busy, setBusy] = useState(false);

  return (
    <div className="bg-surface-2 rounded-2xl border border-neutral-200/80 shadow-xs">
      <div className="p-4 sm:p-5 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 flex gap-3">
          {e.image_url && (
            <img
              src={e.image_url}
              alt=""
              className="w-12 h-12 shrink-0 rounded-xl object-cover border border-neutral-200 bg-white"
            />
          )}
          <div className="min-w-0">
            <p className="font-bold text-ink break-words">{e.title}</p>
            {e.title_zh && <p className="text-xs text-neutral-500 break-words">{e.title_zh}</p>}
            {open && (
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" className={ROW_BTN} onClick={onCopy}>
                  <Copy className="w-4 h-4" aria-hidden />
                  {t('Copy registration link', '复制报名链接')}
                </button>
                <button type="button" className={ROW_BTN} onClick={onQr} aria-expanded={qrOpen}>
                  <QrCode className="w-4 h-4" aria-hidden />
                  {t('Registration QR code', '报名二维码')}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-1 text-xs text-neutral-600">
          <p className="tabular-nums">{fmtWhen(lang, e)}</p>
          <p className="break-words">{e.location || '—'}</p>
          <Status tone={e.published ? 'good' : 'warn'}>
            {e.published ? t('Published', '已发布') : t('Draft', '草稿')}
          </Status>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button type="button" className={ROW_BTN} onClick={onEdit}>
            <Pencil className="w-4 h-4" aria-hidden />
            {t('Edit', '编辑')}
          </button>
          <button
            type="button"
            className={ROW_BTN}
            onClick={onRegistrations}
            aria-expanded={regOpen}
          >
            <Users className="w-4 h-4" aria-hidden />
            {t('Registrations', '报名')}
            {!!e.registration_count && (
              <span className="tabular-nums text-neutral-500">{e.registration_count}</span>
            )}
          </button>
          <button type="button" className={ROW_BTN} onClick={onVolunteers}>
            <HandHelping className="w-4 h-4" aria-hidden />
            {t('Volunteers', '志愿者')}
          </button>
          <button
            type="button"
            className={ROW_BTN}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onToggle();
              setBusy(false);
            }}
          >
            {e.published ? t('Unpublish', '取消发布') : t('Publish', '发布')}
          </button>
          <InlineConfirm
            label={t('Delete', '删除')}
            keepLabel={t('Keep', '保留')}
            confirmLabel={t('Delete', '删除')}
            doneLabel={t('Deleting…', '即将删除…')}
            undoLabel={t('Undo', '撤销')}
            onCommit={onDelete}
          />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {qrOpen && open && (
          <motion.div
            key="qr"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={mountIn}
            className="overflow-hidden"
          >
            <QrPanel e={e} onCopy={onCopy} onClose={onQr} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// A printable QR code for the registration page.
function QrPanel({
  e,
  onCopy,
  onClose,
}: {
  e: AdminEvent;
  onCopy: () => void;
  onClose: () => void;
}) {
  const { t } = useAdmin();
  const url = registrationUrl(e);
  let png = '';
  let err = '';
  try {
    png = qrPng(url);
  } catch (x) {
    err = `QR: ${x instanceof Error ? x.message : String(x)}`;
  }
  const title = e.title_zh ? `${e.title_zh} · ${e.title}` : e.title;
  return (
    <div className="px-4 sm:px-5 pb-5 pt-1 flex flex-col sm:flex-row gap-4 sm:items-center border-t border-neutral-200/80">
      {png ? (
        <img
          src={png}
          alt={t(`Registration QR code for ${e.title}`, `${title} 报名二维码`)}
          className="w-40 h-40 mt-4 rounded-xl border border-neutral-200 bg-white"
        />
      ) : (
        <div className="mt-4">
          <Notice tone="error">{err}</Notice>
        </div>
      )}
      <div className="min-w-0 space-y-3 sm:mt-4">
        <p className="font-bold text-ink break-words">{title}</p>
        <p className="text-xs text-neutral-600">
          {t('Scanning opens the registration page', '扫码打开报名页面')}{' '}
          <code className="break-all text-ink">{url}</code>
        </p>
        <div className="flex flex-wrap gap-2">
          {png && (
            <a className={SECONDARY} download={`caaci-${e.slug}-registration-qr.gif`} href={png}>
              <Download className="w-4 h-4" aria-hidden />
              {t('Download image', '下载图片')}
            </a>
          )}
          <button type="button" className={SECONDARY} onClick={onCopy}>
            <Copy className="w-4 h-4" aria-hidden />
            {t('Copy link', '复制链接')}
          </button>
          <button type="button" className={SECONDARY} onClick={onClose}>
            <X className="w-4 h-4" aria-hidden />
            {t('Close', '关闭')}
          </button>
        </div>
      </div>
    </div>
  );
}
