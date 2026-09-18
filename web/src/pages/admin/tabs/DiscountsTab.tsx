import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Plus, QrCode, X } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { tr } from '../../../components/tokens/ui';
import type { Lang } from '../../../lib/lang';
import { listExit, listItem, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DIVIDED,
  DragStepper,
  INPUT,
  InlineConfirm,
  LABEL,
  LiquidToggle,
  Loaded,
  Notice,
  PRIMARY,
  SECONDARY,
  Status,
  TabHeader,
  useAdmin,
  useLoad,
} from '../kit';

interface Discount {
  code: string;
  percent_off: number;
  description: string | null;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  created_at: string;
}

const ENDPOINT = '/api/admin/discounts';
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const shareUrl = (code: string) =>
  `${location.origin}/membership/?code=${encodeURIComponent(code)}`;

function qrPng(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 16);
}

// Discount codes: the active switch is a LiquidToggle, percent off a
// DragStepper, and Delete an InlineConfirm whose Undo holds the DELETE back.
// functions/api/admin/discounts.js.
export default function DiscountsTab() {
  const { lang, t, api, toast } = useAdmin();
  const list = useLoad(() => api<{ rows: Discount[] }>(ENDPOINT));
  const rows = list.data?.rows ?? [];
  const setRows = (next: (rs: Discount[]) => Discount[]) => list.set({ rows: next(rows) });
  const [adding, setAdding] = useState(false);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const setActive = async (d: Discount, active: boolean) => {
    setRows((rs) => rs.map((r) => (r.code === d.code ? { ...r, active } : r)));
    const res = await api<{ discount: Discount }>(ENDPOINT, { body: { code: d.code, active } });
    if (res.ok) setRows((rs) => rs.map((r) => (r.code === d.code ? res.data.discount : r)));
    else {
      setRows((rs) => rs.map((r) => (r.code === d.code ? d : r)));
      toast('error', res.data.error || t('Update failed.', '更新失败。'));
    }
  };

  const remove = async (d: Discount) => {
    const res = await api(`${ENDPOINT}?code=${encodeURIComponent(d.code)}`, { method: 'DELETE' });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    setRows((rs) => rs.filter((r) => r.code !== d.code));
    if (qrFor === d.code) setQrFor(null);
    toast('success', t(`Deleted ${d.code}.`, `已删除 ${d.code}。`));
  };

  const created = (d: Discount) => {
    setRows((rs) => [d, ...rs]);
    setAdding(false);
    setQrFor(d.code); // hand the QR over right away
  };

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Discount codes', '折扣码')}
        description={t(
          'Codes members type at checkout, each with a QR code that opens the membership page with it applied.',
          '会员结账时输入的折扣码；每个码都有二维码，扫码打开已带折扣的会员页。',
        )}
        actions={
          <button type="button" className={PRIMARY} onClick={() => setAdding((a) => !a)}>
            {adding ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {adding ? t('Cancel', '取消') : t('New code', '新建折扣码')}
          </button>
        }
      />

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            key="form"
            initial={riseFromSm}
            animate={shown}
            exit={listExit}
            transition={mountIn}
          >
            <CreateForm lang={lang} onCreated={created} />
          </motion.div>
        )}
      </AnimatePresence>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? rows.length === 0 : undefined}
        empty={t('No discount codes yet.', '暂无折扣码。')}
      >
        <ul className={DIVIDED}>
          <AnimatePresence initial={false}>
            {rows.map((d, i) => (
              <motion.li
                key={d.code}
                layout
                initial={riseFromSm}
                animate={shown}
                exit={listExit}
                transition={listItem(i)}
                className="py-5"
              >
                <Row
                  d={d}
                  lang={lang}
                  qrOpen={qrFor === d.code}
                  onQr={() => setQrFor((c) => (c === d.code ? null : d.code))}
                  onActive={(on) => void setActive(d, on)}
                  onDelete={() => void remove(d)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Loaded>
    </div>
  );
}

function state(d: Discount, lang: Lang) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  if (!d.active) return { tone: 'muted' as const, label: t('Inactive', '已停用') };
  if (d.expires_at && new Date(d.expires_at) <= new Date())
    return { tone: 'warn' as const, label: t('Expired', '已过期') };
  if (d.max_redemptions != null && d.times_redeemed >= d.max_redemptions)
    return { tone: 'warn' as const, label: t('Used up', '已用完') };
  return { tone: 'good' as const, label: t('Active', '有效') };
}

function Row({
  d,
  lang,
  qrOpen,
  onQr,
  onActive,
  onDelete,
}: {
  d: Discount;
  lang: Lang;
  qrOpen: boolean;
  onQr: () => void;
  onActive: (on: boolean) => void;
  onDelete: () => void;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const st = state(d, lang);
  const expires = d.expires_at
    ? new Date(d.expires_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : t('No expiry', '不过期');
  const used = `${d.times_redeemed}${d.max_redemptions != null ? ` / ${d.max_redemptions}` : ''}`;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <code className="font-mono text-base font-bold text-ink tracking-wide">{d.code}</code>
            <span className="text-sm font-semibold text-brick">−{d.percent_off}%</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500 truncate">{d.description || '—'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-neutral-600">
          <Status tone={st.tone}>{st.label}</Status>
          <span>
            {t('Used', '已用')} <b className="tabular-nums text-ink">{used}</b>
          </span>
          <span>{expires}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <LiquidToggle
            checked={d.active}
            onChange={onActive}
            label={t(`${d.code} active`, `${d.code} 启用`)}
          />
          <button
            type="button"
            onClick={onQr}
            aria-expanded={qrOpen}
            className="h-11 px-4 rounded-full border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <QrCode className="w-4 h-4" aria-hidden />
            {t('QR', '二维码')}
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
        {qrOpen && (
          <motion.div
            key="qr"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={mountIn}
            className="overflow-hidden"
          >
            <QrPanel d={d} lang={lang} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function QrPanel({ d, lang }: { d: Discount; lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const url = shareUrl(d.code);
  let png = '';
  try {
    png = qrPng(url);
  } catch {
    /* shown as the notice below */
  }
  return (
    <div className="pt-4 pb-1 flex flex-col sm:flex-row gap-4 sm:items-center border-t border-neutral-200/80">
      {png ? (
        <img
          src={png}
          alt={t(`QR code for ${d.code}`, `${d.code} 的二维码`)}
          className="w-40 h-40 mt-4 rounded-xl border border-neutral-200 bg-white"
        />
      ) : (
        <Notice tone="error">{t('Could not draw the QR code.', '无法生成二维码。')}</Notice>
      )}
      <div className="min-w-0 space-y-3 sm:mt-4">
        <p className="text-xs text-neutral-600">
          {t('Scanning opens', '扫码打开')} <code className="break-all text-ink">{url}</code>
        </p>
        {png && (
          <a className={SECONDARY} download={`caaci-${d.code}-qr.gif`} href={png}>
            <Download className="w-4 h-4" aria-hidden />
            {t('Download image', '下载图片')}
          </a>
        )}
      </div>
    </div>
  );
}

function CreateForm({ lang, onCreated }: { lang: Lang; onCreated: (d: Discount) => void }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const { api } = useAdmin();
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState<number | null>(20);
  const [description, setDescription] = useState('');
  const [expires, setExpires] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!CODE_RE.test(clean))
      return setMsg(
        t(
          'Code must be 2–32 letters, digits, dashes or underscores.',
          '折扣码须为 2–32 位字母、数字、短横线或下划线。',
        ),
      );
    if (!percent) return setMsg(t('Percent off is required.', '折扣百分比为必填项。'));
    setBusy(true);
    const res = await api<{ discount: Discount }>(ENDPOINT, {
      method: 'PUT',
      body: {
        code: clean,
        percent_off: percent,
        description: description.trim(),
        expires_at: expires,
        max_redemptions: cap,
      },
    });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Could not create code.', '无法创建折扣码。'));
    onCreated(res.data.discount);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t('Code', '折扣码')} *</span>
          <input
            className={`${INPUT} font-mono uppercase`}
            value={code}
            maxLength={32}
            placeholder="SPRING2026"
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </label>
        <div>
          <span className={LABEL}>{t('Percent off', '折扣百分比')} *</span>
          <DragStepper
            value={percent}
            onChange={setPercent}
            min={1}
            max={100}
            suffix="%"
            label={t('Percent off', '折扣百分比')}
            hint={t('Tap for 1 · hold and slide to sweep', '点一下 ±1 · 按住左右滑动快速调')}
          />
        </div>
        <label className="block md:col-span-2">
          <span className={LABEL}>{t('Description', '说明')}</span>
          <input
            className={INPUT}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block">
          <span className={LABEL}>{t('Expires (optional)', '到期（可选）')}</span>
          <input
            type="date"
            className={INPUT}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </label>
        <label className="block">
          <span className={LABEL}>{t('Max redemptions (optional)', '最多使用次数（可选）')}</span>
          <input
            type="number"
            min={1}
            step={1}
            className={INPUT}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </label>
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <button type="submit" className={PRIMARY} disabled={busy}>
        {t('Create code', '创建折扣码')}
      </button>
    </form>
  );
}
