import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Download, Link2, Plus, X } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { tr } from '../../../components/tokens/ui';
import type { Lang } from '../../../lib/lang';
import { listExit, listItem, mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DIVIDED,
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
  fmtDate,
  fmtDateTime,
  useAdmin,
  useLoad,
} from '../kit';

interface Invite {
  code: string;
  tier_id: string;
  note: string | null;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  created_at: string;
}

interface Redemption {
  code: string;
  member_id: string;
  redeemed_at: string;
  members: { full_name: string | null; email: string | null } | null;
}

type Listing = { rows: Invite[]; redemptions: Redemption[] };

const ENDPOINT = '/api/admin/invites';
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
// The link the invited person opens: the account page, which sends them to
// sign in or sign up first and comes back with the code (AccountPage.tsx).
const shareUrl = (code: string) => `${location.origin}/account/?invite=${encodeURIComponent(code)}`;

function qrPng(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 16);
}

// Invitation codes for Honorable Membership: an admin makes one (the emailed
// verification code guards it, as a plan change is guarded), sends the link,
// and the invited people activate the tier themselves on /account/.
// functions/api/admin/invites.js; the member side is functions/api/invite.js.
export default function InvitesTab() {
  const { lang, t, api, guarded, toast } = useAdmin();
  const list = useLoad(() => api<Listing>(ENDPOINT));
  const rows = list.data?.rows ?? [];
  const redemptions = list.data?.redemptions ?? [];
  const setRows = (next: (rs: Invite[]) => Invite[]) => list.set({ rows: next(rows), redemptions });
  const [adding, setAdding] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);

  const setActive = async (d: Invite, active: boolean) => {
    setRows((rs) => rs.map((r) => (r.code === d.code ? { ...r, active } : r)));
    // Switching a code back on opens seats again, so it needs the emailed code.
    const call = (headers: Record<string, string>) =>
      api<{ invite: Invite }>(ENDPOINT, { body: { code: d.code, active }, headers });
    const res = active ? await guarded(call) : await call({});
    if (res.ok) setRows((rs) => rs.map((r) => (r.code === d.code ? res.data.invite : r)));
    else {
      setRows((rs) => rs.map((r) => (r.code === d.code ? d : r)));
      if (!res.cancelled) toast('error', res.data.error || t('Update failed.', '更新失败。'));
    }
  };

  const remove = async (d: Invite) => {
    const res = await api(`${ENDPOINT}?code=${encodeURIComponent(d.code)}`, { method: 'DELETE' });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    setRows((rs) => rs.filter((r) => r.code !== d.code));
    if (openFor === d.code) setOpenFor(null);
    toast('success', t(`Deleted ${d.code}.`, `已删除 ${d.code}。`));
  };

  const created = (d: Invite) => {
    setRows((rs) => [d, ...rs]);
    setAdding(false);
    setOpenFor(d.code); // hand the link over right away
  };

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Invitation codes', '邀请码')}
        description={t(
          'A link for the people the Board honours: they open it, sign in or sign up, and Honorable Membership is activated on their account, with its 华协币. Cap a code at the number of people it is for.',
          '给理事会拟授予荣誉会员的人一个链接：点开、登录或注册，即可在自己账号上激活荣誉会员并获发华协币。请把使用次数上限设为实际邀请的人数。',
        )}
        actions={
          <button type="button" className={PRIMARY} onClick={() => setAdding((a) => !a)}>
            {adding ? (
              <X className="w-4 h-4" aria-hidden />
            ) : (
              <Plus className="w-4 h-4" aria-hidden />
            )}
            {adding ? t('Cancel', '取消') : t('New code', '新建邀请码')}
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
        empty={t('No invitation codes yet.', '暂无邀请码。')}
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
                  usedBy={redemptions.filter((r) => r.code === d.code)}
                  open={openFor === d.code}
                  onOpen={() => setOpenFor((c) => (c === d.code ? null : d.code))}
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

function state(d: Invite, lang: Lang) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  if (!d.active) return { tone: 'muted' as const, label: t('Off', '已停用') };
  if (d.expires_at && new Date(d.expires_at) <= new Date())
    return { tone: 'warn' as const, label: t('Expired', '已过期') };
  if (d.max_redemptions != null && d.times_redeemed >= d.max_redemptions)
    return { tone: 'warn' as const, label: t('Used up', '已用完') };
  return { tone: 'good' as const, label: t('Open', '可用') };
}

