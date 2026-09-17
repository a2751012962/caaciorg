// The registration form's question builder: add, remove, reorder (up/down),
// pick an answer type, mark required, and for choice questions edit the
// options and "Other"; number questions take optional whole-number bounds.
// A question switched to a text type keeps its options in the draft, so
// switching back restores them (questionsPayload drops them on save).
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { INPUT, LABEL, LiquidToggle, SELECT, useAdmin } from '../../kit';
import {
  CHOICE_TYPES,
  MAX_LABEL,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  Q_TYPES,
  blankOption,
  blankQuestion,
  moved,
  typeName,
  type DraftQuestion,
  type QuestionType,
} from './rules';

const ICON_BTN =
  'w-11 h-11 shrink-0 rounded-full border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-800 hover:text-neutral-900 inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const ICON_DANGER =
  'w-11 h-11 shrink-0 rounded-full border border-neutral-200 bg-white text-rose-700 hover:border-rose-600 inline-flex items-center justify-center cursor-pointer transition-colors';
const SMALL_BTN =
  'min-h-[44px] px-4 rounded-full border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 hover:border-neutral-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function QuestionBuilder({
  questions,
  onChange,
}: {
  questions: DraftQuestion[];
  onChange: (qs: DraftQuestion[]) => void;
}) {
  const { t } = useAdmin();
  const names = typeName(t);
  const setQ = (i: number, patch: Partial<DraftQuestion>) =>
    onChange(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="text-sm text-neutral-500">
          {t(
            'No questions yet: the form asks only for an email address.',
            '暂无问题：表单只收集邮箱地址。',
          )}
        </p>
      )}
      {questions.map((q, i) => (
        <div
          key={q.id || i}
          className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-neutral-500">
              {t(`Question ${i + 1}`, `问题 ${i + 1}`)}
            </span>
            <select
              className={`${SELECT} w-auto`}
              value={q.type}
              aria-label={t('Answer type', '答题类型')}
              onChange={(e) => {
                const type = e.target.value as QuestionType;
                const options =
                  CHOICE_TYPES.has(type) && !q.options.length ? [blankOption(q)] : q.options;
                setQ(i, { type, options });
              }}
            >
              {Q_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {names[ty]}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <LiquidToggle
                checked={q.required}
                onChange={(required) => setQ(i, { required })}
                label={t(`Question ${i + 1} required`, `问题 ${i + 1} 必填`)}
              />
              {t('Required', '必填')}
            </span>
            <div className="flex gap-1.5 ms-auto">
              <button
                type="button"
                className={ICON_BTN}
                disabled={i === 0}
                aria-label={t('Move question up', '上移问题')}
                title={t('Move question up', '上移问题')}
                onClick={() => onChange(moved(questions, i, i - 1))}
              >
                <ArrowUp className="w-4 h-4" aria-hidden />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                disabled={i === questions.length - 1}
                aria-label={t('Move question down', '下移问题')}
                title={t('Move question down', '下移问题')}
                onClick={() => onChange(moved(questions, i, i + 1))}
              >
                <ArrowDown className="w-4 h-4" aria-hidden />
              </button>
              <button
                type="button"
                className={ICON_DANGER}
                aria-label={t('Remove question', '删除问题')}
                title={t('Remove question', '删除问题')}
                onClick={() => onChange(questions.filter((_, k) => k !== i))}
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className={LABEL}>{t('Question (English)', '问题（英文）')}</span>
              <input
                className={INPUT}
                maxLength={MAX_LABEL}
                value={q.label_en}
                onChange={(e) => setQ(i, { label_en: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{t('Question (Chinese)', '问题（中文）')}</span>
              <input
                className={INPUT}
                maxLength={MAX_LABEL}
                value={q.label_zh}
                onChange={(e) => setQ(i, { label_zh: e.target.value })}
              />
            </label>
          </div>

          {CHOICE_TYPES.has(q.type) && (
            <div className="space-y-2">
              <span className={LABEL}>{t('Options', '选项')}</span>
              {q.options.map((o, j) => {
                const setO = (patch: Partial<typeof o>) =>
                  setQ(i, {
                    options: q.options.map((x, k) => (k === j ? { ...x, ...patch } : x)),
                  });
                return (
                  <div key={o.id || j} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      className={`${INPUT} sm:flex-1`}
                      maxLength={MAX_LABEL}
                      placeholder="English"
                      aria-label={t(`Option ${j + 1} (English)`, `选项 ${j + 1}（英文）`)}
                      value={o.label_en}
                      onChange={(e) => setO({ label_en: e.target.value })}
                    />
                    <input
                      className={`${INPUT} sm:flex-1`}
                      maxLength={MAX_LABEL}
                      placeholder="中文"
                      aria-label={t(`Option ${j + 1} (Chinese)`, `选项 ${j + 1}（中文）`)}
                      value={o.label_zh}
                      onChange={(e) => setO({ label_zh: e.target.value })}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className={ICON_BTN}
                        disabled={j === 0}
                        aria-label={t('Move option up', '上移选项')}
                        title={t('Move option up', '上移选项')}
                        onClick={() => setQ(i, { options: moved(q.options, j, j - 1) })}
                      >
                        <ArrowUp className="w-4 h-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={ICON_BTN}
                        disabled={j === q.options.length - 1}
                        aria-label={t('Move option down', '下移选项')}
                        title={t('Move option down', '下移选项')}
                        onClick={() => setQ(i, { options: moved(q.options, j, j + 1) })}
                      >
                        <ArrowDown className="w-4 h-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={ICON_DANGER}
                        aria-label={t('Remove option', '删除选项')}
                        title={t('Remove option', '删除选项')}
                        onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })}
                      >
                        <X className="w-4 h-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={SMALL_BTN}
                  disabled={q.options.length >= MAX_OPTIONS}
                  onClick={() => setQ(i, { options: [...q.options, blankOption(q)] })}
                >
                  <Plus className="w-4 h-4" aria-hidden />
                  {t('Add option', '添加选项')}
                </button>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700">
                  <LiquidToggle
                    checked={q.other}
                    onChange={(other) => setQ(i, { other })}
                    label={t('Allow “Other” with a text box', '允许选“其他”并填写文字')}
                  />
                  {t('Allow “Other” with a text box', '允许选“其他”并填写文字')}
                </span>
              </div>
            </div>
          )}

          {q.type === 'number' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={LABEL}>{t('Smallest allowed (optional)', '最小值（可选）')}</span>
                <input
                  type="number"
                  step={1}
                  className={INPUT}
                  value={q.min}
                  placeholder={t('No minimum', '不限')}
                  onChange={(e) => setQ(i, { min: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={LABEL}>{t('Largest allowed (optional)', '最大值（可选）')}</span>
                <input
                  type="number"
                  step={1}
                  className={INPUT}
                  value={q.max}
                  placeholder={t('No maximum', '不限')}
                  onChange={(e) => setQ(i, { max: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className={SMALL_BTN}
        disabled={questions.length >= MAX_QUESTIONS}
        onClick={() => onChange([...questions, blankQuestion(questions)])}
      >
        <Plus className="w-4 h-4" aria-hidden />
        {t('Add question', '添加问题')}
      </button>
    </div>
  );
}
