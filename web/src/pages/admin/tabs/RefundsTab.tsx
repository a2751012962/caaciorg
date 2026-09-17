import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Undo2, X } from 'lucide-react';
import { mountIn, riseFromSm, shown } from '../../../lib/motion';
import {
  DataTable,
  Field,
  INPUT,
  InlineConfirm,
  Loaded,
  Notice,
  Pager,
  ROW_BTN,
  SECONDARY,
  TabHeader,
  fmtDate,
  usd,
  useAdmin,
  useLoad,
  useTabParams,
  type Column,
} from '../kit';
import {
  LEDGER_LIMIT,
  MemberCell,
  paymentsPath,
  remainingOf,
  useKindLabel,
  type Payment,
  type PaymentsPage,
} from './payments/ledger';

interface RefundResult {
  ok: true;
  refund_id: string;
  amount_cents: number;
  refunded_cents: number;
  fully_refunded: boolean;
}

// Refunds: the payments ledger (same GET /api/admin/payments feed) with a
// Refund action per row. The form opens under its row; Issue refund is an
// InlineConfirm, and once its undo window has passed POST /api/admin/refunds
// runs through guarded(), which asks for the emailed code.
// Opened from Payments as #refunds?payment=<id>&offset=<page offset>.
export default function RefundsTab() {
  const { lang, t, api } = useAdmin();
  const params = useTabParams();
  const kindLabel = useKindLabel();
  const [offset, setOffset] = useState(() => Math.max(0, Number(params.offset) || 0));
  const [openId, setOpenId] = useState<string | null>(params.payment || null);
  const [done, setDone] = useState('');
  const page = useLoad(async () => {
    const res = await api<PaymentsPage>(paymentsPath(offset));
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load payments.', '无法加载收款记录。');
    return res;
  }, [offset]);
  const data = page.data;
  const rows = data?.rows ?? [];

  // The payment we were sent to is not on this page (the ledger moved on).
  const missing =
    !!params.payment &&
    openId === params.payment &&
    !!data &&
    !page.loading &&
    !rows.some((p) => p.id === params.payment);

  const refunded = async (res: RefundResult) => {
    setOpenId(null);
    setDone(
      t(
        `Refunded ${usd(res.amount_cents)}${res.fully_refunded ? ' (payment now fully refunded)' : ''}.`,
        `已退款 ${usd(res.amount_cents)}${res.fully_refunded ? '（该付款已全额退回）' : ''}。`,
      ),
    );
    await page.reload();
  };

  const columns: Column<Payment>[] = [
    { key: 'date', label: t('Date', '日期'), render: (p) => fmtDate(lang, p.paid_at) },
    { key: 'member', label: t('Member', '会员'), render: (p) => <MemberCell p={p} /> },
    { key: 'kind', label: t('Type', '类型'), render: (p) => kindLabel(p.kind) },
    {
      key: 'paid',
      label: t('Paid', '实付'),
      className: 'tabular-nums',
      render: (p) => usd(p.amount_cents),
    },
    {
      key: 'refunded',
      label: t('Refunded', '已退'),
      className: 'tabular-nums',
      render: (p) =>
        p.refunded_cents ? (
          <>
            {usd(p.refunded_cents)}
            {remainingOf(p) <= 0 && (
              <span className="text-neutral-500"> ({t('full', '全额')})</span>
            )}
          </>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Refunds', '退款')}
        description={t(
          'Refund a charge straight from here — the money is returned through Stripe and the ledger is updated. Refund the full amount or a partial amount; a charge can be refunded more than once up to what was paid.',
          '可直接在此退款——款项通过 Stripe 原路退回并更新收款记录。可全额或部分退款；同一笔付款可多次退款，累计不超过实付金额。',
        )}
      />

      {done && <Notice tone="success">{done}</Notice>}
      {page.error && data && <Notice tone="error">{page.error}</Notice>}
      {missing && (
        <Notice tone="warn">
          {t(
            'That payment is not on this page any more — find it in the list below.',
            '该付款已不在本页，请在下方列表中查找。',
          )}
        </Notice>
      )}

      <Loaded
        loading={page.loading}
        error={data ? '' : page.error}
        isEmpty={data ? rows.length === 0 && offset === 0 : undefined}
        empty={t('No payments to refund.', '暂无可退款的付款。')}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          actions={(p) =>
            remainingOf(p) > 0 ? (
              <button
                type="button"
                className={ROW_BTN}
                aria-expanded={openId === p.id}
                onClick={() => {
                  setDone('');
                  setOpenId((id) => (id === p.id ? null : p.id));
                }}
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden />
                {t('Refund', '退款')}
              </button>
            ) : (
              <span className="text-xs text-neutral-500">{t('Refunded', '已退款')}</span>
            )
          }
          expand={(p) =>
            openId === p.id && remainingOf(p) > 0 ? (
              <motion.div initial={riseFromSm} animate={shown} transition={mountIn}>
                <RefundForm
                  p={p}
                  autoScroll={p.id === params.payment}
                  onClose={() => setOpenId(null)}
                  onRefunded={(r) => void refunded(r)}
                />
              </motion.div>
            ) : null
          }
        />
        <Pager
          offset={offset}
          limit={LEDGER_LIMIT}
          total={data?.total ?? 0}
          onPage={(o) => {
            setOpenId(null);
            setOffset(o);
          }}
        />
      </Loaded>
    </div>
  );
}

// The "issue a refund" form for one ledger row. The amount starts at the whole
// refundable balance; staff may enter a smaller, partial amount.
function RefundForm({
  p,
  autoScroll,
  onClose,
  onRefunded,
}: {
  p: Payment;
  autoScroll: boolean;
  onClose: () => void;
  onRefunded: (r: RefundResult) => void;
}) {
  const { t, api, guarded } = useAdmin();
  const remaining = remainingOf(p);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const box = useRef<HTMLDivElement>(null);
  // InlineConfirm commits when it unmounts inside its undo window. For money
  // that is the wrong default: Cancel, turning the page or leaving the tab
  // before the window ends cancels the refund instead. `closed` covers Cancel;
  // a form no longer in the document (its DOM is gone before the commit runs)
  // covers the rest.
  const closed = useRef(false);
  const who = p.members?.full_name || p.members?.email || t('this member', '该会员');

  useEffect(() => {
    if (autoScroll) box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [autoScroll]);

  const dollars = parseFloat(amount);
  const cents = Math.round(dollars * 100);
  const invalid =
    !Number.isFinite(dollars) || dollars <= 0
      ? t('Enter a valid amount.', '请输入有效金额。')
      : cents > remaining
        ? t('Amount exceeds the refundable balance.', '金额超过可退余额。')
        : '';

  const issue = async () => {
    if (closed.current || !box.current?.isConnected) return;
    if (invalid) return setMsg(invalid);
    setBusy(true);
    setMsg('');
    // Money moves: the API insists on the emailed verification code.
    const res = await guarded((headers) =>
      api<RefundResult>('/api/admin/refunds', {
        method: 'POST',
        headers,
        body: { payment_id: p.id, amount_cents: cents, reason: reason.trim() || undefined },
      }),
    );
    setBusy(false);
    if (res.cancelled) return;
    if (!res.ok) return setMsg(res.data.error || t('Refund failed.', '退款失败。'));
    onRefunded(res.data);
  };

  return (
    <div ref={box} className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-ink break-words">
            {t('Refund', '退款')} — {who}
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            {t('Refundable balance', '可退余额')}:{' '}
            <b className="tabular-nums text-ink">{usd(remaining)}</b>
          </p>
        </div>
        <button
          type="button"
          className="w-11 h-11 shrink-0 rounded-full inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-ink cursor-pointer transition-colors"
          aria-label={t('Cancel', '取消')}
          onClick={() => {
            closed.current = true;
            onClose();
          }}
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('Amount (USD)', '金额（美元）')}>
          <input
            type="number"
            className={`${INPUT} tabular-nums`}
            min={0.01}
            max={(remaining / 100).toFixed(2)}
            step={0.01}
            inputMode="decimal"
            value={amount}
            disabled={busy}
            onChange={(e) => {
              setAmount(e.target.value);
              setMsg('');
            }}
          />
        </Field>
        <Field label={t('Reason (optional)', '原因（可选）')}>
          <input
            type="text"
            className={INPUT}
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      {invalid ? (
        <Notice tone="error">{invalid}</Notice>
      ) : (
        <p className="text-xs text-neutral-600">
          {t(
            `Refund ${usd(cents)} to ${who}? This returns the money through Stripe.`,
            `确认向 ${who} 退款 ${usd(cents)}？款项将通过 Stripe 原路退回。`,
          )}
        </p>
      )}
      {msg && msg !== invalid && <Notice tone="error">{msg}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <InlineConfirm
          label={t('Issue refund', '确认退款')}
          keepLabel={t('Keep', '保留')}
          confirmLabel={
            invalid ? t('Refund', '退款') : t(`Refund ${usd(cents)}`, `退款 ${usd(cents)}`)
          }
          doneLabel={t('Refunding…', '即将退款…')}
          undoLabel={t('Undo', '撤销')}
          disabled={busy || !!invalid}
          onCommit={() => void issue()}
        />
        <button
          type="button"
          className={SECONDARY}
          disabled={busy}
          onClick={() => {
            closed.current = true;
            onClose();
          }}
        >
          {t('Cancel', '取消')}
        </button>
      </div>
    </div>
  );
}
