import { useId, useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { actionErrorText, cancelRsvp, tr } from '../../lib/account';
import { AccountModal } from './AccountModal';

// Behind FEATURES.rsvpCancel (lib/features.ts): the design's "Cancel RSVP" link
// on an upcoming RSVP and its confirm dialog. Confirming goes through
// cancelRsvp(), which has no backend yet and answers not_available; the card is
// only removed (onCancelled) after a real success.

interface CancelRsvpProps {
  lang: Lang;
  eventId: string;
  onCancelled: () => void;
}

export function CancelRsvp({ lang, eventId, onCancelled }: CancelRsvpProps) {
  const t = tr(lang);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    setError(null);
    setOpen(true);
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await cancelRsvp(eventId);
    setBusy(false);
    if (!res.ok) {
      setError(actionErrorText(res.error, lang));
      return;
    }
    setOpen(false);
    onCancelled();
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="min-h-[36px] text-xs text-neutral-400 hover:text-rose-600 font-medium cursor-pointer inline-flex items-center"
      >
        {t('Cancel RSVP', '取消报名')}
      </button>

      {open && (
        <AccountModal
          onClose={close}
          labelledBy={`${id}-title`}
          className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-neutral-200 space-y-4"
        >
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h4 id={`${id}-title`} className="text-base font-bold text-neutral-900">
              {t('Cancel Event Registration?', '确认取消活动报名？')}
            </h4>
            <p className="text-xs text-neutral-500 mt-1">
              {t(
                'Your RSVP will be withdrawn and your spot released to other community members.',
                '取消后您的报名将被撤销，名额将释放给其他社区成员。',
              )}
            </p>
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

          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="flex-1 min-h-[44px] py-2.5 rounded-full border border-neutral-200 text-xs font-medium cursor-pointer active:scale-98 disabled:opacity-60"
            >
              {t('Keep RSVP', '保留报名')}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="flex-1 min-h-[44px] py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer active:scale-98 disabled:opacity-60"
            >
              {busy ? t('Cancelling…', '正在取消…') : t('Confirm Cancel', '确认取消')}
            </button>
          </div>
        </AccountModal>
      )}
    </>
  );
}
