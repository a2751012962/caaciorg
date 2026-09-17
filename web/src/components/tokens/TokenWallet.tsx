import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Coins, History, LayoutDashboard, Plus, Send, Store, Wrench, X } from 'lucide-react';
import type { Lang } from '../../lib/lang';
import { overlayIn, sheetFrom, sheetIn, sheetOut, sheetShown } from '../../lib/motion';
import {
  day,
  kindLabel,
  lineText,
  pickName,
  refusalText,
  tokens,
  usd,
  when,
  type Wallet,
} from '../../lib/tokens';
import { INPUT, LABEL, Notice, PRIMARY, SECONDARY, Status, tr } from './ui';

const SHOWN = 6;

// The phone buttons that open a sheet: full width, one line even at 320px, so no
// letter-spacing (that is for the uppercase English primary button) and less padding.
const SHEET_BUTTON_BASE =
  'w-full min-h-[48px] px-3 rounded-full text-sm font-semibold whitespace-nowrap inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors active:scale-98';
const SHEET_BUTTON_PRIMARY = `${SHEET_BUTTON_BASE} bg-brick hover:bg-brick-hover text-white shadow-xs`;
const SHEET_BUTTON = `${SHEET_BUTTON_BASE} bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900`;
type Sheet = 'buy' | 'history' | 'send' | null;

