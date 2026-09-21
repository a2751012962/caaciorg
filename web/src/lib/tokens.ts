// Client for the token (华协币) endpoints in functions/api/tokens/* and
// functions/api/admin/{tokens,merchants,roles}.js. Types mirror what those
// handlers return. Every call goes through api() with the member's session;
// nothing here decides who may do what — the server does.
import { api, type ApiResult } from './api';
import type { Lang } from './lang';

export type TxKind =
  | 'grant'
  | 'purchase'
  | 'cash'
  | 'mint'
  | 'charge'
  | 'void'
  | 'reversal'
  | 'transfer_out'
  | 'transfer_in'
  | 'adjust';
export type TxState = 'ok' | 'voided' | 'disputed' | 'reversed';

export interface TxLine {
  /** the menu item this line was rung up from; absent on charges taken before 0032 */
  id?: string;
  name: string;
  name_zh: string | null;
  tokens: number;
  qty: number;
}

export interface MerchantRef {
  id: string;
  name: string;
  name_zh: string | null;
}

export interface Pack {
  cents: number;
  tokens: number;
  charge_cents: number;
}

export interface WalletTx {
  id: string;
  at: string;
  kind: TxKind;
  amount: number;
  state: TxState;
  items: TxLine[];
  note: string;
  merchant: { name: string; name_zh: string | null } | null;
}

export interface Wallet {
  enabled: boolean;
  balance: number;
  expiring: { amount: number; at: string } | null;
  rate: number;
  can_buy: boolean;
  packs: Pack[];
  history: WalletTx[];
  family: { id: string; name: string }[];
  roles: { admin: boolean; root: boolean; merchants: MerchantRef[] };
}

export interface MenuItem {
  id: string;
  merchant_id: string;
  group_label: string | null;
  name: string;
  name_zh: string | null;
  tokens: number;
  sort_order?: number;
  active?: boolean;
  /** the code in this item's printed QR (0030); null = no sticker issued */
  pay_code?: string | null;
  pay_code_at?: string | null;
  /** units sold under standing charges (0033); only on the admin's list */
  sold?: number;
  sold_tokens?: number;
}

export interface ScanMerchant extends MerchantRef {
  kind: 'internal' | 'partner';
  status: 'active' | 'suspended';
  items: MenuItem[];
}

export interface Scan {
  member: {
    id: string;
    name: string;
    valid: boolean;
    tier_name: string | null;
    until: string | null;
    is_self: boolean;
  };
  balance: number;
  merchants: ScanMerchant[];
  admin: boolean;
  root: boolean;
  grant_target: number;
  limits: { max_charge: number; rate: number; cash_min_cents: number; admin_mint_cap: number };
}

export interface MerchantTx {
  id: string;
  at: string;
  kind: TxKind;
  amount: number;
  state: TxState;
  items: TxLine[];
  note: string;
  customer: string;
  by: string;
  related_tx: string | null;
  settled: boolean;
  can_void: boolean;
  /** paid by the customer scanning the item's own QR, with nobody at a till */
  self_serve: boolean;
  /** the four characters their screen shows, for the counter to check */
  confirm: string;
  /** when the stall handed it over (0031); null = still waiting */
  collected_at: string | null;
  /** who ticked it off, so a second claim on one payment names someone */
  collected_by: string;
  can_collect: boolean;
}

/** What a printed pay code (0030) stands for: /api/tokens/pay?c=<code>. */
export interface PayCode {
  code: string;
  merchant: { name: string; name_zh: string | null };
  item: { name: string; name_zh: string | null; tokens: number };
  /** false when the shop is suspended, over the cap, or not cleared for scan-to-pay */
  open: boolean;
  suspended: boolean;
  rate: number;
  signed_in: boolean;
  balance: number | null;
}

export interface PayDone {
  ok: true;
  tx_id: string;
  confirm: string;
  amount: number;
  balance: number;
  duplicate: boolean;
}

export interface Settlement {
  id: string;
  merchant_id?: string;
  period_end: string;
  tokens: number;
  amount_cents: number;
  status: 'due' | 'paid';
  reference: string | null;
  paid_at: string | null;
}

export interface MerchantConsole {
  merchant: {
    id: string;
    name: string;
    name_zh: string | null;
    kind: 'internal' | 'partner';
    status: 'active' | 'suspended';
    suspended_reason: string | null;
  };
  rate: number;
  open: { tokens: number; amount_cents: number };
  total: number;
  offset: number;
  rows: MerchantTx[];
  settlements: Settlement[];
}

export interface TokenSettings {
  tokens_per_dollar: number;
  grants: Record<string, number>;
  packs_cents: number[];
  max_charge: number;
  admin_mint_cap: number;
  admin_daily_cap: number;
  cash_min_cents: number;
  void_hours: number;
  dispute_days: number;
  settle_min_cents: number;
  suspend_after: number;
  /** 0030; older databases answer without these until the migration is applied */
  pay_repeat_seconds?: number;
  pay_allow_partners?: boolean;
}

