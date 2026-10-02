import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { effectiveStatus } from '../../../lib/shared';
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
  CHOICE_TYPES,
  answerText,
  chicagoTime,
  choiceCounts,
  downloadCsv,
  eventTitleIn,
  labelIn,
  volunteersCsv,
  type Question,
  type Volunteer,
  type VolunteersData,
} from './events/rules';

const ENDPOINT = '/api/admin/event-volunteers';
const ANY_EVENT = '__any__'; // filter value for the rows with no event

// Volunteers: who offered to help, from the volunteer dialog, from each
// event's own volunteer page and from the "I'd also like to volunteer" box on
// an event registration form. The event filter is built from the rows (plus
// the event the Events tab sent us for, even when nobody has signed up for it
// yet). Filtered to one event, the answers to that event's volunteer questions
// (its own, else the site's default ones, 0035) get a column each and the
// choice questions a head count. functions/api/admin/event-volunteers.js.
export default function VolunteersTab() {
  const { lang, t, api, toast } = useAdmin();
  const params = useTabParams();
  const list = useLoad(() => api<VolunteersData>(`${ENDPOINT}?scope=all`));
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const defaults = useMemo(() => list.data?.questions ?? [], [list.data]);
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

  // The questions the shown rows answer: one event's own (else the default),
  // or the default for the "any event" rows. Across all events the answers
  // are to different forms, so no columns — the CSV of a filter has them.
  const questions = useMemo<Question[]>(() => {
    if (!pick) return [];
    if (pick === ANY_EVENT) return defaults;
    const own = rows.find((r) => r.event_id === pick)?.event?.questions;
    return own ?? defaults;
  }, [pick, rows, defaults]);
  const counts = useMemo(() => choiceCounts(questions, shownRows), [questions, shownRows]);

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
    downloadCsv(volunteersCsv(shownRows, questions), `${slug ? `${slug}-` : ''}volunteers.csv`);
  };

  const sourceLabel = (s: string | null) =>
    s === 'volunteer'
      ? t('Volunteer form', '志愿者报名表')
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
    // One column per question of the form the shown rows answer.
    ...questions.map((q): Column<Volunteer> => ({
      key: `q-${q.id}`,
      label: labelIn(q, lang),
      render: (r) => (
        <span className="whitespace-pre-wrap break-words">
          {answerText(q, r.answers?.[q.id], lang) || '—'}
        </span>
      ),
    })),
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
      render: (r) => {
        if (!r.account) return '—';
        const s = effectiveStatus(r.account.status, r.account.expires_at);
        return <Status tone={memberStatusTone(s)}>{memberStatusLabel(t, s)}</Status>;
      },
    },
  ];

  const choiceQuestions = questions.filter((q) => CHOICE_TYPES.has(q.type));

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Volunteers', '志愿者')}
        description={t(
          'Sign-ups from the volunteer dialog, each event’s volunteer page and event registration forms. Filter by event to see the answers to its volunteer questions.',
          '来自志愿者弹窗、各活动志愿者报名页和活动报名表的报名记录。按活动筛选可查看该活动志愿者问题的回答。',
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

      {/* Head counts per option of the choice questions, as the Registrations panel shows them. */}
      {shownRows.length > 0 && choiceQuestions.length > 0 && (
        <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {choiceQuestions.map((q) => {
            const c = counts[q.id] || {};
            const lines: [string, number | undefined][] = (q.options || []).map((o) => [
              labelIn(o, lang),
              c[o.id],
            ]);
            if (q.other || c.other) lines.push([t('Other', '其他'), c.other]);
            return (
              <div key={q.id}>
                <div className="text-xs font-bold text-neutral-500 mb-2">{labelIn(q, lang)}</div>
                {lines.map(([label, n], k) => (
                  <div key={k} className="flex justify-between gap-2 text-sm text-neutral-700">
                    <span className="min-w-0 break-words">{label}</span>
                    <strong className="tabular-nums text-ink">{Number(n) || 0}</strong>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

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
