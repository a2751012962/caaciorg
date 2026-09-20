import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { CARD, Notice, PRIMARY, SECONDARY, Spinner, ToolPage, tr } from '../components/tokens/ui';
import { loginUrl, useAuth } from '../lib/auth';
import type { Lang } from '../lib/lang';
import { newIdemKey, pickName, refusalText, tokens, usd, type PayCode } from '../lib/tokens';

const CODE_RE = /^[2-9A-HJ-NP-TV-Z]{6,16}$/;

interface Done {
  txId: string;
  confirm: string;
  amount: number;
  balance: number;
  at: number;
}

// /pay/?c=<code> — the page a printed QR opens (0030). The sticker is on the
// product, so the visitor may well arrive signed out and not even be a member:
// the code is read first, and asks for a sign-in only when they mean to pay.
// Nothing is taken without a tap — a scanner app that prefetches the URL must
// not be able to spend anything.
export function PayPage({ lang }: { lang: Lang }) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const auth = useAuth();
  const code = useMemo(
    () => (new URLSearchParams(window.location.search).get('c') || '').trim().toUpperCase(),
    [],
  );

  const [info, setInfo] = useState<PayCode | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  // One key per attempt, so a tap that lost the connection and was tried again
  // takes the tokens once. A finished payment gets a fresh one for the next cup.
  const [idem, setIdem] = useState(newIdemKey);

  const load = useCallback(async () => {
    if (!CODE_RE.test(code)) return;
    const res = await tokens.payCode(code);
    if (res.ok) {
      setInfo(res.data);
      setLoadError('');
    } else if (res.status === 404) {
      setLoadError(tr(lang, 'This QR code is not in use.', '这个二维码已失效。'));
    } else {
      setLoadError(refusalText(res, lang));
    }
  }, [code, lang]);

  // Reloaded once the session is known, so the balance appears the moment the
  // visitor comes back from signing in.
  useEffect(() => {
    if (auth.ready) void load();
  }, [auth.ready, auth.user, load]);

  const pay = async (allowRepeat = false) => {
    if (!info) return;
    setBusy(true);
    setError('');
    const res = await tokens.pay({ code, idem_key: idem, allow_repeat: allowRepeat });
    setBusy(false);
    if (!res.ok) {
      if (res.data.code === 'repeat_too_soon') return setRepeat(refusalText(res, lang));
      setRepeat('');
      setError(refusalText(res, lang));
      void load();
      return;
    }
    setRepeat('');
    setDone({
      txId: res.data.tx_id,
      confirm: res.data.confirm,
      amount: res.data.amount,
      balance: res.data.balance,
      at: Date.now(),
    });
    setIdem(newIdemKey());
    setInfo((i) => (i ? { ...i, balance: res.data.balance } : i));
  };

  const eyebrow = t('CAACI Tokens', '华协币');
  const title = t('Pay with tokens', '用华协币支付');

  if (!CODE_RE.test(code) || loadError)
    return (
      <ToolPage eyebrow={eyebrow} title={title}>
        <Notice tone="error">
          {loadError || t('This QR code is not in use.', '这个二维码已失效。')}
        </Notice>
        <p className="text-xs text-neutral-500">
          {t(
            'Please pay at the counter, and let the stall know the sticker needs replacing.',
            '请到柜台付款，并告诉摊位这张贴纸需要更换。',
          )}
        </p>
      </ToolPage>
    );

  if (!info)
    return (
      <ToolPage eyebrow={eyebrow} title={title}>
        <Spinner label={t('Loading…', '加载中…')} />
      </ToolPage>
    );

  const itemName = lang === 'zh' && info.item.name_zh ? info.item.name_zh : info.item.name;
  const shopName = pickName(info.merchant, lang);
  const short = info.balance === null ? 0 : info.item.tokens - info.balance;

  if (done)
    return (
      <ToolPage eyebrow={eyebrow} title={t('Paid', '支付成功')}>
        <Receipt done={done} itemName={itemName} shopName={shopName} lang={lang} />
        <button
          type="button"
          className={`${SECONDARY} w-full`}
          onClick={() => {
            setDone(null);
            setError('');
          }}
        >
          {t('Buy another one', '再买一份')}
        </button>
        <p className="text-[11px] text-neutral-500 text-center">
          {t(
            'A receipt is on its way to your email. If this wasn’t you, the link in it tells CAACI.',
            '回执邮件正在发送。如果这不是你本人支付，邮件里的链接可以直接申诉。',
          )}
        </p>
      </ToolPage>
    );

  return (
    <ToolPage eyebrow={eyebrow} title={title}>
      {/* What the sticker stands for. The shop's name is the thing to read
          before tapping: a code sent to you by someone else looks exactly like
          a code on a cup, and only this line tells them apart. */}
      <div className={`${CARD} text-center`}>
        <p className="text-xs text-neutral-500">{t('Paying', '支付给')}</p>
        <p className="text-lg font-bold text-maroon truncate">{shopName}</p>
        <p className="mt-4 text-sm text-neutral-700">{itemName}</p>
        <p className="text-5xl font-bold text-brick tabular-nums mt-1">{info.item.tokens}</p>
        <p className="text-xs text-neutral-500">
          {t('tokens', '华协币')} · {usd((info.item.tokens * 100) / info.rate)}
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {!info.open ? (
        <Notice tone="warn">
          {info.suspended
            ? t(
                'This shop is on hold. Please pay at the counter.',
                '该商家已被暂停，请到柜台付款。',
              )
            : t(
                'This shop does not take scan-to-pay yet. Please pay at the counter.',
                '该商家暂不支持扫码付款，请到柜台付款。',
              )}
        </Notice>
      ) : !info.signed_in ? (
        <>
          <a
            href={loginUrl(window.location.pathname + window.location.search)}
            className={`${PRIMARY} w-full`}
          >
            {t('Sign in to pay', '登录后支付')}
          </a>
          <p className="text-xs text-neutral-500 text-center">
            {t(
              'Tokens come with a CAACI membership. Nothing is charged until you tap again after signing in.',
              '华协币随会员资格发放。登录后还需再点一次确认，才会扣币。',
            )}
          </p>
        </>
      ) : short > 0 ? (
        <>
          <Notice tone="warn">
            {t(
              `${short} tokens short — your balance is ${info.balance}.`,
              `还差 ${short} 币，当前余额 ${info.balance} 币。`,
            )}
          </Notice>
          <a href={lang === 'zh' ? '/zh/account/' : '/account/'} className={`${SECONDARY} w-full`}>
            {t('Top up', '去充值')}
          </a>
        </>
      ) : repeat ? (
        <div className="space-y-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-sm text-amber-900 font-semibold">
            {repeat} {t('Pay for it again?', '要再付一次吗？')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${PRIMARY} flex-1`}
              disabled={busy}
              onClick={() => void pay(true)}
            >
              {busy
                ? t('Paying…', '支付中…')
                : t(`Yes, pay ${info.item.tokens} again`, `是，再付 ${info.item.tokens} 币`)}
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              onClick={() => setRepeat('')}
            >
              {t('No', '不用')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`${PRIMARY} w-full`}
            disabled={busy}
            onClick={() => void pay()}
          >
            {busy
              ? t('Paying…', '支付中…')
              : t(`Pay ${info.item.tokens} tokens`, `支付 ${info.item.tokens} 币`)}
          </button>
          <p className="text-xs text-neutral-500 text-center">
            {t(
              `Balance ${info.balance} · show the next screen to the stall.`,
              `余额 ${info.balance} 币 · 支付后把下一屏给摊位看。`,
            )}
          </p>
        </>
      )}

      <p className="text-[11px] text-neutral-500 text-center flex items-center justify-center gap-1.5">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {t(
          'Only pay a shop you are standing in. CAACI will never send you this link.',
          '只在你本人到店时付款。华协不会通过私信发送付款链接。',
        )}
      </p>
    </ToolPage>
  );
}

// The proof at the counter. The confirmation code is what the stall checks
// against its own console — and the clock keeps running, so a screenshot taken
// earlier reads "12 minutes ago" instead of "just now".
function Receipt({
  done,
  itemName,
  shopName,
  lang,
}: {
  done: Done;
  itemName: string;
  shopName: string;
  lang: Lang;
}) {
  const t = (en: string, zh: string) => tr(lang, en, zh);
  const [ago, setAgo] = useState(0);
  useEffect(() => {
    const tick = () => setAgo(Math.floor((Date.now() - done.at) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [done.at]);

  const since =
    ago < 60
      ? t(`${ago}s ago`, `${ago} 秒前`)
      : t(`${Math.floor(ago / 60)} min ago`, `${Math.floor(ago / 60)} 分钟前`);

  return (
    <div className="bg-ink text-white rounded-2xl p-6 shadow-xl border border-white/10 text-center">
      <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" aria-hidden />
      <p className="text-4xl font-bold text-gold tabular-nums mt-3">−{done.amount}</p>
      <p className="text-xs text-neutral-400">{t('tokens', '华协币')}</p>
      <p className="text-sm font-semibold mt-3 truncate">{itemName}</p>
      <p className="text-xs text-neutral-300 truncate">{shopName}</p>

      <div className="mt-5 pt-4 border-t border-white/15">
        <p className="text-[11px] text-neutral-400">{t('Show this code', '请出示此确认码')}</p>
        <p className="text-4xl font-bold tracking-[0.3em] tabular-nums">{done.confirm}</p>
        <p className="text-[11px] text-neutral-400 mt-1">
          {new Date(done.at).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US')} · {since}
        </p>
      </div>

      <p className="text-xs text-neutral-300 mt-4">
        {t(`Balance ${done.balance}`, `余额 ${done.balance} 币`)}
      </p>
    </div>
  );
}