export interface Overview {
  settings: TokenSettings;
  totals: {
    outstanding: Partial<Record<'grant' | 'purchase' | 'cash' | 'mint', number>>;
    holders: number;
    owed_to_partners: number;
    statements_due_cents: number;
    open_disputes: number;
    failed_receipts: number;
  };
  root: boolean;
}

export interface LedgerTx {
  id: string;
  created_at: string;
  kind: TxKind;
  amount: number;
  state: TxState;
  items: TxLine[] | null;
  note: string | null;
  reason: string | null;
  cash_cents: number | null;
  member_id: string | null;
  member_name: string;
  member_email: string;
  actor_name: string;
  merchant: { name: string; name_zh: string | null } | null;
  disputed_at: string | null;
  dispute_note: string | null;
  resolution: string | null;
  receipt_sent_at: string | null;
  receipt_error: string | null;
}

export interface AdminMerchant {
  id: string;
  name: string;
  name_zh: string | null;
  kind: 'internal' | 'partner';
  status: 'active' | 'suspended';
  suspended_reason: string | null;
  contact_name: string | null;
  contact_email: string | null;
  payout_note: string | null;
  open_tokens: number;
  open_cents: number;
  /** it has taken tokens or been settled, so it can only be suspended, never deleted */
  has_history: boolean;
  /** standing charges so far (0033): how many, and the tokens they took */
  sold_charges: number;
  sold_tokens: number;
  staff: { member_id: string; role: 'owner' | 'staff'; name: string; email: string }[];
  items: MenuItem[];
  settlements: Settlement[];
}

/** One menu item on its own: what it sold, and the charges behind that. */
export interface ItemReport {
  item: MenuItem;
  merchant: MerchantRef & { kind: 'internal' | 'partner'; status: 'active' | 'suspended' };
  /** units sold, counting only charges that still stand */
  sold: number;
  tokens: number;
  /** charges that were voided or refunded after a dispute */
  undone: number;
  first_at: string | null;
  last_at: string | null;
  total: number;
  offset: number;
  rows: LedgerTx[];
}

/** A refusal from the ledger carries both languages; anything else only English. */
export type Refusal = { error?: string; error_zh?: string; code?: string };

export function refusalText(res: ApiResult<Refusal>, lang: Lang): string {
  if (res.status === 0)
    return lang === 'zh' ? '网络连接失败，请重试。' : 'No connection. Please try again.';
  if (lang === 'zh' && res.data.error_zh) return res.data.error_zh;
  return res.data.error || (lang === 'zh' ? '操作失败。' : 'Something went wrong.');
}

const signed = { auth: true } as const;
const get = <T>(path: string) => api<T & Refusal>(path, undefined, signed);
const post = <T>(path: string, body: unknown) => api<T & Refusal>(path, body, signed);

