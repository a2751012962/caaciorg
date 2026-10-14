// Create / edit an event: PUT /api/admin/events to create, POST { id, … } to
// patch. Same body and client checks as the old eventForm, including the
// question builder and the warning before changing the questions of a form
// people have already answered.
import { useState, type FormEvent } from 'react';
import {
  Field,
  INPUT,
  LiquidToggle,
  Notice,
  PRIMARY,
  SECONDARY,
  TEXTAREA,
  useAdmin,
} from '../../kit';
import { ImageField } from './ImageField';
import { QuestionBuilder } from './QuestionBuilder';
import { TemplateBar } from './TemplateBar';
import {
  dtInput,
  localToIso,
  questionState,
  questionsError,
  questionsPayload,
  type AdminEvent,
} from './rules';

export function EventForm({
  ev,
  onCancel,
  onSaved,
}: {
  ev: AdminEvent | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t, api } = useAdmin();
  const edit = !!ev;
  // null registration_questions = the event takes no registrations.
  const accepting = edit && Array.isArray(ev.registration_questions);
  const regCount = (edit && Number(ev.registration_count)) || 0;
  // null volunteer_questions = the volunteer page asks the site's default
  // questions; an array = this event's own (0035).
  const ownVolunteer = edit && Array.isArray(ev.volunteer_questions);

  const [f, setF] = useState({
    title: ev?.title ?? '',
    title_zh: ev?.title_zh ?? '',
    location: ev?.location ?? '',
    starts_at: dtInput(ev?.starts_at),
    ends_at: dtInput(ev?.ends_at),
    perk_deadline: dtInput(ev?.perk_deadline),
    perk_item_zh: ev?.perk_item_zh ?? '',
    perk_item_en: ev?.perk_item_en ?? '',
    image_url: ev?.image_url ?? '',
    description: ev?.description ?? '',
    description_zh: ev?.description_zh ?? '',
    published: !edit || !!ev.published,
    accept: accepting,
    ownVolunteer,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [questions, setQuestions] = useState(() =>
    questionState(edit ? ev.registration_questions : null),
  );
  const [volQuestions, setVolQuestions] = useState(() =>
    questionState(edit ? ev.volunteer_questions : null),
  );
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when the admin must confirm changing questions people already answered.
  const [confirming, setConfirming] = useState(false);

  const buildBody = () => ({
    title: f.title.trim(),
    title_zh: f.title_zh.trim(),
    location: f.location.trim(),
    // The admin's wall-clock times as real instants; '' clears an end (→ null)
    // or a deadline (→ start).
    starts_at: localToIso(f.starts_at),
    ends_at: localToIso(f.ends_at),
    perk_deadline: localToIso(f.perk_deadline),
    perk_item_zh: f.perk_item_zh.trim(),
    perk_item_en: f.perk_item_en.trim(),
    description: f.description.trim(),
    description_zh: f.description_zh.trim(),
    image_url: f.image_url.trim(),
    published: f.published,
    // Switched off → null: no registration page, and the public API answers 404.
    registration_questions: f.accept ? questionsPayload(questions) : null,
    // Switched off → null: the volunteer page asks the default questions.
    volunteer_questions: f.ownVolunteer ? questionsPayload(volQuestions) : null,
  });

  const save = async (confirmed: boolean) => {
    setMsg('');
    const body = buildBody();
    if (!body.title) return setMsg(t('Title is required.', '标题为必填项。'));
    if (!body.starts_at) return setMsg(t('Start date is required.', '开始时间为必填项。'));
    if (!body.perk_item_zh !== !body.perk_item_en)
      return setMsg(
        t(
          'Enter the gift name in both languages, or neither.',
          '请用中英文填写礼品名称，或都不填。',
        ),
      );
    if (f.accept) {
      const problem = questionsError(t, questions);
      if (problem) return setMsg(problem);
    }
    if (f.ownVolunteer) {
      const problem = questionsError(t, volQuestions);
      if (problem) return setMsg(t(`Volunteer questions — ${problem}`, `志愿者问题——${problem}`));
    }
    // Stored answers are keyed by question and option id and never rewritten.
    const saved = accepting ? questionsPayload(questionState(ev.registration_questions)) : null;
    if (
      !confirmed &&
      regCount > 0 &&
      JSON.stringify(body.registration_questions) !== JSON.stringify(saved)
    )
      return setConfirming(true);
    setConfirming(false);
    setBusy(true);
    const res = edit
      ? await api('/api/admin/events', { method: 'POST', body: { id: ev.id, ...body } })
      : await api('/api/admin/events', { method: 'PUT', body });
    setBusy(false);
    if (!res.ok) return setMsg(res.data.error || t('Save failed.', '保存失败。'));
    onSaved();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <h2 className="text-lg font-bold text-ink">
        {edit ? t('Edit event', '编辑活动') : t('New event', '新建活动')}
      </h2>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={`${t('Title', '标题')} *`}>
          <input
            className={INPUT}
            value={f.title}
            required
            autoFocus={!edit}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <Field label={t('Chinese title (optional)', '中文标题（可选）')}>
          <input
            className={INPUT}
            value={f.title_zh}
            onChange={(e) => set('title_zh', e.target.value)}
          />
        </Field>
        <Field label={t('Location', '地点')}>
          <input
            className={INPUT}
            value={f.location}
            onChange={(e) => set('location', e.target.value)}
          />
        </Field>
        <Field label={`${t('Starts', '开始')} *`}>
          <input
            type="datetime-local"
            className={INPUT}
            value={f.starts_at}
            onChange={(e) => set('starts_at', e.target.value)}
          />
        </Field>
        <Field label={t('Ends (optional)', '结束（可选）')}>
          <input
            type="datetime-local"
            className={INPUT}
            value={f.ends_at}
            onChange={(e) => set('ends_at', e.target.value)}
          />
        </Field>
        <Field
          label={t('Free-gift deadline', '福利截止时间')}
          hint={t(
            'Register and create an account by this time to get the free gift. Empty = event start.',
            '在此时间前报名并注册账户可领取福利。留空 = 活动开始时间。',
          )}
        >
          <input
            type="datetime-local"
            className={INPUT}
            value={f.perk_deadline}
            onChange={(e) => set('perk_deadline', e.target.value)}
          />
        </Field>
        <Field
          label={t('Free gift (Chinese)', '福利礼品（中文）')}
          hint={t(
            'Name the gift in both languages, or leave both empty for no free gift.',
            '请用中英文填写礼品名称；都留空表示没有福利。',
          )}
        >
          <input
            className={INPUT}
            value={f.perk_item_zh}
            placeholder="月饼"
            onChange={(e) => set('perk_item_zh', e.target.value)}
          />
        </Field>
        <Field label={t('Free gift (English)', '福利礼品（英文）')}>
          <input
            className={INPUT}
            value={f.perk_item_en}
            placeholder="mooncake"
            onChange={(e) => set('perk_item_en', e.target.value)}
          />
        </Field>
        <div className="md:col-span-2">
          <ImageField value={f.image_url} onChange={(url) => set('image_url', url)} />
        </div>
        <Field label={t('Description', '描述')} className="md:col-span-2">
          <textarea
            className={TEXTAREA}
            rows={3}
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <Field
          label={t('Chinese description (optional)', '中文描述（可选）')}
          className="md:col-span-2"
        >
          <textarea
            className={TEXTAREA}
            rows={3}
            value={f.description_zh}
            onChange={(e) => set('description_zh', e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
        <LiquidToggle
          checked={f.published}
          onChange={(v) => set('published', v)}
          label={t('Published (publicly visible)', '发布（公开可见）')}
        />
        {t('Published (publicly visible)', '发布（公开可见）')}
      </div>

      <div className="border-t border-neutral-200 pt-5 space-y-3">
        <span className="text-xs font-semibold text-brick block">{t('Registration', '报名')}</span>
        <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
          <LiquidToggle
            checked={f.accept}
            onChange={(v) => set('accept', v)}
            label={t('Accept registrations', '接受报名')}
          />
          {t('Accept registrations', '接受报名')}
        </div>
        <p className="text-xs text-neutral-500">
          {t(
            'While the event is published and has not ended, people can register on its registration page. Email is always asked; add any other questions below.',
            '活动发布后、结束前，大家可以在活动报名页报名。报名表始终收集邮箱；其他问题请在下方添加。',
          )}
        </p>
        {regCount > 0 && (
          <Notice tone="warn">
            {t(
              `${regCount} registration(s) so far. Changing the questions does not change the answers already given.`,
              `目前已有 ${regCount} 人报名。修改问题不会改变已提交的答案。`,
            )}
          </Notice>
        )}
        {/* The questions are kept while registration is switched off. */}
        {f.accept && (
          <>
            <TemplateBar kind="registration" questions={questions} onFill={setQuestions} />
            <QuestionBuilder questions={questions} onChange={setQuestions} />
          </>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-5 space-y-3">
        <span className="text-xs font-semibold text-brick block">{t('Volunteers', '志愿者')}</span>
        <div className="flex items-center gap-3 text-sm font-semibold text-neutral-700">
          <LiquidToggle
            checked={f.ownVolunteer}
            onChange={(v) => set('ownVolunteer', v)}
            label={t('Ask this event’s own volunteer questions', '为本活动设置专属志愿者问题')}
          />
          {t('Ask this event’s own volunteer questions', '为本活动设置专属志愿者问题')}
        </div>
        <p className="text-xs text-neutral-500">
          {t(
            'While the event is published and has not ended, people can sign up to help on its volunteer page (/events/<slug>/volunteer/). Name, email and phone are always asked. Switched off, the page asks the site’s default volunteer questions; switched on, it asks the questions below — shifts, stations, whatever this event needs.',
            '活动发布后、结束前，大家可以在活动的志愿者报名页（/events/<slug>/volunteer/）报名帮忙。姓名、邮箱和电话始终收集。关闭时，报名页使用网站默认的志愿者问题；开启后，使用下方的问题——班次、岗位，按本活动的需要设置。',
          )}
        </p>
        {f.ownVolunteer && (
          <>
            <TemplateBar kind="volunteer" questions={volQuestions} onFill={setVolQuestions} />
            <QuestionBuilder questions={volQuestions} onChange={setVolQuestions} />
          </>
        )}
      </div>

      {confirming && (
        <div className="space-y-3">
          <Notice tone="warn">
            {t(
              `${regCount} people have already registered for this event. Their answers stay as they are, so answers to changed or removed questions and options may no longer match the form. Save the new questions?`,
              `已有 ${regCount} 人报名此活动。已提交的答案不会随之修改，修改或删除的问题和选项可能与已有答案对不上。确定保存新的问题吗？`,
            )}
          </Notice>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY}
              disabled={busy}
              onClick={() => void save(true)}
            >
              {t('Save the new questions', '保存新的问题')}
            </button>
            <button type="button" className={SECONDARY} onClick={() => setConfirming(false)}>
              {t('Cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {msg && <Notice tone="error">{msg}</Notice>}
      {!confirming && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={PRIMARY} disabled={busy}>
            {edit ? t('Save', '保存') : t('Create event', '创建活动')}
          </button>
          <button type="button" className={SECONDARY} onClick={onCancel}>
            {t('Cancel', '取消')}
          </button>
        </div>
      )}
    </form>
  );
}
