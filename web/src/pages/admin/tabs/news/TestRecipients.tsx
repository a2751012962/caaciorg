import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { mountIn, riseFromSm, shown } from '../../../../lib/motion';
import { LABEL, SELECT, useAdmin } from '../../kit';

export interface TestRecipientList {
  self: string;
  /** null when the admin accounts could not be read. */
  admins: string[] | null;
}

// Who a test email goes to, as ticks in a dropdown: you, always (ticked and
// fixed), and whichever other admin accounts are ticked. The API still refuses
// any address that is not an admin account.
export function TestRecipients({
  list,
  picked,
  onChange,
}: {
  /** null = GET /api/admin/news failed. */
  list: TestRecipientList | null;
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  const { t } = useAdmin();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const admins = list?.admins;
  const note = admins
    ? t('No other admin accounts.', '没有其他管理员账号。')
    : t("Couldn't load the admin accounts.", '无法加载管理员账号。');
  const n = picked.length;
  const toggle = (email: string, on: boolean) =>
    onChange(on ? [...picked, email] : picked.filter((x) => x !== email));

  const row =
    'flex items-center gap-3 min-h-[44px] px-3 rounded-xl text-sm text-neutral-800 break-all';
  const tick = (on: boolean, fixed = false) => (
    <span
      className={`w-5 h-5 shrink-0 rounded-md border inline-flex items-center justify-center ${
        on
          ? fixed
            ? 'bg-neutral-400 border-neutral-400 text-white'
            : 'bg-brick border-brick text-white'
          : 'bg-white border-neutral-300'
      }`}
      aria-hidden
    >
      {on && <Check className="w-3.5 h-3.5" />}
    </span>
  );

  return (
    <div ref={box} className="relative">
      <span className={LABEL} id="news-test-to-label">
        {t('Test recipients', '测试收件人')}
      </span>
      <button
        type="button"
        className={`${SELECT} text-left flex items-center justify-between gap-2`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby="news-test-to-label news-test-to-btn"
        id="news-test-to-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">
          {n ? t(`You + ${n} admin(s)`, `你自己 + ${n} 位管理员`) : t('Just you', '只发给你自己')}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-neutral-500" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="menu"
            initial={riseFromSm}
            animate={shown}
            exit={{ opacity: 0 }}
            transition={mountIn}
            className="absolute z-20 left-0 right-0 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-lg p-1.5"
            role="group"
            aria-labelledby="news-test-to-label"
          >
            {list?.self && (
              <div className={`${row} text-neutral-500`}>
                {tick(true, true)}
                <span className="min-w-0">
                  {list.self} <span className="text-neutral-400">{t('(you)', '（你自己）')}</span>
                </span>
              </div>
            )}
            {(admins || []).map((email) => {
              const on = picked.includes(email);
              return (
                <label
                  key={email}
                  className={`${row} cursor-pointer hover:bg-neutral-50 focus-within:ring-2 focus-within:ring-brick`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={(e) => toggle(email, e.target.checked)}
                  />
                  {tick(on)}
                  <span className="min-w-0">{email}</span>
                </label>
              );
            })}
            {!admins?.length && <p className="px-3 py-2 text-xs text-neutral-500">{note}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <span className="block mt-1.5 text-[11px] text-neutral-500">
        {t(
          'A test email always goes to you. Tick other admin accounts to add them.',
          '测试邮件总会发给你自己；可以再勾选其他管理员账号。',
        )}
      </span>
    </div>
  );
}
