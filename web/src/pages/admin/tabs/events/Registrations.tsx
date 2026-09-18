// Who registered for one event, and who gets its free gift:
// GET /api/admin/event-registrations?event_id=… — head-counts, per-option
// counts for the choice questions, one column per question, a gift-eligible
// filter (events with a gift only) and the CSV export.
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { DIVIDED, LiquidToggle, Notice, SECONDARY, Spinner, Status, useAdmin } from '../../kit';
import {
  CHOICE_TYPES,
  answerText,
  chicagoTime,
  downloadCsv,
  eventTitleIn,
  labelIn,
  registrationsCsv,
  type AdminEvent,
  type Registration,
  type RegistrationsData,
} from './rules';

export function Registrations({ ev, onClose }: { ev: AdminEvent; onClose: () => void }) {
  const { lang, t, api } = useAdmin();
  const [data, setData] = useState<RegistrationsData | null>(null);
  const [error, setError] = useState('');
  const [eligibleOnly, setEligibleOnly] = useState(false);

  useEffect(() => {
    let live = true; // a slow answer for an event the admin has since left is dropped
    setData(null);
    setError('');
    setEligibleOnly(false);
    void api<RegistrationsData>(
      `/api/admin/event-registrations?event_id=${encodeURIComponent(ev.id)}`,
    ).then((res) => {
      if (!live) return;
      if (!res.ok)
        return setError(res.data.error || t('Could not load registrations.', '无法加载报名。'));
      setData({
        ...res.data,
        questions: Array.isArray(res.data.questions) ? res.data.questions : [],
        rows: res.data.rows || [],
        summary: res.data.summary || {},
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.id]);

  const perk = data?.event.perk || null;
  const onlyEligible = !!perk && eligibleOnly;
  const questions = data?.questions ?? [];
  const summary = data?.summary ?? {};
  // # is the position in registration order, kept when filtering.
  const shown = (data?.rows ?? [])
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => !onlyEligible || r.perk_eligible);

  const csv = () => {
    if (!data) return;
    const name =
      String(data.event.slug || data.event.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'event';
    downloadCsv(
      registrationsCsv(data, { eligibleOnly: onlyEligible }),
      `${name}-registrations${onlyEligible ? '-eligible' : ''}.csv`,
    );
  };

  const mark = (yes: boolean) =>
    yes ? (
      <span className="text-emerald-700 font-bold">✓</span>
    ) : (
      <span className="text-neutral-400">—</span>
    );
  // A signup that never confirmed its email doesn't count, but staff should see it.
  const account = (a: Registration['account']) =>
    !a ? (
      mark(false)
    ) : a.confirmed ? (
      mark(true)
    ) : (
      <Status tone="warn">{t('Unconfirmed', '未验证')}</Status>
    );

  let deadline = '';
  if (data) {
    if (perk) {
      const when = chicagoTime(perk.deadline);
      const atStart = Date.parse(perk.deadline) === Date.parse(data.event.starts_at);
      deadline = t(
        `Free gift: ${perk.item_en} · deadline ${when} (Chicago)${atStart ? ' — the event start' : ''}`,
        `福利：${perk.item_zh} · 截止时间 ${when}（芝加哥时间）${atStart ? '——即活动开始时间' : ''}`,
      );
    } else deadline = t('No free gift for this event.', '该活动没有福利。');
  }

  const stat = (label: string, n: number | undefined, good = false) => (
    <div>
      <div className="text-xs font-bold text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${good ? 'text-emerald-700' : 'text-ink'}`}
      >
        {Number(n) || 0}
      </div>
    </div>
  );

  return (
    <section className="space-y-5" aria-label={t('Registrations', '报名')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-brick block">
            {t('Registrations', '报名')}
          </span>
          <h2 className="text-lg font-bold text-ink break-words">
            {eventTitleIn(lang, data?.event ?? ev)}
          </h2>
          {deadline && <p className="text-xs text-neutral-500 mt-1">{deadline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perk && (
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <LiquidToggle
                checked={eligibleOnly}
                onChange={setEligibleOnly}
                label={t('Gift-eligible only', '只看可领福利')}
              />
              {t('Gift-eligible only', '只看可领福利')}
            </span>
          )}
          <button type="button" className={SECONDARY} disabled={!data} onClick={csv}>
            <Download className="w-4 h-4" aria-hidden />
            {t('Download CSV', '导出 CSV')}
          </button>
          <button type="button" className={SECONDARY} onClick={onClose}>
            <X className="w-4 h-4" aria-hidden />
            {t('Close', '关闭')}
          </button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Spinner label={t('Loading…', '加载中…')} />}

      {data && (
        <>
          <div className="grid gap-x-6 gap-y-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {stat(t('Total', '总数'), summary.total)}
            {stat(t('Confirmed account', '已验证账户'), summary.with_account)}
            {perk &&
              stat(
                t(`Free ${perk.item_en} eligible`, `可领${perk.item_zh}`),
                summary.perk_eligible,
                true,
              )}
          </div>
          {questions.some((q) => CHOICE_TYPES.has(q.type)) && (
            <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {questions
                .filter((q) => CHOICE_TYPES.has(q.type))
                .map((q) => {
                  const counts = summary.choices?.[q.id] || {};
                  const lines: [string, number | undefined][] = (q.options || []).map((o) => [
                    labelIn(o, lang),
                    counts[o.id],
                  ]);
                  if (q.other || counts.other) lines.push([t('Other', '其他'), counts.other]);
                  return (
                    <div key={q.id}>
                      <div className="text-xs font-bold text-neutral-500 mb-2">
                        {labelIn(q, lang)}
                      </div>
                      {lines.map(([label, n], k) => (
                        <div
                          key={k}
                          className="flex justify-between gap-2 text-sm text-neutral-700"
                        >
                          <span className="min-w-0 break-words">{label}</span>
                          <strong className="tabular-nums text-ink">{Number(n) || 0}</strong>
                        </div>
                      ))}
                    </div>
                  );
                })}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-sm text-neutral-500 py-6 text-center">
              {onlyEligible
                ? t('No eligible registrations.', '暂无可领福利的报名。')
                : t('No registrations yet.', '暂无报名。')}
            </p>
          ) : (
            <>
              {/* Wide screens: one column per question, scrolling sideways. */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm border-b border-neutral-200/80">
                  <thead>
                    <tr className="text-left text-xs font-bold text-neutral-500 border-b border-neutral-200">
                      <th className="px-3 py-3">#</th>
                      <th className="px-3 py-3 whitespace-nowrap">
                        {t('Registered (Chicago)', '报名时间（芝加哥）')}
                      </th>
                      <th className="px-3 py-3">{t('Email', '邮箱')}</th>
                      {questions.map((q) => (
                        <th key={q.id} className="px-3 py-3 min-w-[140px]">
                          {labelIn(q, lang)}
                        </th>
                      ))}
                      <th className="px-3 py-3">{t('Account', '账户')}</th>
                      {perk && (
                        <th className="px-3 py-3">
                          {t(`Free ${perk.item_en}`, `免费${perk.item_zh}`)}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ r, n }) => (
                      <tr
                        key={r.id}
                        className="border-b border-neutral-200/60 last:border-0 align-top"
                      >
                        <td className="px-3 py-2.5 text-neutral-500 tabular-nums">{n}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                          {chicagoTime(r.created_at)}
                        </td>
                        <td className="px-3 py-2.5 break-all">{r.email}</td>
                        {questions.map((q) => (
                          <td key={q.id} className="px-3 py-2.5 text-neutral-700">
                            {answerText(q, r.answers?.[q.id], lang) || '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2.5">{account(r.account)}</td>
                        {perk && <td className="px-3 py-2.5">{mark(r.perk_eligible)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Phones: a divided list, one entry per registrant. */}
              <ul className={`md:hidden ${DIVIDED}`}>
                {shown.map(({ r, n }) => (
                  <li key={r.id} className="py-4 space-y-2 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-ink break-all">
                        <span className="text-neutral-400 me-1.5">#{n}</span>
                        {r.email}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 tabular-nums">
                      {chicagoTime(r.created_at)} {t('(Chicago)', '（芝加哥）')}
                    </div>
                    {questions.map((q) => (
                      <div key={q.id} className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-bold text-neutral-500 min-w-0">
                          {labelIn(q, lang)}
                        </span>
                        <span className="text-right text-neutral-700 min-w-0 break-words">
                          {answerText(q, r.answers?.[q.id], lang) || '—'}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-bold text-neutral-500">
                        {t('Account', '账户')}
                      </span>
                      {account(r.account)}
                    </div>
                    {perk && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-bold text-neutral-500">
                          {t(`Free ${perk.item_en}`, `免费${perk.item_zh}`)}
                        </span>
                        {mark(r.perk_eligible)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
