import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import {
  Field,
  INPUT,
  InlineConfirm,
  LABEL,
  Notice,
  SECONDARY,
  SELECT,
  TabHeader,
  fmtDate,
  useAdmin,
} from '../kit';
import { useAsk, type Msg } from './members/shared';
import { NewsEditor, cleanHtml } from './news/NewsEditor';
import { TestRecipients, type TestRecipientList } from './news/TestRecipients';

// Templates: the API renders one (GET /api/admin/news-template → { subject,
// html }) into the subject and message boxes, where it stays editable and is
// sent like any other news email. An event template waits for an event.
const NEWS_TEMPLATES = {
  general: { api: 'general', event: false, en: 'general announcement', zh: '通用公告' },
  event: { api: 'announcement', event: true, en: 'event announcement', zh: '活动通知' },
  reminder: { api: 'reminder', event: true, en: 'event reminder', zh: '活动提醒' },
  thanks: { api: 'thanks', event: true, en: 'event thank-you', zh: '活动感谢信' },
  renewal: { api: 'renewal', event: false, en: 'renewal reminder', zh: '会员续费提醒' },
} as const;
type TemplateKey = keyof typeof NEWS_TEMPLATES;
const templateOf = (v: string) =>
  Object.hasOwn(NEWS_TEMPLATES, v) ? NEWS_TEMPLATES[v as TemplateKey] : null;
