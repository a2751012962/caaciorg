import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  DataTable,
  InlineConfirm,
  Loaded,
  SECONDARY,
  SELECT,
  Status,
  TabHeader,
  memberStatusLabel,
  memberStatusTone,
  useAdmin,
  useLoad,
  useTabParams,
  type Column,
} from '../kit';
import {
  chicagoTime,
  downloadCsv,
  eventTitleIn,
  volunteersCsv,
  type Volunteer,
} from './events/rules';

const ENDPOINT = '/api/admin/event-volunteers';
const ANY_EVENT = '__any__'; // filter value for the rows with no event

// Volunteers: who offered to help, from the /volunteer/ page and from the
// "I'd also like to volunteer" box on an event registration form. The event
// filter is built from the rows (plus the event the Events tab sent us for,
// even when nobody has signed up for it yet). functions/api/admin/event-volunteers.js.
export default function VolunteersTab() {
  const { lang, t, api, toast } = useAdmin();
  const params = useTabParams();
  const list = useLoad(() => api<{ rows: Volunteer[] }>(`${ENDPOINT}?scope=all`));
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const [pick, setPick] = useState(params.event || '');

  // Opened from an event's Volunteers button: pick that event.
  useEffect(() => {
    if (params.event) setPick(params.event);
  }, [params.event]);

  // One option per event somebody signed up for, in row order (newest first),
  // plus the event we were sent for, plus "Any event" when there are such rows.
  const options = useMemo(() => {
    const seen = new Map<string, string>();
    let anyEvent = false;
    for (const r of rows) {
      if (!r.event_id || !r.event) {
        anyEvent = true;
        continue;
      }
      if (!seen.has(r.event_id)) seen.set(r.event_id, eventTitleIn(lang, r.event));
    }
    if (params.event && !seen.has(params.event))
      seen.set(
        params.event,
        eventTitleIn(lang, { title: params.title || params.event, title_zh: params.title_zh }),
      );
    return { events: [...seen.entries()], anyEvent };
  }, [rows, lang, params.event, params.title, params.title_zh]);

  const shownRows = useMemo(() => {
    if (!pick) return rows;
    if (pick === ANY_EVENT) return rows.filter((r) => !r.event_id);
    return rows.filter((r) => r.event_id === pick);
  }, [rows, pick]);

  // Naming the event matters when the Events tab sent us here: "No volunteers
  // yet." next to a filter set to one event reads as "nobody ever volunteered".
  const pickTitle = options.events.find(([id]) => id === pick)?.[1];
  const emptyLabel =
    !pick || pick === ANY_EVENT || !pickTitle
      ? t('No volunteers yet.', '暂无志愿者报名。')
      : t(`No volunteers for ${pickTitle} yet.`, `暂无“${pickTitle}”的志愿者报名。`);

  const remove = async (r: Volunteer) => {
    const res = await api(ENDPOINT, { method: 'DELETE', body: { id: r.id } });
    if (!res.ok) return toast('error', res.data.error || t('Delete failed.', '删除失败。'));
    toast(
      'success',
      t(
        `Removed ${r.name || r.email} from the volunteer list.`,
        `已将 ${r.name || r.email} 从志愿者名单中移除。`,
      ),
    );
    await list.reload();
  };

  const csv = () => {
    const slug =
      pick && pick !== ANY_EVENT ? rows.find((r) => r.event_id === pick)?.event?.slug : '';
    downloadCsv(volunteersCsv(shownRows), `${slug ? `${slug}-` : ''}volunteers.csv`);
  };

  const sourceLabel = (s: string | null) =>
    s === 'volunteer'
      ? t('Volunteer page', '志愿者报名页')
      : s === 'registration'
        ? t('Registration form', '活动报名表')
        : s || '—';

  const columns: Column<Volunteer>[] = [
    { key: 'name', label: t('Name', '姓名'), render: (r) => r.name || '—' },
    {
      key: 'email',
      label: t('Email', '邮箱'),
      render: (r) => <span className="break-all">{r.email}</span>,
    },
    {
      key: 'phone',
      label: t('Phone', '电话'),
      render: (r) => r.phone || '—',
      className: 'whitespace-nowrap',
    },
    {
      key: 'event',
      label: t('Event', '活动'),
      render: (r) =>
        r.event ? (
          eventTitleIn(lang, r.event)
        ) : (
          <span className="text-neutral-500">{t('Any event', '任何活动')}</span>
        ),
    },
    { key: 'source', label: t('Source', '来源'), render: (r) => sourceLabel(r.source) },
    {
      key: 'message',
      label: t('Message', '留言'),
      render: (r) => <span className="whitespace-pre-wrap break-words">{r.message || '—'}</span>,
    },
    {
      key: 'created',
      label: t('Signed up', '报名时间'),
      render: (r) => <span className="tabular-nums">{chicagoTime(r.created_at)}</span>,
      className: 'whitespace-nowrap',
    },
    {
      key: 'account',
      label: t('Account', '账户'),
      render: (r) =>
        r.account ? (
          <Status tone={memberStatusTone(r.account.status)}>
            {memberStatusLabel(t, r.account.status)}
          </Status>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Volunteers', '志愿者')}
        description={t(
          'Sign-ups from the volunteer page and from event registration forms. Filter by event, or leave it on all events.',
          '来自志愿者报名页和活动报名表的报名记录。可按活动筛选，或查看全部活动。',
        )}
        actions={
          <button type="button" className={SECONDARY} disabled={!shownRows.length} onClick={csv}>
            <Download className="w-4 h-4" aria-hidden />
            {t('Download CSV', '导出 CSV')}
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          className={`${SELECT} sm:w-80`}
          value={pick}
          aria-label={t('Event', '活动')}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">{t('All events', '全部活动')}</option>
          {options.events.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
          {options.anyEvent && <option value={ANY_EVENT}>{t('Any event', '任何活动')}</option>}
        </select>
        {shownRows.length > 0 && (
          <span className="text-xs text-neutral-500">
            {t(`${shownRows.length} sign-up(s)`, `共 ${shownRows.length} 条报名`)}
          </span>
        )}
      </div>

      <Loaded
        loading={list.loading}
        error={list.error}
        isEmpty={list.data ? shownRows.length === 0 : undefined}
        empty={emptyLabel}
      >
        <DataTable
          columns={columns}
          rows={shownRows}
          rowKey={(r) => r.id}
          actions={(r) => (
            <InlineConfirm
              label={t('Delete', '删除')}
              keepLabel={t('Keep', '保留')}
              confirmLabel={t('Remove', '移除')}
              doneLabel={t('Removing…', '即将移除…')}
              undoLabel={t('Undo', '撤销')}
              onCommit={() => void remove(r)}
            />
          )}
        />
      </Loaded>
    </div>
  );
}