// The member's tokens on /account/: balance, what expires next, buying a pack,
// sending tokens to family, and the history. Renders nothing at all while the
// server says tokens are off (GET /api/tokens/me -> { enabled: false }), so the
// account page is unchanged until the switch is thrown.
//
// On a phone the wallet is the balance and two plain buttons, Buy and History,
// each opening a bottom sheet. Nothing on the page moves, so the member card's
// QR below — what actually pays — stays where it was. On a wide screen the same
// parts are laid out in two columns instead.
export function TokenWallet({ lang, className = '' }: { lang: Lang; className?: string }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    const res = await tokens.wallet();
    if (res.ok) setWallet(res.data);
  }, []);

  useEffect(() => {
    void load();
    // Back from Stripe: say so, and look again shortly — the webhook that
    // credits the pack can land a moment after the redirect.
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('tokens');
    if (!flag) return;
    url.searchParams.delete('tokens');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (flag !== 'bought') return;
    setNotice('bought');
    const timers = [3000, 8000].map((ms) => window.setTimeout(() => void load(), ms));
    return () => timers.forEach(window.clearTimeout);
  }, [load]);

  if (!wallet?.enabled) return null;

  const open = (next: Sheet) => {
    setError('');
    setSheet(next);
  };

  const buy = async (cents: number) => {
    setBusy(`buy-${cents}`);
    setError('');
    const res = await tokens.buy(cents);
    if (res.ok && res.data.url) return window.location.assign(res.data.url);
    setBusy('');
    setError(refusalText(res, lang));
  };

  const send = async () => {
    const n = Number(amount);
    if (!to || !n) return;
    setBusy('send');
    setError('');
    const res = await tokens.transfer(to, n);
    setBusy('');
    if (!res.ok) return setError(refusalText(res, lang));
    setAmount('');
    setSheet(null);
    setNotice('sent');
    void load();
  };

  const zh = lang === 'zh';
  const { roles } = wallet;
  const canSend = wallet.family.length > 0 && wallet.balance > 0;

  // ---- the parts, shared by the phone sheets and the wide layout ----

  const buyPart = (
    <div className="space-y-5">
      <p className="text-xs text-neutral-600 leading-relaxed">
        {t(
          'Pay at CAACI events and partner shops: show the QR on your member card and the clerk takes the tokens. You get an email each time.',
          '在华协活动和合作商家消费：出示会员卡二维码，由店员扣币。每次扣币你都会收到邮件。',
        )}
      </p>
      {wallet.can_buy ? (
        <div>
          <p className={LABEL}>{t('Choose an amount', '选择金额')}</p>
          <div className="grid grid-cols-2 gap-2">
            {wallet.packs.map((p) => (
              <button
                key={p.cents}
                type="button"
                disabled={!!busy}
                onClick={() => void buy(p.cents)}
                className="min-h-[64px] px-4 py-2.5 rounded-xl border border-neutral-300 bg-neutral-50 hover:border-brick hover:text-brick text-left cursor-pointer transition-colors disabled:opacity-60"
              >
                <span className="block text-base font-bold tabular-nums">
                  {p.tokens} {t('tokens', '币')}
                </span>
                <span className="block text-xs text-neutral-500">
                  {busy === `buy-${p.cents}` ? t('Opening…', '正在打开…') : usd(p.charge_cents)}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
            {t(
              'Pay by card on the next page. Prices include the 3.5% card fee. Bought tokens never expire and are not refundable for cash.',
              '下一步用银行卡付款。价格已含 3.5% 刷卡手续费。购买的币不过期，不可兑换现金。',
            )}
          </p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          {t(
            'Join CAACI (the free plan counts) to buy tokens.',
            '加入华协（免费会员即可）后可购买。',
          )}
        </p>
      )}
    </div>
  );

  // rendered in two places (wide layout, phone sheet), so the ids carry where
  const sendPart = (where: 'inline' | 'sheet') => (
    <div className="space-y-3">
      <div>
        <label className={LABEL} htmlFor={`tokens-send-to-${where}`}>
          {t('Family member', '家人')}
        </label>
        <select
          id={`tokens-send-to-${where}`}
          className={INPUT}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          <option value="">{t('Choose…', '请选择…')}</option>
          {wallet.family.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL} htmlFor={`tokens-send-amount-${where}`}>
          {t(`Tokens (you have ${wallet.balance})`, `币数（余额 ${wallet.balance}）`)}
        </label>
        <input
          id={`tokens-send-amount-${where}`}
          className={INPUT}
          inputMode="numeric"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 5))}
        />
      </div>
      <button
        type="button"
        className={`${PRIMARY} w-full`}
        disabled={!to || !Number(amount) || busy === 'send'}
        onClick={() => void send()}
      >
        <Send className="w-4 h-4" aria-hidden />
        {busy === 'send' ? t('Sending…', '转出中…') : t('Send', '转出')}
      </button>
    </div>
  );

  const historyPart = (
    <div>
      {wallet.history.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('Nothing yet.', '暂无记录。')}</p>
      ) : (
        <ul className="divide-y divide-neutral-200/80">
          {(all ? wallet.history : wallet.history.slice(0, SHOWN)).map((tx) => (
            <li key={tx.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 truncate">
                  {tx.kind === 'charge' && tx.merchant
                    ? pickName(tx.merchant, lang)
                    : kindLabel(tx.kind, lang)}
                </p>
                <p className="text-xs text-neutral-500 truncate">
                  {when(tx.at, lang)}
                  {lineText(tx.items, lang) ? ` · ${lineText(tx.items, lang)}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p
                  className={`text-sm font-bold tabular-nums ${tx.amount > 0 ? 'text-emerald-700' : 'text-neutral-900'}`}
                >
                  {tx.amount > 0 ? `+${tx.amount}` : `−${-tx.amount}`}
                </p>
                {tx.state === 'voided' && <Status tone="muted">{t('Cancelled', '已撤销')}</Status>}
                {tx.state === 'reversed' && <Status tone="muted">{t('Refunded', '已退回')}</Status>}
                {tx.state === 'disputed' && (
                  <Status tone="warn">{t('Under review', '核实中')}</Status>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {wallet.history.length > SHOWN && (
        <button
          type="button"
          className="mt-1 min-h-[44px] text-xs font-semibold text-neutral-700 hover:text-brick cursor-pointer"
          onClick={() => setAll(!all)}
        >
          {all ? t('Show fewer', '收起') : t('Show more', '显示更多')}
        </button>
      )}
    </div>
  );

  const sheetTitle =
    sheet === 'buy'
      ? t('Buy tokens', '购买华协币')
      : sheet === 'send'
        ? t('Send to family', '转给家人')
        : t('History', '消费记录');

  return (
    <section
      id="tokens"
      className={`pt-5 border-t border-neutral-200/80 space-y-4 scroll-mt-24 font-poppins ${className}`}
    >
      <div className="lg:grid lg:grid-cols-2 lg:gap-10">
        <div className="space-y-4">
          <div>
            <span className="text-xs font-semibold text-brick flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5" aria-hidden />
              {t('CAACI Tokens', '华协币')}
            </span>
            <p className="text-4xl font-bold text-ink tabular-nums mt-2">{wallet.balance}</p>
            <p className="text-xs text-neutral-500 mt-1">
              {t(`${wallet.rate} tokens = $1`, `${wallet.rate} 币 = $1`)}
              {wallet.expiring && (
                <span className="whitespace-nowrap">
                  {' · '}
                  {t(
                    `${wallet.expiring.amount} expire ${day(wallet.expiring.at, lang)}`,
                    `${wallet.expiring.amount} 币于 ${day(wallet.expiring.at, lang)}过期`,
                  )}
                </span>
              )}
            </p>
          </div>

          {notice === 'bought' && (
            <Notice tone="success">
              {t(
                'Thank you! Your tokens appear here within a minute of the payment.',
                '感谢购买！币会在付款后一分钟内到账。',
              )}
            </Notice>
          )}
          {notice === 'sent' && <Notice tone="success">{t('Sent.', '已转出。')}</Notice>}
          {error && !sheet && <Notice tone="error">{error}</Notice>}

          {/* phone: two plain buttons, each opening a sheet */}
          <div className="lg:hidden space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={SHEET_BUTTON_PRIMARY} onClick={() => open('buy')}>
                <Plus className="w-4 h-4" aria-hidden />
                {t('Buy tokens', '购买华协币')}
              </button>
              <button type="button" className={SHEET_BUTTON} onClick={() => open('history')}>
                <History className="w-4 h-4" aria-hidden />
                {t('History', '消费记录')}
              </button>
            </div>
            {canSend && (
              <button type="button" className={SHEET_BUTTON} onClick={() => open('send')}>
                <Send className="w-4 h-4" aria-hidden />
                {t('Send to family', '转给家人')}
              </button>
            )}
          </div>

          {/* wide screen: laid out in place */}
          <div className="hidden lg:block space-y-6">
            {buyPart}
            {canSend && (
              <div>
                <p className="text-xs font-bold text-neutral-500 mb-3">
                  {t('Send to family', '转给家人')}
                </p>
                {sendPart('inline')}
              </div>
            )}
          </div>
        </div>

        <div className="hidden lg:block">
          <p className={LABEL}>{t('History', '消费记录')}</p>
          {historyPart}
        </div>
      </div>

      {(roles.merchants.length > 0 || roles.admin) && (
        <div className="pt-4 border-t border-neutral-200/80 flex flex-wrap gap-2">
          {roles.merchants.length > 0 && (
            <a className={SECONDARY} href={`${zh ? '/zh' : ''}/merchant/`}>
              <Store className="w-4 h-4" aria-hidden />
              {t('Merchant console', '商家中台')}
            </a>
          )}
          {roles.admin && (
            <a className={SECONDARY} href={`${zh ? '/zh' : ''}/token-admin/`}>
              <Wrench className="w-4 h-4" aria-hidden />
              {t('Token back office', '代币后台')}
            </a>
          )}
          {roles.admin && (
            <a className={SECONDARY} href="/admin/">
              <LayoutDashboard className="w-4 h-4" aria-hidden />
              {t('Admin', '管理后台')}
            </a>
          )}
        </div>
      )}

      <BottomSheet open={!!sheet} title={sheetTitle} lang={lang} onClose={() => setSheet(null)}>
        {error && <Notice tone="error">{error}</Notice>}
        {sheet === 'buy' && buyPart}
        {sheet === 'send' && sendPart('sheet')}
        {sheet === 'history' && historyPart}
      </BottomSheet>
    </section>
  );
}

// A sheet that rises from the bottom of a phone screen. It closes on the ×, a
// tap on the dimmed page or Escape, and the page behind does not scroll while
// it is open. Focus moves to the close button when it opens.
function BottomSheet({
  open,
  title,
  lang,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  lang: Lang;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      root.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={overlayIn}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tokens-sheet-title"
            className="absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col bg-white rounded-t-2xl shadow-2xl"
            initial={sheetFrom}
            animate={sheetShown}
            exit={{ ...sheetFrom, transition: sheetOut }}
            transition={sheetIn}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
              <h3
                id="tokens-sheet-title"
                className="text-lg font-bold font-serif-caaci text-maroon"
              >
                {title}
              </h3>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brick"
                aria-label={tr(lang, 'Close', '关闭')}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
