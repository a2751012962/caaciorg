// The payments ledger as the Payments, Refunds and Dashboard tabs read it
// (functions/api/admin/payments.js, functions/api/admin/dashboard.js).
import { useAdmin } from '../../kit';

export interface Payment {
  id: string;
  kind: string | null;
  amount_cents: number | null;
  currency?: string | null;
  tier_id: string | null;
  discount_code?: string | null;
  paid_at: string | null;
  refunded_cents?: number | null;
  refunded_at?: string | null;
  members: { full_name: string | null; email: string | null } | null;
}

export interface PaymentsPage {
  rows: Payment[];
  total: number;
  limit: number;
  offset: number;
  status_counts: Record<string, number>;
  revenue_ytd_cents: number;
}

export const PAYMENTS = '/api/admin/payments';
export const LEDGER_LIMIT = 50;

export const paymentsPath = (offset: number) =>
  `${PAYMENTS}?${new URLSearchParams({ limit: String(LEDGER_LIMIT), offset: String(offset) })}`;

/** First year / auto-renewal; anything else as stored. */
export function useKindLabel() {
  const { t } = useAdmin();
  return (kind: string | null | undefined) =>
    kind === 'membership'
      ? t('First year', '首年入会')
      : kind === 'renewal'
        ? t('Auto-renewal', '自动续费')
        : kind || '—';
}

/** What is still refundable on a ledger row, in cents. */
export const remainingOf = (p: Payment) => (p.amount_cents || 0) - (p.refunded_cents || 0);

/** Name over email, or "(deleted member)" when the member row is gone. */
export function MemberCell({ p }: { p: Pick<Payment, 'members'> }) {
  const { t } = useAdmin();
  if (!p.members)
    return <span className="text-neutral-500">{t('(deleted member)', '（已删除会员）')}</span>;
  return (
    <span className="inline-block min-w-0 text-left md:text-left">
      <span className="block text-ink font-medium">{p.members.full_name || '—'}</span>
      {p.members.email && (
        <span className="block text-xs text-neutral-500 break-all">{p.members.email}</span>
      )}
    </span>
  );
}
