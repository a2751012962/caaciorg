import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { Lang } from '../../../lib/lang';
import { hoverLift, listItem, riseFromSm, shown, tap } from '../../../lib/motion';
import {
  DataTable,
  Empty,
  EYEBROW,
  MEMBER_STATUSES,
  Notice,
  SECONDARY,
  SECTION,
  SELECT,
  Spinner,
  Status,
  TabHeader,
  fmtDate,
  fmtDateTime,
  memberStatusLabel,
  memberStatusTone,
  usd,
  useAdmin,
  useLoad,
  type Column,
  type TabId,
} from '../kit';
import { ScrubChart } from '../../../components/bencho/ScrubChart';
import { PieChart } from './dashboard/charts';
import { MemberCell, useKindLabel, type Payment } from './payments/ledger';

interface EventRef {
  title: string | null;
  title_zh: string | null;
  slug?: string | null;
  starts_at?: string | null;
}
interface UpcomingEvent extends EventRef {
  id: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  takes_registrations: boolean;
  registration_count: number;
}
interface ExpiringMember {
  id: string;
  full_name: string | null;
  email: string | null;
  tier_id: string | null;
  status: string;
  expires_at: string | null;
}
interface Registration {
  id: string;
  email: string | null;
  created_at: string;
  events: EventRef | null;
}
interface Dashboard {
  generated_at: string;
  members: {
    total: number;
    status_counts: Record<string, number>;
    new_this_month: number;
    by_tier: { id: string; name: string | null; active: number }[];
    year: number;
    by_month: { month: string; active: number }[];
    expiring_days: number;
    expiring_total: number;
    expiring: ExpiringMember[];
  };
  revenue: {
    ytd_cents: number;
    month_cents: number;
    payments_this_month: number;
    year: number;
    years: number[];
    year_cents: number;
    year_payments: number;
    by_month: { month: string; cents: number; payments: number }[];
    recent: Payment[];
  };
  events: {
    upcoming_total: number;
    upcoming: UpcomingEvent[];
    drafts_total: number;
    recent_registrations: Registration[];
  };
  volunteers: { total: number; this_month: number };
  business: { pending: number };
}

const numFmt = (n: number | null | undefined) => (n == null ? '—' : String(n));
// 'YYYY-MM' → 'Sep' / '9月'.
const monthLabel = (lang: Lang, ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
};
const eventTitle = (lang: Lang, e: EventRef | null | undefined) =>
  (lang === 'zh' && e?.title_zh ? e.title_zh : e?.title) || '—';
const fmtWhen = (lang: Lang, e: UpcomingEvent) => {
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const txt = new Date(e.starts_at).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return e.ends_at
    ? `${txt} – ${new Date(e.ends_at).toLocaleTimeString(locale, { timeStyle: 'short' })}`
    : txt;
};
const BAR: Record<string, string> = {
  active: 'bg-emerald-500',
  pending: 'bg-amber-400',
  past_due: 'bg-orange-500',
  expired: 'bg-neutral-400',
  cancelled: 'bg-rose-500',
};

