import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, LayoutDashboard, Printer, Search } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { FluidTabs } from '../components/FluidTabs';
import {
  DANGER,
  INPUT,
  LABEL,
  Notice,
  PRIMARY,
  SECONDARY,
  Spinner,
  Status,
  ToolPage,
  tr,
  useSignedIn,
} from '../components/tokens/ui';
import { api } from '../lib/api';
import type { Lang } from '../lib/lang';
import { openPaySheet, PRINT_CELL } from '../lib/payPrint.js';
import {
  day,
  kindLabel,
  lineText,
  pickName,
  refusalText,
  tokens,
  usd,
  when,
  type AdminMerchant,
  type MenuItem,
  type LedgerTx,
  type Overview,
  type TokenSettings,
} from '../lib/tokens';

type Tab = 'overview' | 'merchants' | 'disputes' | 'ledger' | 'cash' | 'settings';
// No cards on this page: blocks are separated by a rule and space alone.
const SECTION = 'space-y-3 pt-6 border-t border-neutral-200/80';

type Say = (tone: 'success' | 'error', text: string) => void;

const central = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Chicago' }); // YYYY-MM-DD

// /token-admin/ — the back office for tokens: the treasurer's totals, merchants
// with their staff, menus and statements, disputes, the ledger, the cash taken
// at a desk, and (root only) the settings and who is an admin. Every button
// calls an endpoint that checks the caller again; this page only asks.
export function TokenAdminPage({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const signedIn = useSignedIn();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [denied, setDenied] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const say: Say = (tone, text) => setMessage({ tone, text });

  const loadOverview = useCallback(async () => {
    const res = await tokens.admin.overview();
    if (res.ok) setOverview(res.data);
    else setDenied(refusalText(res, lang));
  }, [lang]);

  useEffect(() => {
    if (signedIn) void loadOverview();
  }, [signedIn, loadOverview]);

  const eyebrow = t('CAACI Tokens', '华协币');
  const title = t('Token back office', '代币后台');
  const toAdmin = (
    <a className={SECONDARY} href="/admin-next/">
      <LayoutDashboard className="w-4 h-4" aria-hidden />
      {t('Admin', '管理后台')}
    </a>
  );
  if (denied)
    return (
      <ToolPage eyebrow={eyebrow} title={title} wide>
        <Notice tone="error">{denied}</Notice>
      </ToolPage>
    );
  if (!signedIn || !overview)
    return (
      <ToolPage eyebrow={eyebrow} title={title} wide>
        <Spinner label={t('Loading…', '加载中…')} />
      </ToolPage>
    );

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: t('Overview', '总览') },
    { value: 'merchants', label: t('Merchants', '商家') },
    {
      value: 'disputes',
      label: `${t('Disputes', '申诉')}${overview.totals.open_disputes ? ` (${overview.totals.open_disputes})` : ''}`,
    },
    { value: 'ledger', label: t('Ledger', '流水') },
    { value: 'cash', label: t('Cash', '现金') },
    ...(overview.root ? [{ value: 'settings' as Tab, label: t('Settings', '设置') }] : []),
  ];

  return (
    <ToolPage eyebrow={eyebrow} title={title} wide action={toAdmin}>
      <FluidTabs
        id="token-admin-tabs"
        tone="brand"
        value={tab}
        onChange={(v: Tab) => {
          setTab(v);
          setMessage(null);
        }}
        items={tabs}
        className="flex overflow-x-auto no-scrollbar max-w-full"
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {tab === 'overview' && <OverviewTab lang={lang} overview={overview} />}
      {tab === 'merchants' && <MerchantsTab lang={lang} say={say} />}
      {tab === 'disputes' && <DisputesTab lang={lang} say={say} onChange={loadOverview} />}
      {tab === 'ledger' && <LedgerTab lang={lang} />}
      {tab === 'cash' && <CashTab lang={lang} />}
      {tab === 'settings' && overview.root && (
        <SettingsTab lang={lang} settings={overview.settings} say={say} onSaved={loadOverview} />
      )}
    </ToolPage>
  );
}

// ------------------------------------------------------------- overview ----
function OverviewTab({ lang, overview }: { lang: Lang; overview: Overview }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const { totals, settings } = overview;
  const rate = settings.tokens_per_dollar;
  const o = totals.outstanding;
  const paidFor = (o.purchase ?? 0) + (o.cash ?? 0);
  const free = (o.grant ?? 0) + (o.mint ?? 0);
  const cell = (label: string, value: string, sub?: string) => (
    <div>
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className="text-2xl font-bold text-ink tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">{sub}</p>}
    </div>
  );
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
        {cell(
          t('Bought tokens still unspent', '未花完的已购币'),
          usd((paidFor * 100) / rate),
          t(
            `${paidFor} tokens. Money CAACI has taken and still owes. Never expires.`,
            `${paidFor} 币。华协已收款、尚未兑付，不过期。`,
          ),
        )}
        {cell(
          t('Free tokens still unspent', '未花完的赠币'),
          usd((free * 100) / rate),
          t(
            `${free} tokens from yearly grants and admin mints. Expire with the membership year.`,
            `${free} 币，来自年度赠币和管理员发放，随会员年度过期。`,
          ),
        )}
        {cell(
          t('Owed to partner shops now', '当前应付合作商家'),
          usd((totals.owed_to_partners * 100) / rate),
          t(
            `${totals.owed_to_partners} tokens not on a statement yet.`,
            `${totals.owed_to_partners} 币尚未出账。`,
          ),
        )}
        {cell(
          t('Statements waiting for payment', '待付款对账单'),
          usd(totals.statements_due_cents),
          t(`${totals.holders} members hold tokens.`, `${totals.holders} 位会员持有币。`),
        )}
      </div>
      {totals.failed_receipts > 0 && (
        <Notice tone="warn">
          {t(
            `${totals.failed_receipts} charge receipts in the last 30 days could not be emailed. With a static QR the receipt is how a member notices a wrong charge: find them in the ledger (kind: Spent) and check the member’s email address.`,
            `最近 30 天有 ${totals.failed_receipts} 笔扣币回执未能发出。静态码下回执是会员发现盗刷的唯一途径：请在流水中筛选“消费”，核对会员邮箱。`,
          )}
        </Notice>
      )}
      <MemberLookup lang={lang} />
    </div>
  );
}