// The dropdown's labels, same order and wording as the old panel.
const TEMPLATE_OPTIONS: [TemplateKey, string, string][] = [
  ['general', 'General announcement', '通用公告'],
  ['event', 'Event announcement', '活动通知'],
  ['reminder', 'Event reminder', '活动提醒'],
  ['thanks', 'Event thank-you', '活动感谢信'],
  ['renewal', 'Membership renewal reminder', '会员续费提醒'],
];
// Text a template leaves for the admin to write. /api/admin/news refuses it
// too (PLACEHOLDER in functions/api/_event-emails.js).
const NEWS_PLACEHOLDER = /【待填写|\[To fill in/;

interface EventOption {
  id: string;
  title: string;
  title_zh: string | null;
  starts_at: string;
}

// Compose News: email the membership. Template + event → subject and message
// (Jodit), a test send to you and ticked admins, and the real send, which needs
// the "I understand" box and runs only after InlineConfirm's undo window.
// functions/api/admin/news.js, news-template.js; events from events.js.
export default function NewsTab() {
  const { lang, t, api } = useAdmin();
  const { ask, panel } = useAsk();
  const [testOnly, setTestOnly] = useState(false);
  const [recipients, setRecipients] = useState<TestRecipientList | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [audience, setAudience] = useState('active');
  const [template, setTemplate] = useState('');
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // The template text last put in the boxes, and a counter so a slow template
  // answer for a choice since changed is dropped.
  const filled = useRef<{ subject: string; html: string } | null>(null);
  const seq = useRef(0);
  const sendBox = useRef<HTMLDivElement>(null);
  const tpl = templateOf(template);

  // Whether this environment refuses real sends (NEWS_TEST_ONLY), and who a
  // test can go to. The API refuses real sends there either way.
  useEffect(() => {
    void api<{ test_only?: boolean; test_recipients?: TestRecipientList }>('/api/admin/news').then(
      (res) => {
        setTestOnly(res.ok && res.data.test_only === true);
        const list = res.ok ? (res.data.test_recipients ?? null) : null;
        setRecipients(list);
        // Keep only ticks that are still admin accounts.
        setPicked((p) => p.filter((e) => list?.admins?.includes(e)));
      },
    );
  }, [api]);

  // Returns the chosen event id that is still in the list ('' if none).
  const loadEvents = async (current: string) => {
    const res = await api<{ rows: EventOption[] }>('/api/admin/events?published=true&limit=50');
    if (!res.ok) {
      setMsg({
        tone: 'error',
        text: res.data.error || t('Could not load events.', '无法加载活动。'),
      });
      return current;
    }
    const rows = res.data.rows || [];
    const kept = rows.some((e) => e.id === current) ? current : '';
    setEvents(rows);
    setEventId(kept);
    return kept;
  };

  const fetchTemplate = async (key: TemplateKey, evId: string) => {
    const x = NEWS_TEMPLATES[key];
    const query = new URLSearchParams({ template: x.api });
    if (x.event) query.set('event_id', evId);
    const mine = ++seq.current;
    const res = await api<{ subject?: string; html?: string }>(`/api/admin/news-template?${query}`);
    if (mine !== seq.current) return;
    if (!res.ok)
      return setMsg({
        tone: 'error',
        text: res.data.error || t('Could not load the template.', '无法加载模板。'),
      });
    const s = res.data.subject || '';
    const h = res.data.html || '';
    setSubject(s);
    setHtml(h);
    filled.current = { subject: s, html: cleanHtml(h) };
    setMsg(null);
  };

  const applyTemplate = (key: string, evId: string) => {
    const x = templateOf(key);
    if (!x || (x.event && !evId)) return;
    // Never silently replace something the admin wrote or edited.
    const body = cleanHtml(html);
    const untouched =
      filled.current && subject === filled.current.subject && body === filled.current.html;
    if ((subject.trim() || body.trim()) && !untouched)
      return ask(
        t(`Replace the subject and message with the ${x.en}?`, `用${x.zh}替换当前的主题和正文？`),
        t('Replace', '替换'),
        () => fetchTemplate(key as TemplateKey, evId),
      );
    void fetchTemplate(key as TemplateKey, evId);
  };

  const onTemplate = async (key: string) => {
    setTemplate(key);
    const x = templateOf(key);
    if (!x) {
      seq.current++; // Blank leaves the boxes as they are, and drops a pending template
      return;
    }
    const evId = x.event ? await loadEvents(eventId) : '';
    applyTemplate(key, evId);
  };

  // A test email: to the signed-in admin, plus the ticked admin accounts.
  const sendTest = async () => {
    const body = {
      subject: subject.trim(),
      body_html: cleanHtml(html).trim(),
      test: true,
      test_to: picked,
    };
    if (!body.subject || !body.body_html)
      return setMsg({
        tone: 'error',
        text: t('Subject and message are required.', '主题和正文为必填项。'),
      });
    setTesting(true);
    const res = await api<{ recipients?: string[] }>('/api/admin/news', { method: 'POST', body });
    setTesting(false);
    if (!res.ok)
      return setMsg({
        tone: 'error',
        text:
          res.status === 0
            ? t('Could not send the test email.', '无法发送测试邮件。')
            : res.data.error || t('The test email failed.', '测试邮件发送失败。'),
      });
    const list = (res.data.recipients || []).join(', ');
    setMsg({
      tone: 'success',
      text: t(`Test email sent to ${list}.`, `测试邮件已发送给：${list}。`),
    });
  };

  // The real send. InlineConfirm calls this once its undo window has passed —
  // and also when it unmounts inside that window. A mass email must not go out
  // because the admin left the tab, so a composer no longer in the document
  // (its DOM is gone before the commit runs) sends nothing.
  const sendNews = async () => {
    if (!sendBox.current?.isConnected) return;
    const body = {
      subject: subject.trim(),
      body_html: cleanHtml(html).trim(),
      audience,
      confirm: confirmed,
    };
    if (!body.subject || !body.body_html)
      return setMsg({
        tone: 'error',
        text: t('Subject and message are required.', '主题和正文为必填项。'),
      });
    if (NEWS_PLACEHOLDER.test(body.subject) || NEWS_PLACEHOLDER.test(body.body_html))
      return setMsg({
        tone: 'error',
        text: t(
          'Replace the 【待填写】 / [To fill in] text before sending.',
          '请先替换【待填写】/ [To fill in] 文字再发送。',
        ),
      });
    if (!body.confirm)
      return setMsg({
        tone: 'error',
        text: t('Please check the confirmation box.', '请勾选确认框。'),
      });
    setSending(true);
    const res = await api<{ sent: number; failed: number }>('/api/admin/news', {
      method: 'POST',
      body,
    });
    setSending(false);
    if (!res.ok)
      return setMsg({ tone: 'error', text: res.data.error || t('Send failed.', '发送失败。') });
    const { sent, failed } = res.data;
    setMsg({
      tone: 'success',
      text: t(
        `Sent to ${sent} member(s)${failed ? `, ${failed} failed` : ''}.`,
        `已发送给 ${sent} 位会员${failed ? `，${failed} 封失败` : ''}。`,
      ),
    });
    setConfirmed(false);
  };

  return (
    <div className="space-y-5">
      <TabHeader
        title={t('Compose News', '发送通讯')}
        description={t('Email the membership', '向会员发送邮件')}
      />

      {testOnly && (
        <Notice tone="warn">
          {t(
            'This site only sends test emails: it shares the real member list, so real sends are turned off here. Send the real email from caaciorg.com.',
            '此站点只能发送测试邮件：它连接的是真实会员名单，所以这里关闭了正式群发。正式邮件请到 caaciorg.com 发送。',
          )}
        </Notice>
      )}

      <div className="space-y-5">
        <Field label={t('Audience', '收件对象')} className="max-w-sm">
          <select className={SELECT} value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="active">{t('Active members only', '仅有效会员')}</option>
            <option value="all">{t('All members', '全部会员')}</option>
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Template', '模板')}
            hint={t(
              'Replace any 【待填写】 / [To fill in] text before sending.',
              '发送前请替换所有【待填写】/ [To fill in] 文字。',
            )}
          >
            <select
              className={SELECT}
              value={template}
              onChange={(e) => void onTemplate(e.target.value)}
            >
              <option value="">{t('Blank', '空白')}</option>
              {TEMPLATE_OPTIONS.map(([v, en, zh]) => (
                <option key={v} value={v}>
                  {lang === 'zh' ? `${zh} · ${en}` : `${en} · ${zh}`}
                </option>
              ))}
            </select>
          </Field>
          {tpl?.event && (
            <Field label={t('Event (published)', '活动（已发布）')}>
              <select
                className={SELECT}
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  applyTemplate(template, e.target.value);
                }}
              >
                <option value="">{t('— Choose an event —', '— 选择活动 —')}</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title_zh ? `${e.title_zh} · ${e.title}` : e.title} (
                    {fmtDate(lang, e.starts_at)})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {panel}

        <Field label={t('Subject', '主题')}>
          <input
            type="text"
            className={INPUT}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>

        <div>
          <label htmlFor="news-body" className={LABEL}>
            {t('Message', '正文')}
          </label>
          <NewsEditor id="news-body" value={html} onChange={setHtml} />
        </div>

        <TestRecipients list={recipients} picked={picked} onChange={setPicked} />

        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            className="w-5 h-5 accent-brick cursor-pointer"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span className="text-sm text-neutral-800">
            {t('I understand this emails real members.', '我确认这将向真实会员发送邮件。')}
          </span>
        </label>

        <div ref={sendBox} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={SECONDARY}
            disabled={testing}
            onClick={() => void sendTest()}
          >
            <Send className="w-4 h-4" aria-hidden />
            {testing ? t('Sending…', '发送中…') : t('Send test email', '发送测试邮件')}
          </button>
          <InlineConfirm
            label={t('Send news email', '发送通讯邮件')}
            keepLabel={t('Keep editing', '继续编辑')}
            confirmLabel={
              audience === 'all'
                ? t('Email all members', '发给全部会员')
                : t('Email active members', '发给有效会员')
            }
            doneLabel={t('Sending…', '即将发送…')}
            undoLabel={t('Undo', '撤销')}
            disabled={testOnly || sending || !confirmed}
            onCommit={() => void sendNews()}
          />
        </div>
        {!confirmed && !testOnly && (
          <p className="text-xs text-neutral-500">
            {t(
              'Tick “I understand this emails real members.” to send.',
              '勾选“我确认这将向真实会员发送邮件。”后才能发送。',
            )}
          </p>
        )}

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </div>
  );
}