export const tokens = {
  wallet: () => get<Wallet>('/api/tokens/me'),
  buy: (pack_cents: number) => post<{ url: string }>('/api/tokens/buy', { pack_cents }),
  transfer: (to: string, amount: number) =>
    post<{ ok: true; balance: number }>('/api/tokens/transfer', { to, amount }),

  scan: (memberId: string) => get<Scan>(`/api/tokens/scan?m=${encodeURIComponent(memberId)}`),
  charge: (body: {
    member_id: string;
    merchant_id: string;
    items: { id: string; qty: number }[];
    custom_tokens: number;
    note: string;
    idem_key: string;
  }) =>
    post<{ ok: true; tx_id: string; amount: number; balance: number; duplicate: boolean }>(
      '/api/tokens/charge',
      body,
    ),
  // Scan-to-pay: the code is read anonymously (the visitor is holding the
  // sticker), and paid once they have signed in.
  payCode: (code: string) => get<PayCode>(`/api/tokens/pay?c=${encodeURIComponent(code)}`),
  pay: (body: { code: string; idem_key: string; allow_repeat?: boolean }) =>
    post<PayDone>('/api/tokens/pay', body),

  /** Tick a scan-to-pay charge as handed over, or undo a mis-tap. */
  collect: (tx_id: string, collected: boolean) =>
    post<{ ok: true; collected_at: string | null; collected_by: string | null }>(
      '/api/tokens/collect',
      { tx_id, collected },
    ),

  void: (tx_id: string, reason: string) =>
    post<{ ok: true; amount: number; balance: number | null }>('/api/tokens/void', {
      tx_id,
      reason,
    }),

  myMerchants: () =>
    get<{ merchants: (MerchantRef & { kind: string; status: string })[]; admin: boolean }>(
      '/api/tokens/merchant',
    ),
  merchant: (id: string, offset = 0) =>
    get<MerchantConsole>(`/api/tokens/merchant?merchant_id=${id}&offset=${offset}`),

  admin: {
    overview: () => get<Overview>('/api/admin/tokens?view=overview'),
    member: (id: string) =>
      get<{
        member: {
          id: string;
          full_name: string | null;
          email: string | null;
          tier_id: string | null;
        };
        balance: number;
        grant_target: number;
        rows: LedgerTx[];
      }>(`/api/admin/tokens?view=member&id=${id}`),
    ledger: (params: { kind?: string; merchant_id?: string; offset?: number } = {}) => {
      const qs = new URLSearchParams({ view: 'ledger' });
      if (params.kind) qs.set('kind', params.kind);
      if (params.merchant_id) qs.set('merchant_id', params.merchant_id);
      if (params.offset) qs.set('offset', String(params.offset));
      return get<{ total: number; offset: number; rows: LedgerTx[] }>(`/api/admin/tokens?${qs}`);
    },
    item: (id: string, offset = 0) =>
      get<ItemReport>(`/api/admin/tokens?view=item&id=${id}&offset=${offset}`),
    disputes: () => get<{ total: number; rows: LedgerTx[] }>('/api/admin/tokens?view=disputes'),
    cash: (date: string) =>
      get<{
        date: string;
        rows: {
          actor_id: string | null;
          actor_name: string | null;
          count: number;
          cash_cents: number;
          tokens: number;
        }[];
      }>(`/api/admin/tokens?view=cash&date=${date}`),
    grant: (member_id: string) =>
      post<{ ok: true; granted: number; balance: number }>('/api/admin/tokens', {
        action: 'grant',
        member_id,
      }),
    mint: (member_id: string, amount: number, reason: string) =>
      post<{ ok: true; balance: number }>('/api/admin/tokens', {
        action: 'mint',
        member_id,
        amount,
        reason,
      }),
    cashTopUp: (member_id: string, cash_cents: number) =>
      post<{ ok: true; balance: number }>('/api/admin/tokens', {
        action: 'cash',
        member_id,
        cash_cents,
      }),
    debit: (member_id: string, amount: number, reason: string) =>
      post<{ ok: true; balance: number }>('/api/admin/tokens', {
        action: 'debit',
        member_id,
        amount,
        reason,
      }),
    resolve: (tx_id: string, uphold: boolean, note: string) =>
      post<{ ok: true; upheld: boolean; merchant_suspended?: boolean }>('/api/admin/tokens', {
        action: 'resolve',
        tx_id,
        uphold,
        note,
      }),
    saveSettings: (patch: Partial<TokenSettings>) =>
      post<{ ok: true; settings: TokenSettings }>('/api/admin/tokens', {
        action: 'settings',
        ...patch,
      }),

    merchants: () =>
      get<{ rows: AdminMerchant[]; rate: number; settle_min_cents: number }>(
        '/api/admin/merchants',
      ),
    merchantAction: (body: Record<string, unknown>) =>
      post<{
        ok: true;
        rolled_over?: boolean;
        amount_cents?: number;
        tokens?: number;
        /** the price changed under a sticker that is already printed */
        reprint?: boolean;
      }>('/api/admin/merchants', body),

    admins: () =>
      get<{
        rows: {
          id: string;
          full_name: string | null;
          email: string | null;
          is_admin: boolean;
          is_root: boolean;
        }[];
      }>('/api/admin/roles'),
    setAdmin: (who: { email?: string; member_id?: string }, is_admin: boolean) =>
      post<{ ok: true }>('/api/admin/roles', { ...who, is_admin }),
  },
};

// ---- display helpers shared by the token pages ----

export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const when = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const day = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export const pickName = (m: { name: string; name_zh?: string | null } | null, lang: Lang) =>
  m ? (lang === 'zh' && m.name_zh ? m.name_zh : m.name) : '';

const KIND_LABEL: Record<TxKind, [string, string]> = {
  grant: ['Membership tokens', '会员年度赠币'],
  purchase: ['Bought online', '线上购买'],
  cash: ['Bought with cash', '现金购买'],
  mint: ['Added by CAACI', '华协发放'],
  charge: ['Spent', '消费'],
  void: ['Charge cancelled', '扣币已撤销'],
  reversal: ['Dispute refunded', '申诉退回'],
  transfer_out: ['Sent to family', '转给家人'],
  transfer_in: ['From family', '家人转入'],
  adjust: ['Adjusted by CAACI', '华协调整'],
};
export const kindLabel = (kind: TxKind, lang: Lang) => KIND_LABEL[kind][lang === 'zh' ? 1 : 0];

export const lineText = (items: TxLine[] | null | undefined, lang: Lang) =>
  (items || [])
    .map(
      (i) => `${lang === 'zh' && i.name_zh ? i.name_zh : i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`,
    )
    .join(lang === 'zh' ? '、' : ', ');

/** A key that makes a retried charge land once (token_charge's p_idem). */
export const newIdemKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