// Find a member without scanning their card, then open the same /charge/
// screen a scan opens (grant, cash top-up, mint and charge all live there).
function MemberLookup({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<
    { id: string; full_name: string | null; email: string | null; tier_id: string | null }[] | null
  >(null);
  const [error, setError] = useState('');
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    const res = await api<{
      rows: {
        id: string;
        full_name: string | null;
        email: string | null;
        tier_id: string | null;
      }[];
    }>(`/api/admin/members?limit=10&q=${encodeURIComponent(q.trim())}`, undefined, { auth: true });
    if (res.ok) {
      setRows(res.data.rows);
      setError('');
    } else setError(res.data.error || 'Search failed.');
  };
  return (
    <div className={SECTION}>
      <span className="text-xs font-semibold text-brick block">
        {t('Find a member', '查找会员')}
      </span>
      <p className="text-xs text-neutral-500">
        {t(
          'For when a card cannot be scanned. Opens the same screen as a scan: grant, cash top-up, add tokens.',
          '无法扫码时使用。打开的页面与扫码相同：补发、现金充值、发币。',
        )}
      </p>
      <form onSubmit={(e) => void search(e)} className="flex gap-2">
        <input
          className={INPUT}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Name or email', '姓名或邮箱')}
          aria-label={t('Name or email', '姓名或邮箱')}
        />
        <button type="submit" className={SECONDARY}>
          <Search className="w-4 h-4" aria-hidden />
          {t('Search', '搜索')}
        </button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {rows && rows.length === 0 && (
        <p className="text-xs text-neutral-500">{t('No one found.', '未找到。')}</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-neutral-200/80">
          {rows.map((m) => (
            <li key={m.id} className="py-2 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-neutral-900 truncate">
                  {m.full_name || '—'}
                </span>
                <span className="block text-xs text-neutral-500 truncate">
                  {m.email} · {m.tier_id ?? t('no plan', '无等级')}
                </span>
              </span>
              <a className={SECONDARY} href={`${lang === 'zh' ? '/zh' : ''}/charge/?m=${m.id}`}>
                {t('Open', '打开')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------ merchants ----
function MerchantsTab({ lang, say }: { lang: Lang; say: Say }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [rows, setRows] = useState<AdminMerchant[] | null>(null);
  const [openId, setOpenId] = useState('');
  const [name, setName] = useState('');
  const [nameZh, setNameZh] = useState('');
  // tokens per dollar, so a printed sticker can show the money as well
  const [rate, setRate] = useState(10);

  const load = useCallback(async () => {
    const res = await tokens.admin.merchants();
    if (res.ok) {
      setRows(res.data.rows);
      setRate(res.data.rate || 10);
    } else say('error', refusalText(res, lang));
    // `say` is a fresh closure each render; the list only depends on the language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>, ok: string) => {
    const res = await tokens.admin.merchantAction(body);
    if (!res.ok) return say('error', refusalText(res, lang));
    say(
      'success',
      res.data.rolled_over
        ? t(
            `Nothing closed: ${usd(res.data.amount_cents ?? 0)} is under the minimum, so it rolls into the next statement.`,
            `未出账：${usd(res.data.amount_cents ?? 0)} 低于最低结算额，滚入下一期。`,
          )
        : ok,
    );
    await load();
  };

  if (!rows) return <Spinner label={t('Loading…', '加载中…')} />;
  return (
    <div className="space-y-8">
      <div className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
        {rows.map((m) => (
          <div key={m.id} className="py-3">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 text-left min-h-[44px] cursor-pointer"
              onClick={() => setOpenId(openId === m.id ? '' : m.id)}
              aria-expanded={openId === m.id}
            >
              <span className="min-w-0">
                <span className="block text-base font-semibold text-neutral-900 truncate">
                  {m.name}
                  {m.name_zh ? ` · ${m.name_zh}` : ''}
                </span>
                <span className="block text-xs text-neutral-500">
                  {m.kind === 'internal'
                    ? t('CAACI’s own (never paid out)', '华协内部（不结算）')
                    : t('Partner shop', '合作商家')}{' '}
                  · {m.staff.length} {t('staff', '店员')} · {m.items.length}{' '}
                  {t('menu items', '菜单项')}
                </span>
              </span>
              <span className="text-right shrink-0">
                {m.kind === 'partner' && (
                  <span className="block text-sm font-bold tabular-nums">{usd(m.open_cents)}</span>
                )}
                {m.status === 'active' ? (
                  <Status tone="good">{t('Active', '正常')}</Status>
                ) : (
                  <Status tone="bad">{t('Suspended', '已暂停')}</Status>
                )}
              </span>
            </button>
            {openId === m.id && <MerchantDetail lang={lang} m={m} rate={rate} act={act} />}
          </div>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            { action: 'save_merchant', name, name_zh: nameZh, kind: 'partner' },
            t('Merchant created.', '商家已创建。'),
          ).then(() => {
            setName('');
            setNameZh('');
          });
        }}
      >
        <span className="text-xs font-semibold text-brick block">
          {t('Add a partner shop', '新增合作商家')}
        </span>
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            className={INPUT}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Name (English)', '英文名')}
            aria-label={t('Name (English)', '英文名')}
          />
          <input
            className={INPUT}
            value={nameZh}
            onChange={(e) => setNameZh(e.target.value)}
            placeholder={t('Name (Chinese)', '中文名')}
            aria-label={t('Name (Chinese)', '中文名')}
          />
        </div>
        <button type="submit" className={PRIMARY}>
          {t('Create', '创建')}
        </button>
      </form>
    </div>
  );
}

function MerchantDetail({
  lang,
  m,
  rate,
  act,
}: {
  lang: Lang;
  m: AdminMerchant;
  rate: number;
  act: (body: Record<string, unknown>, ok: string) => Promise<void>;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [email, setEmail] = useState('');
  const [item, setItem] = useState({ name: '', name_zh: '', tokens: '', group_label: '' });
  const [payout, setPayout] = useState(m.payout_note ?? '');
  const [refs, setRefs] = useState<Record<string, string>>({});
  // the menu item whose printed QR is open, '' = none
  const [qrFor, setQrFor] = useState('');

  return (
    <div className="mt-3 mb-3 space-y-6">
      {m.status === 'suspended' && (
        <Notice tone="warn">
          {t('Suspended', '已暂停')}: {m.suspended_reason}
        </Notice>
      )}

      {/* staff */}
      <section className="space-y-2">
        <p className={LABEL}>{t('Staff who can take tokens', '可扣币的店员')}</p>
        {m.kind === 'internal' && (
          <p className="text-xs text-neutral-500">
            {t(
              'Every CAACI admin can already charge here. Add volunteers below.',
              '所有华协管理员自动可在此扣币。志愿者请在下方添加。',
            )}
          </p>
        )}
        <ul className="divide-y divide-neutral-200/80">
          {m.staff.map((s) => (
            <li key={s.member_id} className="py-2 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-neutral-900">{s.name || '—'}</span> · {s.email}{' '}
                · {s.role}
              </span>
              <button
                type="button"
                className="min-h-[44px] text-rose-700 font-semibold cursor-pointer"
                onClick={() =>
                  void act(
                    { action: 'remove_staff', merchant_id: m.id, member_id: s.member_id },
                    t('Removed.', '已移除。'),
                  )
                }
              >
                {t('Remove', '移除')}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              { action: 'add_staff', merchant_id: m.id, email },
              t('Added.', '已添加。'),
            ).then(() => setEmail(''));
          }}
        >
          <input
            className={INPUT}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('Email of their CAACI account', '对方华协账号的邮箱')}
            aria-label={t('Email of their CAACI account', '对方华协账号的邮箱')}
          />
          <button type="submit" className={SECONDARY}>
            {t('Add', '添加')}
          </button>
        </form>
        <p className="text-[11px] text-neutral-500">
          {t('They must sign up on the site first.', '对方需先在网站注册账号。')}
        </p>
      </section>

      {/* menu */}
      <section className="space-y-2">
        <p className={LABEL}>{t('Menu', '菜单')}</p>
        <ul className="divide-y divide-neutral-200/80">
          {m.items.map((i) => (
            <li key={i.id} className="py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {i.group_label && <span className="text-neutral-500">[{i.group_label}] </span>}
                  <span className="font-semibold text-neutral-900">{i.name}</span>
                  {i.name_zh ? ` · ${i.name_zh}` : ''} — {i.tokens} {t('tokens', '币')}
                  {i.pay_code && (
                    <span className="ml-2 text-neutral-500 tabular-nums">QR {i.pay_code}</span>
                  )}
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    className="min-h-[44px] font-semibold text-brick cursor-pointer"
                    onClick={() => setQrFor(qrFor === i.id ? '' : i.id)}
                  >
                    {i.pay_code ? t('QR code', '二维码') : t('Make a QR', '生成二维码')}
                  </button>
                  <button
                    type="button"
                    className="min-h-[44px] text-rose-700 font-semibold cursor-pointer"
                    onClick={() =>
                      void act({ action: 'delete_item', id: i.id }, t('Deleted.', '已删除。'))
                    }
                  >
                    {t('Delete', '删除')}
                  </button>
                </div>
              </div>
              {qrFor === i.id && <PayCode lang={lang} m={m} item={i} rate={rate} act={act} />}
            </li>
          ))}
        </ul>
        <form
          className="grid grid-cols-2 sm:grid-cols-5 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              {
                action: 'save_item',
                merchant_id: m.id,
                ...item,
                tokens: Number(item.tokens),
                sort_order: m.items.length,
              },
              t('Item added.', '已添加。'),
            ).then(() =>
              setItem({ name: '', name_zh: '', tokens: '', group_label: item.group_label }),
            );
          }}
        >
          <input
            className={INPUT}
            required
            value={item.name}
            onChange={(e) => setItem({ ...item, name: e.target.value })}
            placeholder={t('Item', '品名（英）')}
            aria-label={t('Item', '品名（英）')}
          />
          <input
            className={INPUT}
            value={item.name_zh}
            onChange={(e) => setItem({ ...item, name_zh: e.target.value })}
            placeholder={t('Chinese name', '品名（中）')}
            aria-label={t('Chinese name', '品名（中）')}
          />
          <input
            className={INPUT}
            required
            inputMode="numeric"
            value={item.tokens}
            onChange={(e) => setItem({ ...item, tokens: e.target.value.replace(/\D/g, '') })}
            placeholder={t('Tokens', '币数')}
            aria-label={t('Tokens', '币数')}
          />
          <input
            className={INPUT}
            value={item.group_label}
            onChange={(e) => setItem({ ...item, group_label: e.target.value })}
            placeholder={t('Stall (optional)', '摊位（可选）')}
            aria-label={t('Stall (optional)', '摊位（可选）')}
          />
          <button type="submit" className={SECONDARY}>
            {t('Add item', '添加')}
          </button>
        </form>
      </section>

      {/* money */}
      {m.kind === 'partner' && (
        <section className="space-y-3">
          <p className={LABEL}>{t('Statements', '对账与付款')}</p>
          <p className="text-xs text-neutral-600">
            {t(
              `Open now: ${m.open_tokens} tokens = ${usd(m.open_cents)}.`,
              `当前未出账：${m.open_tokens} 币 = ${usd(m.open_cents)}。`,
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={SECONDARY}
              onClick={() => {
                // everything before the first instant of this month, Central time
                const [y, mo] = central().split('-').map(Number);
                const probe = new Date(Date.UTC(y, mo - 1, 1, 6));
                const offset = probe
                  .toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
                  .endsWith('00:00:00')
                  ? 6
                  : 5;
                const before = new Date(Date.UTC(y, mo - 1, 1, offset));
                void act(
                  { action: 'close_statement', merchant_id: m.id, before: before.toISOString() },
                  t('Statement closed.', '对账单已生成。'),
                );
              }}
            >
              {t('Close last month', '生成上月对账单')}
            </button>
            <button
              type="button"
              className={SECONDARY}
              onClick={() =>
                void act(
                  {
                    action: 'close_statement',
                    merchant_id: m.id,
                    before: new Date(Date.now() - 1000).toISOString(),
                  },
                  t('Statement closed.', '对账单已生成。'),
                )
              }
            >
              {t('Close up to now', '生成截至现在的对账单')}
            </button>
          </div>
          <ul className="divide-y divide-neutral-200/80">
            {m.settlements.map((s) => (
              <li key={s.id} className="py-2 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {t('to', '截至')} {day(s.period_end, lang)} · {s.tokens} {t('tokens', '币')} ·{' '}
                    <span className="font-semibold">{usd(s.amount_cents)}</span>
                  </span>
                  {s.status === 'paid' ? (
                    <Status tone="good">
                      {t('Paid', '已付')} · {s.reference}
                    </Status>
                  ) : (
                    <Status tone="warn">{t('Due', '待付')}</Status>
                  )}
                </div>
                {s.status === 'due' && (
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      value={refs[s.id] ?? ''}
                      onChange={(e) => setRefs({ ...refs, [s.id]: e.target.value })}
                      placeholder={t('Cheque no. / Zelle reference', '支票号 / Zelle 备注')}
                      aria-label={t('Payment reference', '付款凭证')}
                    />
                    <button
                      type="button"
                      className={SECONDARY}
                      disabled={!(refs[s.id] ?? '').trim()}
                      onClick={() =>
                        void act(
                          { action: 'mark_paid', settlement_id: s.id, reference: refs[s.id] },
                          t('Marked paid.', '已标记付款。'),
                        )
                      }
                    >
                      {t('Mark paid', '标记已付')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              className={INPUT}
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder={t(
                'How CAACI pays them (Zelle, cheque payee…)',
                '付款方式（Zelle、支票抬头…）',
              )}
              aria-label={t('Payout note', '付款方式')}
            />
            <button
              type="button"
              className={SECONDARY}
              onClick={() =>
                void act(
                  {
                    action: 'save_merchant',
                    id: m.id,
                    name: m.name,
                    name_zh: m.name_zh,
                    contact_name: m.contact_name,
                    contact_email: m.contact_email,
                    payout_note: payout,
                  },
                  t('Saved.', '已保存。'),
                )
              }
            >
              {t('Save', '保存')}
            </button>
          </div>
        </section>
      )}

      <section>
        {m.status === 'active' ? (
          <button
            type="button"
            className={DANGER}
            onClick={() =>
              void act(
                {
                  action: 'set_status',
                  merchant_id: m.id,
                  status: 'suspended',
                  reason: 'Suspended by an admin',
                },
                t('Suspended.', '已暂停。'),
              )
            }
          >
            {t('Suspend this merchant', '暂停该商家')}
          </button>
        ) : (
          <button
            type="button"
            className={SECONDARY}
            onClick={() =>
              void act(
                { action: 'set_status', merchant_id: m.id, status: 'active' },
                t('Re-activated.', '已恢复。'),
              )
            }
          >
            {t('Re-activate', '恢复')}
          </button>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- disputes ----
function DisputesTab({
  lang,
  say,
  onChange,
}: {
  lang: Lang;
  say: Say;
  onChange: () => Promise<void>;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [rows, setRows] = useState<LedgerTx[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const res = await tokens.admin.disputes();
    if (res.ok) setRows(res.data.rows);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (tx: LedgerTx, uphold: boolean) => {
    const res = await tokens.admin.resolve(tx.id, uphold, notes[tx.id] ?? '');
    if (!res.ok) return say('error', refusalText(res, lang));
    say(
      'success',
      uphold
        ? res.data.merchant_suspended
          ? t(
              'Upheld: tokens returned. That merchant is now suspended (too many upheld disputes this month).',
              '申诉成立，币已退回。该商家本月成立申诉过多，已自动暂停。',
            )
          : t(
              'Upheld: the tokens are back with the member and come off the merchant’s next statement.',
              '申诉成立：币已退回会员，并从商家下期对账中扣除。',
            )
        : t('Rejected: the charge stands.', '已驳回：扣币有效。'),
    );
    await Promise.all([load(), onChange()]);
  };

  if (!rows) return <Spinner label={t('Loading…', '加载中…')} />;
  if (rows.length === 0)
    return (
      <p className="text-sm text-neutral-500">{t('No open disputes.', '没有待处理的申诉。')}</p>
    );
  return (
    <div className="divide-y divide-neutral-200/80 border-y border-neutral-200/80">
      {rows.map((tx) => (
        <div key={tx.id} className="py-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-900">
                {tx.member_name || '—'}{' '}
                <span className="font-normal text-neutral-500">· {tx.member_email}</span>
              </p>
              <p className="text-xs text-neutral-600">
                {pickName(tx.merchant, lang)} · {when(tx.created_at, lang)} · {t('by', '操作人')}{' '}
                {tx.actor_name || '—'}
              </p>
              <p className="text-xs text-neutral-600">{lineText(tx.items, lang) || tx.note}</p>
            </div>
            <p className="text-lg font-bold tabular-nums shrink-0">{-tx.amount}</p>
          </div>
          {tx.dispute_note && (
            <p className="text-xs text-neutral-700 border-l-2 border-neutral-300 pl-3">
              “{tx.dispute_note}”
            </p>
          )}
          <input
            className={INPUT}
            value={notes[tx.id] ?? ''}
            onChange={(e) => setNotes({ ...notes, [tx.id]: e.target.value })}
            placeholder={t('What you found out (kept on the record)', '核实结果（存档）')}
            aria-label={t('Resolution note', '核实结果')}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={DANGER} onClick={() => void resolve(tx, true)}>
              {t('Uphold — return the tokens', '申诉成立，退币')}
            </button>
            <button type="button" className={SECONDARY} onClick={() => void resolve(tx, false)}>
              {t('Reject — the charge stands', '驳回，扣币有效')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- ledger ----
const KINDS = [
  '',
  'charge',
  'grant',
  'purchase',
  'cash',
  'mint',
  'adjust',
  'void',
  'reversal',
  'transfer_out',
] as const;

// A merchant's rows: its charges, and the voids and dispute reversals against them.
const MERCHANT_KINDS = ['', 'charge', 'void', 'reversal'] as const;

function LedgerTab({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [kind, setKind] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; rows: LedgerTx[] } | null>(null);

  useEffect(() => {
    void tokens.admin.merchants().then((res) => res.ok && setMerchants(res.data.rows));
  }, []);

  useEffect(() => {
    // a slow answer for an earlier filter must not overwrite the current one
    let current = true;
    setData(null);
    void tokens.admin
      .ledger({ kind, merchant_id: merchantId, offset })
      .then((res) => current && res.ok && setData(res.data));
    return () => {
      current = false;
    };
  }, [kind, merchantId, offset]);

  // With a merchant picked, only the kinds a merchant can have are offered.
  const kinds: readonly (typeof KINDS)[number][] = merchantId ? MERCHANT_KINDS : KINDS;

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
        <div>
          <label className={LABEL} htmlFor="ledger-merchant">
            {t('Merchant', '商家')}
          </label>
          <select
            id="ledger-merchant"
            className={INPUT}
            value={merchantId}
            onChange={(e) => {
              const next = e.target.value;
              setMerchantId(next);
              if (next && !(MERCHANT_KINDS as readonly string[]).includes(kind)) setKind('');
              setOffset(0);
            }}
          >
            <option value="">{t('All merchants', '全部商家')}</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {pickName(m, lang)}
                {m.status === 'suspended' ? ` (${t('suspended', '已暂停')})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="ledger-kind">
            {t('Kind', '类型')}
          </label>
          <select
            id="ledger-kind"
            className={INPUT}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setOffset(0);
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k ? kindLabel(k, lang) : t('Everything', '全部')}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!data ? (
        <Spinner label={t('Loading…', '加载中…')} />
      ) : data.rows.length === 0 ? (
        <p className="text-xs text-neutral-500 py-6">
          {t('No records for this filter.', '该筛选条件下没有记录。')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-neutral-200/80">
            {data.rows.map((tx) => (
              <li key={tx.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900 truncate">
                    {tx.member_name || tx.member_email || '—'}
                    <span className="ml-2 font-normal text-neutral-500">
                      {when(tx.created_at, lang)}
                    </span>
                  </p>
                  <p className="text-neutral-600 truncate">
                    {kindLabel(tx.kind, lang)}
                    {tx.merchant ? ` · ${pickName(tx.merchant, lang)}` : ''}
                    {tx.cash_cents ? ` · ${usd(tx.cash_cents)}` : ''}
                    {lineText(tx.items, lang) ? ` · ${lineText(tx.items, lang)}` : ''}
                    {tx.reason ? ` · ${tx.reason}` : ''}
                    {tx.note ? ` · ${tx.note}` : ''}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {tx.actor_name
                      ? `${t('by', '操作人')} ${tx.actor_name}`
                      : t('automatic', '系统自动')}
                    {tx.kind === 'charge' && tx.receipt_error
                      ? ` · ${t('receipt failed', '回执失败')}: ${tx.receipt_error}`
                      : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-bold tabular-nums ${tx.amount > 0 ? 'text-emerald-700' : 'text-neutral-900'}`}
                  >
                    {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                  </p>
                  {tx.state !== 'ok' && (
                    <Status tone={tx.state === 'disputed' ? 'warn' : 'muted'}>
                      {tx.state === 'disputed'
                        ? t('Disputed', '争议中')
                        : tx.state === 'voided'
                          ? t('Voided', '已撤销')
                          : t('Reversed', '已冲回')}
                    </Status>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              className={SECONDARY}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {t('Newer', '较新')}
            </button>
            <span className="text-[11px] text-neutral-500">
              {data.total
                ? `${offset + 1}–${Math.min(offset + 50, data.total)} / ${data.total}`
                : '0'}
            </span>
            <button
              type="button"
              className={SECONDARY}
              disabled={offset + 50 >= data.total}
              onClick={() => setOffset(offset + 50)}
            >
              {t('Older', '较早')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- cash ----
function CashTab({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [date, setDate] = useState(central);
  const [rows, setRows] = useState<
    { actor_name: string | null; count: number; cash_cents: number; tokens: number }[] | null
  >(null);
  useEffect(() => {
    setRows(null);
    void tokens.admin.cash(date).then((res) => setRows(res.ok ? res.data.rows : []));
  }, [date]);
  const total = (rows ?? []).reduce((sum, r) => sum + r.cash_cents, 0);
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label className={LABEL} htmlFor="cash-date">
          {t('Day (Central time)', '日期（中部时间）')}
        </label>
        <input
          id="cash-date"
          type="date"
          className={INPUT}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {!rows ? (
        <Spinner label={t('Loading…', '加载中…')} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t('No cash was taken that day.', '当天没有现金充值。')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-neutral-200/80">
            {rows.map((r, i) => (
              <li key={i} className="py-2 flex items-center justify-between text-sm">
                <span>
                  {r.actor_name || '—'}
                  <span className="ml-2 text-xs text-neutral-500">
                    {r.count} {t('top-ups', '笔')} · {r.tokens} {t('tokens', '币')}
                  </span>
                </span>
                <span className="font-bold tabular-nums">{usd(r.cash_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-neutral-900 flex justify-between border-t border-neutral-200/80 pt-3">
            <span>{t('The cash box should hold', '钱箱应有现金')}</span>
            <span className="tabular-nums">{usd(total)}</span>
          </p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- settings ----
function SettingsTab({
  lang,
  settings,
  say,
  onSaved,
}: {
  lang: Lang;
  settings: TokenSettings;
  say: Say;
  onSaved: () => Promise<void>;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [grants, setGrants] = useState(() => JSON.stringify(settings.grants));
  const [packs, setPacks] = useState(() => settings.packs_cents.map((c) => c / 100).join(', '));
  const [n, setN] = useState({
    max_charge: String(settings.max_charge),
    admin_mint_cap: String(settings.admin_mint_cap),
    admin_daily_cap: String(settings.admin_daily_cap),
    cash_min_cents: String(settings.cash_min_cents),
    void_hours: String(settings.void_hours),
    settle_min_cents: String(settings.settle_min_cents),
    suspend_after: String(settings.suspend_after),
    pay_repeat_seconds: String(settings.pay_repeat_seconds ?? 120),
  });
  const [payPartners, setPayPartners] = useState(settings.pay_allow_partners === true);
  const [admins, setAdmins] = useState<
    { id: string; full_name: string | null; email: string | null; is_root: boolean }[]
  >([]);
  const [email, setEmail] = useState('');

  const loadAdmins = useCallback(async () => {
    const res = await tokens.admin.admins();
    if (res.ok) setAdmins(res.data.rows);
  }, []);
  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    let parsed: Record<string, number>;
    try {
      parsed = JSON.parse(grants);
    } catch {
      return say(
        'error',
        t(
          'Yearly tokens must be JSON like {"student":150}.',
          '年度赠币需为 JSON，例如 {"student":150}。',
        ),
      );
    }
    const res = await tokens.admin.saveSettings({
      grants: parsed,
      packs_cents: packs
        .split(',')
        .map((s) => Math.round(Number(s.trim()) * 100))
        .filter((c) => c > 0),
      ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number(v)])),
      pay_allow_partners: payPartners,
    });
    if (!res.ok) return say('error', refusalText(res, lang));
    say('success', t('Settings saved.', '设置已保存。'));
    await onSaved();
  };

  const setAdmin = async (who: { email?: string; member_id?: string }, is_admin: boolean) => {
    const res = await tokens.admin.setAdmin(who, is_admin);
    if (!res.ok) return say('error', refusalText(res, lang));
    say(
      'success',
      is_admin ? t('Admin appointed.', '已任命管理员。') : t('Admin removed.', '已取消管理员。'),
    );
    setEmail('');
    await loadAdmins();
  };

  const field = (key: keyof typeof n, label: string) => (
    <div>
      <label className={LABEL} htmlFor={`set-${key}`}>
        {label}
      </label>
      <input
        id={`set-${key}`}
        className={INPUT}
        inputMode="numeric"
        value={n[key]}
        onChange={(e) => setN({ ...n, [key]: e.target.value.replace(/\D/g, '') })}
      />
    </div>
  );

  return (
    <div className="space-y-8">
      <form className="space-y-4" onSubmit={(e) => void save(e)}>
        <span className="text-xs font-semibold text-brick block">
          {t('Root only: global settings', '仅 root：全局参数')}
        </span>
        <div>
          <label className={LABEL} htmlFor="set-grants">
            {t('Yearly tokens per plan (JSON, by tier id)', '各等级年度赠币（JSON，按等级 id）')}
          </label>
          <input
            id="set-grants"
            className={`${INPUT} font-mono`}
            value={grants}
            onChange={(e) => setGrants(e.target.value)}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="set-packs">
            {t(
              'Online packs in dollars, comma-separated (minimum 10)',
              '线上购买档位（美元，逗号分隔，最低 10）',
            )}
          </label>
          <input
            id="set-packs"
            className={INPUT}
            value={packs}
            onChange={(e) => setPacks(e.target.value)}
          />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {field('max_charge', t('Most tokens in one charge', '单笔扣币上限'))}
          {field('admin_mint_cap', t('Admin: most tokens per action', '管理员单次上限'))}
          {field('admin_daily_cap', t('Admin: free mints per day', '管理员每日发币上限'))}
          {field('cash_min_cents', t('Smallest cash top-up (cents)', '现金充值最低额（美分）'))}
          {field('void_hours', t('Hours a shop can void', '商家可撤销时限（小时）'))}
          {field('settle_min_cents', t('Smallest statement (cents)', '最低结算额（美分）'))}
          {field('suspend_after', t('Upheld disputes before suspension', '成立申诉几笔后暂停'))}
          {field(
            'pay_repeat_seconds',
            t('Scan-to-pay: ask again within (seconds)', '扫码付款：多少秒内重复需再确认'),
          )}
        </div>
        <label className="flex items-start gap-3 text-xs text-neutral-700 leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-brick cursor-pointer"
            checked={payPartners}
            onChange={(e) => setPayPartners(e.target.checked)}
          />
          <span>
            {t(
              'Let partner shops take scan-to-pay. Off, only CAACI’s own stalls can — which is what the tokens’ compliance position rests on. Turn this on only after that review.',
              '允许合作商家收扫码付款。关闭时只有华协自营摊位可以——华协币的合规依据正建立在这一点上。请在重新评估后再开启。',
            )}
          </span>
        </label>
        <button type="submit" className={PRIMARY}>
          {t('Save settings', '保存设置')}
        </button>
      </form>

      <div className={SECTION}>
        <span className="text-xs font-semibold text-brick block">
          {t('Root only: who is an admin', '仅 root：管理员名单')}
        </span>
        <ul className="divide-y divide-neutral-200/80">
          {admins.map((a) => (
            <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-neutral-900">{a.full_name || '—'}</span> ·{' '}
                {a.email}
                {a.is_root ? ' · root' : ''}
              </span>
              {!a.is_root && (
                <button
                  type="button"
                  className="min-h-[44px] text-rose-700 font-semibold cursor-pointer"
                  onClick={() => void setAdmin({ member_id: a.id }, false)}
                >
                  {t('Remove', '取消')}
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void setAdmin({ email }, true);
          }}
        >
          <input
            className={INPUT}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('Email of their CAACI account', '对方华协账号的邮箱')}
            aria-label={t('Email of their CAACI account', '对方华协账号的邮箱')}
          />
          <button type="submit" className={SECONDARY}>
            {t('Make admin', '设为管理员')}
          </button>
        </form>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          {t(
            'An admin can add up to the caps above without asking anyone. Root is set in the Supabase SQL editor only.',
            '管理员可在上述上限内直接发币。root 只能在 Supabase SQL 编辑器中设置。',
          )}
        </p>
      </div>
    </div>
  );
}

// The printed sticker for one menu item (0030). The code is the sticker: a new
// one kills every sheet already printed, which is the answer to a QR that was
// swapped, copied or photographed. The price is NOT in the code — it is read
// from this item when someone pays — so editing the price below changes what
// every sticker already on a cup charges, and the sheets have to be reprinted.
function PayCode({
  lang,
  m,
  item,
  rate,
  act,
}: {
  lang: Lang;
  m: AdminMerchant;
  item: MenuItem;
  rate: number;
  act: (body: Record<string, unknown>, ok: string) => Promise<void>;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [blocked, setBlocked] = useState(false);
  const url = item.pay_code ? `${window.location.origin}/pay/?c=${item.pay_code}` : '';
  const png = useMemo(() => {
    if (!url) return '';
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createDataURL(8, 16);
  }, [url]);

  const issue = (ok: string) =>
    void act({ action: 'issue_code', merchant_id: m.id, id: item.id }, ok);

  // Redrawn at the sheet's own cell size: the 8px cells on screen would print
  // at about 90dpi, which a phone camera reads badly on a curved cup.
  const print = (size: 'small' | 'large') => {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const cell = PRINT_CELL[size];
    setBlocked(
      !openPaySheet(
        {
          name: item.name,
          name_zh: item.name_zh,
          tokens: item.tokens,
          code: item.pay_code || '',
          url,
          rate,
        },
        size,
        lang,
        qr.createDataURL(cell, cell * 2),
      ),
    );
  };

  if (!item.pay_code)
    return (
      <div className="mt-2 mb-1 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 space-y-2">
        <p className="text-neutral-600 leading-relaxed">
          {t(
            `A QR on the product that charges ${item.tokens} tokens when a member scans it. Nobody needs a till.`,
            `给这件商品生成一张二维码，会员扫码即可支付 ${item.tokens} 币，摊位不需要任何设备。`,
          )}
        </p>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => issue(t('QR code created.', '二维码已生成。'))}
        >
          {t('Make a QR code', '生成二维码')}
        </button>
        {m.kind !== 'internal' && (
          <p className="text-[11px] text-amber-800">
            {t(
              'Partner shops can only take scan-to-pay once root turns it on in Settings.',
              '合作商家需由 root 在设置中开启后才能收扫码付款。',
            )}
          </p>
        )}
      </div>
    );

  return (
    <div className="mt-2 mb-1 p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 flex flex-col sm:flex-row gap-4">
      {png && (
        <img
          src={png}
          alt={t(`Pay QR code for ${item.name}`, `${item.name} 付款二维码`)}
          className="w-36 h-36 rounded-xl border border-neutral-200 bg-white shrink-0"
        />
      )}
      <div className="min-w-0 space-y-2">
        <p className="font-bold text-ink break-words">
          {item.name}
          {item.name_zh ? ` · ${item.name_zh}` : ''} — {item.tokens} {t('tokens', '币')}
        </p>
        <p className="text-neutral-600">
          <code className="break-all text-ink">{url}</code>
        </p>
        {item.pay_code_at && (
          <p className="text-[11px] text-neutral-500">
            {t('Issued', '生成于')} {day(item.pay_code_at, lang)} ·{' '}
            {t('reprint the sheet whenever you change the price above.', '上方改价后请重新打印。')}
          </p>
        )}
        {blocked && (
          <Notice tone="warn">
            {t(
              'Your browser blocked the print window. Allow pop-ups for this site and try again.',
              '浏览器拦截了打印窗口，请允许本站弹出窗口后重试。',
            )}
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} onClick={() => print('small')}>
            <Printer className="w-4 h-4" aria-hidden />
            {t('Print 12 stickers', '打印贴纸（12 枚一页）')}
          </button>
          <button type="button" className={SECONDARY} onClick={() => print('large')}>
            <Printer className="w-4 h-4" aria-hidden />
            {t('Print 4 signs', '打印立牌（4 枚一页）')}
          </button>
          {png && (
            <a
              className={SECONDARY}
              download={`caaci-pay-${item.pay_code}.gif`}
              href={png}
              aria-label={t('Download the QR image', '下载二维码图片')}
            >
              <Download className="w-4 h-4" aria-hidden />
              {t('Image only', '仅下载图片')}
            </a>
          )}
          <button
            type="button"
            className={SECONDARY}
            onClick={() =>
              issue(t('New code. Reprint the stickers.', '已换新码，请重新打印贴纸。'))
            }
          >
            {t('New code', '换新码')}
          </button>
          <button
            type="button"
            className={DANGER}
            onClick={() =>
              void act(
                { action: 'clear_code', merchant_id: m.id, id: item.id },
                t('Scan-to-pay is off for this item.', '该商品扫码付款已停用。'),
              )
            }
          >
            {t('Stop scan-to-pay', '停用扫码付款')}
          </button>
        </div>
      </div>
    </div>
  );
}
