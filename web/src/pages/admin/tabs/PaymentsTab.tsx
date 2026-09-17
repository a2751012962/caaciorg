import { useState } from 'react';
import { RefreshCw, Undo2 } from 'lucide-react';
import {
  DataTable,
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

// The membership ledger: head-counts and this year's revenue on top, every
// payment beneath, 50 a page. Rows are written by the Stripe webhook; a row
// with a refundable balance links to the Refunds tab, opened on that payment.
// functions/api/admin/payments.js.
export default function PaymentsTab() {
  const { lang, t, api, tierName, go } = useAdmin();
  const kindLabel = useKindLabel();
  const [offset, setOffset] = useState(0);
  const page = useLoad(async () => {
    const res = await api<PaymentsPage>(paymentsPath(offset));
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load payments.', '无法加载收款记录。');
    return res;
  }, [offset]);
  const data = page.data;
  const rows = data?.rows ?? [];
  const sc = data?.status_counts ?? {};

  const tiles: { label: string; value: string; tone?: string }[] = [
    {
      label: t('Active members', '有效会员'),
      value: fmtCount(sc.active),
      tone: 'text-emerald-700',
    },
    {
      label: t('Past due — follow up', '逾期需补交'),
      value: fmtCount(sc.past_due),
      tone: sc.past_due ? 'text-amber-700' : undefined,
    },
    { label: t('Expired', '已过期'), value: fmtCount(sc.expired), tone: 'text-neutral-500' },
    {
      label: t('Revenue this year', '今年收款'),
      value: data ? usd(data.revenue_ytd_cents) : '—',
    },
  ];

  const columns: Column<Payment>[] = [
    { key: 'date', label: t('Date', '日期'), render: (p) => fmtDate(lang, p.paid_at) },
    { key: 'member', label: t('Member', '会员'), render: (p) => <MemberCell p={p} /> },
    { key: 'kind', label: t('Type', '类型'), render: (p) => kindLabel(p.kind) },
    { key: 'tier', label: t('Tier', '方案'), render: (p) => tierName(p.tier_id), wideOnly: true },
    {
      key: 'discount',
      label: t('Discount', '折扣码'),
      render: (p) =>
        p.discount_code ? <code className="font-mono text-xs">{p.discount_code}</code> : '—',
    },
    {
      key: 'amount',
      label: t('Amount', '金额'),
      className: 'tabular-nums',
      render: (p) => (
        <span className="inline-block">
          <span className="block text-ink font-semibold">{usd(p.amount_cents)}</span>
          {!!p.refunded_cents && (
            <span className="block text-xs text-neutral-500">
              −{usd(p.refunded_cents)} {t('refunded', '已退')}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Payments', '收款记录')}
        description={t(
          'Every membership charge lands here automatically via the Stripe webhook — first-year payments and yearly auto-renewals. Members whose card failed show as Past due; follow up or they expire.',
          '每笔会员费都会通过 Stripe webhook 自动记录——包括首年付款和每年自动续费扣款。扣款失败的会员显示为“逾期”，需要跟进补交，否则会过期。',
        )}
        actions={
          <button
            type="button"
            className={SECONDARY}
            disabled={page.loading}
            onClick={() => void page.reload()}
          >
            <RefreshCw className={`w-4 h-4 ${page.loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('Refresh', '刷新')}
          </button>
        }
      />

      {page.error && data && <Notice tone="error">{page.error}</Notice>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((x) => (
          <div
            key={x.label}
            className="bg-surface-2 rounded-2xl border border-neutral-200/80 shadow-xs p-4"
          >
            <div className="text-xs font-bold text-neutral-500">{x.label}</div>
            <div
              className={`mt-1 text-2xl sm:text-3xl font-bold tabular-nums ${x.tone ?? 'text-ink'}`}
            >
              {x.value}
            </div>
          </div>
        ))}
      </div>

      <Loaded
        loading={page.loading}
        error={data ? '' : page.error}
        isEmpty={data ? rows.length === 0 && offset === 0 : undefined}
        empty={t('No payments recorded yet.', '暂无收款记录。')}
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
                onClick={() => go('refunds', { payment: p.id, offset: String(offset) })}
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden />
                {t('Refund', '退款')}
              </button>
            ) : (
              <span className="text-xs text-neutral-500">{t('Refunded', '已退款')}</span>
            )
          }
        />
        <Pager
          offset={offset}
          limit={LEDGER_LIMIT}
          total={data?.total ?? 0}
          onPage={(o) => setOffset(o)}
        />
      </Loaded>
    </div>
  );
}

const fmtCount = (n: number | null | undefined) => (n == null ? '—' : String(n));