// The landing tab. One GET /api/admin/dashboard feeds every tile, chart and
// table; ?year= switches the year the two lines show. Each stat tile opens the
// tab that holds the detail. functions/api/admin/dashboard.js.
export default function DashboardTab() {
  const { lang, t, api, go, tierName } = useAdmin();
  const kindLabel = useKindLabel();
  // The year the lines show (null = the current one); Refresh keeps it.
  const [year, setYear] = useState<number | null>(null);
  const dash = useLoad(async () => {
    const res = await api<Dashboard>(
      `/api/admin/dashboard${year ? `?year=${encodeURIComponent(year)}` : ''}`,
    );
    if (!res.ok && res.status !== 403 && !res.data.error)
      res.data.error = t('Could not load the dashboard.', '无法加载看板。');
    return res;
  }, [year]);
  const d = dash.data;

  const header = (
    <TabHeader
      title={t('Dashboard', '看板')}
      description={
        d?.generated_at
          ? t(
              `Updated ${fmtDateTime(lang, d.generated_at)}`,
              `更新于 ${fmtDateTime(lang, d.generated_at)}`,
            )
          : undefined
      }
      actions={
        <>
          {d && (d.revenue.years?.length ?? 0) >= 2 && (
            <select
              className={SELECT.replace('w-full', 'w-32')}
              aria-label={t('Year', '年份')}
              value={d.revenue.year}
              disabled={dash.loading}
              onChange={(e) => setYear(Number(e.target.value) || null)}
            >
              {d.revenue.years.map((y) => (
                <option key={y} value={y}>
                  {lang === 'zh' ? `${y} 年` : y}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className={SECONDARY}
            disabled={dash.loading}
            onClick={() => void dash.reload()}
          >
            <RefreshCw className={`w-4 h-4 ${dash.loading ? 'animate-spin' : ''}`} aria-hidden />
            {t('Refresh', '刷新')}
          </button>
        </>
      }
    />
  );

  if (!d)
    return (
      <div className="space-y-5">
        <div>
          <span className={EYEBROW}>{t('Overview', '总览')}</span>
          {header}
        </div>
        {dash.error ? (
          <Notice tone="error">{dash.error}</Notice>
        ) : (
          <Spinner label={t('Loading…', '加载中…')} />
        )}
      </div>
    );

  const m = d.members;
  const sc = m.status_counts || {};
  const rev = d.revenue;
  const ev = d.events;
  const days = m.expiring_days || 30;
  const total = m.total || 0;

  // Three colours only: ink, green for the active count, and one attention
  // colour for the queues that need a follow-up.
  const tiles: { label: string; value: number; sub?: string; tone?: string; goto: TabId }[] = [
    {
      label: t('Active members', '有效会员'),
      value: sc.active,
      tone: 'text-emerald-700',
      sub: t(`${total} members in total`, `会员共 ${total} 人`),
      goto: 'members',
    },
    {
      label: t('Past due — follow up', '逾期需补交'),
      value: sc.past_due,
      tone: sc.past_due ? 'text-amber-700' : undefined,
      goto: 'payments',
    },
    {
      label: t(`Expiring in ${days} days`, `${days} 天内到期`),
      value: m.expiring_total,
      tone: m.expiring_total ? 'text-amber-700' : undefined,
      goto: 'members',
    },
    {
      label: t('New members this month', '本月新增会员'),
      value: m.new_this_month,
      goto: 'members',
    },
    {
      label: t('Volunteer sign-ups', '志愿者报名'),
      value: d.volunteers.total,
      sub: t(
        `${d.volunteers.this_month ?? 0} this month`,
        `本月新增 ${d.volunteers.this_month ?? 0}`,
      ),
      goto: 'volunteers',
    },
    {
      label: t('Listings awaiting review', '待审核商家'),
      value: d.business.pending,
      tone: d.business.pending ? 'text-amber-700' : undefined,
      goto: 'directory',
    },
  ];

  // Revenue: the shown year's total (and this month, when it is this year).
  const thisYear = new Date(d.generated_at || Date.now()).getFullYear();
  const shownYear = rev.year ?? (Number(rev.by_month[0]?.month?.slice(0, 4)) || thisYear);
  const isThisYear = shownYear === thisYear;
  const months = (rev.by_month || []).map((b) => ({
    label: monthLabel(lang, b.month),
    value: b.cents || 0,
    title: t(
      `${monthLabel(lang, b.month)}: ${usd(b.cents)} (${b.payments ?? 0} payments)`,
      `${monthLabel(lang, b.month)}：${usd(b.cents)}（${b.payments ?? 0} 笔）`,
    ),
  }));
  const memberMonths = (m.by_month || []).map((b) => ({
    label: monthLabel(lang, b.month),
    value: b.active || 0,
    title: t(
      `${monthLabel(lang, b.month)}: ${b.active ?? 0} active members`,
      `${monthLabel(lang, b.month)}：有效会员 ${b.active ?? 0} 人`,
    ),
  }));

  const tiers = m.by_tier || [];
  const activeTotal = tiers.reduce((s, x) => s + (x.active || 0), 0);
  const pct = (v: number) => (activeTotal ? Math.round((v / activeTotal) * 100) : 0);
  const slices = tiers.map((x) => ({
    name: x.name || x.id,
    value: x.active || 0,
    share: `${pct(x.active || 0)}%`,
    title: t(
      `${x.name || x.id}: ${x.active || 0} (${pct(x.active || 0)}%)`,
      `${x.name || x.id}：${x.active || 0} 人（${pct(x.active || 0)}%）`,
    ),
  }));

  const eventCols: Column<UpcomingEvent>[] = [
    {
      key: 'event',
      label: t('Event', '活动'),
      render: (e) => (
        <span className="inline-block">
          <span className="block text-ink font-medium">{eventTitle(lang, e)}</span>
          {e.location && <span className="block text-xs text-neutral-500">{e.location}</span>}
        </span>
      ),
    },
    { key: 'when', label: t('When', '时间'), render: (e) => fmtWhen(lang, e) },
    {
      key: 'reg',
      label: t('Registered', '已报名'),
      className: 'text-right tabular-nums',
      render: (e) =>
        e.takes_registrations ? (
          numFmt(e.registration_count)
        ) : (
          <span className="text-neutral-500">{t('no form', '无报名表')}</span>
        ),
    },
  ];
  const expiringCols: Column<ExpiringMember>[] = [
    {
      key: 'member',
      label: t('Member', '会员'),
      render: (x) => <MemberCell p={{ members: { full_name: x.full_name, email: x.email } }} />,
    },
    { key: 'tier', label: t('Tier', '类型'), render: (x) => tierName(x.tier_id) },
    { key: 'expires', label: t('Expires', '到期'), render: (x) => fmtDate(lang, x.expires_at) },
  ];
  const regCols: Column<Registration>[] = [
    {
      key: 'email',
      label: t('Email', '邮箱'),
      render: (r) => <span className="break-all">{r.email || '—'}</span>,
    },
    { key: 'event', label: t('Event', '活动'), render: (r) => eventTitle(lang, r.events) },
    {
      key: 'at',
      label: t('Registered', '报名时间'),
      render: (r) => fmtDateTime(lang, r.created_at),
    },
  ];
  const payCols: Column<Payment>[] = [
    { key: 'date', label: t('Date', '日期'), render: (p) => fmtDate(lang, p.paid_at) },
    { key: 'member', label: t('Member', '会员'), render: (p) => <MemberCell p={p} /> },
    { key: 'kind', label: t('Type', '类型'), render: (p) => kindLabel(p.kind) },
    {
      key: 'amount',
      label: t('Amount', '金额'),
      className: 'text-right tabular-nums',
      render: (p) => usd(p.amount_cents),
    },
  ];

  const expiring = m.expiring || [];
  const regs = ev.recent_registrations || [];
  const pays = rev.recent || [];

  return (
    <div className="space-y-8">
      <div>
        <span className={EYEBROW}>{t('Overview', '总览')}</span>
        {header}
      </div>
      {dash.error && <Notice tone="error">{dash.error}</Notice>}

      {/* Stat tiles: the numbers staff act on, each a shortcut to its tab. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-6">
        {tiles.map((x, i) => (
          <motion.button
            key={x.goto + x.label}
            type="button"
            initial={riseFromSm}
            animate={shown}
            transition={listItem(i)}
            whileHover={hoverLift}
            whileTap={tap}
            onClick={() => go(x.goto)}
            className="group text-left min-h-11 cursor-pointer"
          >
            <span className="flex items-start justify-between gap-2 text-xs font-bold text-neutral-500">
              <span>{x.label}</span>
              <ChevronRight
                className="w-3.5 h-3.5 shrink-0 text-neutral-400 group-hover:text-brick transition-colors"
                aria-hidden
              />
            </span>
            <span
              className={`block mt-1 text-2xl sm:text-3xl font-bold tabular-nums ${x.tone ?? 'text-ink'}`}
            >
              {numFmt(x.value)}
            </span>
            {x.sub && <span className="block text-xs text-neutral-500">{x.sub}</span>}
          </motion.button>
        ))}
      </div>

      {/* Revenue: figures beside the shown year month by month. */}
      <section className={SECTION}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] md:items-center">
          <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <h2 className="col-span-2 md:col-span-1 text-lg font-bold text-ink">
              {t('Revenue', '收款')}
            </h2>
            <Figure
              label={
                isThisYear
                  ? t('Revenue this year', '今年收款')
                  : t(`Revenue in ${shownYear}`, `${shownYear} 年收款`)
              }
              value={usd(isThisYear ? rev.ytd_cents : rev.year_cents)}
            />
            {isThisYear ? (
              <Figure
                label={t('Revenue this month', '本月收款')}
                value={usd(rev.month_cents)}
                sub={t(
                  `${rev.payments_this_month ?? 0} payments`,
                  `${rev.payments_this_month ?? 0} 笔`,
                )}
              />
            ) : (
              <Figure label={t('Payments', '笔数')} value={numFmt(rev.year_payments)} />
            )}
          </div>
          <div className="min-w-0">
            {months.length ? (
              <ScrubChart points={months} fmt={usd} />
            ) : (
              <Empty>
                {isThisYear
                  ? t('No payments this year.', '今年暂无收款。')
                  : t(`No payments in ${shownYear}.`, `${shownYear} 年无收款。`)}
              </Empty>
            )}
          </div>
        </div>
      </section>

      {/* Active members: live figures beside a line reconstructed from the spans. */}
      <section className={SECTION}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] md:items-center">
          <div className="grid grid-cols-2 md:grid-cols-1 gap-4">
            <h2 className="col-span-2 md:col-span-1 text-lg font-bold text-ink">
              {t('Active members', '有效会员')}
            </h2>
            <Figure
              label={t('Active now', '当前有效')}
              value={numFmt(sc.active)}
              tone="text-emerald-700"
              sub={t(`${total} members in total`, `会员共 ${total} 人`)}
            />
            <Figure label={t('New this month', '本月新增')} value={numFmt(m.new_this_month)} />
          </div>
          <div className="min-w-0">
            {memberMonths.length ? (
              <ScrubChart points={memberMonths} fmt={(n) => String(Math.round(n))} />
            ) : (
              <Empty>{t('No membership history for this year.', '该年份没有会员记录。')}</Empty>
            )}
          </div>
        </div>
      </section>

      <section className={SECTION}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t('Active members by tier', '有效会员按类型')}>
            {tiers.length ? (
              <PieChart slices={slices} emptyText={t('No active members yet.', '暂无有效会员。')} />
            ) : (
              <Empty>{t('No membership tiers.', '暂无会员类型。')}</Empty>
            )}
          </Card>
          <Card title={t('Members by status', '会员状态')}>
            <ul className="space-y-3">
              {MEMBER_STATUSES.map((s) => {
                const n = sc[s] ?? 0;
                const share = total ? Math.round((n / total) * 100) : 0;
                return (
                  <li key={s}>
                    <div className="flex items-center justify-between gap-3 mb-1.5 text-sm">
                      <Status tone={memberStatusTone(s)}>{memberStatusLabel(t, s)}</Status>
                      <span className="tabular-nums text-neutral-700">
                        {n} <span className="text-xs text-neutral-500">({share}%)</span>
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full bg-neutral-200 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={share}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={memberStatusLabel(t, s)}
                    >
                      {/* The width is data, not styling. */}
                      <div
                        className={`h-full rounded-full ${BAR[s]} transition-[width] duration-500`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </section>

      <section className={SECTION}>
        <div className="grid gap-5 lg:grid-cols-2">
          <ListSection
            title={t('Upcoming events', '即将举办的活动')}
            info={
              ev.drafts_total
                ? t(`${ev.drafts_total} unpublished`, `${ev.drafts_total} 个未发布`)
                : ''
            }
            empty={t('No upcoming published events.', '暂无已发布的即将举办活动。')}
            isEmpty={!ev.upcoming?.length}
          >
            <DataTable columns={eventCols} rows={ev.upcoming || []} rowKey={(e) => e.id} />
          </ListSection>
          <ListSection
            title={t('Expiring soon', '即将到期')}
            info={
              (m.expiring_total || 0) > expiring.length
                ? t(
                    `${expiring.length} of ${m.expiring_total}`,
                    `${expiring.length} / 共 ${m.expiring_total}`,
                  )
                : ''
            }
            empty={t(`Nobody expires in the next ${days} days.`, `未来 ${days} 天内没有会员到期。`)}
            isEmpty={!expiring.length}
          >
            <DataTable columns={expiringCols} rows={expiring} rowKey={(x) => x.id} />
          </ListSection>
        </div>
      </section>

      <section className={SECTION}>
        <div className="grid gap-5 lg:grid-cols-2">
          <ListSection
            title={t('Latest registrations', '最新报名')}
            empty={t('No registrations yet.', '暂无报名。')}
            isEmpty={!regs.length}
          >
            <DataTable columns={regCols} rows={regs} rowKey={(r) => r.id} />
          </ListSection>
          <ListSection
            title={t('Latest payments', '最新收款')}
            empty={t('No payments recorded yet.', '暂无收款记录。')}
            isEmpty={!pays.length}
          >
            <DataTable columns={payCols} rows={pays} rowKey={(p) => p.id} />
          </ListSection>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      {title && <h2 className="text-lg font-bold text-ink mb-4">{title}</h2>}
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl sm:text-3xl font-bold tabular-nums ${tone ?? 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

function ListSection({
  title,
  info,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  info?: string;
  empty: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {info && <span className="text-xs text-neutral-500">{info}</span>}
      </div>
      {isEmpty ? <Empty>{empty}</Empty> : children}
    </section>
  );
}
