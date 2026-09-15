import { useId, useState, type FormEvent } from 'react';
import { AlertCircle, Check, CheckCircle2, MessageSquare, Star, X } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { actionErrorText, eventDay, submitEventFeedback, tr } from '../../lib/account';
import type { RegisteredEvent } from '../../types/account';
import { AccountModal } from './AccountModal';

// Behind FEATURES.eventFeedback (lib/features.ts): the design's "Feedback"
// button on a concluded event and its rating dialog. Submitting goes through
// submitEventFeedback(), which has no backend yet and answers not_available.

// The design's highlight tags, with its job-fair-only "Helpful Recruiters" made
// general. The ids are what a backend would store.
const FEEDBACK_TAGS = [
  { id: 'friendly_hosts', en: 'Friendly Hosts', zh: '主办方热情周到' },
  { id: 'well_organized', en: 'Well Organized', zh: '组织井然有序' },
  { id: 'great_networking', en: 'Great Networking', zh: '结识了许多朋友' },
  { id: 'inspiring_sessions', en: 'Inspiring Sessions', zh: '宣讲内容充实' },
  { id: 'convenient_location', en: 'Convenient Location', zh: '场地交通便利' },
  { id: 'need_more_time', en: 'Need More Time', zh: '希望延长交流时间' },
] as const;

const STARS = [1, 2, 3, 4, 5];
const DEFAULT_RATING = 5;
const SENT_CLOSE_MS = 1200;

interface EventFeedbackProps {
  lang: Lang;
  registration: RegisteredEvent;
}

export function EventFeedback({ lang, registration }: EventFeedbackProps) {
  const t = tr(lang);
  const id = useId();
  const { event } = registration;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(DEFAULT_RATING);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // sent: accepted during this visit (the button shows a check).
  // thanks: the dialog is showing its thank-you view.
  const [sent, setSent] = useState(false);
  const [thanks, setThanks] = useState(false);

  const show = () => {
    setError(null);
    setThanks(false);
    setOpen(true);
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    setThanks(false);
  };
  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await submitEventFeedback({
      event_id: event.id,
      rating,
      tags,
      comment: comment.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(actionErrorText(res.error, lang));
      return;
    }
    setSent(true);
    setThanks(true);
    setTimeout(() => {
      setOpen(false);
      setThanks(false);
    }, SENT_CLOSE_MS);
  };

  const shownRating = hover || rating;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="min-h-[32px] px-3 py-1 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-all bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/80 active:scale-95 shadow-2xs"
        title={t('Provide or view event feedback', '填写或查看活动评价反馈')}
      >
        {sent ? (
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        ) : (
          <MessageSquare className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        )}
        <span>{sent ? t('Feedback', '已反馈') : t('Feedback', '活动反馈')}</span>
      </button>

      {open && (
        <AccountModal
          onClose={close}
          labelledBy={`${id}-title`}
          className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-neutral-200 space-y-5 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-neutral-100">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-brick/10 text-brick flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-semibold text-neutral-400">
                  {t('Concluded Event', '往期已结束活动')}
                </span>
                <h4
                  id={`${id}-title`}
                  className="text-base font-bold text-neutral-900 mt-1 leading-snug"
                >
                  {(lang === 'zh' && event.title_zh) || event.title}
                </h4>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 mt-1">
                  <span>{eventDay(event, lang)}</span>
                  {event.location && (
                    <>
                      <span>•</span>
                      <span className="truncate">{event.location}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-full hover:bg-neutral-100 cursor-pointer shrink-0 transition-colors"
              title={t('Close', '关闭')}
              aria-label={t('Close', '关闭')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {thanks ? (
            <div role="status" className="py-8 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h5 className="text-sm font-bold text-neutral-900">
                {t('Feedback Submitted Successfully!', '反馈提交成功！')}
              </h5>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                {t(
                  'Thank you for helping us improve future CAACI community activities.',
                  '感谢您的真诚分享与宝贵建议，CAACI 组委会将持续优化活动体验。',
                )}
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 text-xs">
              {/* Star Rating */}
              <fieldset>
                <legend className="block font-semibold text-neutral-800 mb-2">
                  {t('Overall Experience Rating', '活动整体满意度评星')}
                </legend>
                <div className="flex items-center gap-2">
                  {STARS.map((star) => (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHover(star)}
                      onMouseLeave={() => setHover(0)}
                      onClick={() => setRating(star)}
                      aria-pressed={rating === star}
                      className="p-1 cursor-pointer transition-transform hover:scale-110 active:scale-95"
                      title={t(`${star} Star${star > 1 ? 's' : ''}`, `${star} 星`)}
                    >
                      <Star
                        className={`w-7 h-7 ${
                          shownRating >= star ? 'text-amber-400 fill-amber-400' : 'text-neutral-300'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="text-xs font-bold text-neutral-700 ml-2 font-mono">
                    {shownRating} / 5
                  </span>
                </div>
              </fieldset>

              {/* Quick Impression Tags */}
              <fieldset>
                <legend className="block font-semibold text-neutral-800 mb-2">
                  {t('Key Highlights & Impressions', '活动亮点与直观印象')}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {FEEDBACK_TAGS.map((tag) => {
                    const selected = tags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        aria-pressed={selected}
                        className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all border active:scale-95 ${
                          selected
                            ? 'bg-brick text-white border-brick'
                            : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                        }`}
                      >
                        {t(tag.en, tag.zh)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Detailed comments */}
              <div>
                <label
                  htmlFor={`${id}-comment`}
                  className="block font-semibold text-neutral-800 mb-1.5"
                >
                  {t('Detailed Feedback & Suggestions (Optional)', '心得体验与改进建议（选填）')}
                </label>
                <textarea
                  id={`${id}-comment`}
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t(
                    'Share your thoughts, memorable moments, or suggestions for next year...',
                    '请写下您对本次活动的感受、难忘瞬间或对下届活动形式的建议...',
                  )}
                  className="w-full p-3 text-xs bg-neutral-50 border border-neutral-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-brick text-neutral-900 resize-none"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Footer Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 min-h-[44px] py-2.5 rounded-full bg-brick hover:brightness-110 text-white text-xs font-semibold cursor-pointer shadow-xs active:scale-98 disabled:opacity-60"
                >
                  {busy ? t('Submitting…', '正在提交…') : t('Submit Feedback', '提交反馈评价')}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={busy}
                  className="min-h-[44px] px-5 py-2.5 rounded-full border border-neutral-200 hover:bg-neutral-50 text-neutral-700 text-xs font-medium cursor-pointer active:scale-98 disabled:opacity-60"
                >
                  {t('Cancel', '取消')}
                </button>
              </div>
            </form>
          )}
        </AccountModal>
      )}
    </>
  );
}
