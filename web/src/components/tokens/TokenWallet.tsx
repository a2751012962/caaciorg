import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Coins, Send, Store, Wrench } from 'lucide-react';
import type { Lang } from '../../lib/lang';
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
import { INPUT, LABEL, Notice, SECONDARY, Status, tr } from './ui';

const SHOWN = 6;

// The member's tokens on /account/: balance, what expires next, buying a pack,
// sending tokens to family, and the history. Renders nothing at all while the
// server says tokens are off (GET /api/tokens/me -> { enabled: false }), so the
// account page is unchanged until the switch is thrown.
export function TokenWallet({ lang, className = '' }: { lang: Lang; className?: string }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [all, setAll] = useState(false);
  // The wallet sits at the top of /account/. On a phone only the balance shows
  // until it is opened, so the member card's QR — what actually pays — stays
  // within a thumb's reach; on a wide screen everything is laid out at once.
  const [open, setOpen] = useState(false);
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
    setNotice('sent');
    void load();
  };

  const zh = lang === 'zh';
  const history = all ? wallet.history : wallet.history.slice(0, SHOWN);
  const { roles } = wallet;

  return (
    <section
      id="tokens"
      className={`pt-5 border-t border-neutral-200/80 space-y-5 scroll-mt-24 font-poppins ${className}`}
    >
      <div className="lg:grid lg:grid-cols-2 lg:gap-10">
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-brick flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5" aria-hidden />
                {t('CAACI Tokens', '华协币')}
              </span>
              <p className="text-4xl font-bold text-ink tabular-nums mt-2">{wallet.balance}</p>
              <p className="text-xs text-neutral-500 mt-1">
                {t(`${wallet.rate} tokens = $1`, `${wallet.rate} 币 = $1`)}
                {wallet.expiring &&
                  ` · ${t(`${wallet.expiring.amount} expire ${day(wallet.expiring.at, lang)}`, `其中 ${wallet.expiring.amount} 币将于 ${day(wallet.expiring.at, lang)} 过期`)}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls="tokens-more"
              className="lg:hidden shrink-0 whitespace-nowrap min-h-[44px] px-4 rounded-full border border-neutral-300 bg-neutral-50 text-xs font-semibold text-neutral-700 hover:border-brick hover:text-brick inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {open ? t('Close', '收起') : t('Buy · History', '购买 · 记录')}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
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
          {error && <Notice tone="error">{error}</Notice>}

          <div id="tokens-more" className={`${open ? 'block' : 'hidden'} lg:block space-y-5`}>
            <p className="text-xs text-neutral-600 leading-relaxed">
              {t(
                'Pay at CAACI events and partner shops: show the QR on your member card and the clerk takes the tokens. You get an email each time.',
                '在华协活动和合作商家消费：出示会员卡二维码，由店员扣币。每次扣币你都会收到邮件。',
              )}
            </p>

            {/* buy */}
            <div>
              <p className={LABEL}>{t('Buy tokens', '购买')}</p>
              {wallet.can_buy ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {wallet.packs.map((p) => (
                      <button
                        key={p.cents}
                        type="button"
                        disabled={!!busy}
                        onClick={() => void buy(p.cents)}
                        className="min-h-[56px] px-3 py-2 rounded-xl border border-neutral-300 bg-neutral-50 hover:border-brick hover:text-brick text-left cursor-pointer transition-colors disabled:opacity-60"
                      >
                        <span className="block text-sm font-bold tabular-nums">
                          {p.tokens} {t('tokens', '币')}
                        </span>
                        <span className="block text-[11px] text-neutral-500">
                          {usd(p.charge_cents)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
                    {t(
                      'Prices include the 3.5% card fee. Bought tokens never expire and are not refundable for cash.',
                      '价格已含 3.5% 刷卡手续费。购买的币不过期，不可兑换现金。',
                    )}
                  </p>
                </>
              ) : (
                <p className="text-xs text-neutral-500">
                  {t(
                    'Join CAACI (the free plan counts) to buy tokens.',
                    '加入华协（免费会员即可）后可购买。',
                  )}
                </p>
              )}
            </div>

            {/* send to family */}
            {wallet.family.length > 0 && wallet.balance > 0 && (
              <div>
                <p className={LABEL}>{t('Send to family', '转给家人')}</p>
                <div className="flex gap-2">
                  <select
                    className={INPUT}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    aria-label={t('Family member', '家人')}
                  >
                    <option value="">{t('Choose…', '请选择…')}</option>
                    {wallet.family.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${INPUT} max-w-24`}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={t('Tokens', '币数')}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  />
                  <button
                    type="button"
                    className={SECONDARY}
                    disabled={!to || !Number(amount) || busy === 'send'}
                    onClick={() => void send()}
                  >
                    <Send className="w-4 h-4" aria-hidden />
                    <span className="sr-only sm:not-sr-only">{t('Send', '转出')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* history */}
        <div className={`${open ? 'block' : 'hidden'} lg:block mt-5 lg:mt-0`}>
          <p className={LABEL}>{t('History', '记录')}</p>
          {wallet.history.length === 0 ? (
            <p className="text-xs text-neutral-500">{t('Nothing yet.', '暂无记录。')}</p>
          ) : (
            <ul className="divide-y divide-neutral-200/80">
              {history.map((tx) => (
                <li key={tx.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-neutral-900 truncate">
                      {tx.kind === 'charge' && tx.merchant
                        ? pickName(tx.merchant, lang)
                        : kindLabel(tx.kind, lang)}
                    </p>
                    <p className="text-[11px] text-neutral-500 truncate">
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
                    {tx.state === 'voided' && (
                      <Status tone="muted">{t('Cancelled', '已撤销')}</Status>
                    )}
                    {tx.state === 'reversed' && (
                      <Status tone="muted">{t('Refunded', '已退回')}</Status>
                    )}
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
        </div>
      )}
    </section>
  );
}