function Row({
  d,
  lang,
  usedBy,
  open,
  onOpen,
  onActive,
  onDelete,
}: {
  d: Invite;
  lang: Lang;
  usedBy: Redemption[];
  open: boolean;
  onOpen: () => void;
  onActive: (on: boolean) => void;
  onDelete: () => void;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const st = state(d, lang);
  const expires = d.expires_at ? fmtDate(lang, d.expires_at) : t('No expiry', '不过期');
  const used = `${d.times_redeemed}${d.max_redemptions != null ? ` / ${d.max_redemptions}` : ''}`;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <code className="font-mono text-base font-bold text-ink tracking-wide">{d.code}</code>
          <p className="mt-1 text-xs text-neutral-500 truncate">{d.note || '—'}</p>
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
            onClick={onOpen}
            aria-expanded={open}
            className="h-11 px-4 rounded-full border border-neutral-200 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Link2 className="w-4 h-4" aria-hidden />
            {t('Link', '链接')}
          </button>
          {/* A used code is the record of who joined through it: the API refuses to delete it. */}
          {d.times_redeemed === 0 && (
            <InlineConfirm
              label={t('Delete', '删除')}
              keepLabel={t('Keep', '保留')}
              confirmLabel={t('Delete', '删除')}
              doneLabel={t('Deleting…', '即将删除…')}
              undoLabel={t('Undo', '撤销')}
              onCommit={onDelete}
            />
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={mountIn}
            className="overflow-hidden"
          >
            <SharePanel d={d} lang={lang} usedBy={usedBy} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SharePanel({ d, lang, usedBy }: { d: Invite; lang: Lang; usedBy: Redemption[] }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const { toast } = useAdmin();
  const url = shareUrl(d.code);
  let png = '';
  try {
    png = qrPng(url);
  } catch {
    /* shown as the notice below */
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('success', t('Link copied.', '链接已复制。'));
    } catch {
      toast(
        'error',
        t('Could not copy — select the link and copy it.', '无法复制，请手动选中链接复制。'),
      );
    }
  };
  return (
    <div className="pt-4 pb-1 space-y-4 border-t border-neutral-200/80">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
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
            {t('Send this link', '把这个链接发给对方')}{' '}
            <code className="break-all text-ink">{url}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={SECONDARY} onClick={() => void copy()}>
              <Copy className="w-4 h-4" aria-hidden />
              {t('Copy link', '复制链接')}
            </button>
            {png && (
              <a className={SECONDARY} download={`caaci-invite-${d.code}-qr.gif`} href={png}>
                <Download className="w-4 h-4" aria-hidden />
                {t('Download QR', '下载二维码')}
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-bold text-neutral-500">
          {t('Used by', '已使用的会员')}{' '}
          <span className="tabular-nums text-ink">{usedBy.length}</span>
        </p>
        {usedBy.length === 0 ? (
          <p className="text-xs text-neutral-500">{t('Nobody yet.', '还没有人使用。')}</p>
        ) : (
          <ul className={DIVIDED}>
            {usedBy.map((r) => (
              <li
                key={`${r.code}:${r.member_id}`}
                className="py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs"
              >
                <span className="min-w-0">
                  <span className="font-semibold text-ink">
                    {r.members?.full_name || t('(no name)', '（未填姓名）')}
                  </span>
                  {r.members?.email && (
                    <span className="ml-2 font-mono text-neutral-500 break-all">
                      {r.members.email}
                    </span>
                  )}
                </span>
                <span className="text-neutral-500 tabular-nums">
                  {fmtDateTime(lang, r.redeemed_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CreateForm({ lang, onCreated }: { lang: Lang; onCreated: (d: Invite) => void }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const { api, guarded } = useAdmin();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [expires, setExpires] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean && !CODE_RE.test(clean))
      return setMsg(
        t(
          'A code is 2–32 letters, digits, dashes or underscores — or leave it blank for a random one.',
          '邀请码须为 2–32 位字母、数字、短横线或下划线；留空则自动生成。',
        ),
      );
    setBusy(true);
    setMsg('');
    const res = await guarded((headers) =>
      api<{ invite: Invite }>(ENDPOINT, {
        method: 'PUT',
        headers,
        body: {
          code: clean,
          note: note.trim(),
          expires_at: expires,
          max_redemptions: cap,
        },
      }),
    );
    setBusy(false);
    if (res.cancelled) return;
    if (!res.ok)
      return setMsg(res.data.error || t('Could not create the code.', '无法创建邀请码。'));
    onCreated(res.data.invite);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t('Code (optional)', '邀请码（可选）')}</span>
          <input
            className={`${INPUT} font-mono uppercase`}
            value={code}
            maxLength={32}
            placeholder={t('Blank = random, e.g. HM-7K3Q9XAB', '留空自动生成，如 HM-7K3Q9XAB')}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block">
          <span className={LABEL}>{t('Max uses (optional)', '最多使用次数（可选）')}</span>
          <input
            type="number"
            min={1}
            step={1}
            className={INPUT}
            value={cap}
            placeholder={t('How many people this is for', '本次邀请的人数')}
            onChange={(e) => setCap(e.target.value)}
          />
        </label>
        <label className="block">
          <span className={LABEL}>{t('Note', '备注')}</span>
          <input
            className={INPUT}
            value={note}
            placeholder={t('e.g. 2026 Mid-Autumn volunteers', '例如：2026 中秋志愿者')}
            onChange={(e) => setNote(e.target.value)}
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
      </div>
      {msg && <Notice tone="error">{msg}</Notice>}
      <button type="submit" className={PRIMARY} disabled={busy}>
        {t('Create code', '创建邀请码')}
      </button>
    </form>
  );
}
